/**
 * Loads `axe-core` lazily and runs an accessibility scan whenever the page settles
 * after a DOM change (route changes included).
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

  /** Quiet period after the last DOM change before scanning. */
  const SETTLE_MS = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let lastReport = '';

  const runScan = (): void => {
    // axe throws if a second run starts while one is in progress.
    if (running) {
      schedule();
      return;
    }
    running = true;
    axe
      .run(document, { resultTypes: ['violations'] })
      .then((results) => {
        // Re-renders (toasts, spinners) trigger rescans; only log a changed result.
        const report = `${location.pathname}|${results.violations.map((v) => v.id).join(',')}`;
        if (report === lastReport) return;
        lastReport = report;
        if (results.violations.length === 0) return;
        console.groupCollapsed(
          `[axe] ${results.violations.length} accessibility violation(s) on ${location.pathname}`,
        );
        for (const v of results.violations) {
          console.warn(`${v.id} (${v.impact}): ${v.help}\n→ ${v.helpUrl}`, v.nodes);
        }
        console.groupEnd();
      })
      .catch((err) => console.error('[axe] scan failed', err))
      .finally(() => (running = false));
  };

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(runScan, SETTLE_MS);
  };

  // Scan once the DOM has settled after any change. This covers routerLink
  // navigations (pushState fires no event) and content that renders after data
  // loads, which a popstate listener alone missed.
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  schedule();
}
