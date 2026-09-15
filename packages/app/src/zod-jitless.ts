/**
 * WO-245 (SDD-006, found by WO-085's CSP learning test): zod 4.6.3's `allowsEval()` probes
 * `new Function('')` in a try/catch to decide whether it can compile fast validators. Under this app's
 * real `script-src 'self'` (no `unsafe-eval`), the browser still reports a `securitypolicyviolation` for
 * that blocked call even though zod's own catch swallows the resulting throw — zod's own source
 * comment names this exact case: "strict CSPs report the caught `new Function` as a
 * `securitypolicyviolation` even though the throw is swallowed" (`node_modules/zod/v4/core/util.js`).
 *
 * `config({ jitless: true })` skips the probe entirely, so it must run before any zod schema in the
 * bundle performs its first parse — this module has no imports of its own besides zod, and is imported
 * first in `main.tsx`, so its top-level code runs before any sibling import's module body can reach a
 * zod `.parse()`/`.safeParse()` call.
 */
import { config } from 'zod';

config({ jitless: true });
