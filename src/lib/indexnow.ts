/**
 * IndexNow: Bing (and Yandex, Seznam, Naver) hear about a changed page the moment it
 * changes, instead of on their next pass over the sitemap. Bing's index is what ChatGPT
 * search reads. Google does not take part - it keeps reading the sitemap.
 *
 * The key is public by design: a search engine fetches `/<key>.txt` to check that this
 * host sent the ping. So it lives here, not among the secrets.
 */
import type { Env } from '../env';
import { log } from './log';

export const INDEXNOW_KEY = '71f406899159b10e0f21a3fcd1bc302f';

/** What goes to the endpoint: our host, the key and where to find it, full addresses. */
export function indexNowBody(base: string, paths: string[]): { host: string; key: string; keyLocation: string; urlList: string[] } {
  return { host: new URL(base).host, key: INDEXNOW_KEY, keyLocation: `${base}/${INDEXNOW_KEY}.txt`, urlList: [...new Set(paths)].map((p) => `${base}${p}`) };
}

/**
 * Tells the search engines these paths changed. Production only - a preview or a test
 * run has no addresses worth announcing. Never throws: a ping that fails costs a few
 * hours of freshness, never the save it followed. Meant for `waitUntil`.
 */
export async function pingIndexNow(env: Env, paths: string[]): Promise<void> {
  if (env.ENVIRONMENT !== 'production' || paths.length === 0) return;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(indexNowBody(env.PUBLIC_BASE_URL, paths)),
      signal: AbortSignal.timeout(5000),
    });
    // 200 and 202 both mean accepted; anything else is worth seeing in the log.
    if (!res.ok) log.warn('indexnow.rejected', { status: res.status, count: paths.length });
  } catch (err) {
    log.warn('indexnow.failed', { reason: String((err as Error).message ?? err), count: paths.length });
  }
}
