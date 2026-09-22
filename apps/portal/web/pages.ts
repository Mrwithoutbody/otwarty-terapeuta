import { Hono } from 'hono';
import type { Env } from '../../../shared/env';
import {
  findCandidates,
  getCrisisResources,
  getPublishedFaq,
  getTherapist,
  listCities,
  listCityPages,
  listOpenSlots,
  listSitemapEntries,
  listVocabulary,
  type SearchFilters,
} from '../../../shared/db/catalog';
import type { PublicFaqItem, PublicSlot, PublicTherapist } from '../../../shared/db/types';
import { rankTherapists } from '../../../shared/matching/rank';
import { escapeHtml, slugOf } from '../../../shared/lib/sanitize';
import { formatDate, formatDateTime, formatPrice, formatTime, nowIso } from '../../../shared/lib/time';
import { controllerDetails, CONTROLLER } from '../../../shared/web/controller';
import { recordProfileView } from '../../../shared/db/views';
import { htmlResponse, pageHead, renderPage } from '../../../shared/web/layout';
import { serveAuthored, serveAuthoredSubpage } from '../authored/site';
import { languageList, pluginCta } from './labels';
import { PROFILE_SLUG, sessionFrom, snippet, withSeoHead } from './seo';

/**
 * The public website. Everything is server rendered with escaped text and no
 * inline script, which keeps the CSP strict and makes the catalogue usable
 * without JavaScript at all.
 */

export const siteApp = new Hono<{ Bindings: Env }>();


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
  <div class="card-head">
    ${
      t.photo_url
        ? `<img class="avatar" src="${escapeHtml(thumbnailUrl(t.photo_url))}" alt="${escapeHtml(t.display_name)} — zdjęcie" width="72" height="72" loading="lazy" decoding="async">`
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
    <dt>Języki</dt><dd>${languageList(t.languages)}</dd>
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

/**
 * Three profiles a visitor can open straight from the home page. Real people
 * with a photograph come first; demo profiles only fill the row when the
 * catalogue is still short.
 */
function featuredTherapists(entries: PublicTherapist[]): PublicTherapist[] {
  const rank = (t: PublicTherapist) => (t.is_demo ? 2 : 0) + (t.photo_url ? 0 : 1);
  return [...entries].sort((x, y) => rank(x) - rank(y)).slice(0, 3);
}

/**
 * Faces round the hero's search card: up to seven profiles with a photograph,
 * real people before demo ones, each a link to the profile. The first takes the
 * large tile and therefore the master image; the rest are 160 px thumbnails.
 * Slots nobody fills stay in the grid as empty cells, next to the three that
 * are empty by design. Under three faces there is no mosaic at all.
 */
function heroFaces(entries: PublicTherapist[]): string {
  const people = [...entries].filter((t) => t.photo_url).sort((x, y) => Number(x.is_demo) - Number(y.is_demo)).slice(0, 7);
  if (people.length < 3) return '';
  const faces = Array.from({ length: 7 }, (_, i) => {
    const t = people[i];
    if (!t) return `<span class="hero-face hero-face-${i + 1}" aria-hidden="true"></span>`;
    const src = i === 0 ? t.photo_url! : thumbnailUrl(t.photo_url)!;
    const size = i === 0 ? 320 : 160;
    return `<a class="hero-face hero-face-${i + 1}" href="/terapeuci/${encodeURIComponent(t.slug)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(t.display_name)}" width="${size}" height="${size}" decoding="async"></a>`;
  }).join('');
  return faces + [1, 2, 3].map((k) => `<span class="hero-face hero-gap-${k}" aria-hidden="true"></span>`).join('');
}

/** Areas the catalogue's profiles work with, the most common first. */
function catalogueTopics(entries: PublicTherapist[]): Array<{ slug: string; name: string }> {
  const counts = new Map<string, { name: string; n: number }>();
  for (const topic of entries.flatMap((t) => t.topics)) {
    const seen = counts.get(topic.slug) ?? { name: topic.name, n: 0 };
    seen.n += 1;
    counts.set(topic.slug, seen);
  }
  return [...counts].sort((x, y) => y[1].n - x[1].n).map(([slug, { name }]) => ({ slug, name }));
}

/**
 * Kolejność przy każdym wejściu inna: nikt nie ma na stałe dużego kafla ani miejsca w trzech
 * kartach. Sortowania w `heroFaces` i `featuredTherapists` są stabilne, więc ich grupy
 * (realne osoby przed demo, ze zdjęciem przed bez) zostają - losuje się kolejność w grupie.
 */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

siteApp.get('/', async (c) => {
  const entries = shuffled(await findCandidates(c.env, {}));
  const allTopics = catalogueTopics(entries);
  const cities = [...new Set(entries.flatMap((t) => t.locations.map((l) => l.city)))].sort((x, y) => x.localeCompare(y, 'pl'));
  const topics = allTopics
    .slice(0, 10)
    .map((t) => `<li><a href="/terapeuci?obszar=${encodeURIComponent(t.slug)}">${escapeHtml(t.name)}</a></li>`)
    .join('');
  const base = c.env.PUBLIC_BASE_URL;
  const heroArt = ['hero-art-a', 'hero-art-b', 'hero-art-c'][Math.floor(Math.random() * 3)];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${base}/#org`, name: 'Otwarty Terapeuta', url: base, logo: `${base}/apple-touch-icon.png`, email: c.env.SUPPORT_EMAIL },
      { '@type': 'WebSite', '@id': `${base}/#site`, name: 'Otwarty Terapeuta', url: base, inLanguage: 'pl-PL', publisher: { '@id': `${base}/#org` } },
    ],
  };
  return htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Znajdź psychoterapeutę',
      description:
        'Psychoterapeuci w Polsce z własnymi, autorskimi stronami: jak pracują, ile kosztuje sesja, kiedy mają wolny termin. Jawne ceny, rezerwacja online, bez płatnych pozycji.',
      path: '/',
      head: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
      body: `
<div class="home">
  <section class="home-hero ${heroArt}" aria-labelledby="home-title">
    <div class="hero-copy">
      <p class="eyebrow"><span aria-hidden="true"></span> Psychoterapeuci, ich strony i wolne terminy</p>
      <h1 id="home-title">Znajdź osobę, z którą chcesz porozmawiać.</h1>
      <p class="lead">Każdy terapeuta prowadzi tu własną stronę: jak pracuje, ile kosztuje sesja, kiedy ma wolny termin. Bez płatnych pozycji.</p>
      <p class="hero-more"><a href="/terapeuci">Przeglądaj wszystkich</a> · <a href="#co-znajdziesz">Co tu znajdziesz <span aria-hidden="true">↓</span></a></p>
    </div>

    <div class="hero-bento">
    <form class="hero-search" method="get" action="/terapeuci" role="search" aria-label="Szukaj terapeuty">
      <fieldset class="hero-tabs"><legend class="visually-hidden">Forma spotkań</legend>
        <label><input type="radio" name="tryb" value="gabinet" checked><span>W gabinecie</span></label>
        <label><input type="radio" name="tryb" value="online"><span>Online</span></label>
      </fieldset>
      <div class="hero-search-fields">
        <label class="visually-hidden" for="hero-szukaj">Obszar, nurt lub nazwisko</label>
        <input id="hero-szukaj" name="szukaj" type="search" list="hero-obszary" maxlength="120" autocomplete="off" placeholder="obszar, nurt lub nazwisko">
        <datalist id="hero-obszary">${allTopics.map((t) => `<option value="${escapeHtml(t.name)}">`).join('')}</datalist>
        <label class="visually-hidden" for="hero-miasto">Miejscowość</label>
        <select id="hero-miasto" name="miasto"><option value="">cała Polska</option>${cities
          .map((city) => `<option>${escapeHtml(city)}</option>`)
          .join('')}</select>
        <button class="btn" type="submit">Szukaj</button>
      </div>
    </form>
    ${heroFaces(entries)}
    </div>
  </section>

  <dl class="facts-strip" aria-label="Numery pomocy w nagłej sytuacji">
    <div><dt>bezpośrednie zagrożenie życia</dt><dd><a href="tel:112">112</a></dd></div>
    <div><dt>wsparcie emocjonalne, całą dobę</dt><dd><a href="tel:116123">116 123</a></dd></div>
    <div><dt>telefon zaufania dla młodzieży</dt><dd><a href="tel:116111">116 111</a></dd></div>
    <div><dt>potrzebujesz pomocy natychmiast?</dt><dd><a href="/pomoc-w-kryzysie">Pełna lista miejsc pomocy <span aria-hidden="true">→</span></a></dd></div>
  </dl>

  <section class="home-section offer-section" id="co-znajdziesz" aria-labelledby="offer-title">
    <div class="section-heading centered">
      <h2 id="offer-title">Co tu znajdziesz</h2>
      <p>Nie wizytówki z formularza, tylko strony pisane przez samych terapeutów. Tej treści nie ma nigdzie indziej.</p>
    </div>
    <div class="offer-grid">
      <article><h3>Autorskie strony terapeutów</h3><p>Podejście, doświadczenie, przebieg pierwszego spotkania i odpowiedzi na częste pytania — własnymi słowami osoby, do której idziesz.</p></article>
      <article><h3>Ceny i zasady przed decyzją</h3><p>Cena sesji, czas trwania, forma spotkania i zasady odwołania są jawne, zanim podasz jakiekolwiek dane.</p></article>
      <article><h3>Wolne terminy i rezerwacja</h3><p>Widzisz realny kalendarz i rezerwujesz online. Logowanie dopiero przy rezerwacji — przeglądasz anonimowo.</p></article>
    </div>
  </section>

  <section class="home-section" aria-labelledby="featured-title">
    <div class="section-heading centered">
      <h2 id="featured-title">Poznaj terapeutów</h2>
      <p>Każdy profil prowadzi do pełnej strony tej osoby.</p>
    </div>
    <ul class="grid cols-3 featured-grid">${featuredTherapists(entries)
      .map((t) => therapistCard(t, []))
      .join('')}</ul>
    <p class="section-action"><a class="btn" href="/terapeuci">Zobacz wszystkie profile <span aria-hidden="true">→</span></a></p>
  </section>

  <div class="home-section path-row">
  <section class="steps-section" aria-labelledby="steps-title">
    <div class="section-heading centered">
      <h2 id="steps-title">Od kryteriów do spotkania</h2>
      <p>Nie musisz znać się na psychoterapii. Zacznij od tego, w czym szukasz wsparcia.</p>
    </div>
    ${topics ? `<ul class="topic-links" aria-label="Obszary pracy terapeutów">${topics}</ul>` : ''}
    <ol class="steps">
      <li><span>1</span><h3>Wybierz obszar</h3><p>Albo formę spotkań, miejscowość i budżet.</p></li>
      <li><span>2</span><h3>Przeczytaj strony terapeutów</h3><p>Podejście, doświadczenie, cena i zasady.</p></li>
      <li><span>3</span><h3>Zarezerwuj termin</h3><p>Wolny termin z kalendarza, jasne potwierdzenie.</p></li>
    </ol>
  </section>
  <aside class="roadmap" aria-labelledby="next-title">
    <h2 id="next-title">Rozwijamy serwis</h2>
    <ul class="offer-soon">
      <li><strong>Opowiadania terapeutów i superwizorów</strong><span>Teksty o własnej pracy i superwizji. Zobaczysz, kto naprawdę pracuje nad sobą.</span></li>
      <li><strong>Wirtualne gabinety</strong><span>Miejsce spotkań online prowadzone przez terapeutę.</span></li>
      <li><strong>Wydarzenia</strong><span>Warsztaty, grupy i spotkania otwarte.</span></li>
      <li><strong>Szkoły psychoterapii</strong><span>Gdzie kształcą się terapeuci i w jakich nurtach.</span></li>
    </ul>
  </aside>
  </div>

  <aside class="home-section chat-note" id="w-chatgpt" aria-labelledby="assistant-title">
    <div><h2 id="assistant-title">Wolisz zapytać w rozmowie?</h2><p>Ten sam katalog będzie dostępny w ChatGPT: podajesz kryteria, dostajesz profile i wolne terminy. ${c.env.PUBLIC_PLUGIN_URL?.trim() ? '' : 'Aplikacja jest w przygotowaniu do publikacji — katalog na stronie działa niezależnie.'}</p></div>
    ${pluginCta(c.env)}
  </aside>

  <section class="home-cta" aria-labelledby="cta-title">
    <div><h2 id="cta-title">Znajdź osobę, z którą chcesz porozmawiać.</h2></div>
    <div><a class="btn" href="/terapeuci">Przeglądaj terapeutów <span aria-hidden="true">→</span></a><a href="/pomoc-w-kryzysie">Potrzebuję pilnej pomocy</a></div>
  </section>

  <aside class="crisis-inline" aria-label="Pomoc w nagłym zagrożeniu"><p><strong>Nie jest usługą terapeutyczną ani pomocą kryzysową.</strong> W bezpośrednim zagrożeniu życia lub zdrowia zadzwoń pod <strong>112</strong>. Całodobowe wsparcie emocjonalne dla dorosłych: <strong>116 123</strong>.</p><a href="/pomoc-w-kryzysie">Wszystkie numery pomocy</a></aside>
</div>`,
    }),
  );
});

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

/**
 * What the list below actually holds, in facts a person deciding can use:
 * how many profiles, in how many towns, the lowest price anyone charges and
 * the earliest hour anyone has free. Every number is read off the same rows
 * the cards are built from, so the line can never disagree with the list.
 */
function catalogueFacts(entries: PublicTherapist[]): string {
  if (entries.length === 0) return '';
  const facts: Array<[string, string]> = [
    ['Profile w katalogu', String(entries.length)],
  ];

  const cities = new Set(entries.flatMap((t) => t.locations.map((l) => l.city)));
  if (cities.size > 0) facts.push(['Miejscowości', String(cities.size)]);

  const prices = entries.map(sessionFrom).filter((p): p is number => p !== null);
  if (prices.length > 0) facts.push(['Sesja od', formatPrice(Math.min(...prices), 'PLN')]);

  const slots = entries.map((t) => t.next_available_slot_utc).filter((s): s is string => s !== null);
  if (slots.length > 0) {
    const soonest = slots.reduce((a, b) => (a < b ? a : b));
    facts.push(['Najbliższy wolny termin', `${formatDate(soonest)}, ${formatTime(soonest)}`]);
  }

  return `<dl class="facts-strip">${facts
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('')}</dl>`;
}

/** Static pages worth indexing; panel, OAuth and booking receipts stay out (robots.txt). */
const SITEMAP_STATIC = ['/', '/terapeuci', '/jak-to-dziala', '/bezpieczenstwo', '/pomoc-w-kryzysie', '/polityka-prywatnosci', '/regulamin'];

siteApp.get('/sitemap.xml', async (c) => {
  const base = c.env.PUBLIC_BASE_URL;
  const [entries, cities] = await Promise.all([listSitemapEntries(c.env), listCityPages(c.env)]);
  const urls = [
    ...SITEMAP_STATIC.map((path) => `<url><loc>${base}${path}</loc></url>`),
    ...cities.map((x) => `<url><loc>${base}/psychoterapeuta/${slugOf(x.city)}</loc></url>`),
    ...entries.map(
      (e) =>
        `<url><loc>${base}/terapeuci/${escapeHtml(e.slug)}${e.page ? `/${escapeHtml(e.page)}` : ''}</loc><lastmod>${escapeHtml(e.updated_at)}</lastmod></url>`,
    ),
  ];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } },
  );
});

siteApp.get('/terapeuci', async (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams;

  const filters: SearchFilters = {
    text: q.get('szukaj')?.slice(0, 120).trim() || undefined,
    location: q.get('miasto')?.slice(0, 80) || undefined,
    // `tryb` is the home page's W gabinecie / Online switch: one radio group, two filters.
    online: q.get('online') === '1' || q.get('tryb') === 'online' ? true : undefined,
    in_person: q.get('stacjonarnie') === '1' || q.get('tryb') === 'gabinet' ? true : undefined,
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

  const [candidates, cities, vocab, cityPages] = await Promise.all([
    findCandidates(c.env, filters),
    listCities(c.env),
    listVocabulary(c.env),
    listCityPages(c.env),
  ]);
  const ranked = rankTherapists(candidates, filters);
  const facts = catalogueFacts(ranked.map((entry) => entry.therapist));
  const moreOpen = Boolean(
    filters.modalities ||
      filters.languages ||
      filters.session_types ||
      filters.price_max ||
      filters.online ||
      filters.in_person ||
      filters.accepting_new_clients,
  );

  const option = (value: string, label: string, selected: boolean): string =>
    `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  return htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Katalog terapeutów',
      description:
        'Profile psychoterapeutów w Polsce: filtruj po mieście, formie spotkań, cenie, języku i nurcie. Przy każdym profilu cena i najbliższy wolny termin.',
      path: '/terapeuci',
      body: `
<div class="directory-page">
${pageHead('Katalog terapeutów', facts)}
${
  cityPages.length === 0
    ? ''
    : `<p class="meta">Według miasta: ${cityPages.map((x) => `<a href="/psychoterapeuta/${slugOf(x.city)}">${escapeHtml(x.city)}</a> (${x.count})`).join(' · ')}</p>`
}

<form class="filters" method="get" action="/terapeuci" aria-label="Filtry katalogu">
  <div class="filter-bar">
    <div class="field field-search">
      <label for="szukaj">Szukaj</label>
      <input id="szukaj" name="szukaj" type="search" maxlength="120" autocomplete="off"
             placeholder="imię, miasto, obszar pracy, nurt"
             value="${escapeHtml(filters.text ?? '')}">
    </div>
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
    <button class="btn" type="submit">Szukaj</button>
  </div>

  <details class="more-filters"${moreOpen ? ' open' : ''}>
    <summary>Więcej filtrów</summary>
    <div class="more-grid">
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
    </div>
    <div class="more-actions">
      <button class="btn" type="submit">Pokaż wyniki</button>
      <a class="btn secondary" href="/terapeuci">Wyczyść filtry</a>
    </div>
  </details>
</form>

<section class="directory-results" aria-labelledby="wyniki"><h2 id="wyniki" class="visually-hidden">Profile w katalogu</h2>
${
  ranked.length === 0
    ? `<p class="notice">Brak profili pasujących do podanych kryteriów. Spróbuj rozszerzyć filtry.</p>`
    : `<ul class="grid cols-2">${ranked
        .slice(0, 24)
        .map((entry) => therapistCard(entry.therapist, entry.match_reasons))
        .join('')}</ul>`
}
</section></div>`,
    }),
  );
});


function notFoundProfile(env: Env): Response {
  return htmlResponse(
    env,
    renderPage(env, {
      title: 'Nie znaleziono profilu',
      path: '/terapeuci',
      body: `<h1>Nie znaleziono profilu</h1><p>Ten profil nie istnieje albo nie jest opublikowany.</p>
             <p><a href="/terapeuci">Wróć do katalogu</a></p>`,
    }),
    { status: 404 },
  );
}

/** What every page of a therapist renders from: her FAQ and her open slots. */
async function profileContext(env: Env, t: PublicTherapist): Promise<{ faq: PublicFaqItem[]; slots: PublicSlot[] }> {
  const [faq, slots] = await Promise.all([
    getPublishedFaq(env, t.therapist_id),
    listOpenSlots(env, {
      therapist_id: t.therapist_id,
      from_utc: nowIso(),
      to_utc: new Date(Date.now() + 21 * 86_400_000).toISOString(),
      // The grid shows days, so the query has to fetch enough slots to fill them:
      // twelve rows covered barely two days for a therapist with eight hours a day.
      // ponytail: one generous query instead of "distinct days, then their slots";
      // revisit if anyone opens more than ~80 slots inside the window.
      limit: 80,
    }),
  ]);
  return { faq, slots };
}

/** One of her pages: the profile, or a subpage by its slug, written by her and rendered here with her data of this minute. */
async function therapistPage(c: { env: Env; executionCtx: { waitUntil(p: Promise<unknown>): void } }, slug: string, pageSlug: string): Promise<Response> {
  const t = await getTherapist(c.env, { slug });
  if (!t) return notFoundProfile(c.env);
  const ctx = await profileContext(c.env, t);
  if (pageSlug === PROFILE_SLUG) {
    // Licznik odsłon nie może opóźnić strony ani jej wywrócić.
    c.executionCtx.waitUntil(recordProfileView(c.env, t.therapist_id, 'web'));
  }
  const html = pageSlug === PROFILE_SLUG ? await serveAuthored(c.env, t, ctx.slots, ctx.faq) : await serveAuthoredSubpage(c.env, t, ctx.slots, pageSlug);
  return html ? htmlResponse(c.env, withSeoHead(c.env, html, t, pageSlug)) : notFoundProfile(c.env);
}

// ------------------------------------------------------------ city pages ---

/** 2, 3, 4 profile; 5 profili; 22 profile. */
const profiles = (n: number): string => `${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'profile' : 'profili'}`;

/**
 * „Psychoterapeuta Warszawa”: jedyna fraza ogólna, na którą mamy czym odpowiedzieć - realne
 * profile z ceną i terminem. Tylko miasta z `listCityPages`; w innym wypadku 404, nie pusta lista.
 */
siteApp.get('/psychoterapeuta/:miasto', async (c) => {
  const found = (await listCityPages(c.env)).find((x) => slugOf(x.city) === c.req.param('miasto'));
  if (!found) {
    return htmlResponse(c.env, renderPage(c.env, { title: 'Nie znaleziono', path: '/terapeuci', body: `<h1>Nie znaleziono</h1><p><a href="/terapeuci">Wróć do katalogu</a></p>`, noindex: true }), { status: 404 });
  }
  const { city } = found;
  const path = `/psychoterapeuta/${slugOf(city)}`;
  const filters: SearchFilters = { location: city };
  const entries = rankTherapists((await findCandidates(c.env, filters)).filter((t) => !t.is_demo), filters).map((e) => e.therapist);
  const tally = (pick: (t: PublicTherapist) => Array<{ slug: string; name: string }>): Array<{ slug: string; name: string; n: number }> => {
    const seen = new Map<string, { slug: string; name: string; n: number }>();
    for (const tag of entries.flatMap(pick)) seen.set(tag.slug, { ...tag, n: (seen.get(tag.slug)?.n ?? 0) + 1 });
    return [...seen.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'pl'));
  };
  const modalities = tally((t) => t.modalities);
  const topics = tally((t) => t.topics).slice(0, 12);
  const prices = entries.map(sessionFrom).filter((p): p is number => p !== null);
  const online = entries.filter((t) => t.offers_online).length;
  // Nie każda osoba z miasta ma gabinet - obie liczby z danych, żadna nie jest obietnicą.
  const inPerson = entries.filter((t) => t.offers_in_person).length;
  const inCity = `/terapeuci?miasto=${encodeURIComponent(city)}`;
  const chip = (param: string, tag: { slug: string; name: string; n: number }): string =>
    `<li class="tag"><a href="${escapeHtml(`${inCity}&${param}=${encodeURIComponent(tag.slug)}`)}">${escapeHtml(tag.name)} (${tag.n})</a></li>`;
  const list = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Psychoterapeuta ${city}`,
    itemListElement: entries.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: t.profile_url, name: t.display_name })),
  };
  return htmlResponse(
    c.env,
    renderPage(c.env, {
      title: `Psychoterapeuta ${city} — ceny i wolne terminy`,
      description: snippet(
        `Psychoterapia: ${city} i online — ${profiles(entries.length)} z jawną ceną${prices.length ? ` od ${formatPrice(Math.min(...prices), 'PLN')}` : ''} i najbliższym wolnym terminem. Nurty: ${modalities.slice(0, 4).map((m) => m.name).join(', ')}.`,
      ),
      path,
      head: `<script type="application/ld+json">${JSON.stringify(list).replace(/</g, '\\u003c')}</script>`,
      body: `
<div class="directory-page city-page">
${pageHead(`Psychoterapeuta ${city}`, catalogueFacts(entries))}
<p class="lead">${escapeHtml(`${profiles(entries.length)}: ${city}. W gabinecie przyjmuje ${inPerson}, online pracuje ${online}. Przy każdym profilu cena sesji i najbliższy wolny termin prosto z kalendarza. Przeglądasz anonimowo, logowanie dopiero przy rezerwacji.`)}</p>
<section class="directory-results" aria-labelledby="wyniki"><h2 id="wyniki" class="visually-hidden">Profile: ${escapeHtml(city)}</h2>
<ul class="grid cols-2">${entries.map((t) => therapistCard(t, [])).join('')}</ul></section>
${modalities.length ? `<section aria-labelledby="nurty"><h2 id="nurty">Nurty</h2><ul class="tags">${modalities.map((m) => chip('nurt', m)).join('')}</ul></section>` : ''}
${topics.length ? `<section aria-labelledby="obszary"><h2 id="obszary">Z czym można przyjść</h2><ul class="tags">${topics.map((t) => chip('obszar', t)).join('')}</ul></section>` : ''}
<p><a class="btn secondary" href="${escapeHtml(inCity)}">Filtruj w katalogu: cena, język, forma spotkań</a></p>
</div>`,
    }),
  );
});

siteApp.get('/terapeuci/:slug', (c) => therapistPage(c, c.req.param('slug'), PROFILE_SLUG));
siteApp.get('/terapeuci/:slug/:page', (c) => therapistPage(c, c.req.param('slug'), c.req.param('page')));

// ------------------------------------------------------------ static pages ---

siteApp.get('/jak-to-dziala', (c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Jak to działa',
      description:
        'Jak znaleźć psychoterapeutę w Otwartym Terapeucie: kryteria, strony terapeutów, wolne terminy i rezerwacja. Bez opisywania objawów i bez płatnych pozycji.',
      path: '/jak-to-dziala',
      body: `
<div class="subpage how-page">
  ${pageHead('Od pierwszego kryterium do rezerwacji', '<a class="btn" href="/terapeuci">Przejdź do katalogu <span aria-hidden="true">→</span></a>')}

  <section class="subpage-section" aria-labelledby="process-title">
    <div class="subpage-heading"><h2 id="process-title">Sześć spokojnych kroków</h2><p>Na każdym etapie widzisz tylko informacje potrzebne do podjęcia następnej decyzji.</p></div>
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
    <article><h2>Czego nie robimy</h2>
      <ul class="calm-list"><li>Nie zapisujemy Twoich rozmów z ChatGPT.</li><li>Nie zapisujemy powodów, dla których szukasz terapii.</li><li>Nie stawiamy diagnoz i nie kwalifikujemy do leczenia.</li><li>Nie sprzedajemy pozycji w wynikach i nie prowadzimy profilowania reklamowego.</li></ul>
    </article>
    <article><h2>Skąd biorą się dane</h2>
      <p>Dane wprowadza terapeuta. Część z nich weryfikujemy — wtedy profil ma oznaczenie „profil zweryfikowany” z datą weryfikacji.</p><p>Pozostałe dane są oznaczone jako deklarowane przez terapeutę. Profile demonstracyjne są zawsze wyraźnie opisane.</p>
    </article>
  </section>
</div>`,
    }),
  ),
);

siteApp.get('/bezpieczenstwo', (c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Bezpieczeństwo',
      description:
        'Jak Otwarty Terapeuta chroni dane: minimum informacji, anonimowe przeglądanie katalogu, logowanie dopiero przy rezerwacji.',
      path: '/bezpieczenstwo',
      body: `
<div class="subpage safety-page">
  ${pageHead('Twoje dane. Twoja decyzja.')}

  <section class="info-card-grid" aria-label="Najważniejsze zasady bezpieczeństwa">
    <article class="info-card"><span class="info-index">01</span><h2>Granice kliniczne</h2><p>Otwarty Terapeuta jest katalogiem i systemem rezerwacji. Nie prowadzimy terapii, nie stawiamy diagnoz, nie prowadzimy interwencji kryzysowej i nie kwalifikujemy nikogo do leczenia.</p><p>Asystent ChatGPT może jedynie pokazać dane z katalogu i odpowiedzi napisane przez terapeutów.</p></article>
    <article class="info-card crisis-card"><span class="info-index">02</span><h2>Kryzys</h2><p>W razie bezpośredniego zagrożenia życia lub zdrowia pokazujemy dane kontaktowe pomocy kryzysowej zamiast zwykłego wyszukiwania.</p><a href="/pomoc-w-kryzysie">Zobacz miejsca pomocy →</a></article>
    <article class="info-card"><span class="info-index">03</span><h2>Wiek</h2><p>Serwis jest przeznaczony dla osób pełnoletnich. Osobom poniżej 18 roku życia pokazujemy osobne zasoby pomocy i nie prowadzimy standardowej rezerwacji.</p></article>
    <article class="info-card"><span class="info-index">04</span><h2>Weryfikacja terapeutów</h2><p>Sprawdzamy tożsamość i przedstawione dokumenty potwierdzające kwalifikacje. Weryfikacja nie jest gwarancją jakości ani skuteczności terapii. Jej data jest widoczna w profilu.</p></article>
  </section>

  <section class="data-panel" aria-labelledby="data-title">
    <div><h2 id="data-title">Jak chronimy dane</h2><p>Projektujemy każdą operację tak, aby ograniczyć zakres danych i możliwość ich niepotrzebnego użycia.</p></div>
    <ul class="calm-list"><li>Nie zapisujemy treści rozmów ani powodów szukania terapii.</li><li>Dane kontaktowe są szyfrowane kluczem aplikacyjnym.</li><li>Adresy e-mail wyszukujemy po nieodwracalnym skrócie.</li><li>Logi i telemetria są filtrowane z danych osobowych i tokenów.</li><li>Operacje zapisu wymagają autoryzacji, walidacji i trafiają do audytu.</li><li>Nie stosujemy trackerów reklamowych ani zewnętrznych skryptów analitycznych.</li></ul>
  </section>

  <section class="contact-panel"><div><h2>Zgłaszanie problemów</h2><p>Nieprawidłowości w profilu, podejrzenie nadużycia lub incydent bezpieczeństwa zgłoś na <a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a>.</p></div></section>
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
      // Ludzie szukają numeru, nie „pomocy w kryzysie” - tytuł i opis mówią ich słowami.
      title: 'Telefon zaufania i pomoc w kryzysie',
      description:
        'Telefon zaufania 116 123, Centrum Wsparcia 800 70 2222, dzieci i młodzież 116 111, zagrożenie życia 112. Bezpłatne numery pomocy w kryzysie psychicznym.',
      path: '/pomoc-w-kryzysie',
      body: `
<div class="subpage crisis-page">
  <header class="crisis-hero">
    <div><h1>Nie musisz zostawać z tym samodzielnie.</h1><p class="lead">Jeśli sytuacja nie jest bezpośrednim zagrożeniem, poniżej znajdziesz bezpłatne telefony i miejsca wsparcia.</p></div>
    <aside class="emergency-panel" aria-label="Pomoc w bezpośrednim zagrożeniu"><p class="emergency-warning">Rezerwacja wizyty nie jest pomocą w nagłym zagrożeniu.</p><p>Bezpośrednie zagrożenie życia lub zdrowia</p><a href="tel:112">112</a><span>lub 999 · numery alarmowe</span></aside>
  </header>

  <section class="resource-section" aria-labelledby="adult-title"><div class="resource-heading"><h2 id="adult-title">Osoby dorosłe</h2><p>Telefony zaufania i publiczne miejsca pomocy dostępne bez skierowania.</p></div>${renderList(adult)}</section>

  <section class="resource-section minor-resources" aria-labelledby="minor-title"><div class="resource-heading"><h2 id="minor-title">Osoby poniżej 18 roku życia</h2><p>Anonimowe telefony wsparcia oraz osobna ścieżka pomocy dla młodszych osób.</p></div>${renderList(minor)}</section>

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
      description:
        'Polityka prywatności serwisu Otwarty Terapeuta: jakie dane przetwarzamy, w jakim celu i jak długo.',
      path: '/polityka-prywatnosci',
      body: `
<div class="document-page">
${pageHead('Polityka prywatności', `<p class="document-version">Wersja ${escapeHtml(c.env.PRIVACY_VERSION)}</p>`)}
<div class="document-content">
<section><h2>Administrator danych</h2>
<p>Administratorem danych osobowych przetwarzanych w serwisie Otwarty Terapeuta jest:</p>
${controllerDetails()}
<p>Terapeuta, u którego rezerwujesz wizytę, jest odrębnym administratorem danych, które
otrzymuje w celu przeprowadzenia tej wizyty i prowadzenia własnej dokumentacji.</p></section>

<section><h2>Podstawy prawne i cele</h2>
<ul>
  <li><strong>Rezerwacja wizyty i obsługa konta</strong> — art. 6 ust. 1 lit. b RODO,
      przetwarzanie niezbędne do wykonania umowy o świadczenie usługi.</li>
  <li><strong>Kontakt z terapeutą w sprawie wizyty</strong> — art. 6 ust. 1 lit. b RODO;
      w zakresie, w jakim sam fakt rezerwacji ujawnia informację o zdrowiu, przetwarzanie
      opiera się na Twojej wyraźnej zgodzie wyrażonej przy rezerwacji (art. 9 ust. 2 lit. a).</li>
  <li><strong>Bezpieczeństwo, zapobieganie nadużyciom, zapisy audytowe</strong> —
      art. 6 ust. 1 lit. f, nasz uzasadniony interes w utrzymaniu bezpiecznej usługi.</li>
  <li><strong>Obowiązki rozliczeniowe i archiwalne</strong> — art. 6 ust. 1 lit. c,
      w zakresie wymaganym przepisami.</li>
</ul>
<p>Podanie adresu e-mail jest dobrowolne, ale konieczne do dokonania rezerwacji —
bez niego nie prześlemy potwierdzenia ani nie umożliwimy odwołania wizyty.
Przeglądanie katalogu nie wymaga podania żadnych danych.</p></section>

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
  <li>Nie zapisujemy kryteriów wyszukiwania. Filtry służą wyłącznie do policzenia wyników
      i nie trafiają ani do bazy danych, ani do dziennika zdarzeń — w dzienniku zapisujemy
      samą ścieżkę adresu, bez parametrów. Jeżeli szukasz na stronie, wybrane filtry widnieją
      w adresie w pasku przeglądarki, czyli w historii Twojego urządzenia; jeżeli przez
      ChatGPT — treść rozmowy pozostaje po stronie OpenAI, nie po naszej.</li>
  <li>Nie prowadzimy profilowania reklamowego i nie udostępniamy danych do marketingu.</li>
  <li>Nie używamy ciasteczek analitycznych, zewnętrznej analityki ani skryptów śledzących.
      Jedyne ciasteczko w serwisie to sesja panelu dla zalogowanego terapeuty lub administratora.</li>
</ul>
<p>Liczymy natomiast <strong>odsłony profili</strong>: dla każdego profilu, dnia i źródła
(strona albo asystent ChatGPT) rośnie jeden licznik. Nie zapisujemy przy tym adresu IP,
przeglądarki ani żadnego identyfikatora osoby, więc z tych danych nie da się odtworzyć, kto
oglądał profil — wyłącznie ile razy go otwarto. Terapeuta widzi tę liczbę dla własnego profilu,
my usuwamy ją po 24 miesiącach.</p></section>

<section><h2>Odbiorcy danych</h2>
<p>Terapeuta, u którego rezerwujesz, otrzymuje <strong>dane potrzebne do przeprowadzenia
wizyty</strong>: termin, formę spotkania, cenę, numer rezerwacji oraz podane przez Ciebie imię,
adres e-mail i telefon. Dostaje je w wiadomości o nowej rezerwacji i widzi w swoim panelu.
Służą wyłącznie do kontaktu w sprawie tej wizyty. Terapeuta jest w tym zakresie odrębnym
administratorem danych.</p>
<p>Jeżeli odwołasz wizytę, terapeuta dostaje informację o odwołaniu — bez powodu, który
ewentualnie podasz.</p>
<p>Dostawca infrastruktury (Cloudflare) oraz dostawca poczty transakcyjnej przetwarzają dane
wyłącznie na nasze zlecenie i w zakresie potrzebnym do świadczenia usługi.</p></section>

<section><h2>Okres przechowywania</h2>
<p>Usuwaniem zajmuje się zadanie uruchamiane co pięć minut, nie ręczna decyzja:</p>
<ul>
  <li>dane kontaktowe rezerwacji — 12 miesięcy od terminu wizyty; sama rezerwacja zostaje
      bez danych identyfikujących, bo jest potrzebna do rozliczeń,</li>
  <li>zapisy audytowe — 24 miesiące,</li>
  <li>wysłane powiadomienia — 30 dni, nieudane — 90 dni,</li>
  <li>kody logowania — 15 minut, sesja panelu — 8 godzin, token odświeżający — 30 dni,</li>
  <li>niepotwierdzone zgłoszenie terapeuty — 15 minut, razem z danymi z formularza.</li>
</ul>
<p>Dane opublikowanego profilu terapeuty przechowujemy przez czas prowadzenia konta.</p></section>

<section><h2>Twoje prawa</h2>
<ul>
  <li>dostęp do danych i otrzymanie ich kopii,</li>
  <li>sprostowanie danych nieprawidłowych,</li>
  <li>usunięcie danych, o ile nie stoi temu na przeszkodzie obowiązek prawny,</li>
  <li>ograniczenie przetwarzania,</li>
  <li>przeniesienie danych przetwarzanych na podstawie umowy,</li>
  <li>sprzeciw wobec przetwarzania opartego na uzasadnionym interesie,</li>
  <li>cofnięcie zgody w każdej chwili — bez wpływu na to, co wydarzyło się wcześniej.</li>
</ul>
<p>Żądanie wystarczy wysłać na
<a href="mailto:${escapeHtml(CONTROLLER.email)}">${escapeHtml(CONTROLLER.email)}</a>.
Usunięcie konta usuwa dane kontaktowe; sam fakt odbytej wizyty pozostaje w formie
pozbawionej danych identyfikujących, ponieważ jest potrzebny do rozliczeń.</p></section>

<section><h2>Automatyczne decyzje i profilowanie</h2>
<p>Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu,
które wywoływałyby skutki prawne. Kolejność wyników wyszukiwania wynika z podanych przez Ciebie
kryteriów i danych profilu terapeuty; nie buduje profilu Twojej osoby, nie korzysta z historii
i nie zawiera czynnika komercyjnego.</p></section>

<section><h2>Przekazywanie poza EOG</h2>
<p>Dane przechowujemy w bazie Cloudflare D1. Jeżeli korzystanie z infrastruktury dostawcy
wiąże się z przekazaniem danych poza Europejski Obszar Gospodarczy, odbywa się to na
standardowych klauzulach umownych stosowanych przez tego dostawcę.</p></section>

<section><h2>Bezpieczeństwo</h2>
<p>Dane kontaktowe są szyfrowane na poziomie aplikacji. Dostęp do panelu administracyjnego
jest ograniczony rolami i chroniony logowaniem jednorazowym kodem.</p></section>

<section><h2>Skarga do organu nadzorczego</h2>
<p>Jeżeli uważasz, że przetwarzamy Twoje dane niezgodnie z prawem, możesz wnieść skargę do
Prezesa Urzędu Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa.</p></section>
</div></div>`,
    }),
  ),
);

siteApp.get('/regulamin', (c) =>
  htmlResponse(
    c.env,
    renderPage(c.env, {
      title: 'Regulamin',
      description:
        'Regulamin serwisu Otwarty Terapeuta: zasady korzystania z katalogu psychoterapeutów i rezerwacji wizyt.',
      path: '/regulamin',
      body: `
<div class="document-page">
${pageHead('Regulamin', `<p class="document-version">Wersja ${escapeHtml(c.env.TERMS_VERSION)}</p>`)}
<div class="document-content">
<section><h2>1. Kto prowadzi serwis</h2>
<p>Usługodawcą i operatorem serwisu Otwarty Terapeuta jest:</p>
${controllerDetails()}</section>

<section><h2>2. Czym jest serwis</h2>
<p>Otwarty Terapeuta udostępnia katalog psychoterapeutów oraz umożliwia rezerwację terminu wizyty.
Serwis nie świadczy usług terapeutycznych ani medycznych i nie jest stroną umowy między osobą
rezerwującą a terapeutą.</p></section>

<section><h2>3. Kto może korzystać</h2><p>Z rezerwacji mogą korzystać wyłącznie osoby pełnoletnie.</p></section>

<section><h2>4. Profile terapeutów</h2>
<p>Terapeuta może utworzyć konto po potwierdzeniu adresu e-mail. Nowy profil jest roboczy i
niezweryfikowany. Utworzenie konta nie gwarantuje publikacji; administrator może poprosić o
dokumenty, odmówić publikacji albo wycofać profil naruszający regulamin.</p></section>

<section><h2>5. Rezerwacja</h2>
<p>Rezerwacja jest skuteczna po wyświetleniu pełnego podsumowania i jego jednoznacznym potwierdzeniu.
Cena, czas trwania i forma spotkania obowiązują w wersji przedstawionej w podsumowaniu.</p></section>

<section><h2>6. Odwołanie wizyty</h2>
<p>Zasady odwołania określa terapeuta i są widoczne w jego profilu oraz w podsumowaniu rezerwacji.
Odwołanie po upływie bezpłatnego okresu może wiązać się z opłatą ustaloną przez terapeutę.</p>
</section>

<section><h2>7. Płatności</h2>
<p>Rozliczenie następuje bezpośrednio między osobą rezerwującą a terapeutą, zgodnie z informacją
w profilu terapeuty. Serwis nie pośredniczy w płatnościach.</p></section>

<section><h2>8. Dane w profilach</h2>
<p>Za treść profilu i odpowiedzi FAQ odpowiada terapeuta. Serwis oznacza, które dane zostały
zweryfikowane i kiedy. Weryfikacja nie jest gwarancją jakości usługi.</p>
</section>

<section><h2>9. Pomoc w kryzysie</h2>
<p>Serwis nie jest pomocą w nagłym zagrożeniu życia lub zdrowia. W takiej sytuacji należy
skorzystać z numerów wskazanych na stronie <a href="/pomoc-w-kryzysie">Pomoc w kryzysie</a>.</p></section>

<section><h2>10. Kontakt</h2><p><a href="mailto:${escapeHtml(c.env.SUPPORT_EMAIL)}">${escapeHtml(c.env.SUPPORT_EMAIL)}</a></p></section>
</div></div>`,
    }),
  ),
);
