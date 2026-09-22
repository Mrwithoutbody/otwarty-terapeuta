/**
 * Zakładka „Dane i cennik”: fakty profilu jako zwykły formularz.
 *
 * Słowa terapeutka pisze w narzędziu strony (`apps/panel/authored`). Tu zostaje to, co
 * jest faktem, a nie opowieścią: imię, cennik, gabinet, obszary, języki, dyplomy.
 * Formularz powstaje z tabeli `FIELDS` i zapisuje przez `writeProfileData`
 * (`profile-write.ts`) - nowe pole w `data-fields.ts` pojawia się tu samo.
 */
import type { Env } from '../../../shared/env';
import type { PublicTherapist } from '../../../shared/db/types';
import { escapeHtml } from '../../../shared/lib/sanitize';
import { FIELDS, OFFER_ROWS, OFFER_TYPES, type Dictionaries, type Field } from './data-fields';

/** Obszary i nurty z bazy: opcje pól wyboru w formularzu. */
export async function dictionaries(env: Env): Promise<Dictionaries> {
  const [topics, modalities] = await Promise.all([
    env.DB.prepare(`SELECT slug, name_pl FROM specialties ORDER BY category, name_pl`).all<{ slug: string; name_pl: string }>(),
    env.DB.prepare(`SELECT slug, name_pl FROM modalities ORDER BY name_pl`).all<{ slug: string; name_pl: string }>(),
  ]);
  const pairs = (rows: Array<{ slug: string; name_pl: string }>): Array<[string, string]> => rows.map((r) => [r.slug, r.name_pl]);
  return { topics: pairs(topics.results), modalities: pairs(modalities.results) };
}

type Values = Record<string, unknown>;

/** Grupy formularza: blok z `FIELDS` i pola, które pokazujemy. Opisu, nagłówka i zdjęcia tu nie ma - należą do strony. */
const GROUPS: Array<{ block: string; title: string; hint?: string; only?: string[] }> = [
  { block: 'name', title: 'Imię i nazwisko' },
  { block: 'practice', title: 'Jak pracujesz', only: ['offers_online', 'offers_in_person', 'accepting_new_clients', 'session_types', 'age_groups', 'languages'] },
  { block: 'office', title: 'Gabinet', hint: 'Adres widzi pacjent na Twojej stronie. Puste miasto = pracujesz tylko online.' },
  { block: 'topics', title: 'Obszary pracy i nurt', hint: 'Po tym pacjenci i asystent ChatGPT trafiają na Twój profil.' },
  { block: 'practice', title: 'Odwoływanie wizyt', only: ['cancellation_cutoff_h', 'cancellation_policy'] },
  { block: 'credentials', title: 'Dyplomy i certyfikaty', hint: 'Na stronie pokazujemy je z dopiskiem, czy dokument został już potwierdzony przez serwis.' },
];

const OFFER_FIELDS: Field[] = [
  { kind: 'hidden', name: 'id', label: '' },
  { kind: 'text', name: 'title', label: 'Nazwa', max: 120 },
  { kind: 'select', name: 'type', label: 'Typ', options: OFFER_TYPES },
  { kind: 'text', name: 'price', label: 'Cena (zł)', max: 10 },
  { kind: 'text', name: 'minutes', label: 'Czas (min)', max: 4 },
  { kind: 'select', name: 'mode', label: 'Forma', options: [['online', 'online'], ['in_person', 'w gabinecie']] },
];

const fieldsOf = (group: (typeof GROUPS)[number], dict: Dictionaries): Array<{ field: Field; read: (t: PublicTherapist) => unknown }> =>
  (FIELDS[group.block] ?? [])
    .filter((f) => !group.only || group.only.includes(f.field.name))
    .map((f) => ({ field: f.optionsFrom ? { ...f.field, options: dict[f.optionsFrom] } : f.field, read: (t) => f.read(t) }));

function control(name: string, field: Field, value: unknown): string {
  const id = escapeHtml(name.replace(/[^a-z0-9_]+/gi, '-'));
  const hint = field.hint ? `<small class="hint">${escapeHtml(field.hint)}</small>` : '';
  if (field.kind === 'hidden') return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(String(value ?? ''))}">`;
  if (field.kind === 'select') {
    return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label><select id="${id}" name="${escapeHtml(name)}">${(field.options ?? [])
      .map(([v, l]) => `<option value="${escapeHtml(v)}"${String(value ?? '') === v ? ' selected' : ''}>${escapeHtml(l)}</option>`)
      .join('')}</select>${hint}</div>`;
  }
  if (field.kind === 'multiselect') {
    const picked = new Set(Array.isArray(value) ? value.map(String) : []);
    return `<fieldset class="field checks"><legend>${escapeHtml(field.label)}</legend>${(field.options ?? [])
      .map(([v, l]) => `<label class="check"><input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(v)}"${picked.has(v) ? ' checked' : ''}> ${escapeHtml(l)}</label>`)
      .join('')}${hint}</fieldset>`;
  }
  if (field.kind === 'textarea') {
    return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label><textarea id="${id}" name="${escapeHtml(name)}" rows="3" maxlength="${field.max ?? 500}">${escapeHtml(String(value ?? ''))}</textarea>${hint}</div>`;
  }
  return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label><input id="${id}" name="${escapeHtml(name)}" maxlength="${field.max ?? 200}" value="${escapeHtml(String(value ?? ''))}">${hint}</div>`;
}

/** Wiersze listy: to, co jest, plus dwa puste na dopisanie. Wyczyszczona nazwa usuwa wpis przy zapisie. */
function listRows(prefix: string, of: Field[], rows: Values[], max: number, item: string): string {
  const shown = [...rows, {}, {}].slice(0, max);
  return shown
    .map(
      (row, i) =>
        `<fieldset class="form-row list-row"><legend class="sr">${escapeHtml(item)} ${i + 1}</legend>${of.map((f) => control(`${prefix}.${i}.${f.name}`, f, (row as Values)[f.name])).join('')}</fieldset>`,
    )
    .join('');
}

export function factsForm(t: PublicTherapist, dict: Dictionaries, csrf: string, saved: boolean): string {
  const offers = t.offers.map((o) => ({ id: o.offer_id, title: o.title, type: o.session_type, price: String(o.price_minor / 100), minutes: String(o.duration_minutes), mode: o.mode }));
  return `<h2>Dane i cennik</h2>
<p class="panel-lead">Fakty o Twojej praktyce. Pokazujemy je na stronie, w katalogu i w asystencie ChatGPT zawsze takie, jak tutaj —
zmiana ceny działa od razu, bez publikowania strony. Słowa piszesz osobno, w <a href="/admin/terapeuci/${escapeHtml(t.therapist_id)}/strona">swojej stronie</a>.</p>
${saved ? '<p class="notice" role="status">Zapisane.</p>' : ''}
<form method="post" action="/admin/terapeuci/${escapeHtml(t.therapist_id)}/dane" class="stack">
${csrf}
<section class="form-section" id="panel-cennik"><h3>Cennik</h3>
<p class="hint">Każda pozycja to rodzaj sesji, który można zarezerwować. Wyczyszczona nazwa usuwa pozycję z profilu; jej terminy zostają w kalendarzu.</p>
${listRows('offers.offer_rows', OFFER_FIELDS, offers, OFFER_ROWS, 'Sesja')}</section>
${GROUPS.map((group) => {
  const fields = fieldsOf(group, dict);
  return `<section class="form-section"><h3>${escapeHtml(group.title)}</h3>${group.hint ? `<p class="hint">${escapeHtml(group.hint)}</p>` : ''}
${fields
  .map(({ field, read }) =>
    field.kind === 'list'
      ? listRows(`${group.block}.${field.name}`, field.of ?? [], read(t) as Values[], field.max ?? 6, field.item ?? 'Pozycja')
      : control(`${group.block}.${field.name}`, field, read(t)),
  )
  .join('')}</section>`;
}).join('')}
<p><button class="btn" type="submit">Zapisz dane</button></p>
</form>`;
}

/**
 * Formularz → kształt, który przyjmuje `writeProfileData`. Pole wyboru wielokrotnego bez zaznaczeń
 * nie wysyła niczego, więc każde pole formularza dostaje wartość - inaczej nie dałoby się odznaczyć ostatniego.
 */
export function factsFromForm(body: URLSearchParams, dict: Dictionaries): Record<string, Values> {
  const data: Record<string, Values> = {};
  const list = (prefix: string, of: Field[], max: number): Values[] =>
    Array.from({ length: max }, (_, i) => Object.fromEntries(of.map((f) => [f.name, body.get(`${prefix}.${i}.${f.name}`) ?? ''])));
  for (const group of GROUPS) {
    const block = (data[group.block] ??= {});
    for (const { field } of fieldsOf(group, dict)) {
      const name = `${group.block}.${field.name}`;
      block[field.name] = field.kind === 'multiselect' ? body.getAll(name) : field.kind === 'list' ? list(name, field.of ?? [], field.max ?? 6) : (body.get(name) ?? '');
    }
  }
  data.offers = { offer_rows: list('offers.offer_rows', OFFER_FIELDS, OFFER_ROWS).filter((row) => String(row.title).trim() !== '' || String(row.id) !== '') };
  return data;
}
