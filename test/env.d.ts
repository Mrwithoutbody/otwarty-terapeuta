import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env } from '../src/env';

/**
 * `cloudflare:test` types its `env` as `Cloudflare.Env`, so the project's own
 * bindings (plus the two test-only ones) are declared here.
 */
declare global {
  namespace Cloudflare {
    interface Env extends Omit<import('../src/env').Env, never> {
      TEST_MIGRATIONS: D1Migration[];
      TEST_SEED_SQL: string;
    }
  }
}

export type { Env };
