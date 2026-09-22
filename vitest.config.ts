import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

/**
 * Tests run inside the real Workers runtime (Miniflare), against a real D1
 * database created from the same migrations production uses and loaded with
 * the same demo seed. Nothing here is mocked except the clock-free bits.
 */
// Absolute, so `npx vitest run` also works when started from a subfolder.
const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const migrations = await readD1Migrations(at('./migrations'));
const seedSql = await readFile(at('./seed/seed.sql'), 'utf8');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: at('./wrangler.jsonc') },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          TEST_SEED_SQL: seedSql,
          // Test-only key material. Deterministic so failures are reproducible;
          // never used anywhere but the test runner.
          PII_ENC_KEY: 'b3QtdGVzdC1waWkta2V5LTAxMjM0NTY3ODlhYmNkZWY=',
          TOKEN_SIGNING_KEY: 'b3QtdGVzdC10b2tlbi1zaWduaW5nLWtleS0wMTIzNCE=',
          TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
          EMAIL_PROVIDER: 'console',
          EMAIL_FROM: 'test@example.invalid',
          ADMIN_BOOTSTRAP_EMAILS: 'admin@example.invalid',
        },
      },
    }),
  ],
  root: at('.'),
  test: {
    // Playwright owns `e2e/`; this pool only runs the in-runtime tests.
    include: ['shared/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    setupFiles: ['./shared/test/setup.ts'],
    testTimeout: 30_000,
  },
});
