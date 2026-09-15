import { defineConfig, devices } from '@playwright/test';

/**
 * WO-085 (ADR-006 §"Learning test en navegador con Playwright de CodeMirror 6"): a separate config from
 * `../e2e/playwright.config.ts` so this directory's spec never gets swept into the WO-201 journey run —
 * both reuse `../e2e/harness.ts`'s `startJourney`/`stopJourney` (own real Postgres/Neo4j/server) on the
 * same fixed port, so the two suites must run as separate, sequential `npx playwright test` invocations
 * (never in parallel) — matching how CI's `e2e` job already runs the WO-201 journey as its own step.
 *
 * WO-323 (ADR-009 §"Learning test de beforeinput"): adds a `firefox` project scoped (via its own
 * `testMatch`) to only `beforeinput-prevent-default.spec.ts`, since that spec needs to confirm
 * `beforeinput`'s `preventDefault` behavior holds across engines, not just Chromium's. Every other spec
 * in this directory keeps running exactly as before — matched only by the `chromium` project, the same
 * single (previously implicit, now named) default this file always ran everything under.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  projects: [
    { name: 'chromium', testMatch: '**/*.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testMatch: 'beforeinput-prevent-default.spec.ts', use: { ...devices['Desktop Firefox'] } },
  ],
});
