/**
 * The therapist's pages on the x402-landings engine.
 *
 * One engine renders her profile and every subpage (a landing, a group, a
 * workshop, a camp). The engine brings the text blocks, the themes and the
 * templates; this module brings what the engine cannot know - the blocks that
 * read her data (`host-blocks.ts`), the old profile JSON translated on the
 * way in, and the two documents the pages are served as.
 *
 * Render is per request, from the database: her open slots change by the
 * minute, so nothing here is cached as HTML. `resolvePage` is the async
 * pre-pass that hands host data to the blocks; the render itself is sync.
 */
import {
  applyPreset,
  blockAllFields,
  BLOCKS,
  DOCUMENT_CSS,
  LAYOUT_AXES as LP_LAYOUT_AXES,
  layoutClasses as lpLayoutClasses,
  MAX_BLOCKS,
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
import { HOST_SECTIONS, type SectionCtx } from './host-blocks';
import { APP_CSS } from './styles';

export { applyPreset, blockAllFields, BLOCKS, LP_LAYOUT_AXES, lpParseLayout, MAX_BLOCKS, parseBlocks, PRESETS, slugify };
export type { SectionCtx };

// ------------------------------------------------------------ host blocks ---

/** Ids the profile's own buttons point at: the calendar and the first meeting. */
const HOST_ANCHORS: Record<string, string> = { slots: 'terminy', zestawienie: 'pierwsze' };

registerBlocks(
  Object.fromEntries(
    Object.entries(HOST_SECTIONS).map(([type, def]): [string, BlockDef] => [
      type,
      {
        label: def.label,
        hint: def.hint,
        tone: def.tone,
        repeatable: def.repeatable,
        family: def.family,
        fields: def.fields,
        anchor: HOST_ANCHORS[type],
        // Her data goes in, finished HTML comes out. The parser never lets an
        // `html` field through from outside, so only this can set it.
        resolve: async (block, host) => {
          const html = def.render(block, host as SectionCtx);
          // The old renderer wrapped her heading in the frame its styles expect.
          const variant = type === 'hero-profil' ? 'klasyczny' : type.replace(/^hero-/, '');
          return { ...block, html: def.family === 'hero' && html !== '' ? `<div class="phero phero--${variant}">${html}</div>` : html };
        },
        render: (block: Block) => (typeof block.html === 'string' ? block.html : ''),
      },
    ]),
  ),
);

export const HOST_TYPES: string[] = Object.keys(HOST_SECTIONS);

// ------------------------------------------------------- the old profile ---

/**
 * The profile JSON written by the previous engine, translated on read. Types
 * and fields were Polish there and are the engine's here; what the engine has
 * no block for stays a host block (her service, her articles, text beside her
 * portrait). Nothing is migrated in the database: a profile converts every
 * time it is read and is stored in the new shape the next time she saves.
 *
 * ponytail: delete this once `SELECT count(*) FROM therapists WHERE
 * sections_json LIKE '%"tekst"%' OR ... ` is zero on production.
 */
const LEGACY_TYPE: Record<string, string> = {
  hero: 'hero-profil',
  faq: 'faq-profil',
  tekst: 'text',
  'tekst-wyrozniony': 'text',
  cytat: 'quote',
  filary: 'features',
  kroki: 'steps',
  fakty: 'stats',
  wyroznienie: 'cta',
};
const LEGACY_TONE: Record<string, string> = { zwykle: 'plain', panel: 'alt', ciemne: 'dark', waskie: 'narrow' };
const LEGACY_FRAME: Record<string, string> = { karta: 'card', pas: 'stripe' };
const LEGACY_SCALE: Record<string, string> = { duza: 'large', plakat: 'poster' };
const LEGACY_LAYOUT: Record<string, Record<string, string>> = {
  theme: { '': 'sage', bursztyn: 'amber', glina: 'clay', grafit: 'graphite', las: 'forest', papier: 'paper', atrament: 'ink' },
  rhythm: { zwarty: 'tight', dostojny: 'roomy' },
  display: LEGACY_SCALE,
  bands: { panele: 'panels', pasy: 'stripes' },
  hero: { karta: 'card', goly: 'bare' },
  nav: { kotwice: 'anchors' },
};

function legacyBlock(raw: Record<string, unknown>): Record<string, unknown> {
  const oldType = typeof raw.type === 'string' ? raw.type : '';
  const out: Record<string, unknown> = { ...raw, type: LEGACY_TYPE[oldType] ?? oldType };
  if (oldType === 'tekst-wyrozniony' && typeof raw.tlo !== 'string') out.tone = 'alt';
  if (typeof raw.tlo === 'string') out.tone = LEGACY_TONE[raw.tlo] ?? '';
  if (typeof raw.kadr === 'string') out.frame = LEGACY_FRAME[raw.kadr] ?? '';
  if (typeof raw.skala === 'string') out.scale = LEGACY_SCALE[raw.skala] ?? '';
  if (typeof raw.cta_label === 'string' && typeof raw.cta_href === 'string' && oldType in LEGACY_TYPE) {
    out.buttons = [{ label: raw.cta_label, href: raw.cta_href, style: 'primary' }];
  }
  if (Array.isArray(raw.items)) {
    out.items = raw.items.map((item) => {
      const src = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      return typeof src.desc === 'string' && src.body === undefined ? { ...src, body: src.desc } : src;
    });
  }
  return out;
}

const DEFAULT_PROFILE = [
  'hero-profil', 'kluczowe', 'intro', 'dane', 'zestawienie', 'topics', 'offers', 'slots', 'faq-profil',
  'credentials', 'zaproszenie',
];

/** Her arrangement in the engine's shape, or the default spine; always with a heading. */
export function profileBlocks(raw: unknown): Block[] {
  let parsed: unknown = raw;
  if (typeof raw === 'string' || raw === null || raw === undefined) {
    try {
      parsed = JSON.parse((raw as string) || '[]');
    } catch {
      parsed = [];
    }
  }
  const list = Array.isArray(parsed) ? parsed : [];
  const blocks = parseBlocks(
    list.map((entry) => legacyBlock((typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>)),
  );
  if (blocks.length === 0) return DEFAULT_PROFILE.map((type) => ({ type }));
  return blocks.some((b) => BLOCKS[b.type]?.family === 'hero') ? blocks : [{ type: 'hero-profil' }, ...blocks];
}

/** Her layout in the engine's axes, whether stored by the old engine or this one. */
export function profileLayout(raw: unknown): Record<string, string> {
  let parsed: unknown = raw;
  if (typeof raw === 'string' || raw === null || raw === undefined) {
    try {
      parsed = JSON.parse((raw as string) || '{}');
    } catch {
      parsed = {};
    }
  }
  const src = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [axis, value] of Object.entries(src)) {
    out[axis] = typeof value === 'string' ? (LEGACY_LAYOUT[axis]?.[value] ?? value) : value;
  }
  return lpParseLayout(out);
}

/** A template for the profile: the engine's look, the profile's own spine. */
export function applyProfilePreset(id: string): { layout: Record<string, string>; blocks: Block[] } {
  const { layout } = applyPreset(id);
  const hero = layout.display === 'poster' ? 'hero-plakat' : 'hero-profil';
  return { layout, blocks: DEFAULT_PROFILE.map((type) => ({ type: type === 'hero-profil' ? hero : type })) };
}

// ---------------------------------------------------------------- render ---

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

async function renderLp(title: string, blocks: Block[], layout: Record<string, string>, host: SectionCtx): Promise<string> {
  const page = parsePage({ meta: { title }, layout, blocks });
  // Her buttons link to the calendar and the first meeting only when those are on the page.
  const anchors = new Set(page.blocks.map((b) => HOST_ANCHORS[b.type]).filter((a): a is string => a !== undefined));
  return renderBlocks(await resolvePage(page, { ...host, anchors }));
}

/** The profile, inside the catalogue: the engine's page in the catalogue's frame. */
export async function renderProfile(t: PublicTherapist, host: SectionCtx): Promise<string> {
  const layout = profileLayout(t.layout);
  return `<div class="${lpLayoutClasses(layout)}">${await renderLp(t.display_name, profileBlocks(t.sections), layout, host)}</div>`;
}

/**
 * A subpage is its own document, not a section of the catalogue: full
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
 * the class names `host-blocks.ts` renders. Loading the whole of `app.css`
 * into the subpage document was measured to break the engine, and the engine
 * now prefixes its own classes so the catalogue cannot hit them - but the
 * catalogue's element rules (h2 margins, p widths, main padding) would still
 * fight the engine's, so the standalone document takes only these.
 */
const SECTION_CLASSES = [
  'amount', 'badge', 'badges', 'block-lead', 'chips', 'details-body', 'lang', 'meeting-steps',
  'offer-card', 'offer-grid', 'offer-meta', 'offer-name', 'offer-price', 'offer-rows', 'pcard', 'pcards',
  'pdata', 'per', 'pfact', 'pfact-cta', 'pfacts', 'pfacts-strip', 'phero', 'pillars', 'plinks', 'pquote',
  'pservice', 'pservice-facts', 'pservice-points', 'psplit', 'psplit-empty', 'psplit-photo', 'read-more',
  'slot-chips', 'slot-foot', 'slot-mode', 'slot-none', 'slot-table', 'slot-table-scroll', 'slot-time',
  'visually-hidden',
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

/** The engine's stylesheet for pages inside the catalogue (`app.css` is there too). */
export const LP_CSS = PAGE_CSS;
/** Everything a subpage document needs, in one file. */
export const LP_DOC_CSS = DOCUMENT_CSS + PAGE_CSS + keepSectionRules(APP_CSS) + BAR_CSS;

export async function renderTherapistDocument(
  row: PageRow,
  host: SectionCtx,
  t: PublicTherapist,
  pages: PageRow[],
  assets: { lpDocCss: string },
): Promise<string> {
  const links = pages
    .filter((p) => p.id !== row.id)
    .map((p) => `<a href="/terapeuci/${escapeHtml(t.slug)}/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>`)
    .join('');
  const layout = lpParseLayout(row.layout_json);
  const body = await renderLp(row.title, parseBlocks(row.blocks_json), layout, host);
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(row.title)} — ${escapeHtml(t.display_name)}</title>
<meta name="description" content="${escapeHtml(t.headline ?? row.title)}">
${row.status === 'published' ? '' : '<meta name="robots" content="noindex, nofollow">'}
<link rel="stylesheet" href="${assets.lpDocCss}">
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
<main id="main" class="${lpLayoutClasses(layout)}">
${body}
</main>
</body>
</html>`;
}

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
