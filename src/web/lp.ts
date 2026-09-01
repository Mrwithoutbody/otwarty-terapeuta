/**
 * Podstrony terapeutki na silniku x402-landings.
 *
 * Profil zostaje na własnym silniku sekcji; podstrona (landing pod kampanię,
 * terapia grupowa, warsztat, camp) to bloki x402 plus bloki hosta, które czytają
 * bazę: kalendarz, oferta, FAQ, kwalifikacje. Blok hosta opakowuje istniejący
 * renderer z `sections.ts`, więc kalendarz na podstronie jest tym samym
 * kalendarzem co na profilu - jedna tabela dni, jedne zasady odwołania.
 *
 * Render jest przy żądaniu, z bazy: sloty zmieniają się co minutę, więc cache
 * HTML nie ma tu sensu. `resolvePage` to asynchroniczny pre-pass z danymi hosta,
 * sam render jest synchroniczny.
 */
import {
  applyPreset,
  blockAllFields,
  BLOCKS,
  DOCUMENT_CSS,
  LAYOUT_AXES as LP_LAYOUT_AXES,
  layoutClasses as lpLayoutClasses,
  PAGE_CSS,
  parseBlocks,
  parseLayout as lpParseLayout,
  parsePage,
  PRESETS,
  registerBlocks,
  renderBlocks,
  resolvePage,
  slugify,
  type Block,
  type BlockDef,
} from 'x402-landings';
import type { Env } from '../env';
import type { PublicTherapist } from '../db/types';
import { escapeHtml } from '../lib/sanitize';
import { SECTIONS_DEF, type SectionCtx } from './sections';
import { APP_CSS } from './styles';

export { applyPreset, blockAllFields, BLOCKS, LP_LAYOUT_AXES, lpParseLayout, parseBlocks, PRESETS, slugify };

/**
 * The subpage is its own document, not a section of the catalogue: full
 * viewport, the engine's stripes edge to edge, no catalogue header or footer.
 * What ties it back is one slim bar with her name and her other pages.
 */
const BAR_CSS = `
.lp-bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:.25rem 1.25rem;align-items:center;
  padding:.65rem clamp(1rem,4vw,2.5rem);font:500 .9rem/1.2 Inter,ui-sans-serif,system-ui,sans-serif;
  background:rgba(255,255,255,.88);color:#222;backdrop-filter:blur(8px);border-bottom:1px solid rgba(0,0,0,.08)}
.lp-bar a{color:inherit;text-decoration:none;padding:.3rem .2rem}
.lp-bar a:hover{text-decoration:underline}
.lp-bar a[aria-current]{font-weight:700}
.lp-bar .lp-bar-name{font-weight:700;margin-right:auto}
main.lp{padding-block:0}
`;

/**
 * Only the catalogue rules the host blocks need, pulled out of `app.css` by
 * the class names `sections.ts` renders. Loading the whole of `app.css` into
 * the subpage document was measured to break the engine: its `.hero` painted a
 * light card under a dark poster, `.steps li` bleached the step cards, and
 * `.kicker` turned a label into a pill. Selectors are filtered one comma-part
 * at a time, so a shared rule keeps only the part that belongs to a section.
 */
const SECTION_CLASSES = [
  'amount', 'badge', 'badges', 'block-lead', 'chips', 'details-body', 'lang', 'meeting-steps',
  'offer-card', 'offer-grid', 'offer-meta', 'offer-name', 'offer-price', 'offer-rows', 'pcard', 'pcards',
  'pdata', 'per', 'pfact', 'pfact-cta', 'pfacts', 'pfacts-strip', 'pillars', 'plinks', 'pquote', 'pservice',
  'pservice-facts', 'pservice-points', 'psplit', 'psplit-empty', 'psplit-photo', 'read-more', 'slot-chips',
  'slot-foot', 'slot-mode', 'slot-none', 'slot-table', 'slot-table-scroll', 'slot-time', 'visually-hidden',
];
const SECTION_CLASS = new RegExp(`\\.(${SECTION_CLASSES.join('|')})(?![\\w-])`);

/** Top-level rules of a stylesheet, nested blocks kept whole. */
function splitRules(css: string): Array<{ head: string; body: string }> {
  const out: Array<{ head: string; body: string }> = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        out.push({ head: css.slice(start, open).trim(), body: css.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return out;
}

/** Comma-separated selectors, commas inside `:is(...)` and friends left alone. */
function splitSelectors(head: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(head.slice(start, i));
      start = i + 1;
    }
  }
  out.push(head.slice(start));
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

function keepSectionRules(css: string): string {
  return splitRules(css.replace(/\/\*[\s\S]*?\*\//g, ''))
    .map(({ head, body }) => {
      if (head.startsWith('@font-face')) return `${head}{${body}}`;
      if (head.startsWith('@media') || head.startsWith('@supports')) {
        const inner = keepSectionRules(body);
        return inner === '' ? '' : `${head}{${inner}}`;
      }
      if (head.startsWith('@')) return '';
      const parts = splitSelectors(head).filter((x) => SECTION_CLASS.test(x));
      return parts.length === 0 ? '' : `${parts.join(',')}{${body}}`;
    })
    .filter((x) => x !== '')
    .join('\n');
}

export const HOST_CSS = keepSectionRules(APP_CSS);
export const LP_DOC_CSS = DOCUMENT_CSS + PAGE_CSS + HOST_CSS + BAR_CSS;

export interface PageRow {
  id: string;
  therapist_id: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  blocks_json: string;
  layout_json: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * Blok hosta → sekcja profilu, której renderer i dane bierze. Nazwy bloków są
 * osobne od nazw sekcji tylko tam, gdzie kolidują z rdzeniem x402 (`faq`).
 */
export const HOST_BLOCKS: Record<string, string> = {
  intro: 'intro',
  topics: 'topics',
  offers: 'offers',
  'oferta-lista': 'oferta-lista',
  slots: 'slots',
  dane: 'dane',
  'faq-profil': 'faq',
  credentials: 'credentials',
  zaproszenie: 'zaproszenie',
};

function hostBlock(section: string): BlockDef {
  const def = SECTIONS_DEF[section];
  if (!def) throw new Error(`Brak sekcji profilu: ${section}`);
  return {
    label: def.label,
    hint: def.hint,
    tone: def.tone,
    repeatable: def.repeatable,
    family: def.family,
    fields: def.fields,
    // Renderer profilu dostaje kontekst hosta i zwraca gotowy HTML; parser
    // nigdy nie przepuści pola `html` z zewnątrz, więc trafia tu tylko to.
    resolve: async (block, host) => ({ ...block, html: def.render(block, host as SectionCtx) }),
    render: (block: Block) => (typeof block.html === 'string' ? block.html : ''),
  };
}

registerBlocks(Object.fromEntries(Object.entries(HOST_BLOCKS).map(([type, section]) => [type, hostBlock(section)])));

// ------------------------------------------------------------------ baza ---

export async function listPages(env: Env, therapistId: string, publishedOnly: boolean): Promise<PageRow[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM therapist_pages WHERE therapist_id = ?${publishedOnly ? ` AND status = 'published'` : ''}
     ORDER BY position, created_at`,
  )
    .bind(therapistId)
    .all<PageRow>();
  return rows.results;
}

export async function getPage(env: Env, therapistId: string, slug: string): Promise<PageRow | null> {
  return env.DB.prepare(`SELECT * FROM therapist_pages WHERE therapist_id = ? AND slug = ?`)
    .bind(therapistId, slug)
    .first<PageRow>();
}

export async function getPageById(env: Env, therapistId: string, id: string): Promise<PageRow | null> {
  return env.DB.prepare(`SELECT * FROM therapist_pages WHERE therapist_id = ? AND id = ?`)
    .bind(therapistId, id)
    .first<PageRow>();
}

// ---------------------------------------------------------------- render ---

/** Podstrona jako samodzielny dokument: belka powrotu + strona silnika na całą szerokość. */
export async function renderTherapistDocument(
  row: PageRow,
  host: SectionCtx,
  t: PublicTherapist,
  pages: PageRow[],
  assets: { lpCss: string },
): Promise<string> {
  const page = await resolvePage(
    parsePage({ meta: { title: row.title }, layout: row.layout_json, blocks: row.blocks_json }),
    host,
  );
  const links = pages
    .filter((p) => p.id !== row.id)
    .map((p) => `<a href="/terapeuci/${escapeHtml(t.slug)}/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>`)
    .join('');
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(row.title)} — ${escapeHtml(t.display_name)}</title>
<meta name="description" content="${escapeHtml(t.headline ?? row.title)}">
${row.status === 'published' ? '' : '<meta name="robots" content="noindex, nofollow">'}
<link rel="stylesheet" href="${assets.lpCss}">
<link rel="icon" href="data:,">
</head>
<body>
<a class="skip" href="#main">Przejdź do treści</a>
<nav class="lp-bar" aria-label="Strony terapeuty">
  <a class="lp-bar-name" href="/terapeuci/${escapeHtml(t.slug)}">← ${escapeHtml(t.display_name)}</a>
  <a href="/terapeuci/${escapeHtml(t.slug)}">Profil</a>
  <a href="/terapeuci/${escapeHtml(t.slug)}/${escapeHtml(row.slug)}" aria-current="page">${escapeHtml(row.title)}</a>
  ${links}
</nav>
<main id="main" class="${lpLayoutClasses(row.layout_json)}">
${renderBlocks(page)}
</main>
</body>
</html>`;
}
