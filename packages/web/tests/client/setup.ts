import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Testing Library's `cleanup()` auto-runs via an `afterEach` hook when it detects a Jest-like global test
 * framework; Vitest isn't one, so this repo's jsdom project (SDD-005 "Tests", `vitest.config.ts`) wires it in
 * explicitly instead. Without this, `render()` from one `it()` block leaks its DOM into the next: `screen`
 * queries the whole `document`, and two `it()` blocks in the same file would then see duplicate elements.
 */
afterEach(() => {
  cleanup();
});
