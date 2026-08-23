import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { bridge } from './bridge';

/**
 * Otwarty Terapeuta - MCP Apps widget.
 *
 * The widget renders ONLY data delivered by a tool result. It never fetches,
 * never invents a therapist, and never renders anything as HTML. Every string
 * arrives as untrusted text and is rendered as a React text node; every link
 * is passed through `safeHref` first.
 */

type View =
  | 'therapist_list'
  | 'therapist_profile'
  | 'faq'
  | 'slots'
  | 'booking_summary'
  | 'booking_confirmed'
  | 'my_bookings';

interface Envelope {
  view: View;
  title?: string;
  data: unknown;
  generated_at?: string;
}

// ---------------------------------------------------------------- helpers ---

/** Only https and mailto links survive. Anything else renders as plain text. */
function safeHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'mailto:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

/**
 * The bio is stored as plain text with `**bold**` markers and `\*` escapes.
 * The widget renders plain text, so the markers are stripped rather than shown.
 */
function plain(value: unknown): string {
  return text(value).replace(/\\(\*)|\*\*/g, (_match, escaped: string | undefined) => escaped ?? '');
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function Link({ href, children }: { href: unknown; children: React.ReactNode }): React.ReactElement {
  const safe = safeHref(href);
  if (!safe) return <>{children}</>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Tags({ items, label }: { items: unknown[]; label: string }): React.ReactElement | null {
  const values = items.map((i) => (typeof i === 'string' ? i : text(record(i).name))).filter(Boolean);
  if (values.length === 0) return null;
  return (
    <div className="tagrow">
      <span className="tagrow-label">{label}</span>
      <ul className="tags">
        {values.map((value, index) => (
          <li key={`${value}-${index}`} className="tag">
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DemoBadge({ isDemo }: { isDemo: unknown }): React.ReactElement | null {
  if (isDemo !== true) return null;
  return <span className="badge demo">dane demonstracyjne</span>;
}

function VerifiedBadge({ status }: { status: unknown }): React.ReactElement {
  return status === 'verified' ? (
    <span className="badge ok">profil zweryfikowany</span>
  ) : (
    <span className="badge neutral">dane deklarowane przez terapeutę</span>
  );
}

// ------------------------------------------------------------------ views ---

function Photo({ url, name }: { url: unknown; name: string }): React.ReactElement | null {
  const src = text(url);
  // The bridge payload is untrusted: only an absolute https image is ever rendered.
  if (!src || !src.startsWith('https://')) return null;
  return <img className="photo" src={src} alt={`Zdjęcie profilowe: ${name}`} loading="lazy" decoding="async" />;
}

function TherapistCard({ item }: { item: Record<string, unknown> }): React.ReactElement {
  const reasons = list(item.match_reasons).map((r) => text(r)).filter(Boolean);
  return (
    <li className="card">
      <div className="card-head">
        <div className="identity">
          <Photo url={item.photo_url} name={text(item.display_name, 'Terapeuta')} />
          <h3>{text(item.display_name, 'Terapeuta')}</h3>
        </div>
        <div className="badges">
          <VerifiedBadge status={item.verification_status} />
          <DemoBadge isDemo={item.is_demo} />
        </div>
      </div>
      {item.headline ? <p className="muted">{text(item.headline)}</p> : null}
      <dl className="facts">
        <dt>Forma</dt>
        <dd>
          {[item.offers_online === true ? 'online' : null, item.offers_in_person === true ? 'stacjonarnie' : null]
            .filter(Boolean)
            .join(', ') || 'brak danych'}
        </dd>
        <dt>Miejscowość</dt>
        <dd>{list(item.cities).map((c) => text(c)).join(', ') || 'tylko online'}</dd>
        <dt>Cena</dt>
        <dd>{text(item.price_display, 'brak danych')}</dd>
        <dt>Najbliższy termin</dt>
        <dd>{text(item.next_available_slot_local, text(item.next_available_slot_utc, 'brak wolnych terminów'))}</dd>
        <dt>Przyjmuje nowe osoby</dt>
        <dd>{item.accepting_new_clients === true ? 'tak' : 'nie'}</dd>
      </dl>
      <Tags items={list(item.topics)} label="Obszary pracy" />
      <Tags items={list(item.modalities)} label="Nurt" />
      <Tags items={list(item.languages)} label="Języki" />
      {reasons.length > 0 ? (
        <div className="reasons">
          <p className="reasons-label">Pasuje do podanych kryteriów, ponieważ:</p>
          <ul>
            {reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="card-actions">
        <Link href={item.profile_url}>Zobacz pełny profil</Link>
      </p>
    </li>
  );
}

function TherapistList({ data }: { data: Record<string, unknown> }): React.ReactElement {
  const results = list(data.results).map(record);
  if (results.length === 0) {
    return (
      <Empty
        title="Brak profili pasujących do podanych kryteriów"
        body="Spróbuj rozszerzyć kryteria: inny zakres cen, sesje online zamiast stacjonarnych albo szerszy przedział dat."
      />
    );
  }
  return (
    <>
      <ul className="cards">
        {results.map((item, index) => (
          <TherapistCard key={text(item.therapist_id, String(index))} item={item} />
        ))}
      </ul>
      <p className="disclaimer">{text(data.disclaimer)}</p>
    </>
  );
}

function TherapistProfile({ data }: { data: Record<string, unknown> }): React.ReactElement {
  const t = record(data.therapist);
  const offers = list(t.offers).map(record);
  return (
    <article className="profile">
      <div className="card-head">
        <div className="identity">
          <Photo url={t.photo_url} name={text(t.display_name, 'Terapeuta')} />
          <h3>{text(t.display_name, 'Terapeuta')}</h3>
        </div>
        <div className="badges">
          <VerifiedBadge status={t.verification_status} />
          <DemoBadge isDemo={t.is_demo} />
        </div>
      </div>
      {t.headline ? <p className="muted">{text(t.headline)}</p> : null}
      <p className="bio">{plain(t.bio)}</p>
      <Tags items={list(t.topics)} label="Obszary pracy" />
      <Tags items={list(t.modalities)} label="Nurt" />
      <Tags items={list(t.languages)} label="Języki" />
      <h4>Oferta</h4>
      <ul className="offers">
        {offers.map((offer, index) => (
          <li key={text(offer.offer_id, String(index))}>
            {text(offer.title)} — {text(offer.price_display)} / {text(offer.duration_minutes)} min (
            {offer.mode === 'online' ? 'online' : 'stacjonarnie'})
          </li>
        ))}
      </ul>
      <h4>Kwalifikacje</h4>
      <ul className="credentials">
        {list(t.credentials).map(record).map((c, index) => (
          <li key={index}>
            {text(c.title)}
            {c.issuer ? `, ${text(c.issuer)}` : ''}
            {c.year ? ` (${text(c.year)})` : ''}
            {c.verified === true ? ' — zweryfikowane' : ' — deklarowane'}
          </li>
        ))}
      </ul>
      <p className="muted">Zasady odwołania: {text(t.cancellation_policy, 'zgodnie z regulaminem')}</p>
      <p>
        <Link href={t.profile_url}>Otwórz profil na stronie</Link>
      </p>
      <p className="disclaimer">{text(data.data_source_note)}</p>
    </article>
  );
}

function Faq({ data }: { data: Record<string, unknown> }): React.ReactElement {
  const items = list(data.items).map(record);
  if (data.no_approved_answer === true || items.length === 0) {
    return (
      <Empty
        title="Brak zatwierdzonej odpowiedzi"
        body="Ten terapeuta nie opublikował odpowiedzi na to pytanie. Skontaktuj się bezpośrednio z terapeutą."
      />
    );
  }
  return (
    <>
      <dl className="faq">
        {items.map((item, index) => (
          <div className="faq-item" key={text(item.faq_id, String(index))}>
            <dt>{text(item.question)}</dt>
            <dd>
              <p>{text(item.answer)}</p>
              <p className="muted small">Zaktualizowano: {text(item.updated_at)}</p>
            </dd>
          </div>
        ))}
      </dl>
      <p className="disclaimer">{text(data.usage_note)}</p>
    </>
  );
}

function Slots({
  data,
  onPreview,
  busySlot,
}: {
  data: Record<string, unknown>;
  onPreview: (slotId: string) => void;
  busySlot: string | null;
}): React.ReactElement {
  const slots = list(data.slots).map(record);
  const stale = typeof data.fresh_until_utc === 'string' && Date.parse(data.fresh_until_utc) < Date.now();

  if (slots.length === 0) {
    return (
      <Empty
        title="Brak wolnych terminów w tym zakresie"
        body="Poproś asystenta o sprawdzenie innego zakresu dat albo innej formy spotkania."
      />
    );
  }
  return (
    <>
      {stale ? (
        <p className="warn" role="status">
          Te terminy mogły się zmienić. Poproś asystenta o odświeżenie listy przed rezerwacją.
        </p>
      ) : null}
      <ul className="slots">
        {slots.map((slot, index) => {
          const id = text(slot.slot_id, String(index));
          return (
            <li key={id}>
              <button
                type="button"
                className="slot"
                onClick={() => onPreview(id)}
                disabled={busySlot !== null}
                aria-busy={busySlot === id}
              >
                <span className="slot-time">{text(slot.local_start)}</span>
                <span className="slot-meta">
                  {text(slot.duration_minutes)} min · {slot.mode === 'online' ? 'online' : 'stacjonarnie'} ·{' '}
                  {text(slot.price_display)}
                </span>
                <span className="slot-cta">{busySlot === id ? 'Przygotowuję podsumowanie…' : 'Pokaż podsumowanie'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="disclaimer">{text(data.freshness_note)}</p>
    </>
  );
}

function BookingSummary({
  data,
  onConfirm,
  busy,
}: {
  data: Record<string, unknown>;
  onConfirm: () => void;
  busy: boolean;
}): React.ReactElement {
  const s = record(data.summary);
  return (
    <section className="summary" aria-labelledby="summary-heading">
      <h3 id="summary-heading">Podsumowanie przed potwierdzeniem</h3>
      <dl className="facts wide">
        <dt>Terapeuta</dt>
        <dd>{text(s.therapist_name)}</dd>
        <dt>Termin</dt>
        <dd>
          {text(s.local_start)} ({text(s.local_timezone_label)})
        </dd>
        <dt>Czas trwania</dt>
        <dd>{text(s.duration_minutes)} min</dd>
        <dt>Forma</dt>
        <dd>
          {text(s.session_type_label)}, {text(s.mode_label)}
        </dd>
        <dt>Cena</dt>
        <dd>{text(s.price_display)}</dd>
        <dt>Odwołanie</dt>
        <dd>{text(s.cancellation_policy, 'zgodnie z regulaminem')}</dd>
      </dl>
      <p className="muted small">
        Potwierdzenie oznacza akceptację <Link href={s.terms_url}>regulaminu</Link> (wersja {text(s.terms_version)}) i{' '}
        <Link href={s.privacy_url}>polityki prywatności</Link> (wersja {text(s.privacy_version)}).
      </p>
      <button type="button" className="primary" onClick={onConfirm} disabled={busy} aria-busy={busy}>
        {busy ? 'Rezerwuję…' : 'Potwierdzam i rezerwuję'}
      </button>
      <p className="muted small">
        Możesz też odpowiedzieć asystentowi „tak, rezerwuję”. Rezerwacja jest zapisywana dopiero po potwierdzeniu.
      </p>
    </section>
  );
}

function BookingConfirmed({ data }: { data: Record<string, unknown> }): React.ReactElement {
  const s = record(data.summary);
  return (
    <section className="confirmed" aria-labelledby="confirmed-heading">
      <p className="ok-banner" role="status">
        Rezerwacja potwierdzona
      </p>
      <h3 id="confirmed-heading">Numer rezerwacji: {text(data.public_ref)}</h3>
      <dl className="facts wide">
        <dt>Terapeuta</dt>
        <dd>{text(s.therapist_name)}</dd>
        <dt>Termin</dt>
        <dd>
          {text(s.local_start)} ({text(s.local_timezone_label)})
        </dd>
        <dt>Forma</dt>
        <dd>
          {text(s.session_type_label)}, {text(s.mode_label)}
        </dd>
        <dt>Cena</dt>
        <dd>{text(s.price_display)}</dd>
      </dl>
      <p>{text(data.cancellation_policy, 'Zasady odwołania określa regulamin terapeuty.')}</p>
      <p>
        <Link href={data.manage_url}>Zarządzaj rezerwacją</Link>
      </p>
    </section>
  );
}

function MyBookings({ data }: { data: Record<string, unknown> }): React.ReactElement {
  const bookings = list(data.bookings).map(record);
  if (bookings.length === 0) {
    return <Empty title="Brak rezerwacji" body="Nie masz zapisanych nadchodzących wizyt." />;
  }
  return (
    <ul className="cards">
      {bookings.map((b, index) => (
        <li className="card" key={text(b.booking_id, String(index))}>
          <div className="card-head">
            <h3>{text(b.therapist_name)}</h3>
            <span className={b.status === 'cancelled' ? 'badge neutral' : 'badge ok'}>
              {b.status === 'cancelled' ? 'odwołana' : 'potwierdzona'}
            </span>
          </div>
          <dl className="facts">
            <dt>Termin</dt>
            <dd>{text(b.local_start)}</dd>
            <dt>Forma</dt>
            <dd>
              {text(b.session_type_label)}, {text(b.mode_label)}
            </dd>
            <dt>Cena</dt>
            <dd>{text(b.price_display)}</dd>
            <dt>Numer</dt>
            <dd>{text(b.public_ref)}</dd>
          </dl>
          <p>
            <Link href={b.therapist_profile_url}>Profil terapeuty</Link>
          </p>
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------- shared states ---

function Empty({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <div className="state" role="status">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function Loading(): React.ReactElement {
  return (
    <div className="state" role="status" aria-live="polite">
      <h3>Wczytuję dane…</h3>
      <p>Za chwilę pokażemy wynik zwrócony przez Otwartego Terapeutę.</p>
    </div>
  );
}

function AuthRequired(): React.ReactElement {
  return (
    <div className="state" role="status">
      <h3>Wymagane połączenie konta</h3>
      <p>
        Aby zobaczyć podsumowanie lub zarezerwować wizytę, połącz konto Otwartego Terapeuty w ustawieniach
        aplikacji, a następnie powtórz prośbę.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div className="state error" role="alert">
      <h3>Nie udało się wykonać operacji</h3>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="primary" onClick={onRetry}>
          Spróbuj ponownie
        </button>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------------- app ---

function parseEnvelope(raw: unknown): Envelope | null {
  const value = record(raw);
  const view = value.view;
  if (typeof view !== 'string') return null;
  const allowed: View[] = [
    'therapist_list',
    'therapist_profile',
    'faq',
    'slots',
    'booking_summary',
    'booking_confirmed',
    'my_bookings',
  ];
  if (!allowed.includes(view as View)) return null;
  return {
    view: view as View,
    title: typeof value.title === 'string' ? value.title : undefined,
    data: value.data ?? {},
    generated_at: typeof value.generated_at === 'string' ? value.generated_at : undefined,
  };
}

function App(): React.ReactElement {
  const [envelope, setEnvelope] = useState<Envelope | null>(() => parseEnvelope(bridge?.getToolResult()));
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [busyConfirm, setBusyConfirm] = useState(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!bridge) return;
    return bridge.onToolResult((payload) => {
      const parsed = parseEnvelope(payload);
      if (parsed) {
        setEnvelope(parsed);
        setError(null);
        setAuthRequired(false);
        setStatus(`Zaktualizowano widok: ${viewLabel(parsed.view)}.`);
      }
    });
  }, []);

  const handleToolError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : 'Nieznany błąd.';
    if (/unauthorized|401|zalogow/i.test(message)) {
      setAuthRequired(true);
      setStatus('Wymagane połączenie konta.');
      return;
    }
    setError(message);
    setStatus(`Błąd: ${message}`);
  }, []);

  const previewSlot = useCallback(
    async (slotId: string) => {
      if (!bridge) return;
      setBusySlot(slotId);
      setError(null);
      try {
        const result = await bridge.callTool('preview_booking', { slot_id: slotId });
        const parsed = parseEnvelope(record(result).structuredContent ?? result);
        if (parsed) setEnvelope(parsed);
        else {
          // The data tool returned a plain preview payload; wrap it locally.
          const payload = record(record(result).structuredContent ?? result);
          setEnvelope({ view: 'booking_summary', data: payload });
        }
        setStatus('Pokazano podsumowanie rezerwacji.');
      } catch (err) {
        handleToolError(err);
      } finally {
        setBusySlot(null);
      }
    },
    [handleToolError],
  );

  const confirmBooking = useCallback(async () => {
    if (!bridge || !envelope) return;
    const data = record(envelope.data);
    const summary = record(data.summary);
    const token = data.confirmation_token;
    if (typeof token !== 'string') {
      setError('Brak ważnego podsumowania. Poproś asystenta o nowe podsumowanie.');
      return;
    }
    setBusyConfirm(true);
    setError(null);
    try {
      const result = await bridge.callTool('create_booking', {
        confirmation_token: token,
        idempotency_key: `w-${crypto.randomUUID()}`,
        accepted_terms_version: text(summary.terms_version),
        accepted_privacy_version: text(summary.privacy_version),
      });
      const payload = record(record(result).structuredContent ?? result);
      setEnvelope({ view: 'booking_confirmed', data: payload });
      setStatus('Rezerwacja potwierdzona.');
    } catch (err) {
      handleToolError(err);
    } finally {
      setBusyConfirm(false);
    }
  }, [envelope, handleToolError]);

  const body = useMemo(() => {
    if (authRequired) return <AuthRequired />;
    if (error) return <ErrorState message={error} />;
    if (!envelope) return <Loading />;
    const data = record(envelope.data);
    switch (envelope.view) {
      case 'therapist_list':
        return <TherapistList data={data} />;
      case 'therapist_profile':
        return <TherapistProfile data={data} />;
      case 'faq':
        return <Faq data={data} />;
      case 'slots':
        return <Slots data={data} onPreview={previewSlot} busySlot={busySlot} />;
      case 'booking_summary':
        return <BookingSummary data={data} onConfirm={confirmBooking} busy={busyConfirm} />;
      case 'booking_confirmed':
        return <BookingConfirmed data={data} />;
      case 'my_bookings':
        return <MyBookings data={data} />;
      default:
        return <Loading />;
    }
  }, [authRequired, busyConfirm, busySlot, confirmBooking, envelope, error, previewSlot]);

  return (
    <div className="app">
      <h2 className="app-title">{envelope?.title ?? 'Otwarty Terapeuta'}</h2>
      <p ref={statusRef} className="visually-hidden" role="status" aria-live="polite">
        {status}
      </p>
      {body}
      <p className="footer-note">
        Otwarty Terapeuta to katalog i rezerwacja wizyt — nie jest terapią ani pomocą w nagłym zagrożeniu.
        W sytuacji zagrożenia życia zadzwoń pod 112, a po wsparcie emocjonalne pod 116 123.
      </p>
    </div>
  );
}

function viewLabel(view: View): string {
  switch (view) {
    case 'therapist_list':
      return 'lista terapeutów';
    case 'therapist_profile':
      return 'profil terapeuty';
    case 'faq':
      return 'najczęstsze pytania';
    case 'slots':
      return 'wolne terminy';
    case 'booking_summary':
      return 'podsumowanie rezerwacji';
    case 'booking_confirmed':
      return 'potwierdzenie rezerwacji';
    case 'my_bookings':
      return 'moje rezerwacje';
    default:
      return 'widok';
  }
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
