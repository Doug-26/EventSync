import { Service, computed, signal } from '@angular/core';

import { environment } from '../../../environments/environment';

/**
 * Tracks whether the backend looks like it is "waking up" from a free-tier
 * cold start, and starts that wake-up as early as possible.
 *
 * Production runs on Azure free tiers: the SQL database auto-pauses after
 * 60 min idle and needs a while to resume. {@link wakeServer} fires a
 * fire-and-forget request at page load so the resume overlaps with Auth0
 * sign-in instead of starting only after it. {@link track} lets the HTTP
 * interceptor flag requests that stay pending longer than
 * {@link SLOW_REQUEST_MS}, which drives the "waking up" banner.
 */
@Service()
export class ServerStatusService {
  /** A request pending longer than this is considered "slow" (cold start). */
  static readonly SLOW_REQUEST_MS = 5000;

  private readonly slowRequests = signal(0);
  private wakeRequested = false;

  /** `true` while at least one tracked API request has been pending > 5 s. */
  readonly waking = computed(() => this.slowRequests() > 0);

  /**
   * Fire-and-forget GET to `/health/ready` (host root, outside `/api/v1`).
   *
   * That endpoint opens a DB connection, which makes a paused Azure SQL
   * serverless DB start resuming. `mode: 'no-cors'` keeps it a "simple"
   * request: no preflight, no CORS headers needed, and the opaque response is
   * ignored. Runs at most once per page load.
   */
  wakeServer(): void {
    if (this.wakeRequested || typeof fetch !== 'function') {
      return;
    }
    this.wakeRequested = true;

    try {
      const url = new URL('/health/ready', environment.apiUrl).toString();
      fetch(url, { mode: 'no-cors', cache: 'no-store' }).catch(() => {
        // Best effort only — real requests have their own retry/backoff.
      });
    } catch {
      // Malformed apiUrl or fetch unavailable — nothing to warm.
    }
  }

  /**
   * Start tracking one request. After {@link SLOW_REQUEST_MS} it counts as
   * slow until the returned release function is called (call it exactly once,
   * e.g. from `finalize`).
   */
  track(): () => void {
    let counted = false;
    const timer = setTimeout(() => {
      counted = true;
      this.slowRequests.update((n) => n + 1);
    }, ServerStatusService.SLOW_REQUEST_MS);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      clearTimeout(timer);
      if (counted) {
        this.slowRequests.update((n) => Math.max(0, n - 1));
      }
    };
  }
}
