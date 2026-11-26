import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EventService } from '../../../core/api/event.service';
import { MAX_EVENTS_PER_USER } from '../../../core/models/event.model';

/**
 * "Create event" call to action that knows about the per-user event cap.
 *
 * Shows "N of 3 events used" under the button, and at the cap replaces the
 * link with a disabled button plus the reason, so users learn about the limit
 * before filling in a form the server would reject.
 */
@Component({
  selector: 'app-create-event-button',
  imports: [RouterLink],
  host: { class: 'flex flex-col items-stretch gap-1 sm:items-end' },
  template: `
    @if (atCap()) {
      <button
        type="button"
        disabled
        aria-describedby="event-quota"
        class="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-slate-200 px-5 text-sm font-semibold text-slate-600"
      >
        <span aria-hidden="true">+</span>
        <span>Create event</span>
      </button>
    } @else {
      <a
        routerLink="/events/create"
        aria-describedby="event-quota"
        class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        <span aria-hidden="true">+</span>
        <span>Create event</span>
      </a>
    }
    @if (count() !== null) {
      <p id="event-quota" class="text-xs text-slate-600 sm:text-right">
        @if (atCap()) {
          {{ max }} of {{ max }} events used. Delete one to create another.
        } @else {
          {{ count() }} of {{ max }} events used
        }
      </p>
    }
  `,
})
export class CreateEventButtonComponent {
  private readonly eventService = inject(EventService);

  protected readonly max = MAX_EVENTS_PER_USER;
  protected readonly count = this.eventService.eventCount;
  protected readonly atCap = computed(() => (this.count() ?? 0) >= MAX_EVENTS_PER_USER);

  constructor() {
    this.eventService.ensureEventCount();
  }
}
