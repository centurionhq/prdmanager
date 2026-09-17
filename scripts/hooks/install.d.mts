/** Type declarations for install.mjs's exports (WO-410) — picked up automatically for `.mjs` under
 * `nodenext` module resolution, so `packages/core/tests/unit/hooks-install.test.ts` typechecks. */
export declare const HOOK_KINDS: readonly ['pre-commit', 'pre-push'];
export declare const HOOK_MODE: number;

export declare function wrapperContent(kind: string): string;

export interface InstallOneResult {
  kind: string;
  status: 'installed' | 'unchanged' | 'refused';
  path?: string;
  message?: string;
}

export declare function installOne(hooksDir: string, kind: string): InstallOneResult;
export declare function planInstall(hooksDir: string): InstallOneResult[];
export declare function nodeVersionWarning(nodeVersion?: string): string | null;
