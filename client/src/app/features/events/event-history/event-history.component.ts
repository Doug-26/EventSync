import { DatePipe } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EventService } from '../../../core/api/event.service';
import type { EventSummaryDto } from '../../../core/models/event.model';
import type { PagedResult } from '../../../core/models/paged-result.model';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { type LoadState, loadOnChange } from '../../../shared/utils/load-on-change';

/**
 * Organizer-facing archive of events whose start date has passed.
 *
 * The server performs the past-event filter before pagination. Each item links
 * to the existing event detail view, which contains the full event details and
 * the paginated RSVP response list.
 */
@Component({
  selector: 'app-event-history',
  imports: [DatePipe, RouterLink, LoadingSpinnerComponent],
  templateUrl: './event-history.component.html',
})
export class EventHistoryComponent {
  private readonly eventService = inject(EventService);

  protected readonly currentPage = signal(1);

  /** Loads the page whenever it changes; a newer page cancels the in-flight request. */
  private readonly historyLoad = loadOnChange(this.currentPage, (page) =>
    this.eventService.getEvents({
      page,
      pageSize: 10,
      pastOnly: true,
      sortBy: 'date',
      sortDir: 'desc',
    }),
  );

  protected readonly loading = computed(() => this.historyLoad.state().status === 'loading');

  protected readonly errorMessage = computed(() =>
    this.historyLoad.state().status === 'error'
      ? (this.eventService.error() ?? 'Could not load event history.')
      : null,
  );

  /** Last loaded page, kept while the next one loads (pagination bounds stay known). */
  protected readonly result = linkedSignal<
    LoadState<PagedResult<EventSummaryDto>>,
    PagedResult<EventSummaryDto> | null
  >({
    source: this.historyLoad.state,
    computation: (state, previous) => state.value ?? previous?.value ?? null,
  });

  protected readonly events = computed(() => this.result()?.items ?? []);
  protected readonly totalCount = computed(() => this.result()?.totalCount ?? 0);
  protected readonly totalPages = computed(() => this.result()?.totalPages ?? 0);

  protected statusOf(item: EventSummaryDto): 'cancelled' | 'past' {
    return item.isCancelled ? 'cancelled' : 'past';
  }

  protected goToPage(page: number): void {
    if (page < 1 || (this.totalPages() > 0 && page > this.totalPages())) return;
    this.currentPage.set(page);
  }
}
