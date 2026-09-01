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
  blockAllFields,
  BLOCKS,
  LAYOUT_AXES as LP_LAYOUT_AXES,
  layoutClasses as lpLayoutClasses,
  PAGE_CSS,
  parseBlocks,
  parseLayout as lpParseLayout,
  parsePage,
  registerBlocks,
  renderBlocks,
  resolvePage,
  slugify,
  type Block,
  type BlockDef,
} from 'x402-landings';
import type { Env } from '../env';
import { SECTIONS_DEF, type SectionCtx } from './sections';

export { blockAllFields, BLOCKS, LP_LAYOUT_AXES, lpParseLayout, PAGE_CSS, parseBlocks, slugify };

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

/** Podstrona w chromie serwisu: sam fragment, arkusz silnika ładuje layout. */
export async function renderTherapistPage(row: PageRow, host: SectionCtx): Promise<string> {
  const page = await resolvePage(
    parsePage({ meta: { title: row.title }, layout: row.layout_json, blocks: row.blocks_json }),
    host,
  );
  return `<div class="${lpLayoutClasses(row.layout_json)}">${renderBlocks(page)}</div>`;
}
