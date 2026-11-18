import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ServerStatusService } from '../../../core/api/server-status.service';

/**
 * Banner shown while API requests are unusually slow, which in production
 * almost always means the free-tier backend is resuming from idle.
 *
 * Accessibility: a polite live region so screen readers announce the wait
 * without stealing focus. The banner is purely informational.
 */
@Component({
  selector: 'app-server-waking-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="status" aria-live="polite">
      @if (status.waking()) {
        <div class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <div class="mx-auto flex max-w-6xl items-center gap-3">
            <span
              aria-hidden="true"
              class="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-200 border-t-amber-600"
            ></span>
            <p>
              <span class="font-medium">Waking up the server…</span>
              Free hosting sleeps when idle, so the first load can take up to a minute.
            </p>
          </div>
        </div>
      }
    </div>
  `,
})
export class ServerWakingBannerComponent {
  protected readonly status = inject(ServerStatusService);
}
