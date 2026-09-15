/**
 * Resolves which server origin a remote-mode command actually talks to (SDD-010 "Modo remoto"/"Sync de
 * developers y drift", WO-190): nothing the repository says ever gets to pick a server on its own in CI.
 * Shared by `prdm sync`, the `commit-msg` hook and `check commits --range`'s remote paths (WO-195/197/198)
 * — the same cross-check `mcp-proxy.ts` already does, plus the CI-specific "missing is a hard error"
 * rule `prdm mcp-proxy` doesn't need (it's never run in CI).
 */
import type { RemoteProjectConfig } from '@prdm/core';
import { CliError } from '../errors.js';
import { parseServerUrl } from './server-url.js';

/** Most CI providers, GitHub Actions included, set `CI=true`; some historically set `CI=1`. */
export function isCi(env: NodeJS.ProcessEnv): boolean {
  return env.CI === 'true' || env.CI === '1';
}

/**
 * Returns the origin to use, or throws `CliError`:
 *  - Outside CI, `PRDM_SERVER` is optional; when present it must agree with `remote.server`'s origin.
 *  - In CI, `PRDM_SERVER` is mandatory (SDD-010: "en CI, el servidor sale de PRDM_SERVER ... si
 *    remote.server del repo difiere, se aborta sin enviar nada") — a missing value is a clear,
 *    actionable error, never a silent fall-back to whatever the repository happens to say.
 */
export function resolveRemoteServerOrigin(remote: RemoteProjectConfig, env: NodeJS.ProcessEnv): string {
  const configuredOrigin = parseServerUrl(remote.server).origin;
  const prdmServer = env.PRDM_SERVER;

  if (isCi(env) && !prdmServer) {
    throw new CliError('PRDM_SERVER is required in CI for a remote-mode project (it was not set)');
  }
  if (prdmServer) {
    const expectedOrigin = parseServerUrl(prdmServer).origin;
    if (expectedOrigin !== configuredOrigin) {
      throw new CliError(`.prdm.yaml points to ${configuredOrigin}, but PRDM_SERVER is ${expectedOrigin}; refusing to guess which one is correct`);
    }
  }
  return configuredOrigin;
}
