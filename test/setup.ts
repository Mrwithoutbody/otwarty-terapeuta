import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

/**
 * The pages service (x402L) runs in-process behind `https://pages.test`, so the
 * suite exercises the real render with no network. `https://pages.down` is the
 * service that never answers: a refused socket would make workerd throw once
 * more after the catch, a rejected fetch does not.
 */
const realFetch = globalThis.fetch;
let service: Promise<{ fetch(req: Request, env: unknown): Promise<Response> }> | null = null;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const { hostname, pathname } = new URL(request.url);
  if (hostname === 'pages.down') throw new TypeError('down');
  if (hostname !== 'pages.test') return realFetch(request);
  // An edit session needs the service's own D1; the tests need only its address.
  if (pathname === '/v1/edit-session') return Response.json({ url: 'https://pages.test/edit/test.0.0' });
  // Ścieżka w zmiennej: `tsc` hosta nie sprawdza wtedy źródeł usługi (inne flagi ścisłości).
  const entry = 'x402l/src/index';
  service ??= import(/* @vite-ignore */ entry).then((m: { app: { fetch(req: Request, env: unknown): Promise<Response> } }) => m.app);
  return (await service).fetch(request, { DB: undefined, TOKEN_SECRET: 'test' });
};

/**
 * One migration + seed pass per worker. `isolatedStorage` (the pool default)
 * rolls each test's writes back afterwards, so tests stay independent while
 * still running against the real schema and the real demo data.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

  // `D1Database.exec` needs one statement per call. The seed only ever ends a
  // statement with ";\n", so splitting on that is safe for this file.
  for (const statement of env.TEST_SEED_SQL.split(';\n')) {
    const sql = statement
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim()
      .replace(/;$/, '');
    if (sql.length === 0) continue;
    await env.DB.prepare(sql).run();
  }
});
