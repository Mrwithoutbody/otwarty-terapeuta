/**
 * The pages service, as this host talks to it.
 *
 * Pages, templates, the editor and the render all live at `PAGES_URL`
 * (x402landings.space). This module is the only place that knows the wire
 * shape; everything else asks for a page, an editor link or HTML.
 *
 * In tests `PAGES_URL` is `memory://`: the same service runs in-process on an
 * in-memory store, so the suite exercises the real contract with no network.
 */
import type { Env } from '../env';
import { HOST_BLOCK_DEFS } from './host-blocks';

export interface PageInfo {
  id: string;
  owner: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  theme: string;
  variant: string;
  blocks: Array<Record<string, unknown> & { type: string }>;
  version: number;
  created_at: string;
  updated_at: string;
}

/** One look to pick: a theme and one of its palettes. */
export interface ThemeChoice {
  theme: string;
  variant: string;
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
    const { app, memoryStore, sha256 } = await import('x402-landings/service');
    const serviceEnv = {
      STORE: memoryStore([{ id: 'ot-02', name: 'ot-02', origin: env.PUBLIC_BASE_URL, keyHash: await sha256(apiKey(env)) }]),
      TOKEN_SECRET: 'test',
      PUBLIC_URL: 'https://pages.test',
    };
    return { fetch: async (req: Request) => app.fetch(req, serviceEnv) };
  })();
  return memory;
}

const apiKey = (env: Env): string => env.PAGES_API_KEY ?? 'dev';

/** One call to the service. Network trouble becomes `PagesUnavailable`; an answer, any answer, is returned. */
export async function pagesFetch(env: Env, path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('authorization', `Bearer ${apiKey(env)}`);
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

export async function listPages(env: Env, owner: string): Promise<PageInfo[]> {
  const res = await pagesFetch(env, `/v1/pages?owner=${encodeURIComponent(owner)}`);
  return res.ok ? ((await res.json()) as PageInfo[]) : [];
}

/** Every theme the service offers this site, one entry per palette. */
export async function listThemeChoices(env: Env): Promise<ThemeChoice[]> {
  const res = await pagesFetch(env, '/v1/themes');
  if (!res.ok) return [];
  const themes = (await res.json()) as Array<{ slug: string; label: string; hint: string; variants: Record<string, { label: string; hint?: string }> }>;
  return themes.flatMap((t) => {
    const variants = Object.entries(t.variants ?? {});
    if (variants.length === 0) return [{ theme: t.slug, variant: '', label: t.label, hint: t.hint }];
    return variants.map(([variant, v]) => ({
      theme: t.slug, variant, label: variants.length > 1 ? `${t.label} — ${v.label}` : t.label, hint: v.hint ?? t.hint,
    }));
  });
}

export interface NewPage {
  owner: string;
  title: string;
  slug?: string;
  /** The look; omitted means the service's default theme and its first palette. */
  theme?: string;
  variant?: string;
  status?: 'draft' | 'published';
  blocks?: Array<{ type: string }>;
}

export async function createPage(env: Env, input: NewPage): Promise<PageInfo | 'slug_taken'> {
  // The service must know her blocks before it can keep them on a page.
  await syncBlocks(env);
  const res = await pagesFetch(env, '/v1/pages', { method: 'POST', json: input });
  if (res.status === 409) return 'slug_taken';
  if (!res.ok) throw new PagesUnavailable(`create page: ${res.status}`);
  return (await res.json()) as PageInfo;
}

export async function getPage(env: Env, id: string): Promise<PageInfo | null> {
  const res = await pagesFetch(env, `/v1/pages/${encodeURIComponent(id)}`);
  return res.ok ? ((await res.json()) as PageInfo) : null;
}

/** Her blocks as the service should know them. Idempotent; called before an editor opens. */
export async function syncBlocks(env: Env): Promise<void> {
  await pagesFetch(env, '/v1/site/blocks', { method: 'PUT', json: { blocks: HOST_BLOCK_DEFS } });
}

/** The trade of this catalogue: which photographs fill a slot the therapist left empty. */
const INDUSTRY = 'psychotherapy';

export interface RenderRequest {
  owner: string;
  slug: string;
  resolved: Record<string, unknown>;
  chrome: Record<string, unknown>;
}

export interface Rendered {
  html: string;
  status: 'draft' | 'published';
  id: string;
}

/** The page with her data in it, or null when she has no such page. */
export async function renderPage(env: Env, input: RenderRequest): Promise<Rendered | null> {
  const res = await pagesFetch(env, '/v1/render/page', { method: 'POST', json: { ...input, document: true, industry: INDUSTRY } });
  if (res.status === 404) return null;
  if (!res.ok) throw new PagesUnavailable(`render: ${res.status}`);
  return {
    html: await res.text(),
    status: res.headers.get('x-page-status') === 'published' ? 'published' : 'draft',
    id: res.headers.get('x-page-id') ?? '',
  };
}

export interface EditSessionInput {
  resolved: Record<string, unknown>;
  summary: Record<string, { text: string; empty?: true }>;
  /** The host owns title, address and visibility (her profile). */
  fixed: boolean;
  /** Her panel; a block's `edit` anchor points into it. */
  panelUrl: string;
}

/** A link into the hosted editor, good for two hours. */
export async function editSession(env: Env, pageId: string, input: EditSessionInput): Promise<string> {
  await syncBlocks(env);
  const res = await pagesFetch(env, `/v1/pages/${encodeURIComponent(pageId)}/edit-session`, { method: 'POST', json: { ...input, industry: INDUSTRY } });
  if (!res.ok) throw new PagesUnavailable(`edit session: ${res.status}`);
  return ((await res.json()) as { url: string }).url;
}

/** The service's origin, for the CSP of pages that frame its editor or link its stylesheet. */
export function pagesOrigin(env: Env): string | null {
  if (env.PAGES_URL.startsWith('memory://')) return 'https://pages.test';
  try {
    return new URL(env.PAGES_URL).origin;
  } catch {
    return null;
  }
}
