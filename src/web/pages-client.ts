/**
 * The pages service (x402L at `PAGES_URL`), as this host talks to it.
 *
 * The service distributes themes and typesets pages - like a WordPress theme
 * repository, not like WordPress.com. It keeps no pages: the JSON of every page
 * (theme, block order, layout, the words she corrected) lives in this database
 * and travels to the service in every request, next to her data (`resolved`)
 * and the frame (`chrome`). This module is the only place that knows the wire
 * shape; everything else asks for a page, an editor link or HTML.
 *
 * In tests `PAGES_URL` is `memory://`: the service runs in-process, so the suite
 * exercises the real render with no network.
 */
import type { Env } from '../env';
import { randomId } from '../lib/crypto';
import { nowIso } from '../lib/time';

export interface PageInfo {
  id: string;
  owner: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  theme: string;
  /** The page as the editor last saved it; `{}` until she opens the editor. */
  page: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** One look to pick. */
export interface ThemeChoice {
  theme: string;
  label: string;
  hint: string;
}

export class PagesUnavailable extends Error {
  override name = 'PagesUnavailable';
}

/** The in-process service for tests. Lives as long as the isolate. */
let memory: Promise<{ fetch(req: Request): Promise<Response> }> | null = null;
async function memoryService(env: Env) {
  memory ??= (async () => {
    // Ścieżka w zmiennej: `tsc` hosta nie sprawdza wtedy źródeł usługi (inne flagi ścisłości).
    const entry = 'x402l/src/index';
    const { app } = (await import(/* @vite-ignore */ entry)) as { app: { fetch(req: Request, env: unknown): Promise<Response> } };
    const serviceEnv = { DB: undefined, TOKEN_SECRET: 'test', HOSTS: env.PUBLIC_BASE_URL };
    return {
      fetch: async (req: Request) => {
        // An edit session needs the service's own D1; the tests need only its address.
        if (new URL(req.url).pathname === '/v1/edit-session') return Response.json({ url: 'https://pages.test/edit/test.0.0' });
        return app.fetch(req, serviceEnv);
      },
    };
  })();
  return memory;
}

/** One call to the service. Network trouble becomes `PagesUnavailable`; an answer, any answer, is returned. */
export async function pagesFetch(env: Env, path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set('content-type', 'application/json');
  const base = env.PAGES_URL.startsWith('memory://') ? 'https://pages.test' : env.PAGES_URL.replace(/\/$/, '');
  const request = new Request(`${base}${path}`, {
    ...rest,
    headers,
    body: json === undefined ? rest.body : JSON.stringify(json),
    signal: AbortSignal.timeout(8000),
  });
  try {
    // `memory://down` is the service that never answers - the outage tests use it,
    // because a refused socket makes workerd throw once more after the catch.
    if (env.PAGES_URL === 'memory://down') throw new PagesUnavailable('pages service unreachable: down');
    if (env.PAGES_URL.startsWith('memory://')) return await (await memoryService(env)).fetch(request);
    const res = await fetch(request);
    if (res.status >= 500) throw new PagesUnavailable(`pages service answered ${res.status}`);
    return res;
  } catch (err) {
    if (err instanceof PagesUnavailable) throw err;
    throw new PagesUnavailable(`pages service unreachable: ${(err as Error).message}`);
  }
}

interface PageRow {
  id: string;
  therapist_id: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  theme: string;
  page_json: string;
  created_at: string;
  updated_at: string;
}

const fromRow = ({ page_json, therapist_id, ...r }: PageRow): PageInfo => ({ ...r, owner: therapist_id, page: JSON.parse(page_json) as Record<string, unknown> });

export async function listPages(env: Env, owner: string): Promise<PageInfo[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM therapist_pages WHERE therapist_id = ? ORDER BY created_at`).bind(owner).all<PageRow>();
  return results.map(fromRow);
}

export async function getPage(env: Env, id: string): Promise<PageInfo | null> {
  const row = await env.DB.prepare(`SELECT * FROM therapist_pages WHERE id = ?`).bind(id).first<PageRow>();
  return row ? fromRow(row) : null;
}

export async function findPage(env: Env, owner: string, slug: string): Promise<PageInfo | null> {
  const row = await env.DB.prepare(`SELECT * FROM therapist_pages WHERE therapist_id = ? AND slug = ?`).bind(owner, slug).first<PageRow>();
  return row ? fromRow(row) : null;
}

/** Every theme the service offers. */
export async function listThemeChoices(env: Env): Promise<ThemeChoice[]> {
  const res = await pagesFetch(env, '/v1/themes');
  if (!res.ok) return [];
  return ((await res.json()) as Array<{ slug: string; label: string; hint: string }>).map((t) => ({ theme: t.slug, label: t.label, hint: t.hint }));
}

export interface NewPage {
  owner: string;
  title: string;
  slug?: string;
  /** The look; omitted means the service's default theme. */
  theme?: string;
  status?: 'draft' | 'published';
}

export function slugOf(title: string): string {
  return title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'strona';
}

export async function createPage(env: Env, input: NewPage): Promise<PageInfo | 'slug_taken'> {
  const id = randomId('pg'), now = nowIso(), slug = input.slug ?? slugOf(input.title);
  try {
    await env.DB.prepare(
      `INSERT INTO therapist_pages (id, therapist_id, slug, title, status, theme, page_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    ).bind(id, input.owner, slug, input.title, input.status ?? 'published', input.theme ?? '', now, now).run();
  } catch (err) {
    if (/UNIQUE/.test((err as Error).message)) return 'slug_taken';
    throw err;
  }
  return (await getPage(env, id))!;
}

/** The editor's page, back from the service: theme, order, layout and only the fields she changed. */
export async function savePageJson(env: Env, owner: string, id: string, page: Record<string, unknown>): Promise<boolean> {
  const theme = typeof page.theme === 'string' ? page.theme : '';
  const title = typeof page.title === 'string' && page.title.trim() ? page.title.trim().slice(0, 140) : null;
  const res = await env.DB.prepare(
    `UPDATE therapist_pages SET page_json = ?, theme = ?, title = COALESCE(?, title), updated_at = ? WHERE id = ? AND therapist_id = ?`,
  ).bind(JSON.stringify(page), theme, title, nowIso(), id, owner).run();
  return (res.meta.changes ?? 0) > 0;
}

/** The trade of this catalogue: which photographs fill a slot the therapist left empty. */
const INDUSTRY = 'psychotherapy';

export interface RenderRequest {
  owner: string;
  slug: string;
  resolved: Record<string, unknown>;
  chrome: Record<string, unknown>;
}

/** The page with her data in it, or null when she has no such page. */
export async function renderPage(env: Env, input: RenderRequest): Promise<string | null> {
  const row = await findPage(env, input.owner, input.slug);
  if (!row) return null;
  const res = await pagesFetch(env, '/v1/render/page', {
    method: 'POST',
    json: { ...input, title: row.title, theme: row.theme, page: row.page, industry: INDUSTRY },
  });
  if (!res.ok) throw new PagesUnavailable(`render: ${res.status}`);
  return res.text();
}

export interface EditSessionInput {
  resolved: Record<string, unknown>;
  chrome: Record<string, unknown>;
  /** Gdzie usługa odeśle stronę po zapisie, i czym się przy tym wylegitymuje. */
  write: { url: string; token: string };
}

/** A link into the hosted editor, good for an hour. */
export async function editSession(env: Env, page: PageInfo, input: EditSessionInput): Promise<string> {
  const res = await pagesFetch(env, '/v1/edit-session', {
    method: 'POST',
    json: { ...input, title: page.title, theme: page.theme, page: page.page, industry: INDUSTRY },
  });
  if (!res.ok) throw new PagesUnavailable(`edit session: ${res.status}`);
  return ((await res.json()) as { url: string }).url;
}

/** The service's origin, for the CSP of pages that link its stylesheet. */
export function pagesOrigin(env: Env): string | null {
  if (env.PAGES_URL.startsWith('memory://')) return 'https://pages.test';
  try {
    return new URL(env.PAGES_URL).origin;
  } catch {
    return null;
  }
}
