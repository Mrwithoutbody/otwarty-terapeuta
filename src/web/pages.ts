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
import { escapeHtml, renderBodyText } from '../lib/sanitize';
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
    return `<a class="btn secondary" href="#w-chatgpt">Zobacz, jak działa w ChatGPT <span aria-hidden="true">↓</span></a>`;
  }
  return `<a class="btn secondary" href="${escapeHtml(url)}" rel="noopener">Znajdź terapeutę z pomocą ChatGPT <span aria-hidden="true">↗</span></a>`;
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

/**
 * The admin uploader stores two renditions under one key: the master and a
 * `-160` thumbnail beside it. Anything that does not match that shape - a demo
 * avatar, a hand-typed address - is returned untouched, and `/media/:key`
 * falls back to the master when a thumbnail was never written, so an older
 * upload still renders.
 */
function thumbnailUrl(url: string | null): string | null {
  if (!url) return null;
  const match = /^(\/media\/therapists\/[^/]+\/[^/.]+)(\.[a-z]+)$/.exec(url);
  return match ? `${match[1]}-160${match[2]}` : url;
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

  return `<li class="card therapist-card">
  <div style="display:flex;gap:0.9rem;align-items:flex-start">
    ${
      t.photo_url
        ? `<img class="avatar" src="${escapeHtml(thumbnailUrl(t.photo_url))}" alt="" width="72" height="72" loading="lazy" decoding="async">`
        : `<span class="avatar" aria-hidden="true"></span>`
    }
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
  <p class="card-actions"><a href="/terapeuci/${encodeURIComponent(t.slug)}">Zobacz profil, FAQ i terminy</a></p>
</li>`;
}

// ------------------------------------------------------------------- home ---

siteApp.get('/', (c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Znajdź psychoterapeutę',
      description:
        'Katalog psychoterapeutów w Polsce z jasnymi cenami, zasadami odwołania i rezerwacją terminu. Bez ukrytego rankingu i bez płatnych pozycji.',
      path: '/',
      body: `
<div class="home">
  <section class="home-hero" aria-labelledby="home-title">
    <div class="hero-copy">
      <p class="eyebrow"><span aria-hidden="true"></span> Katalog psychoterapeutów i rezerwacja wizyt</p>
      <h1 id="home-title">Znajdź psychoterapeutę na swoich warunkach.</h1>
      <p class="lead">Porównaj profile po tym, co naprawdę ma znaczenie: formie spotkań, języku, cenie, nurcie pracy i najbliższym wolnym terminie. Zarezerwuj wizytę bezpośrednio — także w rozmowie z ChatGPT.</p>
      <div class="hero-actions">
        <a class="btn" href="/terapeuci">Przeglądaj katalog na stronie <span aria-hidden="true">→</span></a>
        ${pluginCta(c.env)}
      </div>
      ${c.env.PUBLIC_PLUGIN_URL?.trim() ? '' : '<p class="hero-availability"><span aria-hidden="true"></span> Integracja z ChatGPT jest w przygotowaniu do publikacji.</p>'}
      <ul class="hero-assurances" aria-label="Najważniejsze zasady serwisu">
        <li>Jawne ceny</li><li>Zweryfikowane profile</li><li>Bez opłat za wyszukiwanie</li>
      </ul>
    </div>

    <div class="finder-preview" aria-label="Przykładowy widok wyszukiwarki terapeutów">
      <div class="preview-toolbar"><span class="preview-mark"><img src="/logo.svg" alt="" width="22" height="22"></span><span>Katalog Otwarty Terapeuta</span><span class="preview-status">widok strony</span></div>
      <div class="preview-filters">
        <span>Online</span><span>do 220 zł</span><span>najbliższy termin</span>
      </div>
      <div class="preview-result featured">
        <span class="profile-photo" aria-hidden="true">MK</span>
        <div><p class="result-label">Profil zweryfikowany</p><h2>Psychoterapia dopasowana do Ciebie</h2><p>Online · terapia indywidualna</p></div>
        <span class="match-score">dobry wybór</span>
      </div>
      <div class="preview-slots">
        <p>Najbliższe wolne terminy</p><span>Dziś 18:00</span><span>Jutro 10:30</span><a href="/terapeuci">Zobacz profil →</a>
      </div>
      <div class="preview-note"><span aria-hidden="true">✓</span><p><strong>Dlaczego ten profil?</strong><br>Pasuje do wybranej formy spotkań, budżetu i dostępności.</p></div>
    </div>
  </section>

  <div class="trust-strip" aria-label="Zasady platformy">
    <p><strong>Przejrzysty wybór</strong><span>każdy wynik ma uzasadnienie</span></p>
    <p><strong>Bez płatnych pozycji</strong><span>kolejność wynika z kryteriów</span></p>
    <p><strong>Twoja prywatność</strong><span>nie pytamy o diagnozę</span></p>
    <p><strong>Prosta rezerwacja</strong><span>termin i zasady w jednym miejscu</span></p>
  </div>

  <section class="home-section value-section" aria-labelledby="value-title">
    <div class="section-heading">
      <p class="kicker">Wszystko w jednym miejscu</p>
      <h2 id="value-title">Mniej szukania.<br>Więcej pewności.</h2>
      <p>Dobry wybór zaczyna się od konkretnych informacji. Dlatego pokazujemy to, co naprawdę pomaga podjąć decyzję.</p>
    </div>
    <div class="value-list">
      <article><span class="feature-icon" aria-hidden="true">01</span><div><h3>Profile, które da się porównać</h3><p>Kwalifikacje, obszary pracy, języki, forma spotkań i cena zapisane w czytelny sposób.</p></div></article>
      <article><span class="feature-icon" aria-hidden="true">02</span><div><h3>Wolne terminy bez telefonowania</h3><p>Sprawdź dostępność i przejdź do rezerwacji bez wymiany wielu wiadomości.</p></div></article>
      <article><span class="feature-icon" aria-hidden="true">03</span><div><h3>Jasne powody dopasowania</h3><p>Przy profilu widzisz, które z Twoich kryteriów spełnia — bez tajemniczego wyniku procentowego.</p></div></article>
    </div>
  </section>

  <section class="home-section steps-section" aria-labelledby="steps-title">
    <div class="section-heading centered">
      <p class="kicker">Prosty początek</p>
      <h2 id="steps-title">Od kryteriów do spotkania</h2>
      <p>Nie musisz wiedzieć wszystkiego o psychoterapii. Zacznij od tego, co jest dla Ciebie ważne.</p>
    </div>
    <ol class="steps">
      <li><span>1</span><h3>Wybierz kryteria</h3><p>Określ formę spotkań, lokalizację, budżet i dostępność.</p></li>
      <li><span>2</span><h3>Porównaj profile</h3><p>Przeczytaj o doświadczeniu, podejściu i zasadach współpracy.</p></li>
      <li><span>3</span><h3>Zarezerwuj termin</h3><p>Wybierz dogodny termin i otrzymaj jasne potwierdzenie wizyty.</p></li>
    </ol>
    <p class="section-action"><a class="btn" href="/terapeuci">Przejdź do katalogu <span aria-hidden="true">→</span></a></p>
  </section>

  <section class="home-section assistant-section" id="w-chatgpt" aria-labelledby="assistant-title">
    <div class="chat-window" aria-label="Przykład działania Otwartego Terapeuty w rozmowie z ChatGPT">
      <div class="chat-topbar"><span class="chatgpt-mark" aria-hidden="true">✦</span><strong>ChatGPT</strong><span class="chat-demo-label">przykładowa rozmowa</span></div>
      <div class="chat-thread">
        <p class="chat-user">Szukam terapii online, wieczorami, do 220 zł za spotkanie.</p>
        <div class="chat-assistant"><span class="chatgpt-mark" aria-hidden="true">✦</span><p>Znalazłem profile pasujące do tych kryteriów. Możesz je porównać poniżej.</p></div>
        <div class="chat-widget">
          <div class="chat-widget-head"><span class="preview-mark"><img src="/logo.svg" alt="" width="20" height="20"></span><div><strong>Otwarty Terapeuta</strong><small>3 pasujące profile</small></div></div>
          <div class="chat-profile">
            <span class="profile-photo" aria-hidden="true">MK</span>
            <div><span class="verified-dot">profil zweryfikowany</span><strong>Psychoterapia indywidualna</strong><small>Online · 200 zł · wolny termin jutro</small></div>
          </div>
          <div class="chat-reason"><span aria-hidden="true">✓</span><p><strong>Dlaczego ten profil?</strong> Pasuje do formy spotkań, budżetu i dostępności.</p></div>
          <div class="chat-widget-actions"><span>Zobacz profil</span><span>Sprawdź terminy</span></div>
        </div>
        <p class="chat-caption">Po wyborze terminu ChatGPT pokaże pełne podsumowanie. Rezerwacja nastąpi dopiero po Twoim potwierdzeniu.</p>
      </div>
    </div>
    <div class="assistant-copy">
      <p class="kicker">Otwarty Terapeuta w ChatGPT</p>
      <h2 id="assistant-title">Zapytaj po swojemu. Porównaj. Zarezerwuj.</h2>
      <p>Nie musisz przeklikiwać wielu stron. W rozmowie podajesz ważne dla Ciebie kryteria, a ChatGPT korzysta z naszego katalogu i pokazuje wyniki w interaktywnym widżecie.</p>
      <ol class="chat-steps"><li><span>1</span><p><strong>Opisz praktyczne kryteria</strong><small>Na przykład forma spotkań, budżet i dogodna pora.</small></p></li><li><span>2</span><p><strong>Porównaj profile w rozmowie</strong><small>Zobacz cenę, dostępność i powody dopasowania.</small></p></li><li><span>3</span><p><strong>Potwierdź wybrany termin</strong><small>Przed rezerwacją zobaczysz kompletne podsumowanie.</small></p></li></ol>
      <p class="launch-note"><span aria-hidden="true"></span><strong>Aplikacja w przygotowaniu do publikacji w ChatGPT.</strong> Katalog na stronie działa niezależnie.</p>
      <a href="/jak-to-dziala">Poznaj dokładne zasady działania →</a>
    </div>
  </section>

  <section class="home-section for-you-section" aria-labelledby="for-you-title">
    <div class="section-heading centered"><p class="kicker">Na różnych etapach</p><h2 id="for-you-title">To miejsce może być dla Ciebie</h2></div>
    <div class="audience-grid">
      <article><img class="audience-art audience-art-first" src="/illustrations/audience-first-step.webp" alt="" width="1200" height="676" loading="lazy" decoding="async"><h3>Jeśli szukasz po raz pierwszy</h3><p>Zrozumiałe informacje pomagają zacząć bez znajomości specjalistycznych pojęć.</p></article>
      <article><img class="audience-art audience-art-choice" src="/illustrations/audience-conscious-choice.webp" alt="" width="1200" height="676" loading="lazy" decoding="async"><h3>Jeśli wiesz, czego potrzebujesz</h3><p>Filtry pozwalają szybko zawęzić wybór do ważnych dla Ciebie kryteriów.</p></article>
      <article><img class="audience-art audience-art-transparency" src="/illustrations/audience-transparency.webp" alt="" width="1200" height="676" loading="lazy" decoding="async"><h3>Jeśli cenisz przejrzystość</h3><p>Ceny, dostępność i zasady odwołania widzisz przed podjęciem decyzji.</p></article>
    </div>
  </section>

  <section class="home-section safety-section" aria-labelledby="safety-title">
    <div class="safety-copy"><p class="kicker">Bezpieczeństwo i granice</p><h2 id="safety-title">Twoje dane.<br>Twoja decyzja.</h2><p>Projektujemy serwis tak, aby do znalezienia terapeuty wystarczało minimum informacji.</p><a href="/bezpieczenstwo">Jak chronimy dane →</a></div>
    <div class="safety-list">
      <article><span aria-hidden="true">✓</span><div><h3>Minimum danych</h3><p>Nie prosimy o opis objawów ani historię zdrowia podczas przeglądania.</p></div></article>
      <article><span aria-hidden="true">✓</span><div><h3>Jawne zasady</h3><p>Wyjaśniamy, jak działa dopasowanie i co dzieje się z rezerwacją.</p></div></article>
      <article><span aria-hidden="true">✓</span><div><h3>Pomoc w kryzysie</h3><p>Serwis nie zastępuje interwencji kryzysowej. Ważne numery są zawsze dostępne.</p></div></article>
    </div>
  </section>

  <section class="home-cta" aria-labelledby="cta-title">
    <div><p class="kicker">Pierwszy krok może być prosty</p><h2 id="cta-title">Znajdź osobę, z którą chcesz porozmawiać.</h2></div>
    <div><a class="btn" href="/terapeuci">Przeglądaj terapeutów <span aria-hidden="true">→</span></a><a href="/pomoc-w-kryzysie">Potrzebuję pilnej pomocy</a></div>
  </section>

  <aside class="crisis-inline" aria-label="Pomoc w nagłym zagrożeniu"><p><strong>Nie jest usługą terapeutyczną ani pomocą kryzysową.</strong> W bezpośrednim zagrożeniu życia lub zdrowia zadzwoń pod <strong>112</strong>. Całodobowe wsparcie emocjonalne dla dorosłych: <strong>116 123</strong>.</p><a href="/pomoc-w-kryzysie">Wszystkie numery pomocy</a></aside>
</div>`,
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
<div class="directory-page">
<header class="directory-hero"><p class="kicker">Jawne kryteria, bez ukrytego rankingu</p><h1>Katalog terapeutów</h1><p>Filtry działają na jawnych danych z profilu. Nie musisz nic opisywać ani zakładać konta, żeby przeglądać.</p></header>

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

<section class="directory-results" aria-labelledby="wyniki"><div class="directory-results-heading"><p class="kicker">Profile w katalogu</p><h2 id="wyniki">Wyniki (${ranked.length})</h2></div>
${
  ranked.length === 0
    ? `<p class="notice">Brak profili pasujących do podanych kryteriów. Spróbuj rozszerzyć filtry.</p>`
    : `<ul class="grid cols-2" style="list-style:none;padding:0">${ranked
        .slice(0, 24)
        .map((entry) => therapistCard(entry.therapist, entry.match_reasons))
        .join('')}</ul>`
}
</section></div>`,
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
<article class="profile-page">
<nav aria-label="Ścieżka"><p><a href="/terapeuci">Katalog</a> / ${escapeHtml(t.display_name)}</p></nav>
<div class="profile-head">
  ${
    t.photo_url
      ? `<img class="profile-avatar" src="${escapeHtml(t.photo_url)}" alt="" width="160" height="160" decoding="async">`
      : '<span class="profile-avatar" aria-hidden="true"></span>'
  }
  <div>
    <h1>${escapeHtml(t.display_name)}</h1>
    <p class="meta">${escapeHtml(t.headline ?? '')}</p>
  </div>
</div>
<ul class="tags">
  ${t.verification_status === 'verified' ? `<li class="tag verified">profil zweryfikowany${t.verified_at ? ` (${escapeHtml(t.verified_at.slice(0, 10))})` : ''}</li>` : '<li class="tag">dane deklarowane przez terapeutę</li>'}
  ${t.is_demo ? '<li class="tag demo">profil demonstracyjny — osoba fikcyjna</li>' : ''}
  ${t.accepting_new_clients ? '<li class="tag">przyjmuje nowe osoby</li>' : '<li class="tag">brak wolnych miejsc</li>'}
</ul>

<h2>O mojej pracy</h2>
${renderBodyText(t.bio)}

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

${crisisBanner()}
</article>`,
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
<div class="subpage how-page">
  <header class="subpage-hero">
    <p class="kicker">Prosto i bez presji</p>
    <h1>Od pierwszego kryterium do rezerwacji</h1>
    <p class="lead">Ty określasz, co jest dla Ciebie ważne. My pokazujemy jawne informacje i prowadzimy przez kolejne kroki — bez diagnozowania i bez ukrytego rankingu.</p>
    <a class="btn" href="/terapeuci">Przejdź do katalogu <span aria-hidden="true">→</span></a>
  </header>

  <section class="subpage-section" aria-labelledby="process-title">
    <div class="subpage-heading"><p class="kicker">Cały proces</p><h2 id="process-title">Sześć spokojnych kroków</h2><p>Na każdym etapie widzisz tylko informacje potrzebne do podjęcia następnej decyzji.</p></div>
    <ol class="process-grid">
      <li><h3>Mówisz, czego szukasz</h3><p>Forma spotkań, miejscowość, język, budżet, dostępność, grupa wiekowa i obszary pracy. Nie musisz opisywać swojej sytuacji ani objawów.</p></li>
      <li><h3>Otrzymujesz dopasowane profile</h3><p>Dostajesz 3–5 profili pasujących do kryteriów, wraz z jasnym powodem dopasowania.</p></li>
      <li><h3>Poznajesz terapeutę</h3><p>Czytasz FAQ — odpowiedzi napisane lub zatwierdzone przez tę konkretną osobę.</p></li>
      <li><h3>Sprawdzasz wolne terminy</h3><p>Od razu widzisz cenę, czas trwania oraz formę spotkania.</p></li>
      <li><h3>Widzisz pełne podsumowanie</h3><p>Terapeuta, termin, strefa czasowa, cena, zasady odwołania oraz wersje dokumentów są w jednym miejscu.</p></li>
      <li><h3>Potwierdzasz</h3><p>Dopiero po Twoim jednoznacznym potwierdzeniu rezerwacja zostaje zapisana.</p></li>
    </ol>
  </section>

  <section class="principles-panel" aria-label="Zasady serwisu">
    <article>
      <p class="kicker">Jasne granice</p><h2>Czego nie robimy</h2>
      <ul class="calm-list"><li>Nie zapisujemy Twoich rozmów z ChatGPT.</li><li>Nie zapisujemy powodów, dla których szukasz terapii.</li><li>Nie stawiamy diagnoz i nie kwalifikujemy do leczenia.</li><li>Nie sprzedajemy pozycji w wynikach i nie prowadzimy profilowania reklamowego.</li></ul>
    </article>
    <article>
      <p class="kicker">Jawne źródła</p><h2>Skąd biorą się dane</h2>
      <p>Dane wprowadza terapeuta. Część z nich weryfikujemy — wtedy profil ma oznaczenie „profil zweryfikowany” z datą weryfikacji.</p><p>Pozostałe dane są oznaczone jako deklarowane przez terapeutę. Profile demonstracyjne są zawsze wyraźnie opisane.</p>
    </article>
  </section>
  ${crisisBanner()}
</div>`,
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
<div class="subpage safety-page">
  <header class="subpage-hero">
    <p class="kicker">Bezpieczeństwo i granice</p>
    <h1>Twoje dane. Twoja decyzja.</h1>
    <p class="lead">Serwis pomaga znaleźć terapeutę i zarezerwować termin. Nie diagnozuje, nie prowadzi terapii i zbiera tylko informacje niezbędne do wykonania wybranej czynności.</p>
  </header>

  <section class="info-card-grid" aria-label="Najważniejsze zasady bezpieczeństwa">
    <article class="info-card"><span class="info-index">01</span><h2>Granice kliniczne</h2><p>Otwarty Terapeuta jest katalogiem i systemem rezerwacji. Nie prowadzimy terapii, nie stawiamy diagnoz, nie prowadzimy interwencji kryzysowej i nie kwalifikujemy nikogo do leczenia.</p><p>Asystent ChatGPT może jedynie pokazać dane z katalogu i odpowiedzi napisane przez terapeutów.</p></article>
    <article class="info-card crisis-card"><span class="info-index">02</span><h2>Kryzys</h2><p>W razie bezpośredniego zagrożenia życia lub zdrowia pokazujemy dane kontaktowe pomocy kryzysowej zamiast zwykłego wyszukiwania.</p><a href="/pomoc-w-kryzysie">Zobacz miejsca pomocy →</a></article>
    <article class="info-card"><span class="info-index">03</span><h2>Wiek</h2><p>Serwis jest przeznaczony dla osób pełnoletnich. Osobom poniżej 18 roku życia pokazujemy osobne zasoby pomocy i nie prowadzimy standardowej rezerwacji.</p></article>
    <article class="info-card"><span class="info-index">04</span><h2>Weryfikacja terapeutów</h2><p>Sprawdzamy tożsamość i przedstawione dokumenty potwierdzające kwalifikacje. Weryfikacja nie jest gwarancją jakości ani skuteczności terapii. Jej data jest widoczna w profilu.</p></article>
  </section>

  <section class="data-panel" aria-labelledby="data-title">
    <div><p class="kicker">Minimum informacji</p><h2 id="data-title">Jak chronimy dane</h2><p>Projektujemy każdą operację tak, aby ograniczyć zakres danych i możliwość ich niepotrzebnego użycia.</p></div>
    <ul class="calm-list"><li>Nie zapisujemy treści rozmów ani powodów szukania terapii.</li><li>Dane kontaktowe są szyfrowane kluczem aplikacyjnym.</li><li>Adresy e-mail wyszukujemy po nieodwracalnym skrócie.</li><li>Logi i telemetria są filtrowane z danych osobowych i tokenów.</li><li>Operacje zapisu wymagają autoryzacji, walidacji i trafiają do audytu.</li><li>Nie stosujemy trackerów reklamowych ani zewnętrznych skryptów analitycznych.</li></ul>
  </section>

  <section class="contact-panel"><div><p class="kicker">Kontakt</p><h2>Zgłaszanie problemów</h2><p>Nieprawidłowości w profilu, podejrzenie nadużycia lub incydent bezpieczeństwa zgłoś na <a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a>.</p></div></section>
  ${crisisBanner()}
</div>`,
    }),
  ),
);

siteApp.get('/pomoc-w-kryzysie', async (c) => {
  const [adult, minor] = await Promise.all([
    getCrisisResources(c.env, 'PL', 'adult'),
    getCrisisResources(c.env, 'PL', 'minor'),
  ]);

  const renderList = (items: Awaited<ReturnType<typeof getCrisisResources>>): string =>
    `<ul class="resource-grid">${items
      .map(
        (r) => `<li class="resource-card">
      <h3>${escapeHtml(r.title)}</h3>
      <p>${escapeHtml(r.description)}</p>
      <div class="resource-actions">
        ${r.phone ? `<a class="resource-phone" href="tel:${escapeHtml(r.phone.replace(/\s/g, ''))}"><span>Zadzwoń</span><strong>${escapeHtml(r.phone)}</strong></a>` : ''}
        ${r.url ? `<a class="resource-link" href="${escapeHtml(r.url)}" rel="noopener">Otwórz stronę <span aria-hidden="true">↗</span></a>` : ''}
      </div>
      ${r.hours ? `<p class="resource-hours"><span aria-hidden="true">●</span> ${escapeHtml(r.hours)}</p>` : ''}
      <p class="resource-source">Zweryfikowano ${escapeHtml(r.verified_at)} · <a href="${escapeHtml(r.source_url)}" rel="noopener">oficjalne źródło</a></p>
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
<div class="subpage crisis-page">
  <header class="crisis-hero">
    <div><p class="kicker">Sprawdzone miejsca pomocy</p><h1>Nie musisz zostawać z tym samodzielnie.</h1><p class="lead">Jeśli sytuacja nie jest bezpośrednim zagrożeniem, poniżej znajdziesz bezpłatne telefony i miejsca wsparcia.</p></div>
    <aside class="emergency-panel" aria-label="Pomoc w bezpośrednim zagrożeniu"><p class="emergency-warning">Rezerwacja wizyty nie jest pomocą w nagłym zagrożeniu.</p><p>Bezpośrednie zagrożenie życia lub zdrowia</p><a href="tel:112">112</a><span>lub 999 · numery alarmowe</span></aside>
  </header>

  <section class="resource-section" aria-labelledby="adult-title"><div class="resource-heading"><p class="kicker">Pomoc dla pełnoletnich</p><h2 id="adult-title">Osoby dorosłe</h2><p>Telefony zaufania i publiczne miejsca pomocy dostępne bez skierowania.</p></div>${renderList(adult)}</section>

  <section class="resource-section minor-resources" aria-labelledby="minor-title"><div class="resource-heading"><p class="kicker">Pomoc dla dzieci i młodzieży</p><h2 id="minor-title">Osoby poniżej 18 roku życia</h2><p>Anonimowe telefony wsparcia oraz osobna ścieżka pomocy dla młodszych osób.</p></div>${renderList(minor)}</section>

  <aside class="source-note"><p>Dane utrzymujemy ręcznie i okresowo weryfikujemy względem oficjalnych źródeł (pacjent.gov.pl, gov.pl). Jeśli zauważysz nieaktualną informację, napisz na <a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a>.</p></aside>
</div>`,
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
<div class="document-page">
<header class="document-hero"><p class="kicker">Dokumenty i zasady</p><h1>Polityka prywatności</h1><p class="lead">Przejrzyste wyjaśnienie, jakie dane są potrzebne do działania katalogu i rezerwacji oraz czego świadomie nie zbieramy.</p><p class="document-version">Wersja ${escapeHtml(c.env.PRIVACY_VERSION)}</p></header>
<div class="document-content">
<section><h2>Jakie dane przetwarzamy</h2>
<ul>
  <li><strong>Konto:</strong> adres e-mail (przechowywany w postaci zaszyfrowanej oraz jako nieodwracalny skrót do wyszukiwania).</li>
  <li><strong>Profil terapeuty:</strong> dane zawodowe podane w zgłoszeniu, ustawienia oferty i dostępności oraz status weryfikacji. Adres e-mail pozostaje zaszyfrowany.</li>
  <li><strong>Rezerwacja:</strong> identyfikator terapeuty i terminu, cena, forma spotkania, opcjonalnie imię i telefon do kontaktu — zaszyfrowane.</li>
  <li><strong>Zgody:</strong> wersja regulaminu i polityki prywatności zaakceptowana w momencie rezerwacji.</li>
  <li><strong>Audyt:</strong> minimalny zapis operacji zapisu (co, kiedy, przez kogo), bez treści i bez danych zdrowotnych.</li>
</ul></section>

<section><h2>Czego nie przetwarzamy</h2>
<ul>
  <li>Nie zapisujemy treści rozmów z ChatGPT ani ich fragmentów.</li>
  <li>Nie zapisujemy opisu objawów, historii leczenia ani diagnoz.</li>
  <li>Nie zapisujemy powodów szukania terapii poza filtrami wybranymi w trakcie wyszukiwania —
      a te nie są przypisywane do konta po zakończeniu wyszukiwania.</li>
  <li>Nie prowadzimy profilowania reklamowego i nie udostępniamy danych do marketingu.</li>
</ul></section>

<section><h2>Odbiorcy danych</h2>
<p>Terapeuta, u którego rezerwujesz wizytę, otrzymuje dane niezbędne do jej realizacji.
Dostawca infrastruktury (Cloudflare) i dostawca poczty transakcyjnej przetwarzają dane
na nasze zlecenie.</p></section>

<section><h2>Okres przechowywania</h2>
<p>Szczegóły opisuje dokument retencji dostępny na żądanie. W skrócie: dane kontaktowe rezerwacji
usuwamy po 12 miesiącach od terminu wizyty, zapisy audytowe po 24 miesiącach, dane logowania
po 30 dniach. Niepotwierdzone zgłoszenie terapeuty wygasa po 15 minutach; dane aktywnego profilu
przechowujemy przez czas prowadzenia konta.</p></section>

<section><h2>Twoje prawa</h2>
<p>Możesz zażądać kopii swoich danych lub ich usunięcia, pisząc na
<a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a>.
Usunięcie konta usuwa dane kontaktowe; sam fakt odbytej wizyty pozostaje w formie
pozbawionej danych identyfikujących, ponieważ jest potrzebny do rozliczeń.</p></section>

<section><h2>Bezpieczeństwo</h2>
<p>Dane kontaktowe są szyfrowane na poziomie aplikacji. Dostęp do panelu administracyjnego
jest ograniczony rolami i chroniony logowaniem jednorazowym kodem.</p></section>
</div></div>`,
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
<div class="document-page">
<header class="document-hero"><p class="kicker">Dokumenty i zasady</p><h1>Regulamin</h1><p class="lead">Najważniejsze zasady korzystania z katalogu i rezerwacji, opisane możliwie prostym językiem.</p><p class="document-version">Wersja ${escapeHtml(c.env.TERMS_VERSION)}</p></header>
<div class="document-content">
<section><h2>1. Czym jest serwis</h2>
<p>Otwarty Terapeuta udostępnia katalog psychoterapeutów oraz umożliwia rezerwację terminu wizyty.
Serwis nie świadczy usług terapeutycznych ani medycznych i nie jest stroną umowy między osobą
rezerwującą a terapeutą.</p></section>

<section><h2>2. Kto może korzystać</h2><p>Z rezerwacji mogą korzystać wyłącznie osoby pełnoletnie.</p></section>

<section><h2>3. Profile terapeutów</h2>
<p>Terapeuta może utworzyć konto po potwierdzeniu adresu e-mail. Nowy profil jest roboczy i
niezweryfikowany. Utworzenie konta nie gwarantuje publikacji; administrator może poprosić o
dokumenty, odmówić publikacji albo wycofać profil naruszający regulamin.</p></section>

<section><h2>4. Rezerwacja</h2>
<p>Rezerwacja jest skuteczna po wyświetleniu pełnego podsumowania i jego jednoznacznym potwierdzeniu.
Cena, czas trwania i forma spotkania obowiązują w wersji przedstawionej w podsumowaniu.</p></section>

<section><h2>5. Odwołanie wizyty</h2>
<p>Zasady odwołania określa terapeuta i są widoczne w jego profilu oraz w podsumowaniu rezerwacji.
Odwołanie po upływie bezpłatnego okresu może wiązać się z opłatą ustaloną przez terapeutę.</p>
</section>

<section><h2>6. Płatności</h2>
<p>Rozliczenie następuje bezpośrednio między osobą rezerwującą a terapeutą, zgodnie z informacją
w profilu terapeuty. Serwis nie pośredniczy w płatnościach.</p></section>

<section><h2>7. Dane w profilach</h2>
<p>Za treść profilu i odpowiedzi FAQ odpowiada terapeuta. Serwis oznacza, które dane zostały
zweryfikowane i kiedy. Weryfikacja nie jest gwarancją jakości usługi.</p>
</section>

<section><h2>8. Pomoc w kryzysie</h2>
<p>Serwis nie jest pomocą w nagłym zagrożeniu życia lub zdrowia. W takiej sytuacji należy
skorzystać z numerów wskazanych na stronie <a href="/pomoc-w-kryzysie">Pomoc w kryzysie</a>.</p></section>

<section><h2>9. Kontakt</h2><p><a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a></p></section>
</div></div>`,
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
