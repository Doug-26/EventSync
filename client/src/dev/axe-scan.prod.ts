/**
 * Production stand-in for `axe-scan.ts` (swapped in by `fileReplacements` in
 * `angular.json`), so `axe-core` never enters the production module graph.
 */
export async function enableAxeInDev(): Promise<void> {}
