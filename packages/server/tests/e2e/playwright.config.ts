import { defineConfig } from '@playwright/test';

/**
 * WO-201 (SDD-010 §Tests): no `webServer`/`globalSetup` here on purpose — `full-journey.spec.ts` boots
 * its own server (via `./harness.ts`, real Postgres/Neo4j fixtures, `FakeLlmClient`, test OIDC JWKS) in
 * its own `test.beforeAll`, since the fixtures (org/project/tokens/OIDC keys) are generated per run and
 * need to be threaded straight into `buildServer` — not something a separate `webServer` command with no
 * return channel back to the test process could set up. `fullyParallel: false` and a single worker: this
 * is one long, stateful journey against one shared server instance, never independent parallel tests.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  // A `waitForBodyOnServer`/`waitForFieldOnServer` probe can need to wait out a real backlog of many
  // small Yjs updates (one per keystroke `page.keyboard.type()` sends) draining through the server —
  // generous on purpose, never a substitute for the real-event waits themselves.
  expect: { timeout: 30_000 },
  reporter: [['list']],
});
