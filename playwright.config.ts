import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level checks for the public website and the MCP Apps widget.
 *
 * Uses the locally installed Chrome (`channel: 'chrome'`) so no browser
 * download is needed. Run the D1 migrations and the seed first:
 *
 *   npm run db:reset:local && npm run test:e2e
 */
// Własny port na instancję, żeby równoległe worktree nie przejęły cudzego serwera
// przez `reuseExistingServer`.
const port = Number(process.env.E2E_PORT ?? 8788);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: `npm run build:widget && npx wrangler dev --port ${port} --inspector-port ${port + 1000}`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
