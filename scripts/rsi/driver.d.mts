/** Type declarations for driver.mjs (WO-610 / SDD-063). */
export declare function main(options?: {
  enforceGuard?: () => import('./start-guard.d.mts').StartGuardResult;
}): Promise<number>;
