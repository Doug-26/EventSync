import { Service, inject } from '@angular/core';

import { ClipboardService } from './clipboard.service';

/** Outcome of {@link ShareService.share}. */
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** What to share. */
export interface ShareData {
  readonly title: string;
  readonly text?: string;
  readonly url: string;
}

/**
 * Opens the device's native share sheet (Web Share API) when there is one, so
 * organizers on phones can send an invite straight to a chat app. Elsewhere it
 * falls back to copying the URL. Must be called from a user gesture.
 */
@Service()
export class ShareService {
  private readonly clipboard = inject(ClipboardService);

  /** True when the browser has a native share sheet (most phones, Safari, Edge). */
  readonly canShareNatively = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /**
   * Shares `data` natively, or copies `data.url` to the clipboard.
   * @returns `cancelled` when the user dismissed the share sheet.
   */
  async share(data: ShareData): Promise<ShareResult> {
    if (this.canShareNatively) {
      try {
        await navigator.share({ title: data.title, text: data.text, url: data.url });
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
        // Not allowed in this context (e.g. some in-app webviews): fall back to copying.
      }
    }
    return (await this.clipboard.copy(data.url)) ? 'copied' : 'failed';
  }
}
