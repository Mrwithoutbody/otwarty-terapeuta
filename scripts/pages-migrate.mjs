#!/usr/bin/env node
/* global fetch */
/**
 * One-time move of the therapists' pages into the pages service.
 *
 *   PAGES_URL=https://x402landings.space PAGES_API_KEY=lk_… node scripts/pages-migrate.mjs --env production
 *   node scripts/pages-migrate.mjs --local            # the local D1, the service at PAGES_URL (default localhost:8788, key "dev")
 *   node scripts/pages-migrate.mjs --selftest         # the translator alone, no database, no service
 *
 * Reads `therapists.sections_json/layout_json` and `therapist_pages` with
 * `wrangler d1 execute --json`, translates the old profile shape (Polish
 * types and fields from the engine before this one) into the service's, and
 * creates or updates one page per row: the profile under the slug `profil`,
 * every subpage under its own. Idempotent: run twice, same result. Nothing is
 * deleted here; the columns go in a later migration once production is checked.
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- legacy ---

const LEGACY_TYPE = {
  hero: 'hero-profil', 'hero-obietnica': 'hero-profil', 'hero-plakat': 'hero-profil', 'hero-spotlight': 'hero-profil', 'hero-okladka': 'hero-profil',
  kluczowe: 'dane', 'oferta-lista': 'offers', usluga: 'text', artykuly: 'features', 'zdjecie-tekst': 'media-text', 'tekst-zdjecie': 'media-text',
  faq: 'faq-profil', tekst: 'text', 'tekst-wyrozniony': 'text', cytat: 'quote', filary: 'features', kroki: 'steps', fakty: 'stats',
  wyroznienie: 'cta', first_meeting: 'zestawienie',
};
const LEGACY_TONE = { zwykle: 'plain', panel: 'alt', ciemne: 'dark', waskie: 'narrow' };
const LEGACY_FRAME = { karta: 'card', pas: 'stripe' };
const LEGACY_SCALE = { duza: 'large', plakat: 'poster' };
const LEGACY_LAYOUT = {
  theme: { '': 'sage', bursztyn: 'amber', glina: 'clay', grafit: 'graphite', las: 'forest', papier: 'paper', atrament: 'ink' },
  rhythm: { zwarty: 'tight', dostojny: 'roomy' },
  display: LEGACY_SCALE,
  bands: { panele: 'panels', pasy: 'stripes' },
  hero: { karta: 'card', goly: 'bare' },
  nav: { kotwice: 'anchors' },
};

/** One old block as the service reads it. Host types pass through unchanged. */
export function legacyBlock(raw) {
  const oldType = typeof raw.type === 'string' ? raw.type : '';
  const out = { ...raw, type: LEGACY_TYPE[oldType] ?? oldType };
  // The old poster hero carried its own words; they become overrides of the profile heading.
  if (typeof raw.nadtytul === 'string') out.eyebrow = raw.nadtytul;
  if (typeof raw.tytul === 'string') out.heading = raw.tytul;
  if (typeof raw.wstep === 'string') out.lead = raw.wstep;
  if (oldType === 'tekst-wyrozniony' && typeof raw.tlo !== 'string') out.tone = 'alt';
  if (oldType === 'zdjecie-tekst') out.flip = 'left';
  if (typeof raw.tlo === 'string') out.tone = LEGACY_TONE[raw.tlo] ?? '';
  if (typeof raw.kadr === 'string') out.frame = LEGACY_FRAME[raw.kadr] ?? '';
  if (typeof raw.skala === 'string') out.scale = LEGACY_SCALE[raw.skala] ?? '';
  if (typeof raw.cta_label === 'string' && typeof raw.cta_href === 'string' && oldType in LEGACY_TYPE) {
    out.buttons = [{ label: raw.cta_label, href: raw.cta_href, style: 'primary' }];
  }
  if (Array.isArray(raw.items)) {
    out.items = raw.items.map((item) => {
      const src = typeof item === 'object' && item !== null ? item : {};
      return typeof src.desc === 'string' && src.body === undefined ? { ...src, body: src.desc } : src;
    });
  }
  // A service block became plain text: its lists and details fold into the body.
  if (oldType === 'usluga') {
    const lines = [];
    if (typeof raw.body === 'string') lines.push(raw.body);
    if (Array.isArray(raw.cechy)) lines.push(raw.cechy.map((c) => `• ${c?.tekst ?? ''}`).filter((l) => l !== '• ').join('\n'));
    if (Array.isArray(raw.szczegoly)) lines.push(raw.szczegoly.map((d) => `**${d?.etykieta ?? ''}:** ${d?.wartosc ?? ''}`).join('\n'));
    out.body = lines.filter(Boolean).join('\n\n');
  }
  for (const k of ['nadtytul', 'tytul', 'wstep', 'tlo', 'kadr', 'skala', 'cta_label', 'cta_href', 'cechy', 'szczegoly', 'cytat', 'cytat_autor']) delete out[k];
  return out;
}

const DEFAULT_PROFILE = ['hero-profil', 'intro', 'dane', 'zestawienie', 'topics', 'offers', 'slots', 'faq-profil', 'credentials', 'zaproszenie'];

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw || '') ?? fallback;
  } catch {
    return fallback;
  }
}

export function profileBlocks(raw) {
  const parsed = parseJson(raw, []);
  const list = Array.isArray(parsed) ? parsed : [];
  const blocks = list.filter((b) => typeof b === 'object' && b !== null).map(legacyBlock);
  if (blocks.length === 0) return DEFAULT_PROFILE.map((type) => ({ type }));
  return blocks.some((b) => b.type === 'hero-profil') ? blocks : [{ type: 'hero-profil' }, ...blocks];
}

export function profileLayout(raw) {
  const parsed = parseJson(raw, {});
  const src = typeof parsed === 'object' && parsed !== null ? parsed : {};
  const out = {};
  for (const [axis, value] of Object.entries(src)) {
    if (typeof value === 'string') out[axis] = LEGACY_LAYOUT[axis]?.[value] ?? value;
  }
  return out;
}

// -------------------------------------------------------------- database ---

function d1(envFlag, sql) {
  const args = ['wrangler', 'd1', 'execute', 'DB', ...envFlag, '--json', '--command', sql];
  const run = spawnSync('npx', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`${run.stdout}\n${run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  return parsed[0]?.results ?? [];
}

// --------------------------------------------------------------- service ---

async function call(base, key, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok && res.status !== 409) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res;
}

async function upsert(base, key, existing, page) {
  const hit = existing.find((p) => p.owner === page.owner && p.slug === page.slug);
  if (hit) {
    await call(base, key, `/v1/pages/${hit.id}`, { method: 'PUT', body: JSON.stringify(page) });
    return 'updated';
  }
  const res = await call(base, key, '/v1/pages', { method: 'POST', body: JSON.stringify(page) });
  return res.status === 201 ? 'created' : `skipped (${res.status})`;
}

async function migrate(envFlag) {
  const base = (process.env.PAGES_URL ?? 'http://localhost:8788').replace(/\/$/, '');
  const key = process.env.PAGES_API_KEY ?? 'dev';
  const therapists = d1(envFlag, `SELECT id, display_name, sections_json, layout_json FROM therapists`);
  const subpages = d1(envFlag, `SELECT id, therapist_id, slug, title, status, blocks_json, layout_json FROM therapist_pages`);
  console.log(`${therapists.length} profili, ${subpages.length} podstron → ${base}`);

  // The service must know the host blocks before it will keep them on a page. The
  // host declares them itself the first time it serves a profile or opens the
  // editor, so open one profile on this environment before running this.
  const known = await (await call(base, key, '/v1/blocks')).text();
  if (!known.includes('slots')) {
    throw new Error('Usługa nie zna jeszcze bloków hosta. Otwórz dowolny profil na tym środowisku (host je zgłasza), potem uruchom ponownie.');
  }

  const tally = {};
  const count = (what) => { tally[what] = (tally[what] ?? 0) + 1; };
  for (const t of therapists) {
    const existing = await (await call(base, key, `/v1/pages?owner=${encodeURIComponent(t.id)}`)).json();
    count(await upsert(base, key, existing, {
      owner: t.id, slug: 'profil', title: t.display_name, status: 'published',
      blocks: profileBlocks(t.sections_json), layout: profileLayout(t.layout_json),
    }));
    for (const p of subpages.filter((s) => s.therapist_id === t.id)) {
      count(await upsert(base, key, existing, {
        owner: t.id, slug: p.slug, title: p.title, status: p.status,
        blocks: parseJson(p.blocks_json, []), layout: profileLayout(p.layout_json),
      }));
    }
  }
  console.log(tally);
}

// --------------------------------------------------------------- selftest ---

function selftest() {
  const blocks = profileBlocks(JSON.stringify([
    { type: 'hero-plakat', nadtytul: 'CBT', tytul: 'Konkret', wstep: 'Wstęp.' },
    { type: 'tekst', heading: 'O mnie', body: 'Akapit.', cta_label: 'Napisz', cta_href: 'mailto:a@b.pl', tlo: 'ciemne', kadr: 'pas' },
    { type: 'filary', heading: 'Trzy', items: [{ title: 'Uważność', desc: 'Opis.' }] },
    { type: 'usluga', eyebrow: 'Terapia', heading: 'Kiedy', body: 'B.', cechy: [{ tekst: 'Lęk' }], szczegoly: [{ etykieta: 'Cena', wartosc: '220 zł' }] },
    { type: 'faq' }, { type: 'first_meeting' }, { type: 'slots' },
  ]));
  assert.deepEqual(blocks.map((b) => b.type), ['hero-profil', 'text', 'features', 'text', 'faq-profil', 'zestawienie', 'slots']);
  assert.deepEqual(blocks[0], { type: 'hero-profil', eyebrow: 'CBT', heading: 'Konkret', lead: 'Wstęp.' });
  assert.equal(blocks[1].tone, 'dark');
  assert.equal(blocks[1].frame, 'stripe');
  assert.deepEqual(blocks[1].buttons, [{ label: 'Napisz', href: 'mailto:a@b.pl', style: 'primary' }]);
  assert.equal(blocks[2].items[0].body, 'Opis.');
  assert.equal(blocks[3].body, 'B.\n\n• Lęk\n\n**Cena:** 220 zł');
  assert.equal(blocks[3].cechy, undefined);
  assert.equal(profileBlocks('')[0].type, 'hero-profil');
  assert.equal(profileBlocks('nie json').at(-1).type, 'zaproszenie');
  assert.deepEqual(profileLayout('{"theme":"glina","bands":"pasy","nav":"kotwice","display":"plakat"}'), { theme: 'clay', bands: 'stripes', nav: 'anchors', display: 'poster' });
  assert.deepEqual(profileLayout('broken'), {});
  console.log('selftest ok');
}

const flag = process.argv[2];
if (flag === '--selftest') selftest();
else if (flag === '--local') await migrate(['--local']);
else if (flag === '--env' && process.argv[3]) await migrate(['--env', process.argv[3], '--remote']);
else {
  console.error('usage: pages-migrate.mjs --local | --env <preview|production> | --selftest');
  process.exit(1);
}
