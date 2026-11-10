import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EventService } from '../../../core/api/event.service';
import type { EventSummaryDto } from '../../../core/models/event.model';
import type { PagedResult } from '../../../core/models/paged-result.model';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './event-history.component.html',
})
export class EventHistoryComponent {
  private readonly eventService = inject(EventService);

  protected readonly currentPage = signal(1);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<PagedResult<EventSummaryDto> | null>(null);

  protected readonly events = computed(() => this.result()?.items ?? []);
  protected readonly totalCount = computed(() => this.result()?.totalCount ?? 0);
  protected readonly totalPages = computed(() => this.result()?.totalPages ?? 0);

  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-members
  private readonly loadHistory = effect(() => {
    const page = this.currentPage();
    this.loading.set(true);
    this.errorMessage.set(null);

    this.eventService
      .getEvents({
        page,
        pageSize: 10,
        pastOnly: true,
        sortBy: 'date',
        sortDir: 'desc',
      })
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.errorMessage.set(this.eventService.error() ?? 'Could not load event history.');
        },
      });
  });

  protected statusOf(item: EventSummaryDto): 'cancelled' | 'past' {
    return item.isCancelled ? 'cancelled' : 'past';
  }

  protected goToPage(page: number): void {
    if (page < 1 || (this.totalPages() > 0 && page > this.totalPages())) return;
    this.currentPage.set(page);
  }

  protected trackById = (_: number, item: EventSummaryDto): string => item.id;
}
