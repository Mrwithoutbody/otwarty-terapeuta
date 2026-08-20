import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level checks for the public website and the MCP Apps widget.
 *
 * Uses the locally installed Chrome (`channel: 'chrome'`) so no browser
 * download is needed. Run the D1 migrations and the seed first:
 *
 *   npm run db:reset:local && npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:8788',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: 'npm run build:widget && npx wrangler dev --port 8788',
    url: 'http://localhost:8788/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
