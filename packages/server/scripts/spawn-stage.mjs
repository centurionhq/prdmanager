/**
 * WO-584/585 / SDD-057 review follow-up: `deploy.mjs` and `rollback.mjs` each shaped a `spawnSync(...) ->
 * { success, exitCode }` `Stage` the same way -- pulled out once instead of duplicated.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { REPO_ROOT } from './repo-root.mjs';

/**
 * @param {string} name
 * @param {string} command
 * @param {string[]} args
 * @returns {import('../../../scripts/hooks/pre-push-lib.mjs').Stage}
 */
export function spawnStage(name, command, args) {
  return {
    name,
    run: () => {
      const result = spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit', env: process.env });
      if (result.error) return { success: false, message: `failed to start "${command} ${args.join(' ')}": ${result.error.message}` };
      return { success: result.status === 0, exitCode: result.status ?? 1 };
    },
  };
}
