/**
 * Loads `axe-core` lazily and runs an accessibility scan on every route change.
 * Violations are logged to the console with the standard axe report so they're
 * easy to triage during development.
 *
 * Dev-only: the production build swaps this file for `axe-scan.prod.ts` (a no-op)
 * via `fileReplacements` in `angular.json`. A runtime guard is not enough, because
 * the bundler emits a chunk for every dynamic import it sees, even unreachable ones,
 * which used to leave a 585 kB axe chunk in `dist/`.
 */
export async function enableAxeInDev(): Promise<void> {
  const { default: axe } = await import('axe-core');

  const runScan = (): void => {
    // Defer until the next animation frame so freshly-routed templates have rendered.
    requestAnimationFrame(() => {
      axe
        .run(document, { resultTypes: ['violations'] })
        .then((results) => {
          if (results.violations.length === 0) {
            return;
          }
          console.groupCollapsed(
            `[axe] ${results.violations.length} accessibility violation(s) on ${location.pathname}`,
          );
          for (const v of results.violations) {
            console.warn(`${v.id} (${v.impact}): ${v.help}\n→ ${v.helpUrl}`, v.nodes);
          }
          console.groupEnd();
        })
        .catch((err) => console.error('[axe] scan failed', err));
    });
  };

  // Initial scan + re-scan on history navigation.
  runScan();
  window.addEventListener('popstate', runScan);
}
