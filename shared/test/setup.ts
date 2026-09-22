import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

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
