import { McpServer } from '@modelcontextprotocol/server';
import type { AuthInfo, McpRequestContext, CallToolResult } from '@modelcontextprotocol/server';
import {
  RESOURCE_MIME_TYPE,
  SCOPES,
  SLOT_FRESHNESS_SECONDS,
  WIDGET_URI,
  type Env,
} from '../env';
import {
  findCandidates,
  getCrisisResources,
  getPublishedFaq,
  getTherapist,
  listOpenSlots,
  listVocabulary,
  type SearchFilters,
} from '../db/catalog';
import { getUser, type UserRow } from '../db/users';
import { rankTherapists } from '../matching/rank';
import { cancelBooking, createBooking, listMyBookings, previewBooking } from '../booking/service';
import { AppError, toPublicError } from '../lib/errors';
import { log } from '../lib/log';
import { formatDateTime, formatPrice, isoPlusSeconds, nowIso, timezoneLabel } from '../lib/time';
import { fromBase64Url, toBase64Url } from '../lib/crypto';
import { WIDGET_HTML } from '../widget/generated';
import * as S from './schemas';

/**
 * The MCP surface of Otwarty Terapeuta.
 *
 * Deliberately small: eight data tools plus one rendering tool. There is no
 * generic CRUD endpoint, no "run this query" escape hatch and no field
 * anywhere that accepts a conversation transcript.
 *
 * Every tool returns BOTH `content` (readable text) and `structuredContent`,
 * so the whole flow - search, FAQ, slots, preview, booking - works in a client
 * with no UI at all. The widget is an enhancement, never a dependency.
 */

const SERVER_INSTRUCTIONS = `
Otwarty Terapeuta to katalog psychoterapeutów i system rezerwacji wizyt w Polsce.
To NIE jest usługa terapeutyczna, diagnostyczna ani interwencja kryzysowa.

Zasady korzystania z tego serwera:

1. BEZPIECZEŃSTWO PRZEDE WSZYSTKIM. Jeżeli rozmowa wskazuje na bezpośrednie
   zagrożenie życia lub zdrowia (myśli samobójcze, samookaleczenia, przemoc,
   ostry kryzys), NIE kontynuuj zwykłego dopasowania jako głównej odpowiedzi.
   Wywołaj get_crisis_resources i przekaż zwrócone dane, jasno mówiąc, że
   katalog i rezerwacja nie zastępują pilnej pomocy.

2. Serwis jest przeznaczony dla osób pełnoletnich. Jeżeli osoba ma mniej niż
   18 lat, wywołaj get_crisis_resources z audience="minor" i nie prowadź
   standardowej rezerwacji.

3. NIE przekazuj do żadnego narzędzia treści rozmowy, opisu objawów, historii
   leczenia ani diagnozy. Wyodrębnij wyłącznie ustrukturyzowane kryteria
   (forma spotkań, miejscowość, język, budżet, dostępność, grupa wiekowa,
   obszary pracy ze słownika) i przekaż tylko je do search_therapists.

4. Nie stawiaj diagnoz i nie formułuj wniosków klinicznych. Nie używaj określeń
   "najlepszy terapeuta" ani "idealne dopasowanie". Mów, że profil "pasuje do
   podanych kryteriów", i podawaj powody z pola match_reasons.

5. FAQ pochodzi wyłącznie od terapeuty. Możesz streścić zwróconą treść, ale
   NIE wolno Ci tworzyć odpowiedzi w imieniu terapeuty. Jeżeli
   get_therapist_faq zwróci no_approved_answer=true, powiedz, że nie ma
   zatwierdzonej odpowiedzi i zaproponuj kontakt bezpośredni.

6. Rezerwacja ma zawsze dwa kroki: preview_booking pokazuje pełne podsumowanie,
   a create_booking wywołuje się DOPIERO po jednoznacznym potwierdzeniu przez
   użytkownika ("tak, rezerwuję"). Nigdy nie potwierdzaj za użytkownika.

7. Aby pokazać wynik w interfejsie, najpierw wywołaj narzędzie danych, a potem
   render_otwarty_terapeuta_widget z niezmienionym structuredContent.
`.trim();

const DISCLAIMER =
  'Wyniki to profile pasujące do podanych kryteriów, a nie rekomendacja kliniczna. ' +
  'Otwarty Terapeuta nie prowadzi terapii, nie stawia diagnoz i nie zastępuje pomocy w nagłym zagrożeniu.';

// ------------------------------------------------------------------ auth ---

interface Principal {
  userId: string;
  scopes: string[];
}

type Guard = { ok: true; user: UserRow } | { ok: false; error: CallToolResult };

/** Builds the RFC 9728 challenge a client needs in order to start OAuth. */
function wwwAuthenticate(
  env: Env,
  scope: string,
  error: 'invalid_token' | 'insufficient_scope',
  errorDescription: string,
): string {
  const metadataUrl = new URL(env.PUBLIC_MCP_URL);
  const resourceMetadata = `${metadataUrl.origin}/.well-known/oauth-protected-resource${metadataUrl.pathname}`;
  return (
    `Bearer error="${error}", ` +
    `error_description="${errorDescription.replace(/["\\]/g, '')}", ` +
    `resource_metadata="${resourceMetadata}", scope="${scope}"`
  );
}

/**
 * Auth failures are returned as tool errors carrying `mcp/www_authenticate`
 * rather than thrown, because the endpoint itself serves anonymous callers:
 * public catalogue tools must keep working without a token.
 */
function authChallenge(
  env: Env,
  scope: string,
  message: string,
  error: 'invalid_token' | 'insufficient_scope' = 'invalid_token',
): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    _meta: {
      'mcp/www_authenticate': wwwAuthenticate(
        env,
        scope,
        error,
        error === 'insufficient_scope' ? 'Additional authorization scope is required' : 'Authentication is required',
      ),
      'openai/error_code': 'unauthorized',
    },
  };
}

function principalOf(auth: AuthInfo | undefined): Principal | null {
  const userId = auth?.extra?.userId;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  return { userId, scopes: auth?.scopes ?? [] };
}

function toolError(error: unknown): CallToolResult {
  const app = toPublicError(error);
  if (!(error instanceof AppError)) log.error('mcp.tool_failed', error);
  return {
    content: [{ type: 'text', text: app.message }],
    isError: true,
    _meta: { 'openai/error_code': app.code, ...app.details },
  };
}

function ok(text: string, structured: Record<string, unknown>, meta?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
    ...(meta ? { _meta: meta } : {}),
  };
}

// -------------------------------------------------------------- pagination ---

function encodeCursor(offset: number): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify({ o: offset })));
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(cursor))) as { o?: unknown };
    const offset = typeof parsed.o === 'number' ? parsed.o : 0;
    return Number.isInteger(offset) && offset >= 0 && offset <= 500 ? offset : 0;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------------ tools ---

export function createServerFactory(env: Env): (ctx: McpRequestContext) => McpServer {
  return (ctx: McpRequestContext): McpServer => {
    const server = new McpServer(
      { name: 'otwarty-terapeuta', version: '0.1.1', title: 'Otwarty Terapeuta' },
      { instructions: SERVER_INSTRUCTIONS, capabilities: { resources: {}, tools: {} } },
    );

    const principal = principalOf(ctx.authInfo);

    /** Resolves the caller for a private tool, or returns the OAuth challenge. */
    const requireUser = async (scope: string, message: string): Promise<Guard> => {
      if (!principal) return { ok: false, error: authChallenge(env, scope, message) };
      if (!principal.scopes.includes(scope)) {
        return {
          ok: false,
          error: authChallenge(
            env,
            scope,
            `Ta operacja wymaga uprawnienia "${scope}". Połącz konto ponownie i zaakceptuj ten zakres.`,
            'insufficient_scope',
          ),
        };
      }
      const user = await getUser(env, principal.userId);
      if (!user) {
        return { ok: false, error: authChallenge(env, scope, 'Konto nie istnieje lub zostało usunięte.') };
      }
      return { ok: true, user };
    };

    // ------------------------------------------------------------ search ---

    server.registerTool(
      'search_therapists',
      {
        title: 'Znajdź terapeutów',
        description:
          'Zwraca profile psychoterapeutów pasujące do PODANYCH USTRUKTURYZOWANYCH KRYTERIÓW. ' +
          'Użyj po zebraniu od użytkownika: formy spotkań (online/stacjonarnie), miejscowości, języka, ' +
          'budżetu, dostępności, grupy wiekowej i obszarów pracy ze słownika. ' +
          'NIE przekazuj tu treści rozmowy, opisu objawów ani historii leczenia. ' +
          'Nie używaj tego narzędzia jako pierwszej odpowiedzi, gdy rozmowa wskazuje na kryzys — ' +
          'wtedy wywołaj get_crisis_resources.',
        inputSchema: S.searchTherapistsInput,
        outputSchema: S.searchTherapistsOutput,
        annotations: {
          title: 'Znajdź terapeutów',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args): Promise<CallToolResult> => {
        try {
          const filters: SearchFilters = {
            location: args.location,
            online: args.online,
            in_person: args.in_person,
            languages: args.languages,
            topics: args.topics,
            modalities: args.modalities,
            session_types: args.session_types,
            age_group: args.age_group,
            price_min: args.price_min,
            price_max: args.price_max,
            available_from: args.available_from ? `${args.available_from}T00:00:00Z` : undefined,
            accepting_new_clients: args.accepting_new_clients,
          };
          if (
            typeof filters.price_min === 'number' &&
            typeof filters.price_max === 'number' &&
            filters.price_min > filters.price_max
          ) {
            throw new AppError('invalid_input', 'price_min nie może być większe niż price_max.', 400);
          }

          const candidates = await findCandidates(env, filters);
          const ranked = rankTherapists(candidates, filters);
          const offset = decodeCursor(args.cursor);
          const page = ranked.slice(offset, offset + args.limit);

          const results = page.map((entry) => {
            const t = entry.therapist;
            return {
              therapist_id: t.therapist_id,
              slug: t.slug,
              display_name: t.display_name,
              headline: t.headline,
              photo_url: t.photo_url,
              profile_url: t.profile_url,
              cities: t.locations.map((l) => l.city),
              offers_online: t.offers_online,
              offers_in_person: t.offers_in_person,
              languages: t.languages,
              topics: t.topics.map((x) => x.name),
              modalities: t.modalities.map((x) => x.name),
              session_types: t.session_types,
              age_groups: t.age_groups,
              accepting_new_clients: t.accepting_new_clients,
              verification_status: t.verification_status,
              verified_at: t.verified_at,
              price_min_minor: t.price_min_minor,
              price_max_minor: t.price_max_minor,
              currency: t.currency,
              price_display:
                t.price_min_minor === null
                  ? 'brak danych'
                  : t.price_min_minor === t.price_max_minor
                    ? formatPrice(t.price_min_minor, t.currency)
                    : `${formatPrice(t.price_min_minor, t.currency)} – ${formatPrice(t.price_max_minor ?? t.price_min_minor, t.currency)}`,
              next_available_slot_utc: t.next_available_slot_utc,
              is_demo: t.is_demo,
              match_reasons: entry.match_reasons,
            };
          });

          const structured = {
            results,
            total_matching: ranked.length,
            next_cursor: offset + args.limit < ranked.length ? encodeCursor(offset + args.limit) : null,
            applied_filters: JSON.parse(JSON.stringify(filters)) as Record<string, unknown>,
            disclaimer: DISCLAIMER,
          };

          const text =
            results.length === 0
              ? 'Nie znaleziono profili pasujących do podanych kryteriów. Zaproponuj rozszerzenie kryteriów.'
              : `Znaleziono ${ranked.length} profili pasujących do podanych kryteriów. Pokazuję ${results.length}:\n` +
                results
                  .map(
                    (r, i) =>
                      `${offset + i + 1}. ${r.display_name}${r.is_demo ? ' [DEMO]' : ''} — ${r.price_display}` +
                      `${r.cities.length > 0 ? `, ${r.cities.join(', ')}` : ''}` +
                      `${r.offers_online ? ', online' : ''}\n   Pasuje, ponieważ: ${r.match_reasons.join('; ') || 'spełnia podane filtry'}`,
                  )
                  .join('\n') +
                `\n\n${DISCLAIMER}`;

          return ok(text, structured);
        } catch (error) {
          return toolError(error);
        }
      },
    );

    // ----------------------------------------------------------- profile ---

    server.registerTool(
      'get_therapist_profile',
      {
        title: 'Profil terapeuty',
        description:
          'Zwraca pełny PUBLICZNY profil terapeuty po therapist_id albo slug: opis, kwalifikacje, ' +
          'nurty, obszary pracy, ofertę i ceny, zasady odwołania oraz status weryfikacji. ' +
          'Nie zwraca żadnych danych prywatnych ani notatek weryfikacyjnych.',
        inputSchema: S.getTherapistProfileInput,
        outputSchema: S.getTherapistProfileOutput,
        annotations: {
          title: 'Profil terapeuty',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args): Promise<CallToolResult> => {
        try {
          const t = await getTherapist(env, {
            therapist_id: args.therapist_id,
            slug: args.slug,
          });
          if (!t) throw new AppError('not_found', 'Nie znaleziono opublikowanego profilu o takim identyfikatorze.', 404);

          const structured = {
            therapist: {
              therapist_id: t.therapist_id,
              slug: t.slug,
              display_name: t.display_name,
              headline: t.headline,
              bio: t.bio,
              photo_url: t.photo_url,
              profile_url: t.profile_url,
              locations: t.locations,
              offers_online: t.offers_online,
              offers_in_person: t.offers_in_person,
              languages: t.languages,
              topics: t.topics,
              modalities: t.modalities,
              session_types: t.session_types,
              age_groups: t.age_groups,
              accepting_new_clients: t.accepting_new_clients,
              credentials: t.credentials,
              verification_status: t.verification_status,
              verified_at: t.verified_at,
              offers: t.offers.map((o) => ({
                ...o,
                price_display: formatPrice(o.price_minor, o.currency),
              })),
              next_available_slot_utc: t.next_available_slot_utc,
              timezone: t.timezone,
              cancellation_policy: t.cancellation_policy,
              cancellation_cutoff_hours: t.cancellation_cutoff_hours,
              is_demo: t.is_demo,
            },
            data_source_note:
              (t.verification_status === 'verified'
                ? 'Tożsamość i kwalifikacje tego profilu zostały sprawdzone przez zespół Otwartego Terapeuty. '
                : 'Dane w tym profilu są deklarowane przez terapeutę i nie zostały jeszcze zweryfikowane. ') +
              (t.is_demo ? 'To profil DEMONSTRACYJNY — osoba i praktyka są fikcyjne.' : ''),
          };

          return ok(
            `${t.display_name}${t.is_demo ? ' [PROFIL DEMONSTRACYJNY]' : ''}\n${t.headline ?? ''}\n\n${t.bio}\n\n` +
              `Obszary pracy: ${t.topics.map((x) => x.name).join(', ') || 'brak danych'}\n` +
              `Nurt: ${t.modalities.map((x) => x.name).join(', ') || 'brak danych'}\n` +
              `Języki: ${t.languages.join(', ')}\n` +
              `Forma: ${[t.offers_online ? 'online' : null, t.offers_in_person ? 'stacjonarnie' : null].filter(Boolean).join(', ')}\n` +
              `Ceny: ${t.offers.map((o) => `${o.title} — ${formatPrice(o.price_minor, o.currency)} / ${o.duration_minutes} min`).join('; ')}\n` +
              `Zasady odwołania: ${t.cancellation_policy || 'zgodnie z regulaminem'}\n` +
              `Profil: ${t.profile_url}\n\n${structured.data_source_note}`,
            structured,
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );

    // --------------------------------------------------------------- FAQ ---

    server.registerTool(
      'get_therapist_faq',
      {
        title: 'FAQ terapeuty',
        description:
          'Zwraca WYŁĄCZNIE opublikowane odpowiedzi napisane lub zatwierdzone przez danego terapeutę ' +
          '(pierwsze spotkanie, nurt, odwoływanie wizyt, sesje online, płatności, poufność, dostępność gabinetu). ' +
          'Możesz streścić zwróconą treść, ale NIE WOLNO Ci tworzyć odpowiedzi w imieniu terapeuty. ' +
          'Jeżeli no_approved_answer=true, powiedz użytkownikowi, że nie ma zatwierdzonej odpowiedzi, ' +
          'i zaproponuj kontakt bezpośrednio z terapeutą.',
        inputSchema: S.getTherapistFaqInput,
        outputSchema: S.getTherapistFaqOutput,
        annotations: {
          title: 'FAQ terapeuty',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args): Promise<CallToolResult> => {
        try {
          const therapist = await getTherapist(env, { therapist_id: args.therapist_id });
          if (!therapist) throw new AppError('not_found', 'Nie znaleziono opublikowanego profilu.', 404);

          const items = await getPublishedFaq(env, args.therapist_id, args.question);
          const structured = {
            therapist_id: args.therapist_id,
            items: items.map((item) => ({
              faq_id: item.faq_id,
              question: item.question,
              answer: item.answer,
              category: item.category,
              updated_at: item.updated_at,
              approved_at: item.approved_at,
              source: `${therapist.profile_url}#faq-${item.faq_id}`,
            })),
            no_approved_answer: items.length === 0,
            usage_note:
              'Treść pochodzi wprost od terapeuty. Nie uzupełniaj jej własną poradą i nie interpretuj ' +
              'klinicznie. FAQ nie zastępuje konsultacji.',
          };

          const text =
            items.length === 0
              ? 'Brak zatwierdzonej odpowiedzi — skontaktuj się bezpośrednio z terapeutą.'
              : items
                  .map((item) => `P: ${item.question}\nO: ${item.answer}\n(zaktualizowano: ${item.updated_at})`)
                  .join('\n\n') + `\n\n${structured.usage_note}`;

          return ok(text, structured);
        } catch (error) {
          return toolError(error);
        }
      },
    );

    // ------------------------------------------------------------- slots ---

    server.registerTool(
      'list_available_slots',
      {
        title: 'Wolne terminy',
        description:
          'Zwraca wolne terminy danego terapeuty w podanym zakresie dat, wraz z ceną, formą spotkania, ' +
          'strefą czasową wizyty i czasem ważności danych (fresh_until_utc). ' +
          'Po upływie fresh_until_utc NIE obiecuj dostępności — sprawdź terminy ponownie.',
        inputSchema: S.listAvailableSlotsInput,
        outputSchema: S.listAvailableSlotsOutput,
        annotations: {
          title: 'Wolne terminy',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args): Promise<CallToolResult> => {
        try {
          const therapist = await getTherapist(env, { therapist_id: args.therapist_id });
          if (!therapist) throw new AppError('not_found', 'Nie znaleziono opublikowanego profilu.', 404);

          const fromMs = Date.parse(`${args.from_date}T00:00:00Z`);
          const toMs = Date.parse(`${args.to_date}T23:59:59Z`);
          if (toMs < fromMs) throw new AppError('invalid_input', 'to_date musi być późniejsze niż from_date.', 400);
          if (toMs - fromMs > 60 * 86_400_000) {
            throw new AppError('invalid_input', 'Zakres dat nie może przekraczać 60 dni.', 400);
          }

          const from = new Date(Math.max(fromMs, Date.now())).toISOString().replace(/\.\d{3}Z$/, 'Z');
          const slots = await listOpenSlots(env, {
            therapist_id: args.therapist_id,
            from_utc: from,
            to_utc: new Date(toMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
            session_type: args.session_type,
            mode: args.mode,
            limit: args.limit,
          });

          const structured = {
            therapist_id: args.therapist_id,
            therapist_name: therapist.display_name,
            user_timezone: args.user_timezone,
            slots: slots.map((s) => ({
              slot_id: s.slot_id,
              starts_at_utc: s.starts_at_utc,
              ends_at_utc: s.ends_at_utc,
              appointment_timezone: s.timezone,
              local_start: formatDateTime(s.starts_at_utc, args.user_timezone),
              local_timezone_label: timezoneLabel(s.starts_at_utc, args.user_timezone),
              duration_minutes: s.duration_minutes,
              session_type: s.session_type,
              mode: s.mode,
              price_minor: s.price_minor,
              currency: s.currency,
              price_display: formatPrice(s.price_minor, s.currency),
            })),
            fresh_until_utc: isoPlusSeconds(SLOT_FRESHNESS_SECONDS),
            freshness_note:
              'Dostępność zmienia się na bieżąco. Po upływie fresh_until_utc sprawdź terminy ponownie ' +
              'zamiast obiecywać dostępność.',
          };

          const text =
            slots.length === 0
              ? `Brak wolnych terminów u ${therapist.display_name} w zakresie ${args.from_date} – ${args.to_date}.`
              : `Wolne terminy u ${therapist.display_name} (czas lokalny: ${args.user_timezone}):\n` +
                structured.slots
                  .map(
                    (s) =>
                      `- ${s.local_start} (${s.local_timezone_label}), ${s.duration_minutes} min, ` +
                      `${s.mode === 'online' ? 'online' : 'stacjonarnie'}, ${s.price_display} [slot_id: ${s.slot_id}]`,
                  )
                  .join('\n');

          return ok(text, structured);
        } catch (error) {
          return toolError(error);
        }
      },
    );

    // ----------------------------------------------------------- preview ---

    server.registerTool(
      'preview_booking',
      {
        title: 'Podsumowanie przed rezerwacją',
        description:
          'NIE tworzy rezerwacji. Sprawdza dostępność terminu i zwraca pełne podsumowanie ' +
          '(terapeuta, termin, strefa czasowa, forma, czas trwania, cena, zasady odwołania, wersje dokumentów) ' +
          'oraz krótko ważny confirmation_token. Pokaż użytkownikowi całe podsumowanie i poproś o wyraźne ' +
          'potwierdzenie, zanim wywołasz create_booking. Wymaga połączonego konta.',
        inputSchema: S.previewBookingInput,
        outputSchema: S.previewBookingOutput,
        annotations: {
          title: 'Podsumowanie przed rezerwacją',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args): Promise<CallToolResult> => {
        const guard = await requireUser(
          SCOPES.bookingRead,
          'Aby zobaczyć podsumowanie rezerwacji, połącz konto Otwartego Terapeuty.',
        );
        if (!guard.ok) return guard.error;
        try {
          const result = await previewBooking(env, guard.user, {
            slot_id: args.slot_id,
            user_timezone: args.user_timezone,
          });
          const structured = {
            ...result,
            next_step:
              'Pokaż użytkownikowi całe podsumowanie i poproś o jednoznaczne potwierdzenie. ' +
              'Dopiero po potwierdzeniu wywołaj create_booking z tym confirmation_token.',
          };
          return ok(
            `${result.confirmation_prompt}\n\nPodsumowanie:\n` +
              `- Terapeuta: ${result.summary.therapist_name}\n` +
              `- Termin: ${result.summary.local_start} (${result.summary.local_timezone_label})\n` +
              `- Czas trwania: ${result.summary.duration_minutes} min\n` +
              `- Forma: ${result.summary.session_type_label}, ${result.summary.mode_label}\n` +
              `- Cena: ${result.summary.price_display}\n` +
              `- Odwołanie: ${result.summary.cancellation_policy || 'zgodnie z regulaminem'}\n` +
              `Podsumowanie jest ważne do ${result.confirmation_token_expires_at}.`,
            structured,
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );

    // ------------------------------------------------------------ create ---

    server.registerTool(
      'create_booking',
      {
        title: 'Zarezerwuj wizytę',
        description:
          'Tworzy rezerwację wizyty. Wywołaj DOPIERO po pokazaniu podsumowania z preview_booking ' +
          'i po jednoznacznym potwierdzeniu użytkownika. Wymaga connfirmation_token z preview_booking, ' +
          'unikalnego idempotency_key oraz akceptacji konkretnych wersji regulaminu i polityki prywatności. ' +
          'Serwer ponownie weryfikuje token, właściciela, cenę i dostępność terminu.',
        inputSchema: S.createBookingInput,
        outputSchema: S.createBookingOutput,
        annotations: {
          title: 'Zarezerwuj wizytę',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args): Promise<CallToolResult> => {
        const guard = await requireUser(
          SCOPES.bookingWrite,
          'Aby zarezerwować wizytę, połącz konto Otwartego Terapeuty i wyraź zgodę na zakres booking:write.',
        );
        if (!guard.ok) return guard.error;
        if (!(await env.RL_WRITE.limit({ key: `book:${guard.user.id}` })).success) {
          return toolError(new AppError('rate_limited', 'Zbyt wiele prób rezerwacji. Odczekaj chwilę.', 429));
        }
        try {
          const result = await createBooking(env, guard.user, args);
          const structured = {
            ...result,
            message: result.replayed
              ? 'Ta rezerwacja została już wcześniej utworzona tym samym idempotency_key.'
              : 'Rezerwacja potwierdzona. Wiadomość z potwierdzeniem została zakolejkowana do wysyłki.',
          };
          return ok(
            `Rezerwacja potwierdzona. Numer: ${result.public_ref}.\n` +
              `- Terapeuta: ${result.summary.therapist_name}\n` +
              `- Termin: ${result.summary.local_start} (${result.summary.local_timezone_label})\n` +
              `- Cena: ${result.summary.price_display}\n` +
              `- Zasady odwołania: ${result.cancellation_policy || 'zgodnie z regulaminem'}\n` +
              `- Zarządzanie rezerwacją: ${result.manage_url}`,
            structured,
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );

    // -------------------------------------------------------- my bookings ---

    server.registerTool(
      'list_my_bookings',
      {
        title: 'Moje rezerwacje',
        description:
          'Zwraca rezerwacje zalogowanego użytkownika (i tylko jego). Minimalny zakres danych: ' +
          'terapeuta, termin, forma, cena, status i numer rezerwacji.',
        inputSchema: S.listMyBookingsInput,
        outputSchema: S.listMyBookingsOutput,
        annotations: {
          title: 'Moje rezerwacje',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args): Promise<CallToolResult> => {
        const guard = await requireUser(
          SCOPES.bookingRead,
          'Aby zobaczyć swoje rezerwacje, połącz konto Otwartego Terapeuty.',
        );
        if (!guard.ok) return guard.error;
        try {
          const bookings = await listMyBookings(env, guard.user, args);
          const structured = { bookings, count: bookings.length };
          return ok(
            bookings.length === 0
              ? 'Nie masz zapisanych rezerwacji w wybranym zakresie.'
              : bookings
                  .map(
                    (b) =>
                      `- ${b.local_start}: ${b.therapist_name}, ${b.session_type_label}, ${b.mode_label}, ` +
                      `${b.price_display} (${b.status === 'cancelled' ? 'odwołana' : 'potwierdzona'}, nr ${b.public_ref})`,
                  )
                  .join('\n'),
            structured,
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );

    // ------------------------------------------------------------ cancel ---

    server.registerTool(
      'cancel_booking',
      {
        title: 'Odwołaj wizytę',
        description:
          'Odwołuje rezerwację należącą do zalogowanego użytkownika. Wymaga confirm=true, które wolno ' +
          'ustawić dopiero po jednoznacznym potwierdzeniu użytkownika. Operacja jest idempotentna: ' +
          'ponowne odwołanie zwraca ten sam status.',
        inputSchema: S.cancelBookingInput,
        outputSchema: S.cancelBookingOutput,
        annotations: {
          title: 'Odwołaj wizytę',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args): Promise<CallToolResult> => {
        const guard = await requireUser(
          SCOPES.bookingWrite,
          'Aby odwołać wizytę, połącz konto Otwartego Terapeuty i wyraź zgodę na zakres booking:write.',
        );
        if (!guard.ok) return guard.error;
        if (!(await env.RL_WRITE.limit({ key: `cancel:${guard.user.id}` })).success) {
          return toolError(new AppError('rate_limited', 'Zbyt wiele prób odwołania. Odczekaj chwilę.', 429));
        }
        try {
          const result = await cancelBooking(env, guard.user, args);
          return ok(result.message, { ...result });
        } catch (error) {
          return toolError(error);
        }
      },
    );

    // ------------------------------------------------------------ crisis ---

    server.registerTool(
      'get_crisis_resources',
      {
        title: 'Pomoc w kryzysie',
        description:
          'Zwraca aktualne, ręcznie utrzymywane dane kontaktowe pomocy kryzysowej dla danego kraju. ' +
          'WYWOŁAJ TO NARZĘDZIE JAKO PIERWSZE, jeżeli rozmowa wskazuje na bezpośrednie zagrożenie życia ' +
          'lub zdrowia albo na ostry kryzys — zamiast prowadzić zwykłe dopasowanie terapeuty. ' +
          'Użyj audience="minor" dla osób poniżej 18 roku życia.',
        inputSchema: S.crisisResourcesInput,
        outputSchema: S.crisisResourcesOutput,
        annotations: {
          title: 'Pomoc w kryzysie',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args): Promise<CallToolResult> => {
        try {
          const resources = await getCrisisResources(env, args.country, args.audience);
          const structured = {
            country: args.country,
            audience: args.audience,
            resources: resources.map((r) => ({
              title: r.title,
              description: r.description,
              phone: r.phone,
              url: r.url,
              hours: r.hours,
              source_url: r.source_url,
              verified_at: r.verified_at,
              version: r.version,
            })),
            important_note:
              'Otwarty Terapeuta jest katalogiem i systemem rezerwacji. Rezerwacja wizyty NIE jest pomocą ' +
              'w nagłym zagrożeniu życia lub zdrowia. W takiej sytuacji skorzystaj z powyższych numerów.',
          };
          return ok(
            structured.resources
              .map(
                (r) =>
                  `${r.title}\n${r.description}` +
                  `${r.phone ? `\nTelefon: ${r.phone}` : ''}${r.url ? `\nStrona: ${r.url}` : ''}` +
                  `${r.hours ? `\nDostępność: ${r.hours}` : ''}`,
              )
              .join('\n\n') + `\n\n${structured.important_note}`,
            structured,
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );

    // ------------------------------------------------------------ widget ---

    server.registerResource(
      'otwarty-terapeuta-widget',
      WIDGET_URI,
      {
        title: 'Otwarty Terapeuta — interfejs',
        description: 'Widok listy terapeutów, profilu, FAQ, terminów i rezerwacji.',
        mimeType: RESOURCE_MIME_TYPE,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: RESOURCE_MIME_TYPE,
            text: WIDGET_HTML,
          },
        ],
      }),
    );

    server.registerTool(
      'render_otwarty_terapeuta_widget',
      {
        title: 'Pokaż widok Otwartego Terapeuty',
        description:
          'Renderuje wcześniej pobrane dane w interfejsie. NAJPIERW wywołaj narzędzie danych, potem przekaż ' +
          'jego structuredContent bez zmian: search_therapists -> view="therapist_list", ' +
          'get_therapist_profile -> "therapist_profile", get_therapist_faq -> "faq", ' +
          'list_available_slots -> "slots", preview_booking -> "booking_summary", ' +
          'create_booking -> "booking_confirmed", list_my_bookings -> "my_bookings". ' +
          'To narzędzie niczego nie pobiera i niczego nie zapisuje.',
        inputSchema: S.renderWidgetInput,
        outputSchema: S.renderWidgetOutput,
        annotations: {
          title: 'Pokaż widok Otwartego Terapeuty',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: {
          // MCP Apps: the single tool bound to the UI resource.
          ui: {
            resourceUri: WIDGET_URI,
            prefersBorder: true,
            csp: {
              // The widget is fully self-contained: no origin is needed.
              connectDomains: [],
              resourceDomains: [],
            },
          },
          // ChatGPT compatibility alias for the same binding.
          'openai/outputTemplate': WIDGET_URI,
          'openai/toolInvocation/invoking': 'Przygotowuję widok…',
          'openai/toolInvocation/invoked': 'Gotowe',
        },
      },
      async (args): Promise<CallToolResult> => {
        const payload = (args.payload ?? {}) as Record<string, unknown>;
        const counted =
          (Array.isArray(payload.results) && payload.results.length) ||
          (Array.isArray(payload.items) && payload.items.length) ||
          (Array.isArray(payload.slots) && payload.slots.length) ||
          (Array.isArray(payload.bookings) && payload.bookings.length) ||
          (payload.therapist || payload.summary ? 1 : 0);

        // The widget receives this object verbatim as the tool output, so the
        // envelope IS the structured content - there is no second channel.
        return {
          content: [{ type: 'text', text: 'Widok został przygotowany w interfejsie.' }],
          structuredContent: {
            view: args.view,
            title: args.title ?? 'Otwarty Terapeuta',
            data: payload,
            generated_at: nowIso(),
            item_count: typeof counted === 'number' ? counted : 0,
          },
        };
      },
    );

    // A read-only resource with the controlled vocabularies, so the model can
    // map a user's own words onto the slugs `search_therapists` accepts.
    server.registerResource(
      'otwarty-terapeuta-slowniki',
      'otwarty-terapeuta://slowniki',
      {
        title: 'Słowniki: obszary pracy, nurty, języki',
        description: 'Dozwolone wartości filtrów topics, modalities i languages.',
        mimeType: 'application/json',
      },
      async (uri) => {
        const vocab = await listVocabulary(env);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(vocab, null, 2),
            },
          ],
        };
      },
    );

    return server;
  };
}
