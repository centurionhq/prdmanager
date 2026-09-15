import { describe, expect, test } from 'vitest';
import { config } from 'zod';
import '../../src/zod-jitless.js';

describe('zod-jitless (WO-245)', () => {
  test('sets jitless so zod never probes new Function() under a strict CSP', () => {
    expect(config().jitless).toBe(true);
  });
});
