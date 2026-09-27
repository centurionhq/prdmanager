/**
 * WO-584 / SDD-057: shared by `deploy.mjs`, `rollback.mjs` and `smoke-check.mjs`, which all need the repo
 * root as their working directory for `npm`/`git`/`systemctl` invocations. `dev.mjs` (WO-122) computes
 * this inline since it's the file's only use there; here three scripts need the exact same constant, so
 * it's pulled out once instead of copied three times.
 */
import { fileURLToPath } from 'node:url';

// This file lives at packages/server/scripts/repo-root.mjs -- three levels below the repo root.
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
