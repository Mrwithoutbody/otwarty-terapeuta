/**
 * Narzędzie terapeutki: odpowiedz → ułóż → pokaż światu.
 *
 * Działa w przeglądarce, w panelu. Podgląd rysuje ten sam `renderPublic`, który
 * na serwerze składa stronę dla pacjenta, a ostrzeżenia liczy ten sam strażnik
 * faktów, który serwer sprawdza przy publikacji - jedno źródło, dwa miejsca.
 * Szkic zapisuje się sam; pacjent widzi zmiany dopiero po „Opublikuj”.
 */
import { answered, cut, esc, FORMS, guard, GUARD_MSG, LIMITS, pageFlags, questionOf, renderPublic, TOPS, TYPES, type FactDef, type Flag, type GuardKind, type PageDraft, type Person } from '../../../shared/authored/core';

interface Boot {
  draft: PageDraft;
  published: PageDraft | null;
  published_at: string | null;
  person: Person;
  csrf: string;
  api: string;
  public_url: string;
  panel_url: string;
  can_upload: boolean;
  in_catalogue: boolean;
}

const boot = JSON.parse(document.getElementById('boot')!.textContent!) as Boot;
const app = document.getElementById('app')!;
const $ = <T extends HTMLElement>(s: string, r: ParentNode = document): T | null => r.querySelector<T>(s);
const T = TYPES.profil!;
const P = boot.draft;
let pub = boot.published;
let publishedAt = boot.published_at;
const person = boot.person;
let undo: string | null = null;
let toastTimer = 0;
let saveTimer = 0;
let saving: Promise<void> = Promise.resolve();

const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
const dirty = (): boolean => pub !== null && JSON.stringify(P) !== JSON.stringify(pub);
const count = (): number => answered(P).length;
const plural = (n: number): string => (n === 1 ? 'odpowiedź' : 'odpowiedzi');
const day = (iso: string): string => new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });
const month = (): string => new Date(publishedAt ?? Date.now()).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
const go = (hash: string): void => void (location.hash = hash);
const KIND: Record<GuardKind, string> = { kwota: 'cena w tekście', termin: 'termin w tekście' };

function toast(msg: string): void {
  const t = $('#toast')!;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 6000);
}

/* ---------- zapis ---------- */

async function call(path: string, init: RequestInit): Promise<Response> {
  return fetch(boot.api + path, { ...init, credentials: 'same-origin', headers: { 'x-csrf': boot.csrf, ...(init.headers ?? {}) } });
}
const say = (text: string): void => {
  const el = $('.saved');
  if (el) el.textContent = text;
};
/** Zapis idzie po krótkiej ciszy; kolejne ustawiają się w kolejce, żeby starszy szkic nie nadpisał nowszego. */
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const body = JSON.stringify({ draft: P });
    saving = saving.then(async () => {
      try {
        const res = await call('/szkic', { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
        if (res.status === 401) return toast('Sesja wygasła. Skopiuj swój tekst, odśwież stronę i zaloguj się ponownie.');
        if (!res.ok) throw new Error(String(res.status));
        say('Zapisane. Pacjenci zobaczą to dopiero po publikacji.');
      } catch {
        say('Nie udało się zapisać — sprawdź połączenie. Spróbujemy przy następnej zmianie.');
      }
    });
  }, 700);
}
const flush = async (): Promise<void> => {
  clearTimeout(saveTimer);
  await saving;
};

/* ---------- ekrany ---------- */

function status(): string {
  if (!pub) return '<span class="st draft">Szkic — nikt jeszcze nie widzi</span>';
  if (dirty()) return '<span class="st wait">Zmiany czekają na publikację</span>';
  return `<span class="st live">Opublikowana ${day(publishedAt!)}</span>`;
}

function steps(cur: string): string {
  const t = [['', 'Odpowiedz'], ['uloz', 'Ułóż'], ['pokaz', 'Pokaż światu']] as const;
  return `<nav class="steps-nav" aria-label="Etapy"><a class="back" href="${esc(boot.panel_url)}">‹ Panel</a><h1>Strona o mnie</h1><p class="meta">${status()}</p>
    <ol>${t.map(([id, n], i) => `<li><a href="#/${id}" ${id === cur ? 'aria-current="step"' : ''}><b>${i + 1}</b> ${n}</a></li>`).join('')}</ol></nav>`;
}
/** Stały dolny pasek: podgląd + główny krok. Jest w układzie strony (sticky), więc niczego nie zasłania na stałe. */
const dock = (primary: string, note = ''): string =>
  `<div class="dock">${note ? `<p class="dock-note">${note}</p>` : ''}<div class="dock-in"><button class="btn ghost pvbtn" data-act="peek">Podgląd</button>${primary}</div></div>`;

const MANAGE: Record<FactDef['id'], [string, string]> = {
  creds: ['Dokumenty sprawdza serwis', ''],
  offers: ['Zmień w cenniku', '#panel-dane'],
  slots: ['Zmień w kalendarzu', '#panel-terminy'],
};
function factPreview(f: FactDef): string {
  if (f.id === 'offers') return person.offers.map((o) => `${o.title} — ${o.price_minor / 100} zł`).join(' · ') || 'Cennik jest jeszcze pusty';
  if (f.id === 'slots') return person.slots.length ? `${person.slots.length} wolnych terminów w kalendarzu` : 'Brak wolnych terminów — ustaw grafik';
  return person.credentials.map((c) => c.title).join(' · ') || 'Brak dokumentów';
}

const warnBox = (g: Flag, cutAttr: string): string => `<div class="warn"><p><b>${GUARD_MSG[g.kind][0]}:</b> <q>${esc(g.sentence)}</q></p><p>${GUARD_MSG[g.kind][1]}</p>
  ${cutAttr ? `<button class="btn small" ${cutAttr}>Wytnij to zdanie</button>` : ''}</div>`;
function guardHtml(text: string, attr: string): string {
  const g = guard(text);
  return g.map((x) => warnBox(x, attr ? `${attr}="${x.i}"` : '')).join('') + (g.length ? '<p class="warn-foot">Tego zdania nie pokażemy na stronie. Dopóki tu jest, nie da się opublikować.</p>' : '');
}

function photoCard(): string {
  const has = Boolean(person.photo);
  return `<div class="card photocard">${has ? `<img src="${esc(person.photo)}" alt="Twoje zdjęcie">` : '<span class="nophoto" aria-hidden="true"></span>'}
    <div><h2>${has ? 'Twoje zdjęcie' : 'Dodaj swoje zdjęcie'}</h2><p class="hint">${has ? 'Widać je na Twojej stronie i w katalogu. Zmienia się od razu, bez publikowania.' : 'Osoba, która szuka pomocy, chce najpierw zobaczyć, do kogo idzie. Wystarczy zdjęcie z telefonu — przytniemy je sami.'}</p>
    ${boot.can_upload ? `<p class="row"><label class="btn ${has ? 'ghost' : ''} filebtn">${has ? 'Zmień zdjęcie' : 'Wybierz zdjęcie'}<input type="file" accept="image/*" data-photo class="sr"></label></p>` : '<p class="hint">W tym środowisku nie ma magazynu plików.</p>'}</div></div>`;
}

function stepAnswer(): string {
  const n = count();
  const all = [...T.questions, ...P.custom];
  const flags = pageFlags(P);
  const card = (q: { id: string; q: string }): string => {
    const a = (P.answers[q.id] ?? '').trim();
    const fl = flags.filter((f) => f.where === q.id);
    return `<li><a class="qcard ${a ? 'done' : ''} ${fl.length ? 'flag' : ''}" href="#/q/${esc(q.id)}"><span class="qq">${esc(q.q)}</span>
    ${a ? `<span class="qprev">${esc(a.slice(0, 90)) + (a.length > 90 ? '…' : '')}</span>` : '<span class="qprev go">Odpowiedz ›</span>'}
    ${fl.length ? `<span class="flagchip">Do poprawy: ${KIND[fl[0]!.kind]}</span>` : ''}</a></li>`;
  };
  const done = all.filter((q) => (P.answers[q.id] ?? '').trim());
  const todo = all.filter((q) => !(P.answers[q.id] ?? '').trim());
  const rest = todo.length - 3;
  const note = n >= 3 ? `<b>Masz już ${n} ${plural(n)} — to wystarczy na dobrą stronę.</b> Możesz iść dalej albo dopisać więcej.` : n ? `Masz ${n} ${plural(n)}. Trzy to już strona.` : '';
  return `${steps('')}<section class="wrap">
    <p class="lead small">Dzień dobry. Twoja strona powstaje z odpowiedzi na pytania, które pacjenci naprawdę zadają. Piszesz po swojemu — resztą zajmujemy się my.</p>
    ${photoCard()}
    <label class="linebox">${T.lineLabel}<textarea data-line rows="2" maxlength="${LIMITS.line}">${esc(P.line)}</textarea><small>${T.lineHint}</small></label>
    <div id="lineguard">${guardHtml(P.line, 'data-cut-line')}</div>
    <h2 class="sec">Pytania pacjentów</h2><p class="hint">Nie musisz odpowiadać na wszystkie. Trzy dobre odpowiedzi to już strona.</p>
    ${done.length ? `<ul class="qlist">${done.map(card).join('')}</ul>` : ''}
    ${todo.length ? `<ul class="qlist">${todo.slice(0, 3).map(card).join('')}</ul>` : ''}
    ${rest > 0 ? `<details class="more"><summary>Pokaż jeszcze ${rest} ${rest === 1 ? 'pytanie' : rest < 5 ? 'pytania' : 'pytań'}</summary><ul class="qlist">${todo.slice(3).map(card).join('')}</ul></details>` : ''}
    ${P.custom.length < LIMITS.custom ? `<form class="ownq" data-form="ownq"><label>Pacjenci pytają Cię o coś innego? Dopisz to pytanie<input name="q" required maxlength="${LIMITS.question}" placeholder="np. Czy mogę przyjść z dzieckiem?" autocomplete="off"></label><button class="btn ghost">Dodaj pytanie</button></form>` : ''}
    <h2 class="sec">Na te pytania odpowiadamy za Ciebie</h2><p class="hint">Ceny i terminy bierzemy prosto z Twoich danych, więc nie da się ich pomylić ani zapomnieć zaktualizować. Przy kwalifikacjach pokazujemy, które dokumenty sprawdził serwis.</p>
    <ul class="qlist locked">${T.facts
      .map(
        (f) => `<li><div class="qcard lock"><span class="qq">${esc(f.ask)}</span><span class="qprev">${esc(factPreview(f))}</span>
      <span class="src"><span aria-hidden="true">🔒</span> ${esc(f.source)} · ${MANAGE[f.id][1] ? `<a href="${esc(boot.panel_url + MANAGE[f.id][1])}">${MANAGE[f.id][0]} ›</a>` : MANAGE[f.id][0]}</span></div></li>`,
      )
      .join('')}</ul>
    </section>${dock(`<a class="btn" href="#/uloz">Dalej: ułóż stronę ›</a>`, note)}`;
}

function screenQuestion(qid: string): string {
  const q = questionOf(P, qid);
  if (!q) return stepAnswer();
  const known = T.questions.find((x) => x.id === qid);
  const all = [...T.questions, ...P.custom];
  const next = all[(all.findIndex((x) => x.id === qid) + 1) % all.length]!;
  return `<section class="wrap answer"><a class="back" href="#/">‹ Wszystkie pytania</a>
    <p class="kind">${known ? 'Pacjent pyta' : 'Twoje pytanie'}</p><h1 class="bigq" id="qtitle">${esc(q.q)}</h1>${known ? `<p class="hint">${esc(known.why)}</p>` : ''}
    ${known ? '' : `<details class="fixq"><summary>Popraw treść pytania</summary><label>Treść pytania<input data-cq maxlength="${LIMITS.question}" value="${esc(q.q)}" autocomplete="off"></label><div id="cqguard">${guardHtml(q.q, '')}</div></details>`}
    <label for="ans" class="sr">Twoja odpowiedź</label>
    <textarea id="ans" data-ans="${esc(qid)}" rows="7" maxlength="${LIMITS.answer}" placeholder="Napisz tak, jak mówisz to w gabinecie…">${esc(P.answers[qid] ?? '')}</textarea>
    <p class="saved" role="status" aria-live="polite">Zapisuje się samo.</p>
    <div id="guardbox" aria-live="polite">${guardHtml(P.answers[qid] ?? '', 'data-cut')}</div>
    <div class="tools"><button class="btn ghost" data-act="undo" hidden>Cofnij</button></div>
    ${known?.starters.length ? `<div class="starters"><p>Nie wiesz, jak zacząć? Dotknij początku zdania:</p>${known.starters.map((s) => `<button class="chip" data-starter="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <p class="tip">Wyliczasz po kolei? Pisz każdy punkt w nowej linii — pokażemy je jako kroki.</p>
    <p class="row between">${known ? '<span></span>' : '<button class="btn ghost danger" data-act="del-q">Usuń to pytanie</button>'}<a class="btn ghost" href="#/q/${esc(next.id)}">Następne pytanie ›</a></p></section>
    ${dock('<a class="btn" href="#/">Gotowe</a>')}`;
}

const pict: Record<string, string> = {
  rozmowa: '<svg viewBox="0 0 80 56" aria-hidden="true"><rect x="4" y="4" width="3" height="9" class="a"/><rect x="11" y="4" width="46" height="9" rx="2" class="a"/><rect x="11" y="17" width="62" height="5" rx="2" class="b"/><rect x="11" y="25" width="54" height="5" rx="2" class="b"/><rect x="4" y="36" width="3" height="7" class="a"/><rect x="11" y="36" width="38" height="7" rx="2" class="a"/><rect x="11" y="47" width="60" height="5" rx="2" class="b"/></svg>',
  list: '<svg viewBox="0 0 80 56" aria-hidden="true"><rect x="14" y="2" width="52" height="52" rx="2" class="p"/><rect x="20" y="9" width="18" height="3" class="b"/><rect x="20" y="17" width="40" height="2" class="a"/><rect x="20" y="22" width="40" height="2" class="a"/><rect x="20" y="27" width="34" height="2" class="a"/><rect x="20" y="34" width="40" height="2" class="a"/><rect x="20" y="39" width="28" height="2" class="a"/><path d="M42 48c4-5 6 3 9-1s5-2 8-1" class="s"/></svg>',
  droga: '<svg viewBox="0 0 80 56" aria-hidden="true"><path d="M12 4v48" class="s"/><circle cx="12" cy="9" r="5" class="b"/><circle cx="12" cy="28" r="5" class="b"/><circle cx="12" cy="47" r="5" class="b"/><rect x="24" y="5" width="50" height="9" rx="2" class="a"/><rect x="24" y="24" width="38" height="9" rx="2" class="a"/><rect x="24" y="43" width="46" height="9" rx="2" class="a"/></svg>',
  spis: '<svg viewBox="0 0 80 56" aria-hidden="true"><rect x="6" y="4" width="68" height="10" rx="3" class="p"/><rect x="6" y="17" width="68" height="22" rx="3" class="p"/><rect x="6" y="42" width="68" height="10" rx="3" class="p"/><rect x="11" y="8" width="34" height="2.5" class="b"/><rect x="11" y="21" width="40" height="2.5" class="b"/><rect x="11" y="27" width="56" height="2" class="a"/><rect x="11" y="32" width="46" height="2" class="a"/><rect x="11" y="46" width="28" height="2.5" class="b"/><path d="M64 8l3 3 3-3M64 46l3 3 3-3" class="s"/></svg>',
  twarz: '<svg viewBox="0 0 80 56" aria-hidden="true"><rect x="24" y="3" width="32" height="34" rx="6" class="b"/><circle cx="40" cy="16" r="7" class="p"/><path d="M28 37c0-9 5-13 12-13s12 4 12 13z" class="p"/><rect x="18" y="42" width="44" height="4" class="a"/><rect x="26" y="49" width="28" height="3" class="a"/></svg>',
  slowa: '<svg viewBox="0 0 80 56" aria-hidden="true"><text x="4" y="22" font-size="26" font-family="Georgia,serif" class="bt">„</text><rect x="18" y="8" width="56" height="6" class="b"/><rect x="18" y="19" width="50" height="6" class="b"/><rect x="18" y="30" width="34" height="6" class="b"/><rect x="18" y="44" width="40" height="3" class="a"/><rect x="18" y="50" width="30" height="3" class="a"/></svg>',
  fakty: '<svg viewBox="0 0 80 56" aria-hidden="true"><rect x="4" y="6" width="22" height="26" rx="4" class="p"/><rect x="29" y="6" width="22" height="26" rx="4" class="p"/><rect x="54" y="6" width="22" height="26" rx="4" class="p"/><rect x="8" y="12" width="14" height="5" class="b"/><rect x="33" y="12" width="14" height="5" class="b"/><rect x="58" y="12" width="14" height="5" class="b"/><rect x="8" y="22" width="12" height="2.5" class="a"/><rect x="33" y="22" width="12" height="2.5" class="a"/><rect x="58" y="22" width="12" height="2.5" class="a"/><rect x="4" y="40" width="60" height="3" class="a"/><rect x="4" y="47" width="44" height="3" class="a"/></svg>',
};
const choice = (name: string, list: ReadonlyArray<{ id: string; name: string; desc: string }>, val: string): string =>
  list.map((f) => `<label class="formopt"><input type="radio" name="${name}" value="${f.id}" ${val === f.id ? 'checked' : ''}>${pict[f.id]}<span><b>${f.name}</b><small>${f.desc}</small></span></label>`).join('');

function stepArrange(): string {
  const its = P.order.map((id) => questionOf(P, id)).filter((q) => q !== undefined);
  return `${steps('uloz')}<section class="wrap">
    <p class="lead small">Dwie decyzje i kolejność. Nic tu nie da się zepsuć — treść zostaje ta sama, zmienia się tylko to, jak witasz.</p>
    <fieldset class="forms"><legend>Jak chcesz przywitać osobę, która wchodzi?</legend>${choice('form', FORMS, P.form)}</fieldset>
    <fieldset class="forms"><legend>Co ma zobaczyć najpierw?</legend>${choice('top', TOPS, P.top)}</fieldset>
    ${P.top === 'twarz' && !person.photo ? '<p class="hint nudge">Nie masz jeszcze zdjęcia, więc na razie pokażemy inicjały. <a href="#/">Dodaj zdjęcie</a></p>' : ''}
    <h2 class="sec">O czym mówisz najpierw?</h2><p class="hint">Pierwsza odpowiedź otwiera stronę. Przesuń wyżej to, co dla Twoich pacjentów najważniejsze.</p>
    ${
      its.length
        ? `<ol class="order">${its
            .map(
              (q, i) => `<li><span>${i === 0 ? '<em>otwiera stronę</em>' : ''}${esc(q.q)}</span>
      <span class="mv"><button data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Przesuń wyżej: ${esc(q.q)}">↑</button><button data-down="${i}" ${i === its.length - 1 ? 'disabled' : ''} aria-label="Przesuń niżej: ${esc(q.q)}">↓</button></span></li>`,
            )
            .join('')}</ol>`
        : '<p class="empty">Tu pojawią się Twoje odpowiedzi. <a href="#/">Napisz pierwszą</a> — wystarczą dwa zdania.</p>'
    }
    </section>${dock('<a class="btn" href="#/pokaz">Dalej: pokaż światu ›</a>')}`;
}

function stepPublish(): string {
  const n = count();
  const flags = pageFlags(P);
  const blocked = n < 1 || flags.length > 0;
  const fix = (where: string): string => (where === 'line' ? '#/' : `#/q/${where}`);
  return `${steps('pokaz')}<section class="wrap publish">
    <ul class="check"><li class="${n >= 1 ? 'ok' : 'no'}">${n} ${plural(n)} Twoimi słowami${n < 1 ? ' — napisz choć jedną, pusta strona nikomu nie pomoże' : ''}</li>
      ${person.photo ? '<li class="ok">Twoje zdjęcie</li>' : '<li class="no">Bez zdjęcia — pacjent chce zobaczyć, do kogo idzie. <a href="#/">Dodaj zdjęcie</a></li>'}
      ${T.facts.map((f) => `<li class="ok">${esc(f.title)} — ${esc(f.source)}</li>`).join('')}
      <li class="${flags.length ? 'no' : 'ok'}">${flags.length ? `${flags.length === 1 ? 'Jedno zdanie' : `${flags.length} zdania`} w Twoim tekście podaje ceny albo terminy — popraw poniżej` : 'W Twoim tekście nie ma cen ani terminów — te pokazujemy z danych'}</li>
      <li class="ok">Telefony pomocy kryzysowej na dole strony — zawsze, nie trzeba o nich pamiętać</li></ul>
    ${
      flags.length
        ? `<div class="card fixcard"><h2>Zanim opublikujesz: ${flags.length === 1 ? 'jedno zdanie' : `${flags.length} zdania`} do poprawy</h2>
      ${flags.map((f, k) => `<div class="fixitem"><p class="kind">${esc(f.label)}</p>${warnBox(f, '')}<p class="row">${f.inQuestion ? '' : `<button class="btn small" data-cutflag="${k}">Wytnij to zdanie</button>`}<a class="btn small ghost" href="${fix(f.where)}">Popraw ręcznie</a></p></div>`).join('')}</div>`
        : ''
    }
    ${
      blocked
        ? flags.length
          ? ''
          : '<div class="card"><h2>Jeszcze chwila</h2><p>Strona potrzebuje choć jednej odpowiedzi.</p><a class="btn" href="#/">Wróć do pisania</a></div>'
        : !pub
          ? '<div class="card"><h2>Gotowe, żeby pokazać?</h2><p>Nic się nie zepsuje: po publikacji dalej możesz poprawiać, a pacjenci zobaczą zmiany dopiero, gdy klikniesz jeszcze raz.</p><button class="btn big" data-act="publish">Opublikuj stronę</button></div>'
          : dirty()
            ? `<div class="card"><h2>Masz nowe zmiany</h2><p>Pacjenci wciąż widzą wersję z ${day(publishedAt!)}.</p><p class="row"><button class="btn big" data-act="publish">Opublikuj zmiany</button><button class="btn ghost" data-act="revert">Wróć do wersji opublikowanej</button></p></div>`
            : boot.in_catalogue
              ? `<div class="card okcard"><h2>Strona jest opublikowana</h2><p>Adres: <b>${esc(boot.public_url.replace(/^https?:\/\//, ''))}</b></p><a class="btn big" href="${esc(boot.public_url)}" target="_blank" rel="noopener">Zobacz ją jak pacjent</a></div>`
              : '<div class="card okcard"><h2>Strona jest gotowa</h2><p>Pacjenci zobaczą ją, gdy Twój profil trafi do katalogu — po sprawdzeniu dokumentów przez serwis. Niczego więcej nie musisz robić.</p><button class="btn ghost" data-act="peek">Zobacz, jak będzie wyglądać</button></div>'
    }
    </section>${dock('')}`;
}

/* ---------- router ---------- */

const route = (): string[] => location.hash.replace(/^#\/?/, '').split('/');
const curQ = (): string | undefined => (route()[0] === 'q' ? route()[1] : undefined);

function render(): void {
  const h = route();
  const html = h[0] === 'q' && h[1] ? screenQuestion(h[1]) : h[0] === 'uloz' ? stepArrange() : h[0] === 'pokaz' ? stepPublish() : stepAnswer();
  app.innerHTML = `<div class="editor"><div class="pane">${html}</div>
    <aside class="preview" aria-label="Podgląd strony"><p class="pvlabel">Podgląd — tak to zobaczy pacjent</p><div class="phone" inert id="pv"></div></aside></div>
    <dialog id="peek" aria-label="Podgląd strony"><div class="pubbar"><button data-act="peek-close">‹ Wróć do pisania</button><span>Podgląd szkicu</span></div><div id="pv2" inert></div></dialog>`;
  refreshPreview();
  undo = null;
}
function refreshPreview(): void {
  const html = renderPublic(person, P, month());
  const a = $('#pv');
  const b = $('#pv2');
  if (a) {
    const y = a.scrollTop;
    a.innerHTML = html;
    a.scrollTop = y;
  }
  if (b) b.innerHTML = html;
}

function setAnswer(qid: string, text: string): void {
  P.answers[qid] = text;
  const has = text.trim().length > 0;
  const i = P.order.indexOf(qid);
  if (has && i < 0) P.order.push(qid);
  if (!has && i >= 0) P.order.splice(i, 1);
  save();
  refreshPreview();
}
const showGuard = (): void => {
  const g = $('#guardbox');
  if (g) g.innerHTML = guardHtml($<HTMLTextAreaElement>('#ans')!.value, 'data-cut');
};
function putText(text: string): void {
  const ta = $<HTMLTextAreaElement>('#ans')!;
  undo = ta.value;
  $('[data-act=undo]')!.hidden = false;
  ta.value = text.slice(0, LIMITS.answer);
  setAnswer(curQ()!, ta.value);
  showGuard();
  ta.focus();
}

/* ---------- zdjęcie: przycinamy i zmniejszamy w przeglądarce, serwer dostaje gotowy portret i miniaturę ---------- */

const crop = (img: HTMLImageElement, w: number, h: number): Promise<Blob | null> => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const s = Math.max(w / img.width, h / img.height);
  // Kadr bliżej góry — tam zwykle jest twarz.
  c.getContext('2d')!.drawImage(img, (w - img.width * s) / 2, Math.min(0, (h - img.height * s) * 0.25), img.width * s, img.height * s);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.86));
};
function takePhoto(file: File | undefined): void {
  if (!file || !file.type.startsWith('image/')) return toast('To nie wygląda na zdjęcie. Wybierz plik JPG albo PNG.');
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast('Nie udało się otworzyć tego zdjęcia. Spróbuj innego.');
  };
  img.onload = async () => {
    const [photo, thumb] = await Promise.all([crop(img, 960, 1200), crop(img, 160, 160)]);
    URL.revokeObjectURL(url);
    if (!photo || !thumb) return toast('Nie udało się przygotować zdjęcia. Spróbuj innego.');
    const form = new FormData();
    form.set('photo', photo, 'portret.jpg');
    form.set('photo_thumb', thumb, 'portret-160.jpg');
    toast('Wysyłam zdjęcie…');
    try {
      const res = await call('/zdjecie', { method: 'POST', body: form });
      const out = (await res.json()) as { photo_url?: string; error?: string };
      if (!res.ok || !out.photo_url) return toast(out.error ?? 'Nie udało się zapisać zdjęcia.');
      person.photo = out.photo_url;
      toast('Zdjęcie dodane. Widać je już w podglądzie.');
      render();
    } catch {
      toast('Nie udało się wysłać zdjęcia — sprawdź połączenie.');
    }
  };
  img.src = url;
}

/* ---------- zdarzenia ---------- */

document.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (t.dataset.ans) {
    setAnswer(t.dataset.ans, t.value);
    showGuard();
  } else if ('line' in t.dataset) {
    P.line = t.value.replace(/\n+/g, ' ');
    save();
    refreshPreview();
    $('#lineguard')!.innerHTML = guardHtml(P.line, 'data-cut-line');
  } else if ('cq' in t.dataset) {
    const c = P.custom.find((x) => x.id === curQ());
    if (!c) return;
    c.q = t.value;
    save();
    refreshPreview();
    $('#qtitle')!.textContent = t.value;
    $('#cqguard')!.innerHTML = guardHtml(t.value, '');
  }
});
document.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if ('photo' in t.dataset) takePhoto(t.files?.[0]);
  else if (t.name === 'form' && FORMS.some((f) => f.id === t.value)) P.form = t.value as PageDraft['form'];
  else if (t.name === 'top' && TOPS.some((f) => f.id === t.value)) P.top = t.value as PageDraft['top'];
  else return;
  if (t.name === 'form' || t.name === 'top') {
    save();
    refreshPreview();
  }
});
document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if (form.dataset.form !== 'ownq') return;
  e.preventDefault();
  const q = (form.elements.namedItem('q') as HTMLInputElement).value.trim().replace(/[?\s]*$/, '');
  if (!q || P.custom.length >= LIMITS.custom) return;
  const id = `c_${Date.now().toString(36)}`;
  P.custom.push({ id, q: `${q}?` });
  save();
  go(`#/q/${id}`);
});
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button,[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const ta = $<HTMLTextAreaElement>('#ans');
  if (t.dataset.starter && ta) putText(`${ta.value ? `${ta.value.trimEnd()} ` : ''}${t.dataset.starter} `);
  else if (t.dataset.cut && ta) {
    putText(cut(ta.value, Number(t.dataset.cut)));
    say('Zdanie wycięte. Reszta została — „Cofnij” je przywraca.');
  } else if (t.dataset.cutLine) {
    P.line = cut(P.line, Number(t.dataset.cutLine));
    save();
    render();
  } else if (t.dataset.cutflag) {
    const f = pageFlags(P)[Number(t.dataset.cutflag)];
    if (!f) return;
    if (f.where === 'line') {
      P.line = cut(P.line, f.i);
      save();
    } else setAnswer(f.where, cut(P.answers[f.where] ?? '', f.i));
    render();
    toast('Zdanie wycięte. Reszta Twojego tekstu została bez zmian.');
  } else if (t.dataset.up || t.dataset.down) {
    const i = Number(t.dataset.up ?? t.dataset.down);
    const j = t.dataset.up ? i - 1 : i + 1;
    const o = P.order;
    if (o[i] === undefined || o[j] === undefined) return;
    [o[i], o[j]] = [o[j]!, o[i]!];
    save();
    const y = scrollY;
    render();
    scrollTo(0, y);
    const b = $<HTMLButtonElement>(`[data-${t.dataset.up ? 'up' : 'down'}="${j}"]`);
    if (b && !b.disabled) b.focus();
  } else if (act === 'publish') void publish(t as HTMLButtonElement);
  else if (act === 'revert' && pub) {
    Object.assign(P, clone(pub));
    save();
    render();
    toast('Wróciła wersja, którą widzą pacjenci.');
  } else if (act === 'del-q') {
    const q = curQ()!;
    P.custom = P.custom.filter((c) => c.id !== q);
    delete P.answers[q];
    P.order = P.order.filter((x) => x !== q);
    save();
    go('#/');
  } else if (act === 'peek') $<HTMLDialogElement>('#peek')!.showModal();
  else if (act === 'peek-close') $<HTMLDialogElement>('#peek')!.close();
  else if (act === 'undo' && ta && undo !== null) {
    ta.value = undo;
    setAnswer(curQ()!, undo);
    t.hidden = true;
    showGuard();
  }
});

async function publish(button: HTMLButtonElement): Promise<void> {
  if (pageFlags(P).length) return;
  button.disabled = true;
  await flush();
  try {
    const res = await call('/publikuj', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: P }) });
    const out = (await res.json()) as { ok?: boolean; published_at?: string; error?: string };
    if (!res.ok || !out.ok) {
      button.disabled = false;
      return toast(out.error ?? 'Nie udało się opublikować. Spróbuj jeszcze raz.');
    }
    pub = clone(P);
    publishedAt = out.published_at!;
    render();
    toast('Opublikowane. Pacjenci widzą już nową wersję.');
  } catch {
    button.disabled = false;
    toast('Nie udało się opublikować — sprawdź połączenie.');
  }
}

window.addEventListener('hashchange', () => {
  $('#toast')!.hidden = true;
  render();
  scrollTo(0, 0);
  const h = $('#app h1');
  if (h) {
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
  }
});
// Niezapisany szkic nie ginie przy zamknięciu karty: ostatni zapis idzie jako keepalive.
window.addEventListener('pagehide', () => {
  clearTimeout(saveTimer);
  void fetch(`${boot.api}/szkic`, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf': boot.csrf }, body: JSON.stringify({ draft: P }) });
});

render();
