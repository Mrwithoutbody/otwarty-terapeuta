import { Hono } from 'hono';
import type { Env } from '../env';
import {
  findCandidates,
  getCrisisResources,
  getPublishedFaq,
  getTherapist,
  listCities,
  listOpenSlots,
  listVocabulary,
  type SearchFilters,
} from '../db/catalog';
import type { PublicTherapist } from '../db/types';
import { rankTherapists } from '../matching/rank';
import { escapeHtml } from '../lib/sanitize';
import { formatDateTime, formatPrice, nowIso } from '../lib/time';
import { hmacHex, timingSafeEqual } from '../lib/crypto';
import { htmlResponse, renderPage } from './layout';

/**
 * The public website. Everything is server rendered with escaped text and no
 * inline script, which keeps the CSP strict and makes the catalogue usable
 * without JavaScript at all.
 */

export const siteApp = new Hono<{ Bindings: Env }>();

function pluginCta(env: Env): string {
  const url = env.PUBLIC_PLUGIN_URL?.trim();
  if (!url) {
    // No invented link. Until the plugin card exists in the OpenAI panel the
    // button is a clearly labelled, disabled control.
    return `<p><span class="btn" aria-disabled="true" role="button" tabindex="0">Znajdź terapeutę z pomocą ChatGPT</span></p>
            <p class="hint">Plugin w przygotowaniu. Po publikacji w katalogu OpenAI ten przycisk będzie prowadził
            bezpośrednio do karty pluginu. Do tego czasu skorzystaj z <a href="/terapeuci">katalogu na stronie</a>.</p>`;
  }
  return `<p><a class="btn" href="${escapeHtml(url)}" rel="noopener">Znajdź terapeutę z pomocą ChatGPT</a></p>`;
}

function crisisBanner(): string {
  return `<div class="notice warn">
    <h2>Potrzebujesz pomocy natychmiast?</h2>
    <p>Jeżeli Ty lub ktoś w Twoim otoczeniu jest w bezpośrednim niebezpieczeństwie, zadzwoń pod
    <strong>112</strong>. Całodobowe wsparcie emocjonalne dla osób dorosłych: <strong>116 123</strong>.
    Dla osób poniżej 18 roku życia: <strong>116 111</strong>.</p>
    <p><a href="/pomoc-w-kryzysie">Zobacz pełną listę miejsc pomocy</a></p>
  </div>`;
}

function therapistCard(t: PublicTherapist, reasons: string[]): string {
  const price =
    t.price_min_minor === null
      ? 'brak danych'
      : t.price_min_minor === t.price_max_minor
        ? formatPrice(t.price_min_minor, t.currency)
        : `${formatPrice(t.price_min_minor, t.currency)} – ${formatPrice(t.price_max_minor ?? t.price_min_minor, t.currency)}`;

  const modes = [t.offers_online ? 'online' : null, t.offers_in_person ? 'stacjonarnie' : null]
    .filter(Boolean)
    .join(', ');

  return `<li class="card">
  <div style="display:flex;gap:0.9rem;align-items:flex-start">
    ${t.photo_url ? `<img class="avatar" src="${escapeHtml(t.photo_url)}" alt="">` : `<span class="avatar" aria-hidden="true"></span>`}
    <div>
      <h3><a href="/terapeuci/${encodeURIComponent(t.slug)}">${escapeHtml(t.display_name)}</a></h3>
      <p class="meta">${escapeHtml(t.headline ?? '')}</p>
    </div>
  </div>
  <ul class="tags">
    ${t.verification_status === 'verified' ? '<li class="tag verified">profil zweryfikowany</li>' : '<li class="tag">dane deklarowane przez terapeutę</li>'}
    ${t.is_demo ? '<li class="tag demo">dane demonstracyjne</li>' : ''}
    ${t.accepting_new_clients ? '<li class="tag">przyjmuje nowe osoby</li>' : '<li class="tag">brak wolnych miejsc</li>'}
  </ul>
  <dl>
    <dt>Forma</dt><dd>${escapeHtml(modes || 'brak danych')}</dd>
    <dt>Miejscowość</dt><dd>${escapeHtml(t.locations.map((l) => l.city).join(', ') || 'tylko online')}</dd>
    <dt>Cena</dt><dd>${escapeHtml(price)}</dd>
    <dt>Języki</dt><dd>${escapeHtml(t.languages.join(', '))}</dd>
    <dt>Najbliższy termin</dt>
    <dd>${t.next_available_slot_utc ? escapeHtml(formatDateTime(t.next_available_slot_utc, t.timezone)) : 'brak wolnych terminów'}</dd>
  </dl>
  <ul class="tags">${t.topics
    .slice(0, 5)
    .map((x) => `<li class="tag">${escapeHtml(x.name)}</li>`)
    .join('')}</ul>
  ${
    reasons.length > 0
      ? `<div class="notice"><p class="meta">Pasuje do podanych kryteriów, ponieważ:</p><ul>${reasons
          .map((r) => `<li>${escapeHtml(r)}</li>`)
          .join('')}</ul></div>`
      : ''
  }
  <p><a href="/terapeuci/${encodeURIComponent(t.slug)}">Zobacz profil, FAQ i terminy</a></p>
</li>`;
}

// ------------------------------------------------------------------- home ---

siteApp.get('/', (c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Znajdź psychoterapeutę',
      description:
        'Katalog psychoterapeutów w Polsce z jasnymi cenami, zasadami odwołania i rezerwacją terminu. ' +
        'Bez ukrytego rankingu i bez płatnych pozycji.',
      path: '/',
      body: `
<div class="hero">
  <h1>Znajdź psychoterapeutę na swoich warunkach</h1>
  <p class="lead">Porównaj profile po tym, co naprawdę ma znaczenie: formie spotkań, języku, cenie,
  nurcie pracy i najbliższym wolnym terminie. Zarezerwuj wizytę bezpośrednio — także w rozmowie z ChatGPT.</p>
  ${pluginCta(c.env)}
  <p><a class="btn secondary" href="/terapeuci">Przeglądaj katalog na stronie</a></p>
</div>

<h2>Co to jest, a czym nie jest</h2>
<div class="grid cols-2">
  <div class="card">
    <h3>To jest</h3>
    <ul>
      <li>katalog psychoterapeutów z jawnymi cenami i kwalifikacjami,</li>
      <li>odpowiedzi na najczęstsze pytania napisane przez samych terapeutów,</li>
      <li>podgląd wolnych terminów i rezerwacja wizyty,</li>
      <li>zarządzanie własną rezerwacją i jej odwołanie.</li>
    </ul>
  </div>
  <div class="card">
    <h3>To nie jest</h3>
    <ul>
      <li>terapia, diagnoza ani porada kliniczna,</li>
      <li>pomoc w nagłym zagrożeniu życia lub zdrowia,</li>
      <li>ranking „najlepszych” terapeutów,</li>
      <li>miejsce, w którym trzeba opisywać swoje objawy, żeby coś znaleźć.</li>
    </ul>
  </div>
</div>

<h2>Jak dobieramy profile</h2>
<p>Dopasowanie działa na jawnych kryteriach: forma spotkań, miejscowość, język, budżet, dostępność,
grupa wiekowa i obszary pracy. Przy każdym profilu pokazujemy konkretny powód, dla którego pasuje
do podanych kryteriów. Nie ma płatnych pozycji w wynikach i nie ma ukrytego rankingu.</p>

${crisisBanner()}`,
    }),
  ),
);

// -------------------------------------------------------------- catalogue ---

function parseListParam(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => /^[a-z0-9-]{1,64}$/.test(v))
    .slice(0, 8);
  return items.length > 0 ? items : undefined;
}

siteApp.get('/terapeuci', async (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams;

  const filters: SearchFilters = {
    location: q.get('miasto')?.slice(0, 80) || undefined,
    online: q.get('online') === '1' ? true : undefined,
    in_person: q.get('stacjonarnie') === '1' ? true : undefined,
    languages: parseListParam(q.get('jezyk') ?? undefined),
    topics: parseListParam(q.get('obszar') ?? undefined),
    modalities: parseListParam(q.get('nurt') ?? undefined),
    session_types: parseListParam(q.get('forma') ?? undefined) as SearchFilters['session_types'],
    price_max: q.get('cena_max') ? Number(q.get('cena_max')) * 100 : undefined,
    accepting_new_clients: q.get('wolne') === '1' ? true : undefined,
  };
  if (typeof filters.price_max === 'number' && !Number.isFinite(filters.price_max)) {
    delete filters.price_max;
  }

  const [candidates, cities, vocab] = await Promise.all([
    findCandidates(c.env, filters),
    listCities(c.env),
    listVocabulary(c.env),
  ]);
  const ranked = rankTherapists(candidates, filters);

  const option = (value: string, label: string, selected: boolean): string =>
    `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  return htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Katalog terapeutów',
      description: 'Przeglądaj i filtruj profile psychoterapeutów.',
      path: '/terapeuci',
      body: `
<h1>Katalog terapeutów</h1>
<p>Filtry działają na jawnych danych z profilu. Nie musisz nic opisywać ani zakładać konta, żeby przeglądać.</p>

<form class="filters" method="get" action="/terapeuci">
  <fieldset>
    <legend>Filtry</legend>
    <div class="field-row two">
      <div class="field">
        <label for="miasto">Miejscowość</label>
        <select id="miasto" name="miasto">
          ${option('', 'dowolna', !filters.location)}
          ${cities.map((city) => option(city, city, filters.location === city)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="obszar">Obszar pracy</label>
        <select id="obszar" name="obszar">
          ${option('', 'dowolny', !filters.topics)}
          ${vocab.topics.map((t) => option(t.slug, t.name, filters.topics?.[0] === t.slug)).join('')}
        </select>
      </div>
    </div>
    <div class="field-row two">
      <div class="field">
        <label for="nurt">Nurt pracy</label>
        <select id="nurt" name="nurt">
          ${option('', 'dowolny', !filters.modalities)}
          ${vocab.modalities.map((m) => option(m.slug, m.name, filters.modalities?.[0] === m.slug)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="jezyk">Język sesji</label>
        <select id="jezyk" name="jezyk">
          ${option('', 'dowolny', !filters.languages)}
          ${vocab.languages.map((l) => option(l.slug, l.name, filters.languages?.[0] === l.slug)).join('')}
        </select>
      </div>
    </div>
    <div class="field-row two">
      <div class="field">
        <label for="forma">Typ spotkania</label>
        <select id="forma" name="forma">
          ${option('', 'dowolny', !filters.session_types)}
          ${option('individual', 'indywidualne', filters.session_types?.[0] === 'individual')}
          ${option('couples', 'dla par', filters.session_types?.[0] === 'couples')}
          ${option('family', 'rodzinne', filters.session_types?.[0] === 'family')}
        </select>
      </div>
      <div class="field">
        <label for="cena_max">Cena maksymalna za sesję (zł)</label>
        <input id="cena_max" name="cena_max" type="number" min="0" max="2000" step="10"
               value="${filters.price_max ? escapeHtml(String(filters.price_max / 100)) : ''}">
      </div>
    </div>
    <div class="checkbox">
      <input id="online" name="online" type="checkbox" value="1"${filters.online ? ' checked' : ''}>
      <label for="online">Tylko sesje online</label>
    </div>
    <div class="checkbox">
      <input id="stacjonarnie" name="stacjonarnie" type="checkbox" value="1"${filters.in_person ? ' checked' : ''}>
      <label for="stacjonarnie">Tylko spotkania stacjonarne</label>
    </div>
    <div class="checkbox">
      <input id="wolne" name="wolne" type="checkbox" value="1"${filters.accepting_new_clients ? ' checked' : ''}>
      <label for="wolne">Tylko przyjmujący nowe osoby</label>
    </div>
  </fieldset>
  <button class="btn" type="submit">Pokaż wyniki</button>
  <a class="btn secondary" href="/terapeuci">Wyczyść filtry</a>
</form>

<h2 id="wyniki">Wyniki (${ranked.length})</h2>
${
  ranked.length === 0
    ? `<p class="notice">Brak profili pasujących do podanych kryteriów. Spróbuj rozszerzyć filtry.</p>`
    : `<ul class="grid cols-2" style="list-style:none;padding:0">${ranked
        .slice(0, 24)
        .map((entry) => therapistCard(entry.therapist, entry.match_reasons))
        .join('')}</ul>`
}
`,
    }),
  );
});

siteApp.get('/terapeuci/:slug', async (c) => {
  const slug = c.req.param('slug');
  const t = await getTherapist(c.env, { slug });
  if (!t) {
    return htmlResponse(
      c.env,
      renderPage(c.env, {
        title: 'Nie znaleziono profilu',
        path: '/terapeuci',
        body: `<h1>Nie znaleziono profilu</h1><p>Ten profil nie istnieje albo nie jest opublikowany.</p>
               <p><a href="/terapeuci">Wróć do katalogu</a></p>`,
      }),
      { status: 404 },
    );
  }

  const [faq, slots] = await Promise.all([
    getPublishedFaq(c.env, t.therapist_id),
    listOpenSlots(c.env, {
      therapist_id: t.therapist_id,
      from_utc: nowIso(),
      to_utc: new Date(Date.now() + 21 * 86_400_000).toISOString(),
      limit: 12,
    }),
  ]);

  return htmlResponse(
    c.env,
    renderPage(c.env, {
      title: t.display_name,
      description: t.headline ?? 'Profil psychoterapeuty',
      path: '/terapeuci',
      body: `
<nav aria-label="Ścieżka"><p><a href="/terapeuci">Katalog</a> / ${escapeHtml(t.display_name)}</p></nav>
<h1>${escapeHtml(t.display_name)}</h1>
<p class="meta">${escapeHtml(t.headline ?? '')}</p>
<ul class="tags">
  ${t.verification_status === 'verified' ? `<li class="tag verified">profil zweryfikowany${t.verified_at ? ` (${escapeHtml(t.verified_at.slice(0, 10))})` : ''}</li>` : '<li class="tag">dane deklarowane przez terapeutę</li>'}
  ${t.is_demo ? '<li class="tag demo">profil demonstracyjny — osoba fikcyjna</li>' : ''}
  ${t.accepting_new_clients ? '<li class="tag">przyjmuje nowe osoby</li>' : '<li class="tag">brak wolnych miejsc</li>'}
</ul>

<h2>O mojej pracy</h2>
<p>${escapeHtml(t.bio).replace(/\n/g, '<br>')}</p>

<div class="grid cols-2">
  <div class="card">
    <h3>Podstawowe informacje</h3>
    <dl>
      <dt>Forma</dt><dd>${escapeHtml([t.offers_online ? 'online' : null, t.offers_in_person ? 'stacjonarnie' : null].filter(Boolean).join(', ') || 'brak danych')}</dd>
      <dt>Miejscowość</dt><dd>${escapeHtml(t.locations.map((l) => `${l.city}${l.address_line ? `, ${l.address_line}` : ''}`).join('; ') || 'tylko online')}</dd>
      <dt>Języki</dt><dd>${escapeHtml(t.languages.join(', '))}</dd>
      <dt>Typ spotkań</dt><dd>${escapeHtml(t.session_types.join(', '))}</dd>
      <dt>Grupy wiekowe</dt><dd>${escapeHtml(t.age_groups.join(', '))}</dd>
      <dt>Strefa czasowa</dt><dd>${escapeHtml(t.timezone)}</dd>
    </dl>
  </div>
  <div class="card">
    <h3>Nurt i obszary pracy</h3>
    <ul class="tags">${t.modalities.map((m) => `<li class="tag">${escapeHtml(m.name)}</li>`).join('')}</ul>
    <ul class="tags">${t.topics.map((x) => `<li class="tag">${escapeHtml(x.name)}</li>`).join('')}</ul>
  </div>
</div>

<h2>Oferta i ceny</h2>
<div class="table-scroll">
<table>
  <caption class="visually-hidden">Oferta sesji, ceny i czas trwania</caption>
  <thead><tr><th scope="col">Rodzaj</th><th scope="col">Forma</th><th scope="col">Czas</th><th scope="col">Cena</th></tr></thead>
  <tbody>
    ${t.offers
      .map(
        (o) =>
          `<tr><td>${escapeHtml(o.title)}</td><td>${o.mode === 'online' ? 'online' : 'stacjonarnie'}</td>
           <td>${o.duration_minutes} min</td><td>${escapeHtml(formatPrice(o.price_minor, o.currency))}</td></tr>`,
      )
      .join('')}
  </tbody>
</table>
</div>

<h2>Kwalifikacje</h2>
<ul>
  ${
    t.credentials.length === 0
      ? '<li>Terapeuta nie podał jeszcze kwalifikacji.</li>'
      : t.credentials
          .map(
            (cr) =>
              `<li>${escapeHtml(cr.title)}${cr.issuer ? `, ${escapeHtml(cr.issuer)}` : ''}${cr.year ? ` (${cr.year})` : ''} —
               ${cr.verified ? '<strong>zweryfikowane</strong>' : 'deklarowane przez terapeutę'}</li>`,
          )
          .join('')
  }
</ul>

<h2 id="faq">Zanim przyjdziesz — pytania i odpowiedzi</h2>
${
  faq.length === 0
    ? '<p>Ten terapeuta nie opublikował jeszcze odpowiedzi. Skontaktuj się bezpośrednio.</p>'
    : `<dl>${faq
        .map(
          (item) =>
            `<div id="faq-${escapeHtml(item.faq_id)}">
               <dt><strong>${escapeHtml(item.question)}</strong></dt>
               <dd><p>${escapeHtml(item.answer).replace(/\n/g, '<br>')}</p>
               <p class="hint">Odpowiedź terapeuty, zaktualizowana ${escapeHtml(item.updated_at.slice(0, 10))}.</p></dd>
             </div>`,
        )
        .join('')}</dl>`
}
<p class="hint">Odpowiedzi pochodzą wprost od terapeuty. Nie zastępują konsultacji ani porady klinicznej.</p>

<h2>Najbliższe wolne terminy</h2>
${
  slots.length === 0
    ? '<p>Brak wolnych terminów w najbliższych trzech tygodniach.</p>'
    : `<ul class="slot-list">${slots
        .map(
          (s) =>
            `<li>${escapeHtml(formatDateTime(s.starts_at_utc, s.timezone))} — ${s.duration_minutes} min,
             ${s.mode === 'online' ? 'online' : 'stacjonarnie'}, ${escapeHtml(formatPrice(s.price_minor, s.currency))}</li>`,
        )
        .join('')}</ul>`
}
<p>Rezerwacja terminu odbywa się przez asystenta ChatGPT.</p>
${pluginCta(c.env)}

<h2>Zasady odwołania</h2>
<p>${escapeHtml(t.cancellation_policy || `Bezpłatne odwołanie do ${t.cancellation_cutoff_hours} godzin przed sesją.`)}</p>

${crisisBanner()}`,
    }),
  );
});

// ------------------------------------------------------------ static pages ---

siteApp.get('/jak-to-dziala', (c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Jak to działa',
      path: '/jak-to-dziala',
      body: `
<h1>Jak to działa</h1>
<ol>
  <li><strong>Mówisz, czego szukasz.</strong> Forma spotkań, miejscowość, język, budżet, dostępność,
  grupa wiekowa i obszary pracy. Nie musisz opisywać swojej sytuacji ani objawów.</li>
  <li><strong>Dostajesz 3–5 profili pasujących do kryteriów</strong>, z podanym powodem dopasowania.</li>
  <li><strong>Czytasz FAQ terapeuty</strong> — odpowiedzi napisane lub zatwierdzone przez tę konkretną osobę.</li>
  <li><strong>Sprawdzasz wolne terminy</strong> z ceną i formą spotkania.</li>
  <li><strong>Widzisz pełne podsumowanie</strong>: terapeuta, termin, strefa czasowa, czas trwania, cena,
  zasady odwołania oraz wersje regulaminu i polityki prywatności.</li>
  <li><strong>Potwierdzasz.</strong> Dopiero wtedy rezerwacja jest zapisywana.</li>
</ol>

<h2>Czego nie robimy</h2>
<ul>
  <li>Nie zapisujemy Twoich rozmów z ChatGPT.</li>
  <li>Nie zapisujemy powodów, dla których szukasz terapii.</li>
  <li>Nie stawiamy diagnoz i nie kwalifikujemy do leczenia.</li>
  <li>Nie sprzedajemy pozycji w wynikach i nie prowadzimy profilowania reklamowego.</li>
</ul>

<h2>Skąd biorą się dane w profilach</h2>
<p>Dane wprowadza terapeuta. Część z nich weryfikujemy — wtedy profil ma oznaczenie
„profil zweryfikowany” z datą weryfikacji. Pozostałe dane są oznaczone jako deklarowane przez
terapeutę. Profile demonstracyjne (fikcyjne, na potrzeby prezentacji) są zawsze wyraźnie oznaczone.</p>
${crisisBanner()}`,
    }),
  ),
);

siteApp.get('/bezpieczenstwo', (c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Bezpieczeństwo',
      path: '/bezpieczenstwo',
      body: `
<h1>Bezpieczeństwo i granice usługi</h1>

<h2>Granice kliniczne</h2>
<p>Otwarty Terapeuta jest katalogiem i systemem rezerwacji. Nie prowadzimy terapii, nie stawiamy
diagnoz, nie prowadzimy interwencji kryzysowej i nie kwalifikujemy nikogo do leczenia. Asystent
ChatGPT korzystający z naszego pluginu również tego nie robi — może jedynie pokazać dane z katalogu
i odpowiedzi napisane przez terapeutów.</p>

<h2>Kryzys</h2>
<p>Jeżeli rozmowa wskazuje na bezpośrednie zagrożenie życia lub zdrowia, plugin ma obowiązek pokazać
dane kontaktowe pomocy kryzysowej zamiast prowadzić zwykłe wyszukiwanie.
<a href="/pomoc-w-kryzysie">Zobacz listę miejsc pomocy</a>.</p>

<h2>Wiek</h2>
<p>Serwis jest przeznaczony dla osób pełnoletnich. Dla osób poniżej 18 roku życia pokazujemy osobne
zasoby pomocy i nie prowadzimy standardowej rezerwacji.</p>

<h2>Jak chronimy dane</h2>
<ul>
  <li>Nie zapisujemy treści rozmów ani powodów szukania terapii.</li>
  <li>Dane kontaktowe (imię, e-mail, telefon) są szyfrowane w bazie kluczem aplikacyjnym.</li>
  <li>Adresy e-mail są wyszukiwane po nieodwracalnym skrócie, nie po treści.</li>
  <li>Logi i telemetria są filtrowane z danych osobowych i tokenów.</li>
  <li>Każda operacja zapisu wymaga autoryzacji, walidacji, klucza idempotencji i trafia do audytu.</li>
  <li>Nie stosujemy trackerów reklamowych ani zewnętrznych skryptów analitycznych.</li>
</ul>

<h2>Weryfikacja terapeutów</h2>
<p>Weryfikacja obejmuje sprawdzenie tożsamości i przedstawionych dokumentów potwierdzających
kwalifikacje. Weryfikacja nie jest gwarancją jakości ani skuteczności terapii. Data ostatniej
weryfikacji jest widoczna w profilu.</p>

<h2>Zgłaszanie problemów</h2>
<p>Nieprawidłowości w profilu, podejrzenie nadużycia lub incydent bezpieczeństwa zgłoś na
<a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a>.</p>
${crisisBanner()}`,
    }),
  ),
);

siteApp.get('/pomoc-w-kryzysie', async (c) => {
  const [adult, minor] = await Promise.all([
    getCrisisResources(c.env, 'PL', 'adult'),
    getCrisisResources(c.env, 'PL', 'minor'),
  ]);

  const renderList = (items: Awaited<ReturnType<typeof getCrisisResources>>): string =>
    `<ul class="grid cols-2" style="list-style:none;padding:0">${items
      .map(
        (r) => `<li class="card">
      <h3>${escapeHtml(r.title)}</h3>
      <p>${escapeHtml(r.description)}</p>
      ${r.phone ? `<p><strong>Telefon:</strong> <a href="tel:${escapeHtml(r.phone.replace(/\s/g, ''))}">${escapeHtml(r.phone)}</a></p>` : ''}
      ${r.url ? `<p><strong>Strona:</strong> <a href="${escapeHtml(r.url)}" rel="noopener">${escapeHtml(r.url)}</a></p>` : ''}
      ${r.hours ? `<p class="meta">Dostępność: ${escapeHtml(r.hours)}</p>` : ''}
      <p class="hint">Zweryfikowano: ${escapeHtml(r.verified_at)} · źródło: <a href="${escapeHtml(r.source_url)}" rel="noopener">oficjalna informacja</a></p>
    </li>`,
      )
      .join('')}</ul>`;

  return htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Pomoc w kryzysie',
      description: 'Numery i miejsca pomocy w kryzysie psychicznym w Polsce.',
      path: '/pomoc-w-kryzysie',
      body: `
<h1>Pomoc w kryzysie</h1>
<div class="notice warn">
  <p><strong>Rezerwacja wizyty nie jest pomocą w nagłym zagrożeniu.</strong> Jeżeli Ty lub ktoś
  w Twoim otoczeniu jest w bezpośrednim niebezpieczeństwie, zadzwoń pod <strong>112</strong> lub
  <strong>999</strong>.</p>
</div>

<h2>Osoby dorosłe</h2>
${renderList(adult)}

<h2>Osoby poniżej 18 roku życia</h2>
${renderList(minor)}

<p class="hint">Dane są utrzymywane ręcznie i weryfikowane okresowo względem oficjalnych źródeł
(pacjent.gov.pl, gov.pl). Jeżeli zauważysz nieaktualną informację, napisz na
<a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a>.</p>`,
    }),
  );
});

siteApp.get('/polityka-prywatnosci', (c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Polityka prywatności',
      path: '/polityka-prywatnosci',
      body: `
<h1>Polityka prywatności</h1>
<p class="meta">Wersja ${escapeHtml(c.env.PRIVACY_VERSION)}</p>

<h2>Jakie dane przetwarzamy</h2>
<ul>
  <li><strong>Konto:</strong> adres e-mail (przechowywany w postaci zaszyfrowanej oraz jako nieodwracalny skrót do wyszukiwania).</li>
  <li><strong>Profil terapeuty:</strong> dane zawodowe podane w zgłoszeniu, ustawienia oferty i dostępności oraz status weryfikacji. Adres e-mail pozostaje zaszyfrowany.</li>
  <li><strong>Rezerwacja:</strong> identyfikator terapeuty i terminu, cena, forma spotkania, opcjonalnie imię i telefon do kontaktu — zaszyfrowane.</li>
  <li><strong>Zgody:</strong> wersja regulaminu i polityki prywatności zaakceptowana w momencie rezerwacji.</li>
  <li><strong>Audyt:</strong> minimalny zapis operacji zapisu (co, kiedy, przez kogo), bez treści i bez danych zdrowotnych.</li>
</ul>

<h2>Czego nie przetwarzamy</h2>
<ul>
  <li>Nie zapisujemy treści rozmów z ChatGPT ani ich fragmentów.</li>
  <li>Nie zapisujemy opisu objawów, historii leczenia ani diagnoz.</li>
  <li>Nie zapisujemy powodów szukania terapii poza filtrami wybranymi w trakcie wyszukiwania —
      a te nie są przypisywane do konta po zakończeniu wyszukiwania.</li>
  <li>Nie prowadzimy profilowania reklamowego i nie udostępniamy danych do marketingu.</li>
</ul>

<h2>Odbiorcy danych</h2>
<p>Terapeuta, u którego rezerwujesz wizytę, otrzymuje dane niezbędne do jej realizacji.
Dostawca infrastruktury (Cloudflare) i dostawca poczty transakcyjnej przetwarzają dane
na nasze zlecenie.</p>

<h2>Okres przechowywania</h2>
<p>Szczegóły opisuje dokument retencji dostępny na żądanie. W skrócie: dane kontaktowe rezerwacji
usuwamy po 12 miesiącach od terminu wizyty, zapisy audytowe po 24 miesiącach, dane logowania
po 30 dniach. Niepotwierdzone zgłoszenie terapeuty wygasa po 15 minutach; dane aktywnego profilu
przechowujemy przez czas prowadzenia konta.</p>

<h2>Twoje prawa</h2>
<p>Możesz zażądać kopii swoich danych lub ich usunięcia, pisząc na
<a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a>.
Usunięcie konta usuwa dane kontaktowe; sam fakt odbytej wizyty pozostaje w formie
pozbawionej danych identyfikujących, ponieważ jest potrzebny do rozliczeń.</p>

<h2>Bezpieczeństwo</h2>
<p>Dane kontaktowe są szyfrowane na poziomie aplikacji. Dostęp do panelu administracyjnego
jest ograniczony rolami i chroniony logowaniem jednorazowym kodem.</p>`,
    }),
  ),
);

siteApp.get('/regulamin', (c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Regulamin',
      path: '/regulamin',
      body: `
<h1>Regulamin</h1>
<p class="meta">Wersja ${escapeHtml(c.env.TERMS_VERSION)}</p>

<h2>1. Czym jest serwis</h2>
<p>Otwarty Terapeuta udostępnia katalog psychoterapeutów oraz umożliwia rezerwację terminu wizyty.
Serwis nie świadczy usług terapeutycznych ani medycznych i nie jest stroną umowy między osobą
rezerwującą a terapeutą.</p>

<h2>2. Kto może korzystać</h2>
<p>Z rezerwacji mogą korzystać wyłącznie osoby pełnoletnie.</p>

<h2>3. Profile terapeutów</h2>
<p>Terapeuta może utworzyć konto po potwierdzeniu adresu e-mail. Nowy profil jest roboczy i
niezweryfikowany. Utworzenie konta nie gwarantuje publikacji; administrator może poprosić o
dokumenty, odmówić publikacji albo wycofać profil naruszający regulamin.</p>

<h2>4. Rezerwacja</h2>
<p>Rezerwacja jest skuteczna po wyświetleniu pełnego podsumowania i jego jednoznacznym potwierdzeniu.
Cena, czas trwania i forma spotkania obowiązują w wersji przedstawionej w podsumowaniu.</p>

<h2>5. Odwołanie wizyty</h2>
<p>Zasady odwołania określa terapeuta i są widoczne w jego profilu oraz w podsumowaniu rezerwacji.
Odwołanie po upływie bezpłatnego okresu może wiązać się z opłatą ustaloną przez terapeutę.</p>

<h2>6. Płatności</h2>
<p>Rozliczenie następuje bezpośrednio między osobą rezerwującą a terapeutą, zgodnie z informacją
w profilu terapeuty. Serwis nie pośredniczy w płatnościach.</p>

<h2>7. Dane w profilach</h2>
<p>Za treść profilu i odpowiedzi FAQ odpowiada terapeuta. Serwis oznacza, które dane zostały
zweryfikowane i kiedy. Weryfikacja nie jest gwarancją jakości usługi.</p>

<h2>8. Pomoc w kryzysie</h2>
<p>Serwis nie jest pomocą w nagłym zagrożeniu życia lub zdrowia. W takiej sytuacji należy
skorzystać z numerów wskazanych na stronie <a href="/pomoc-w-kryzysie">Pomoc w kryzysie</a>.</p>

<h2>9. Kontakt</h2>
<p><a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a></p>`,
    }),
  ),
);

// ---------------------------------------------------- booking manage page ---

siteApp.get('/rezerwacja/:ref', async (c) => {
  const ref = c.req.param('ref');
  const secret = new URL(c.req.url).searchParams.get('k') ?? '';
  const notFound = renderPage(c.env, {
    title: 'Rezerwacja',
    path: '/',
    noindex: true,
    body: `<h1>Nie znaleziono rezerwacji</h1>
           <p>Link jest nieprawidłowy lub wygasł. Sprawdź adres z wiadomości potwierdzającej.</p>`,
  });

  if (!c.env.TOKEN_SIGNING_KEY || !secret) return htmlResponse(c.env, notFound, { status: 404 });

  const row = await c.env.DB.prepare(
    `SELECT b.public_ref, b.status, b.starts_at_utc, b.timezone, b.price_minor, b.currency,
            b.manage_token_hash, b.session_type, b.mode, t.display_name, t.cancellation_policy
       FROM bookings b JOIN therapists t ON t.id = b.therapist_id WHERE b.public_ref = ?`,
  )
    .bind(ref)
    .first<{
      public_ref: string;
      status: string;
      starts_at_utc: string;
      timezone: string;
      price_minor: number;
      currency: string;
      manage_token_hash: string;
      session_type: string;
      mode: string;
      display_name: string;
      cancellation_policy: string;
    }>();

  if (!row) return htmlResponse(c.env, notFound, { status: 404 });
  const expected = await hmacHex(c.env.TOKEN_SIGNING_KEY, `manage:${secret}`);
  if (!timingSafeEqual(expected, row.manage_token_hash)) {
    return htmlResponse(c.env, notFound, { status: 404 });
  }

  return htmlResponse(
    c.env,
    renderPage(c.env, {
      title: `Rezerwacja ${row.public_ref}`,
      path: '/',
      noindex: true,
      body: `
<h1>Rezerwacja ${escapeHtml(row.public_ref)}</h1>
<p class="meta">Status: ${row.status === 'cancelled' ? 'odwołana' : 'potwierdzona'}</p>
<div class="card">
  <dl>
    <dt>Terapeuta</dt><dd>${escapeHtml(row.display_name)}</dd>
    <dt>Termin</dt><dd>${escapeHtml(formatDateTime(row.starts_at_utc, row.timezone))} (${escapeHtml(row.timezone)})</dd>
    <dt>Forma</dt><dd>${escapeHtml(row.session_type)}, ${row.mode === 'online' ? 'online' : 'stacjonarnie'}</dd>
    <dt>Cena</dt><dd>${escapeHtml(formatPrice(row.price_minor, row.currency))}</dd>
  </dl>
</div>
<h2>Zasady odwołania</h2>
<p>${escapeHtml(row.cancellation_policy || 'Zgodnie z regulaminem terapeuty.')}</p>
<p>Aby odwołać wizytę, poproś asystenta ChatGPT o odwołanie tej rezerwacji albo napisz na
<a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a>.</p>`,
    }),
  );
});
