/**
 * Strony autorskie: terapeutka odpowiada własnymi słowami na pytania pacjentów,
 * a strona składa się sama.
 *
 * Ten plik nie zna ani DOM-u, ani bazy: działa tak samo w Workerze (strona
 * publiczna, walidacja przy zapisie) i w przeglądarce (podgląd w narzędziu).
 * Dlatego narzędzie i serwer nie mogą się rozjechać w tym, co uznają za fakt
 * wpisany prozą, ani w tym, jak strona wygląda.
 *
 * Dwie rzeczy są poza zasięgiem autorki i siedzą tutaj na stałe:
 * - ceny i wolne terminy renderują się z danych, nigdy z tekstu; kwalifikacje także
 *   stoją na stronie z danych, z oznaczeniem, czy dokument sprawdził serwis;
 * - stopka kryzysowa nie należy do stanu strony, więc nie da się jej usunąć.
 */

export interface Question {
  id: string;
  q: string;
  stage: string;
  /** Kolumna profilu, do której trafia odpowiedź przy publikacji; `faq` = wpis w FAQ. Podstrona nie pisze do profilu. */
  field?: 'bio' | 'first_meeting_course' | 'first_meeting_prep' | 'first_meeting_decision' | 'faq';
  why: string;
  starters: string[];
}

export interface FactDef {
  id: 'creds' | 'offers' | 'slots';
  ask: string;
  stage: string;
  /** Po której odpowiedzi autorki stoi fakt w kolejce pytań; `end` = na końcu. */
  after: number | 'end';
  title: string;
  source: string;
}

export interface PageType {
  label: string;
  lineLabel: string;
  lineHint: string;
  questions: Question[];
  stages: Array<{ id: string; title: string }>;
  facts: FactDef[];
}

/** RODZAJ STRONY = pytania pacjentów + fakty z danych + etapy drogi. Nowy rodzaj to nowy wpis tutaj. */
export const TYPES: Record<string, PageType> = {
  profil: {
    label: 'Strona o mnie',
    lineLabel: 'Jedno zdanie pod nazwiskiem',
    lineHint: 'Kim jesteś i gdzie przyjmujesz — tak, jak mówisz to przez telefon.',
    questions: [
      { id: 'who', q: 'Z czym mogę przyjść?', stage: 'kto', field: 'bio', why: 'To pierwsze, czego szuka osoba w trudnym momencie: czy ktoś taki jak ja tu pasuje.', starters: ['Najczęściej przychodzą do mnie osoby, które…', 'Pracuję z ludźmi, którzy…'] },
      { id: 'how', q: 'Jak wygląda praca z Tobą?', stage: 'kto', field: 'bio', why: 'Nazwa nurtu niewiele mówi. Napisz, co się dzieje w gabinecie.', starters: ['W praktyce wygląda to tak:', 'Najważniejsze jest dla mnie…'] },
      { id: 'first', q: 'Jak będzie wyglądało pierwsze spotkanie?', stage: 'pierwsze', field: 'first_meeting_course', why: 'Najwięcej lęku jest przed pierwszą wizytą. Im konkretniej, tym łatwiej przyjść.', starters: ['Najpierw…', 'Pierwsze spotkanie to…'] },
      { id: 'prep', q: 'Czy muszę się jakoś przygotować?', stage: 'pierwsze', field: 'first_meeting_prep', why: 'Krótka odpowiedź też jest dobra. Nawet jedno zdanie.', starters: ['Nie trzeba.', 'Jeśli chcesz, możesz…'] },
      { id: 'silence', q: 'A jeśli nie będę wiedzieć, co powiedzieć?', stage: 'pierwsze', field: 'faq', why: 'To pytanie ludzie wstydzą się zadać na głos.', starters: ['To się zdarza i…'] },
      { id: 'decide', q: 'Skąd będę wiedzieć, czy to dla mnie?', stage: 'potem', field: 'first_meeting_decision', why: 'Pozwól komuś przyjść bez zobowiązań.', starters: ['Po pierwszym spotkaniu…', 'Po kilku rozmowach…'] },
      { id: 'long', q: 'Ile to potrwa?', stage: 'potem', field: 'faq', why: 'Uczciwa odpowiedź buduje zaufanie, nawet jeśli brzmi „to zależy”.', starters: ['Zwykle…', 'To zależy od…'] },
      { id: 'secret', q: 'Czy to, co powiem, zostaje między nami?', stage: 'potem', field: 'faq', why: 'Dla Ciebie oczywiste, dla pacjenta nie.', starters: ['Tak.'] },
      { id: 'online', q: 'Czy rozmowa online naprawdę działa?', stage: 'kto', field: 'faq', why: 'Jeśli pracujesz przez wideo — napisz, co jest potrzebne.', starters: ['Działa.', 'Potrzebne jest tylko…'] },
      { id: 'notfor', q: 'Komu raczej nie pomożesz?', stage: 'kto', field: 'faq', why: 'Odważne i bardzo cenione. Oszczędza czas obu stronom.', starters: ['Nie pracuję z…'] },
    ],
    stages: [
      { id: 'kto', title: 'Zanim napiszesz' },
      { id: 'cena', title: 'Wiesz, ile zapłacisz' },
      { id: 'termin', title: 'Wybierasz termin' },
      { id: 'pierwsze', title: 'Pierwsze spotkanie' },
      { id: 'potem', title: 'A potem' },
      { id: 'inne', title: 'Jeszcze pytania' },
    ],
    facts: [
      { id: 'creds', ask: 'Jakie kwalifikacje są potwierdzone?', stage: 'kto', after: 0, title: 'Kwalifikacje', source: 'z dokumentów sprawdzonych przez serwis' },
      { id: 'offers', ask: 'Ile to kosztuje?', stage: 'cena', after: 1, title: 'Ceny i zasady', source: 'z cennika' },
      { id: 'slots', ask: 'Kiedy jest najbliższy wolny termin?', stage: 'termin', after: 'end', title: 'Wolne terminy', source: 'z kalendarza' },
    ],
  },
  // Grupa, warsztat, jedna specjalizacja: tytuł zamiast imienia w nagłówku, słowa zostają na tej stronie.
  podstrona: {
    label: 'Podstrona',
    lineLabel: 'Jedno zdanie pod tytułem',
    lineHint: 'O czym jest ta strona — tak, jak mówisz to komuś, kto pyta pierwszy raz.',
    questions: [
      { id: 'what', q: 'Co to jest?', stage: 'co', why: 'Jednym, dwoma akapitami: czym to jest i co z tego ma ktoś, kto przyjdzie.', starters: ['To miejsce dla…', 'Spotykamy się, żeby…'] },
      { id: 'for', q: 'Dla kogo to jest?', stage: 'co', why: 'Ktoś czyta i sprawdza, czy to o nim. Krótkie linie staną się listą.', starters: ['Dla osób, które…'] },
      { id: 'how', q: 'Jak to wygląda?', stage: 'jak', why: 'Co się dzieje na miejscu. Bez dat i cen — te pokazujemy z danych.', starters: ['Na spotkaniu…'] },
      { id: 'who', q: 'Kto prowadzi?', stage: 'kto', why: 'Dwa, trzy zdania o Tobie w tym kontekście. Resztę mówi Twój profil.', starters: ['Jestem…'] },
      { id: 'start', q: 'Jak zacząć?', stage: 'start', why: 'Pierwszy krok, bez zgadywania.', starters: ['Najpierw…'] },
    ],
    stages: [
      { id: 'co', title: 'Czym to jest' },
      { id: 'jak', title: 'Jak to wygląda' },
      { id: 'kto', title: 'Kto prowadzi' },
      { id: 'start', title: 'Jak zacząć' },
      { id: 'termin', title: 'Wybierasz termin' },
      { id: 'inne', title: 'Jeszcze pytania' },
    ],
    facts: [
      { id: 'offers', ask: 'Ile to kosztuje?', stage: 'start', after: 'end', title: 'Ceny i zasady', source: 'z cennika' },
      { id: 'slots', ask: 'Kiedy jest najbliższy wolny termin?', stage: 'termin', after: 'end', title: 'Wolne terminy', source: 'z kalendarza' },
    ],
  },
};

/** Dwie decyzje w kroku „Ułóż”: JAK witasz (4) × CO widać najpierw (3). */
export const FORMS = [
  { id: 'rozmowa', name: 'Pytaniami', desc: 'Pytania pacjentów jako nagłówki, pod nimi Twoje odpowiedzi.' },
  { id: 'list', name: 'Listem', desc: 'Piszesz jak do człowieka. Strona czyta się jak list od Ciebie.' },
  { id: 'droga', name: 'Drogą', desc: 'Prowadzisz krok po kroku: od pierwszej myśli do pierwszego spotkania.' },
  { id: 'spis', name: 'Spisem pytań', desc: 'Wszystkie pytania widać od razu. Każdy otwiera to, z czym przyszedł.' },
] as const;
export const TOPS = [
  { id: 'twarz', name: 'Ciebie', desc: 'Duże zdjęcie na górze — dla osób, które najpierw chcą zobaczyć, do kogo idą.' },
  { id: 'slowa', name: 'Twoje pierwsze zdanie', desc: 'Początek Twojej pierwszej odpowiedzi dużymi literami, zanim cokolwiek innego.' },
  { id: 'fakty', name: 'Konkrety', desc: 'Cena, najbliższy wolny termin i potwierdzone kwalifikacje od razu na górze — prosto z danych.' },
] as const;
export type FormId = (typeof FORMS)[number]['id'];
export type TopId = (typeof TOPS)[number]['id'];

/** To, co pisze autorka. Niczego poza tym strona od niej nie bierze. */
export interface PageDraft {
  type: string;
  /** Nagłówek podstrony; profil ma w tym miejscu jej imię. */
  title: string;
  form: FormId;
  top: TopId;
  line: string;
  /** Kolejność pytań na stronie; pierwsza odpowiedź ją otwiera. */
  order: string[];
  answers: Record<string, string>;
  /** Pytania dopisane przez nią. */
  custom: Array<{ id: string; q: string }>;
}

/** Osoba tak, jak widzi ją renderer: same fakty z bazy. */
export interface Person {
  name: string;
  city: string;
  photo: string | null;
  timezone: string;
  is_demo: boolean;
  verified: boolean;
  online: boolean;
  in_person: boolean;
  accepting: boolean;
  credentials: Array<{ title: string; issuer: string; year: number | null; verified: boolean }>;
  offers: Array<{ title: string; duration_minutes: number; price_minor: number }>;
  cancellation_policy: string;
  /** Wolne terminy, ISO UTC, rosnąco. */
  slots: string[];
  /** Dokąd prowadzi „jak zarezerwować”. */
  booking_href: string;
}

/** Takie jak w dawnych formularzach profilu (nagłówek 200, opis 4000, FAQ: 20 pytań po 200 znaków), żeby przeniesienie niczego nie ucięło. */
export const LIMITS = { title: 140, line: 200, answer: 4000, question: 200, custom: 20 };

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const zl = (minor: number): string => `${(minor / 100).toLocaleString('pl-PL')} zł`;
const initials = (n: string): string => n.split(' ').map((w) => w[0]).join('').slice(0, 2);

export function emptyDraft(type = 'profil'): PageDraft {
  return { type, title: '', form: 'rozmowa', top: 'twarz', line: '', order: [], answers: {}, custom: [] };
}

// Znaki sterujące poza \n i \t; z `new RegExp`, jak w lib/sanitize.ts.
const CONTROL = new RegExp('[\\u0000-\\u0008' + '\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\ufeff]', 'g');

/** Szkic z dowolnego JSON-a: nieznane pola wypadają, teksty są przycięte. Jedyna brama dla danych z przeglądarki. */
export function normalizeDraft(raw: unknown, type = 'profil'): PageDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number): string => String(v ?? '').replace(CONTROL, '').slice(0, max);
  const custom = (Array.isArray(r.custom) ? r.custom : [])
    .slice(0, LIMITS.custom)
    .map((c) => c as Record<string, unknown>)
    .filter((c) => /^c_[a-z0-9]{1,16}$/.test(String(c?.id ?? '')))
    .map((c) => ({ id: String(c.id), q: text(c.q, LIMITS.question).trim() }));
  const known = new Set([...TYPES[type]!.questions.map((q) => q.id), ...custom.map((c) => c.id)]);
  const order = [...new Set((Array.isArray(r.order) ? r.order : []).map(String).filter((id) => known.has(id)))];
  const given = (r.answers && typeof r.answers === 'object' ? r.answers : {}) as Record<string, unknown>;
  const answers: Record<string, string> = {};
  for (const id of order) answers[id] = text(given[id], LIMITS.answer);
  return {
    type,
    title: text(r.title, LIMITS.title).replace(/\n+/g, ' ').trim(),
    form: FORMS.some((f) => f.id === r.form) ? (r.form as FormId) : 'rozmowa',
    top: TOPS.some((t) => t.id === r.top) ? (r.top as TopId) : 'twarz',
    line: text(r.line, LIMITS.line).replace(/\n+/g, ' ').trim(),
    order,
    answers,
    custom,
  };
}

export const questionOf = (page: PageDraft, id: string): Pick<Question, 'id' | 'q' | 'stage'> | undefined =>
  TYPES[page.type]!.questions.find((q) => q.id === id) ?? page.custom.map((c) => ({ ...c, stage: 'inne' })).find((c) => c.id === id);

/* ---------- STRAŻNIK FAKTÓW ----------
   Ceny i terminy nie mogą wejść na stronę prozą: dezaktualizują się i mogłyby przeczyć
   cennikowi albo kalendarzowi. O kwalifikacjach pisze śmiało - to jej opis siebie, a to,
   co potwierdził dokument, pokazuje osobno karta z danych. (Reguła na kwalifikacje ukryłaby
   2026-09-21 zdania o certyfikacji i superwizji u 7 z 8 realnych osób.) Dwie zapory:
   1) narzędzie pokazuje takie zdanie, a serwer nie opublikuje strony, dopóki nie zniknie;
   2) renderer i tak go nie wypisze (`clean`), więc stary zapis też nie wycieknie.
   ponytail: reguły to wyrażenia regularne — łapią typowe sformułowania, nie wszystkie („stówka”,
   „mam dyżur rano”) i dają fałszywe alarmy („wstaję o 6”). Gdy terapeutki zaczną się o to potykać,
   wątpliwe zdania może dodatkowo oceniać model; regexy zostają jako twarda bramka. */
const L = 'a-ząćęłńóśźż';
const WEEK = '(?:poniedzie|wtor|środ|czwart|piąt|sobot|niedziel)';
const RULES: Array<{ kind: GuardKind; re: RegExp[] }> = [
  { kind: 'kwota', re: [new RegExp(`(?:\\d|\\b(?:sto|dwieście|trzysta|czterysta|pięćset|tysiąc)\\b)[^\\n]{0,14}?(?<![${L}])(?:zł|pln|złot[${L}]*)(?![${L}])`, 'i')] },
  {
    kind: 'termin',
    re: [
      /(?<![\d.,])(?:[01]?\d|2[0-3])[:.][0-5]\d(?![\d])/,
      /(?<![a-ząćęłńóśźż])o\s+(?:godz[a-z]*\.?\s*)?\d{1,2}(?!\d)/i,
      /\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)/i,
      /woln[a-zy]*\s+(?:termin|godzin)/i,
      new RegExp(`${WEEK}[^\\n]*(?:woln|termin|przyjmuj|zapisy)|(?:woln|termin|przyjmuj|zapisy)[^\\n]*${WEEK}`, 'i'),
    ],
  },
];
export type GuardKind = 'kwota' | 'termin';
export const GUARD_MSG: Record<GuardKind, [string, string]> = {
  kwota: ['To wygląda na cenę', 'Ceny pokazujemy sami, prosto z cennika. Inaczej po zmianie cennika strona mówiłaby dwie różne rzeczy.'],
  termin: ['To wygląda na termin albo godzinę', 'Wolne terminy pokazujemy sami, z kalendarza — zawsze aktualne, więc nikt nie przyjdzie na zajęty.'],
};
export interface Flag {
  i: number;
  kind: GuardKind;
  sentence: string;
}
export const sentences = (text: string): string[] => String(text || '').match(/[^\n]+?(?:[.!?…]+(?=\s|$)|(?=\n|$))[^\S\n]*|\n+/g) ?? [];
export const guard = (text: string): Flag[] =>
  sentences(text).flatMap((s, i) => {
    const r = RULES.find((rule) => rule.re.some((re) => re.test(s)));
    return r ? [{ i, kind: r.kind, sentence: s.trim() }] : [];
  });
export const cut = (text: string, i: number): string =>
  sentences(text).filter((_, j) => j !== i).join('').replace(/[^\S\n]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
export const clean = (text: string): string => {
  const bad = guard(text).map((g) => g.i);
  return bad.length ? sentences(text).filter((_, j) => !bad.includes(j)).join('').trim() : String(text || '');
};

export interface PageFlag extends Flag {
  /** `line` albo id pytania. */
  where: string;
  inQuestion?: boolean;
  label: string;
}
/** Wszystko, co w szkicu blokuje publikację. */
export function pageFlags(page: PageDraft): PageFlag[] {
  const out: PageFlag[] = [
    ...guard(page.title).map((g) => ({ ...g, where: 'title', label: 'Tytuł' })),
    ...guard(page.line).map((g) => ({ ...g, where: 'line', label: TYPES[page.type]!.lineLabel })),
  ];
  for (const id of page.order) {
    const q = questionOf(page, id);
    if (!q) continue;
    if (page.custom.some((c) => c.id === id)) for (const g of guard(q.q)) out.push({ ...g, where: id, inQuestion: true, label: 'Twoje pytanie' });
    for (const g of guard(page.answers[id] ?? '')) out.push({ ...g, where: id, label: q.q });
  }
  return out;
}
/** Odpowiedzi, które wejdą na stronę. */
export const answered = (page: PageDraft): string[] => page.order.filter((id) => questionOf(page, id) && clean(page.answers[id] ?? '').trim() !== '');
export const MIN_ANSWERS = 1;

/* ---------- strona ---------- */

const ph = (p: Person, cls = ''): string =>
  p.photo
    ? `<img class="ph ${cls}" src="${esc(p.photo)}" alt="${esc(p.name)} — zdjęcie" width="480" height="600" loading="eager">`
    : `<span class="ph mono ${cls}" aria-hidden="true">${esc(initials(p.name))}</span>`;

/** Jej tekst w HTML: escapowany, a `**tak**` - jak w dawnych formularzach profilu - staje się pogrubieniem. */
const inline = (s: string): string => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/** Kształt wynika z tego, JAK ktoś napisał: jedno krótkie zdanie → cytat; krótkie linie → lista lub kroki; reszta → akapity. */
export function shape(text: string): string {
  const lines = text.trim().split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0]!.length <= 70) return `<p class="say">${inline(lines[0]!)}</p>`;
  if (lines.length >= 3 && lines.every((l) => l.length <= 120)) {
    const ordered = lines.some((l) => /^(\d+[.)]|najpierw|potem|następnie|na koniec)/i.test(l));
    const li = lines.map((l) => `<li>${inline(l.replace(/^([-–•*]|\d+[.)])\s+/, ''))}</li>`).join('');
    return ordered ? `<ol class="steps">${li}</ol>` : `<ul class="ticks">${li}</ul>`;
  }
  return lines.map((l) => `<p>${inline(l)}</p>`).join('');
}

const dayOf = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string => new Date(iso).toLocaleDateString('pl-PL', { ...opts, timeZone: tz });
const timeOf = (iso: string, tz: string): string => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: tz });

const FACTS: Record<FactDef['id'], (p: Person) => string> = {
  creds: (p) =>
    p.credentials.length === 0
      ? '<p class="policy">Dokumenty czekają na sprawdzenie przez serwis.</p>'
      : `<ul class="creds">${p.credentials
          .map(
            (c) => `<li><strong>${esc(c.title)}</strong><span>${esc([c.issuer, c.year].filter(Boolean).join(', '))}</span>
      <em class="${c.verified ? 'ok' : 'wait'}">${c.verified ? '✓ dokument potwierdzony' : 'czeka na potwierdzenie'}</em></li>`,
          )
          .join('')}</ul>`,
  offers: (p) =>
    `${
      p.offers.length === 0
        ? '<p class="policy">Cennik pojawi się wkrótce.</p>'
        : `<ul class="offers">${p.offers.map((o) => `<li><span><strong>${esc(o.title)}</strong><small>${o.duration_minutes} minut</small></span><b>${zl(o.price_minor)}</b></li>`).join('')}</ul>`
    }${p.cancellation_policy ? `<p class="policy">${esc(p.cancellation_policy)}</p>` : ''}`,
  slots: (p) => {
    if (p.slots.length === 0) return `<p class="policy">W najbliższych tygodniach nie ma wolnych terminów.</p>`;
    const days = new Map<string, string[]>();
    for (const s of p.slots) {
      const day = dayOf(s, p.timezone, { weekday: 'long', day: 'numeric', month: 'long' });
      days.set(day, [...(days.get(day) ?? []), timeOf(s, p.timezone)]);
    }
    return `<div class="slots">${[...days]
      .slice(0, 5)
      .map(([day, times]) => `<div class="day"><h4>${esc(day)}</h4><ul class="times">${times.map((t) => `<li>${t}</li>`).join('')}</ul></div>`)
      .join('')}
      <p class="policy">Rezerwacja odbywa się przez asystenta ChatGPT. Logowanie dopiero przy rezerwacji — przeglądasz anonimowo.</p>
      <p><a class="book" href="${esc(p.booking_href)}">Jak zarezerwować termin</a></p></div>`;
  },
};
const anchor = (f: FactDef): string => (f.id === 'slots' ? 'terminy' : `f-${f.id}`);
const factCard = (f: FactDef, p: Person): string =>
  `<section class="fact" id="${anchor(f)}" aria-label="${esc(f.title)}"><h3>${esc(f.title)}</h3>${FACTS[f.id](p)}<p class="src">Aktualne — ${esc(f.source)}</p></section>`;

const badge = (p: Person): string => (p.verified ? '<p class="badge">✓ Kwalifikacje sprawdzone</p>' : '');
const chips = (p: Person): string =>
  `<ul class="chips">${[p.online && 'online', p.in_person && 'w gabinecie', p.accepting ? 'przyjmuje nowe osoby' : 'obecnie brak miejsc']
    .filter(Boolean)
    .map((c) => `<li>${c}</li>`)
    .join('')}</ul>`;

interface Item {
  q: Pick<Question, 'id' | 'q' | 'stage'>;
  a: string;
}
const items = (page: PageDraft): Item[] =>
  page.order
    .map((id) => ({ q: questionOf(page, id), a: clean(page.answers[id] ?? '') }))
    .filter((x): x is Item => Boolean(x.q) && x.a.trim() !== '' && guard(x.q!.q).length === 0);

/** OTWARCIE — druga decyzja autorki: co widać najpierw. Twarz / jej pierwsze zdanie / konkrety z danych. */
function opening(p: Person, page: PageDraft, its: Item[]): { big: string; quote: string; strip: string } {
  let quote = '';
  let strip = '';
  if (page.top === 'slowa' && its[0]) {
    const s = (sentences(its[0].a)[0] ?? '').trim();
    if (s && s.length <= 230) quote = `<blockquote class="open">${esc(s.replace(/\*\*/g, ''))}</blockquote>`;
  }
  if (page.top === 'fakty') {
    const ok = p.credentials.filter((c) => c.verified).length;
    const first = p.slots[0];
    const cells: Array<[string, string, string] | null> = [
      p.offers.length ? ['f-offers', (p.offers.length > 1 ? 'od ' : '') + zl(Math.min(...p.offers.map((o) => o.price_minor))), 'cena sesji'] : null,
      first ? ['terminy', `${dayOf(first, p.timezone, { weekday: 'short', day: 'numeric', month: 'short' })}, ${timeOf(first, p.timezone)}`, 'najbliższy wolny termin'] : null,
      ok ? ['f-creds', `${ok} ${ok === 1 ? 'dokument' : 'dokumenty'}`, 'potwierdzone kwalifikacje'] : null,
    ];
    strip = `<ul class="strip">${cells
      .filter((c): c is [string, string, string] => c !== null)
      .map((c) => `<li><a href="#${c[0]}"><b>${esc(c[1])}</b><span>${esc(c[2])}</span></a></li>`)
      .join('')}</ul>`;
  }
  return { big: page.top === 'twarz' ? 'big' : '', quote, strip };
}

/** Pytania jej i pytania „z danych” w jednej kolejce — dla pytań i spisu. */
function sequence(p: Person, facts: FactDef[], its: Item[]): Array<{ id?: string; ask: string; html: string; data?: boolean }> {
  const seq: Array<{ id?: string; ask: string; html: string; data?: boolean }> = [];
  const fact = (f: FactDef): number => seq.push({ ask: f.ask, html: factCard(f, p), data: true });
  its.forEach((it, i) => {
    seq.push({ id: it.q.id, ask: it.q.q, html: shape(it.a) });
    facts.filter((f) => f.after === i).forEach(fact);
  });
  facts.filter((f) => f.after === 'end' || f.after >= its.length).forEach(fact);
  return seq;
}

type Opening = ReturnType<typeof opening>;
const head = (p: Person, page: PageDraft): string => `<h1>${esc(page.type === 'profil' ? p.name : page.title || p.name)}</h1>${page.line ? `<p class="line">${esc(page.line)}</p>` : ''}${badge(p)}`;

const RENDER: Record<FormId, (p: Person, page: PageDraft, facts: FactDef[], its: Item[], o: Opening, month: string) => string> = {
  rozmowa: (p, page, facts, its, o) => `<header class="hero">${ph(p, o.big)}<div>${head(p, page)}${chips(p)}</div></header>
    <main class="talk">${o.quote}${o.strip}<p class="talk-intro">Pytania, które ludzie zadają najczęściej — i odpowiedzi własnymi słowami.</p>
    ${sequence(p, facts, its)
      .map((x) => `<div class="ask"><h2>${esc(x.ask)}</h2></div><div class="ans${x.data ? ' data' : ''}">${x.data ? x.html : `<div>${x.html}</div>`}</div>`)
      .join('')}</main>`,
  list: (p, page, facts, its, o, month) => `<main class="letter ${o.big ? 'has-photo' : ''}">${o.big ? `<div class="clip">${ph(p, 'big')}</div>` : ''}
    <div class="head">${o.big ? '' : ph(p)}<div>${head(p, page)}</div></div>
    ${o.strip}
    <p class="date">${esc(p.city || 'Online')}, ${esc(month)}</p>
    ${o.quote}<p class="greet">Dzień dobry,</p>
    ${its.map((it, i) => `<div class="para${i === 0 ? ' first' : ''}"><h2 class="note">${esc(it.q.q)}</h2>${shape(it.a)}</div>`).join('')}
    <p class="bye">Do zobaczenia,</p><p class="sign">${esc(p.name)}</p>${chips(p)}</main>
    <aside class="attach"><h2>Do listu dołączam</h2>${facts.map((f) => factCard(f, p)).join('')}</aside>`,
  droga: (p, page, facts, its, o) => {
    const stages = TYPES[page.type]!.stages
      .map((s) => ({ s, its: its.filter((it) => (it.q.stage || 'inne') === s.id), facts: facts.filter((f) => f.stage === s.id) }))
      .filter((x) => x.its.length || x.facts.length);
    return `<header class="road-hero"><div class="rh ${o.big ? 'has-photo' : ''}"><div>${head(p, page)}${chips(p)}</div>${ph(p, o.big)}</div>
      ${o.quote}${o.strip}
      <nav aria-label="Kroki"><ol>${stages.map((x, i) => `<li><a href="#krok-${i + 1}">${esc(x.s.title)}</a></li>`).join('')}</ol></nav></header>
      <main class="road">${stages
        .map(
          (x, i) => `<section class="station ${x.its.length && x.facts.length ? 'both' : ''}" id="krok-${i + 1}"><span class="num" aria-hidden="true">${i + 1}</span><h2>${esc(x.s.title)}</h2>
        ${x.its.length ? `<div class="st-text">${x.its.map((it) => `<div class="qa"><h3>${esc(it.q.q)}</h3>${shape(it.a)}</div>`).join('')}</div>` : ''}
        ${x.facts.length ? `<div class="st-facts">${x.facts.map((f) => factCard(f, p)).join('')}</div>` : ''}</section>`,
        )
        .join('')}</main>`;
  },
  spis: (p, page, facts, its, o) => {
    const seq = sequence(p, facts, its);
    return `<header class="index-hero">${ph(p, o.big)}${head(p, page)}${chips(p)}${o.quote}${o.strip}</header>
      <main class="index"><p class="index-intro">${seq.length} pytań. Otwórz to, które jest teraz Twoje.</p>
      ${seq
        .map(
          (x, i) =>
            `<details ${i === 0 ? 'open' : ''} class="${x.data ? 'data' : ''}"><summary><span class="n">${i + 1}</span><span>${esc(x.ask)}${x.data ? '<small>odpowiedź z danych — zawsze aktualna</small>' : ''}</span></summary><div class="body">${x.html}</div></details>`,
        )
        .join('')}</main>`;
  },
};

/** Numery są stałą strony, nie jej treścią: stąd nie ma jak ich usunąć ani przepisać. */
const CRISIS = `<footer class="crisis" aria-label="Pomoc w kryzysie"><div><h2>Potrzebujesz pomocy teraz?</h2>
  <p>Ta strona nie jest pomocą doraźną. Zadzwoń — bezpłatnie, całą dobę:</p>
  <ul><li><a href="tel:116123">116 123</a><span>kryzysowy telefon zaufania</span></li>
  <li><a href="tel:800702222">800 70 2222</a><span>Centrum Wsparcia</span></li>
  <li><a href="tel:112">112</a><span>zagrożenie życia</span></li></ul>`;

/**
 * Cała strona publiczna jako `<article>`. `month` („wrzesień 2026”) przychodzi z zewnątrz,
 * bo list nosi datę publikacji, a nie datę renderu.
 */
export function renderPublic(person: Person, draft: PageDraft, month: string): string {
  const page = { ...draft, title: clean(draft.title), line: clean(draft.line) };
  // Karta kwalifikacji bez ani jednego dokumentu przeczyłaby plakietce weryfikacji - wtedy jej nie ma.
  const facts = TYPES[page.type]!.facts.filter((f) => f.id !== 'creds' || person.credentials.length > 0);
  const its = items(page);
  return `<article class="pub"><div class="pg f-${page.form} t-${page.top}">${RENDER[page.form](person, page, facts, its, opening(person, page, its), month)}</div>
    <div class="ctabar"><a class="cta" href="#terminy">Zobacz wolne terminy</a></div>
    ${CRISIS}<p class="demo-note">Otwarty Terapeuta${person.is_demo ? ' · profil demonstracyjny, osoba fikcyjna' : ''}</p></div></footer></article>`;
}
