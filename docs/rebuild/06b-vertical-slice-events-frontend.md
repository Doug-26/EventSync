# Phase 06b — Vertical Slice 2: Events Frontend

**Goal:** build everything the user touches for events — list with search/filter/sort/paging, create form, edit form, detail page, and a polished dashboard with stats. By the end the SPA is feature-complete for the core event lifecycle.

**Prerequisites:** Phase 06a complete (backend endpoints reachable). Confirm with:

```powershell
curl http://localhost:5000/api/v1/event-types
```

**Expected output (requires the API running):**

```json
[{"id":1,"name":"Seminar","icon":"🎓"}, ...]
```

```
client/src/app/
├── core/
│   ├── models/event.model.ts              # Mirrors backend Common DTOs
│   ├── models/paged-result.model.ts       # Mirrors PagedResult<T>
│   └── api/event.service.ts               # Typed HTTP + signal cache
├── shared/validators/custom-validators.ts # futureDate, urlFormat, dateAfter
└── features/events/
    ├── events.routes.ts                   # 4 child routes
    ├── event-list/                        # table + filters + paging
    ├── create-event/                      # reactive form
    ├── edit-event/                        # form + pre-fill from API
    └── event-detail/                      # read-only with action buttons
```

> Several smaller shared components (`StatusBadge`, `LoadingSpinner`, `EmptyState`, `ConfirmDialog`, `Pagination`, `RelativeDate` pipe) are referenced here but their full source lives in phase 10 (polish). For now you can stub them as templates that emit/show the same inputs/outputs — every later phase keeps using them.

---

## Step 1: Add the TypeScript models that mirror the backend DTOs

`client/src/app/core/models/paged-result.model.ts`:

```typescript
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly totalPages: number;
}
```

`client/src/app/core/models/event.model.ts`:

```typescript
import type { InviteLinkDto } from './invite-link.model'; // created in phase 08

export interface EventTypeDto {
  readonly id: number;
  readonly name: string;
  readonly icon: string | null;
}

export interface OrganizerDto {
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface RsvpSummaryDto {
  readonly going: number;
  readonly notGoing: number;
  readonly maybe: number;
  readonly total: number;
}

export interface EventDto {
  readonly id: string;
  readonly title: string;
  readonly organizerName: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly isVirtual: boolean;
  readonly meetingUrl: string | null;
  readonly startDate: string;     // ISO 8601
  readonly endDate: string | null;
  readonly maxAttendees: number | null;
  readonly isCancelled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly eventType: EventTypeDto;
}

export interface EventSummaryDto {
  readonly id: string;
  readonly title: string;
  readonly eventTypeName: string;
  readonly eventTypeIcon: string | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly location: string | null;
  readonly isVirtual: boolean;
  readonly isCancelled: boolean;
  readonly rsvpCount: number;
  readonly coverImageUrl: string | null;
  readonly createdAt: string;
}

export interface EventDetailDto {
  readonly id: string;
  readonly title: string;
  readonly organizerName: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly isVirtual: boolean;
  readonly meetingUrl: string | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly maxAttendees: number | null;
  readonly coverImageUrl: string | null;
  readonly isCancelled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly eventType: EventTypeDto;
  readonly organizer: OrganizerDto;
  readonly rsvps: RsvpSummaryDto;
  readonly inviteLinks: readonly InviteLinkDto[];
}

export interface CreateEventRequest {
  readonly title: string;
  readonly organizerName: string;
  readonly description: string | null;
  readonly eventTypeId: number;
  readonly location: string | null;
  readonly isVirtual: boolean;
  readonly meetingUrl: string | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly maxAttendees: number | null;
  readonly coverImageUrl: string | null;
}

export type UpdateEventRequest = CreateEventRequest;

export interface EventListParams {
  readonly page?: number;
  readonly pageSize?: number;
  readonly search?: string | null;
  readonly typeId?: number | null;
  readonly sortBy?: 'date' | 'title';
  readonly sortDir?: 'asc' | 'desc';
}
```

### Field-by-field notes

- **Dates as `string`** — Angular's HTTP client doesn't parse JSON dates; the JSON wire format is the raw ISO 8601 string. The component converts with `new Date(...)` only when it needs to (filtering by upcoming, formatting via `DatePipe`).
- **`InviteLinkDto` import** — references a file we create in phase 08. To keep the slice compilable now, stub:
  ```typescript
  // client/src/app/core/models/invite-link.model.ts (temporary stub)
  export interface InviteLinkDto {
    readonly id: string; readonly token: string; readonly url: string;
    readonly expiresAt: string | null; readonly maxUses: number | null;
    readonly useCount: number; readonly isActive: boolean; readonly createdAt: string;
  }
  ```
- **`readonly` everywhere** — TypeScript-only; doesn't reach runtime. Discourages accidental mutation.

---

## Step 2: Add the typed client — `event.service.ts`

```typescript
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import type {
  CreateEventRequest, EventDetailDto, EventDto, EventListParams,
  EventSummaryDto, EventTypeDto, UpdateEventRequest,
} from '../models/event.model';
import type { PagedResult } from '../models/paged-result.model';

@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly http = inject(HttpClient);
  private readonly eventsUrl = `${environment.apiUrl}/events`;
  private readonly eventTypesUrl = `${environment.apiUrl}/event-types`;
  private readonly uploadsUrl = `${environment.apiUrl}/uploads`;

  readonly events = signal<PagedResult<EventSummaryDto> | null>(null);
  readonly selectedEvent = signal<EventDetailDto | null>(null);
  readonly eventTypes = signal<readonly EventTypeDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  getEvents(params: EventListParams = {}): Observable<PagedResult<EventSummaryDto>> {
    let httpParams = new HttpParams();
    if (params.page !== undefined) httpParams = httpParams.set('page', params.page);
    if (params.pageSize !== undefined) httpParams = httpParams.set('pageSize', params.pageSize);
    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.typeId !== null && params.typeId !== undefined) {
      httpParams = httpParams.set('typeId', params.typeId);
    }
    if (params.sortBy) httpParams = httpParams.set('sortBy', params.sortBy);
    if (params.sortDir) httpParams = httpParams.set('sortDir', params.sortDir);

    return this.runWithState(
      this.http.get<PagedResult<EventSummaryDto>>(this.eventsUrl, { params: httpParams }),
    ).pipe(tap((result) => this.events.set(result)));
  }

  getEvent(id: string): Observable<EventDetailDto> {
    return this.runWithState(
      this.http.get<EventDetailDto>(`${this.eventsUrl}/${encodeURIComponent(id)}`),
    ).pipe(tap((result) => this.selectedEvent.set(result)));
  }

  createEvent(data: CreateEventRequest): Observable<EventDto> {
    return this.runWithState(this.http.post<EventDto>(this.eventsUrl, data));
  }

  updateEvent(id: string, data: UpdateEventRequest): Observable<EventDto> {
    return this.runWithState(
      this.http.put<EventDto>(`${this.eventsUrl}/${encodeURIComponent(id)}`, data),
    );
  }

  deleteEvent(id: string): Observable<void> {
    return this.runWithState(
      this.http.delete<void>(`${this.eventsUrl}/${encodeURIComponent(id)}`),
    );
  }

  cancelEvent(id: string): Observable<void> {
    return this.runWithState(
      this.http.patch<void>(`${this.eventsUrl}/${encodeURIComponent(id)}/cancel`, {}),
    );
  }

  getEventTypes(): Observable<EventTypeDto[]> {
    return this.runWithState(this.http.get<EventTypeDto[]>(this.eventTypesUrl)).pipe(
      tap((types) => this.eventTypes.set(types)),
    );
  }

  uploadImage(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.runWithState(
      this.http.post<{ url: string }>(`${this.uploadsUrl}/images`, formData),
    );
  }

  private runWithState<T>(source: Observable<T>): Observable<T> {
    this.loading.set(true);
    this.error.set(null);
    return new Observable<T>((subscriber) => {
      const sub = source.subscribe({
        next: (value) => subscriber.next(value),
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.toMessage(err));
          subscriber.error(err);
        },
        complete: () => { this.loading.set(false); subscriber.complete(); },
      });
      return () => sub.unsubscribe();
    });
  }

  private toMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const e = err as { error?: { detail?: string; title?: string }; message?: string };
      return e.error?.detail ?? e.error?.title ?? e.message ?? 'Request failed.';
    }
    return 'Request failed.';
  }
}
```

### Line-by-line — what's new vs `auth-api.service.ts`

- **Public signals (`events`, `selectedEvent`, `eventTypes`, `loading`, `error`)** — let components consume the service's state without subscribing to the observables themselves. The signals are updated via `tap(...)` on the inner observable, and `loading`/`error` get updated by the `runWithState` wrapper.
- **`HttpParams.set` chains** — `HttpParams` is immutable; each `set` returns a new instance. Building it conditionally avoids sending empty params.
- **`encodeURIComponent(id)`** — defensive; Guids don't need it but it's a good habit if the id type ever changes.
- **`uploadImage(file)`** — sends `FormData` (multipart/form-data). The browser sets the boundary header automatically; do **not** set `Content-Type` manually or the boundary will be missing.
- **`runWithState<T>(...)`** — wraps an observable so every call updates the shared `loading`/`error` signals. Re-emits next/error/complete to preserve the caller's `.subscribe()` semantics.
- **`tap(result => signal.set(result))`** — successful responses update the cache. Errors bypass the tap.

> **Why not use `httpResource`?** Angular 21 has `httpResource()` for resource-style data with built-in loading/error. We use plain `HttpClient` + manual signals because (a) it's still the most common pattern in production code, (b) it gives finer control over re-fetches, (c) interview discussions usually focus on this pattern.

---

## Step 3: Add custom validators — `custom-validators.ts`

`client/src/app/shared/validators/custom-validators.ts`:

```typescript
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function futureDate(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    const candidate = new Date(value as string);
    if (Number.isNaN(candidate.getTime())) return { invalidDate: true };
    return candidate.getTime() > Date.now() ? null : { futureDate: true };
  };
}

export function urlFormat(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    try {
      const url = new URL(String(value));
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? null : { urlFormat: true };
    } catch { return { urlFormat: true }; }
  };
}

export function dateAfter(siblingControlName: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    const parent = control.parent;
    if (!parent) return null;
    const sibling = parent.get(siblingControlName);
    const siblingValue = sibling?.value;
    if (siblingValue === null || siblingValue === undefined || siblingValue === '') return null;
    const start = new Date(siblingValue as string).getTime();
    const end = new Date(value as string).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return { invalidDate: true };
    return end > start ? null : { dateAfter: { siblingControlName } };
  };
}
```

### Patterns to remember

- **Empty values pass** — keeps validators composable; combine with `Validators.required` to make mandatory.
- **`{ futureDate: true }` shape** — Angular reads `errors.futureDate` on the control to decide whether to show an error message. The key matches the template selector.
- **`dateAfter('startDate')`** — cross-field via `control.parent.get(...)`. The `parent` is the `FormGroup`. Add the validator to the *later* field (endDate) so it only fires when that field changes.

---

## Step 4: Add the routes — `events.routes.ts`

```typescript
import { Routes } from '@angular/router';

export const EVENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./event-list/event-list.component').then((m) => m.EventListComponent),
    title: 'My Events — EventSync',
  },
  {
    path: 'create',
    loadComponent: () =>
      import('./create-event/create-event.component').then((m) => m.CreateEventComponent),
    title: 'Create event — EventSync',
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('./edit-event/edit-event.component').then((m) => m.EditEventComponent),
    title: 'Edit event — EventSync',
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./event-detail/event-detail.component').then((m) => m.EventDetailComponent),
    title: 'Event — EventSync',
  },
];
```

### Why this order?

Routes are matched in order. **`:id/edit` must come before `:id`** — otherwise navigating to `/events/abc123/edit` would match `:id` first with `id='abc123'` and then complain about the extra `/edit`. Angular's matcher takes the first wins.

> **Lazy-loaded means `EVENTS_ROUTES` is also lazy** — the `events.routes.ts` module only loads when the user hits an `/events/*` URL. Each child component is also a separate chunk.

---

## Step 5: Build the list — `event-list.component.ts`

The most complex component in the slice. Debounced search, filter, sort, paging, all driven by signals.

```typescript
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, Signal, computed, effect, inject, signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, of, startWith, switchMap } from 'rxjs';

import { EventService } from '../../../core/api/event.service';
import type {
  EventListParams, EventSummaryDto, EventTypeDto,
} from '../../../core/models/event.model';
import type { PagedResult } from '../../../core/models/paged-result.model';

type SortBy = 'date' | 'title';
type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-event-list',
  imports: [ReactiveFormsModule, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './event-list.component.html',
})
export class EventListComponent {
  private readonly eventService = inject(EventService);

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });
  protected readonly eventTypeFilter = signal<number | null>(null);
  protected readonly sortBy = signal<SortBy>('date');
  protected readonly sortDir = signal<SortDir>('asc');
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(10);

  private readonly searchValue: Signal<string> = toSignal(
    this.searchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      startWith(''),
    ),
    { initialValue: '' },
  );

  protected readonly params = computed<EventListParams>(() => ({
    page: this.currentPage(),
    pageSize: this.pageSize(),
    search: this.searchValue() || null,
    typeId: this.eventTypeFilter(),
    sortBy: this.sortBy(),
    sortDir: this.sortDir(),
  }));

  protected readonly eventTypes = this.eventService.eventTypes;

  private readonly result = toSignal(
    toObservable(this.params).pipe(
      switchMap((p) =>
        this.eventService.getEvents(p).pipe(
          catchError(() => of(null as PagedResult<EventSummaryDto> | null)),
        ),
      ),
    ),
    { initialValue: null as PagedResult<EventSummaryDto> | null },
  );

  protected readonly events = computed(() => this.result()?.items ?? []);
  protected readonly totalPages = computed(() => this.result()?.totalPages ?? 0);
  protected readonly totalCount = computed(() => this.result()?.totalCount ?? 0);
  protected readonly loading = this.eventService.loading;
  protected readonly error = this.eventService.error;

  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-members
  private readonly resetPageOnFilterChange = effect(() => {
    this.searchValue();
    this.eventTypeFilter();
    this.sortBy();
    this.sortDir();
    queueMicrotask(() => this.currentPage.set(1));
  });

  constructor() {
    this.eventService.getEventTypes().subscribe({ error: () => undefined });
  }

  protected toggleSort(column: SortBy): void {
    if (this.sortBy() === column) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(column);
      this.sortDir.set('asc');
    }
  }

  protected onTypeFilterChange(value: string): void {
    if (value === '') { this.eventTypeFilter.set(null); return; }
    const parsed = Number(value);
    this.eventTypeFilter.set(Number.isNaN(parsed) ? null : parsed);
  }

  protected goToPage(page: number): void {
    if (page < 1 || (this.totalPages() > 0 && page > this.totalPages())) return;
    this.currentPage.set(page);
  }

  protected onDelete(item: EventSummaryDto): void {
    const ok = confirm(`Delete "${item.title}"? This cannot be undone.`);
    if (!ok) return;
    this.eventService.deleteEvent(item.id).subscribe({
      next: () =>
        this.eventService.getEvents(this.params()).subscribe({ error: () => undefined }),
    });
  }

  protected statusOf(item: EventSummaryDto): 'cancelled' | 'past' | 'upcoming' {
    if (item.isCancelled) return 'cancelled';
    return new Date(item.startDate).getTime() < Date.now() ? 'past' : 'upcoming';
  }

  protected trackById = (_: number, item: EventSummaryDto): string => item.id;
  protected trackTypeById = (_: number, item: EventTypeDto): number => item.id;
}
```

### Line-by-line — the reactive pipeline

This is the **key idea** to understand: state lives in signals, and a single derived `result` signal triggers HTTP automatically whenever any input changes.

1. **Input signals** — `currentPage`, `pageSize`, `eventTypeFilter`, `sortBy`, `sortDir`, plus a `FormControl` for search.
2. **`searchValue`** — `FormControl.valueChanges` is an observable. We `debounceTime(300)` (don't fire a request on every keystroke), `distinctUntilChanged()` (don't refire if the trimmed value is the same), then `toSignal` to integrate.
3. **`params`** — `computed` signal that aggregates everything into the shape the service expects. Re-evaluates whenever *any* of its read signals changes.
4. **`result`** — derived from `params` via the round-trip `toObservable → switchMap → toSignal`:
   - `toObservable(params)` — emits whenever `params()` changes.
   - `switchMap` — cancels the previous in-flight request when a new one starts. Critical: prevents stale responses overwriting fresh ones if the user types fast.
   - `catchError` — keeps the stream alive (otherwise an error would terminate the subscription, and no future changes to `params` would re-trigger the request).
   - `toSignal` — back into a signal for template binding.
5. **Derived selectors** — `events`, `totalPages`, `totalCount` are plain `computed` signals that null-coalesce the result.
6. **`resetPageOnFilterChange` effect** — when the user changes filter/sort/search, set `currentPage = 1`. The `queueMicrotask` defers the set so it doesn't fire during the same synchronous evaluation that triggered the effect (would otherwise be a "cycle" warning).

### Why the `eslint-disable-next-line` comment?

`effect()` returns an `EffectRef` we don't store. The reference's only purpose is to schedule the effect; ESLint can't tell so it warns about an unused field. Disabling the lint locally is the lightweight workaround.

### Action: delete via service then re-fetch

```typescript
protected onDelete(item: EventSummaryDto): void {
  const ok = confirm(`Delete "${item.title}"? …`);
  if (!ok) return;
  this.eventService.deleteEvent(item.id).subscribe({
    next: () => this.eventService.getEvents(this.params()).subscribe({ ... }),
  });
}
```

Two requests on success: the DELETE, then a re-fetch with the current params. Re-fetching is simpler than locally splicing the item — and stays correct if the deletion left the user on a now-empty page.

> The template (`event-list.component.html`) uses Tailwind for a table on `sm:` + above and a stacked card view on mobile. Copy it verbatim from the repo. Key Angular features used: `@for (event of events(); track trackById($index, event))`, `@if (loading()) { ... } @else if (error()) { ... }`, `<button (click)="toggleSort('date')" [attr.aria-sort]="sortBy() === 'date' ? sortDir() : 'none'">`.

---

## Step 6: Build the create form — `create-event.component.ts`

```typescript
import {
  ChangeDetectionStrategy, Component, computed, effect, inject, signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { EventService } from '../../../core/api/event.service';
import type { CreateEventRequest } from '../../../core/models/event.model';
import {
  dateAfter, futureDate, urlFormat,
} from '../../../shared/validators/custom-validators';

@Component({
  selector: 'app-create-event',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-event.component.html',
})
export class CreateEventComponent {
  private readonly fb = inject(FormBuilder);
  private readonly eventService = inject(EventService);
  private readonly router = inject(Router);

  protected readonly eventTypes = this.eventService.eventTypes;
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly coverImageUrl = signal<string | null>(null);
  protected readonly coverPreview = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    organizerName: ['', [Validators.required, Validators.maxLength(100)]],
    description: ['', [Validators.maxLength(2000)]],
    eventTypeId: this.fb.control<number | null>(null, [Validators.required]),
    location: ['', [Validators.maxLength(300)]],
    isVirtual: [false],
    meetingUrl: ['', [urlFormat()]],
    startDate: ['', [Validators.required, futureDate()]],
    endDate: ['', [dateAfter('startDate')]],
    maxAttendees: this.fb.control<number | null>(null, [Validators.min(1)]),
  });

  private readonly isVirtual = toSignal(this.form.controls.isVirtual.valueChanges, {
    initialValue: false,
  });

  protected readonly showMeetingUrl = computed(() => this.isVirtual() === true);

  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-members
  private readonly toggleMeetingUrlValidators = effect(() => {
    const required = this.showMeetingUrl();
    const ctrl = this.form.controls.meetingUrl;
    ctrl.setValidators(
      required ? [Validators.required, urlFormat()] : [urlFormat()],
    );
    ctrl.updateValueAndValidity({ emitEvent: false });
  });

  constructor() {
    if (this.eventTypes().length === 0) {
      this.eventService.getEventTypes().subscribe({ error: () => undefined });
    }
  }

  protected onSubmit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const payload: CreateEventRequest = {
      title: v.title.trim(),
      organizerName: v.organizerName.trim(),
      description: v.description.trim() || null,
      eventTypeId: Number(v.eventTypeId),
      location: v.location.trim() || null,
      isVirtual: v.isVirtual,
      meetingUrl: v.isVirtual ? v.meetingUrl.trim() || null : null,
      startDate: v.startDate,
      endDate: v.endDate || null,
      maxAttendees: v.maxAttendees ?? null,
      coverImageUrl: this.coverImageUrl(),
    };

    this.submitting.set(true);
    this.submitError.set(null);
    this.eventService.createEvent(payload).subscribe({
      next: (created) => {
        this.submitting.set(false);
        this.router.navigate(['/events', created.id]);
      },
      error: () => {
        this.submitting.set(false);
        this.submitError.set(
          this.eventService.error() ?? 'Could not create event. Please try again.',
        );
      },
    });
  }

  protected onCancel(): void {
    this.router.navigate(['/events']);
  }

  /** Upload helpers — full bodies omitted; see phase 07. */
  protected onFileSelected(event: Event): void { /* … */ }
  protected onDrop(event: DragEvent): void { /* … */ }
  private uploadFile(file: File): void { /* … */ }
  protected removeCover(): void {
    this.coverImageUrl.set(null);
    this.coverPreview.set(null);
    this.uploadError.set(null);
  }
}
```

### Why typed reactive forms?

- **`fb.nonNullable.group({...})`** — every control's value type is non-null. Without this you'd have to handle `null` everywhere. Typed forms make `form.value` and `form.getRawValue()` strongly typed.
- **`fb.control<number | null>(null, [...])`** — for fields where `null` is a meaningful "unset" value (event type dropdown placeholder), explicitly type the generic.

### Conditional validator on `meetingUrl`

The toggle `isVirtual` controls whether meetingUrl is required:

1. `isVirtual` is a signal converted from `valueChanges`.
2. `showMeetingUrl` is a `computed` that reads it.
3. The `effect` re-runs whenever `showMeetingUrl` flips, calls `setValidators(...)`, and `updateValueAndValidity({ emitEvent: false })`. The `emitEvent: false` avoids re-triggering the `valueChanges` observable (which would cause a feedback loop).

### Submission flow

- **Disable double-submit** — guard with `submitting()`.
- **`form.markAllAsTouched()`** — needed because the template uses `(control.touched && control.invalid)` to show errors. Without this, errors don't appear on first invalid submit until the user has touched each field.
- **Manual trim + null-or-string conversion** — backend accepts `null` for "absent" optional fields; empty strings get coerced.
- **Navigate to the new event detail page on success** — `router.navigate(['/events', created.id])`.

### Upload integration (preview)

The cover image flow uploads immediately on selection (not at form-submit time). The component holds two signals: `coverPreview` (object URL for the local file) and `coverImageUrl` (server-side path returned by the upload endpoint). Submit only sends `coverImageUrl`. Full upload logic is detailed in **phase 07**.

---

## Step 7: Build the edit form — `edit-event.component.ts`

Same shape as Create with three differences:

1. **Route parameter binding** — `id = input.required<string>()` reads from the URL because `app.config.ts` uses `withComponentInputBinding()`.
2. **Pre-fill via effect** — an effect runs when `id()` is available, calls `getEvent`, and `form.reset(...)` with the fetched values.
3. **No `futureDate()` validator on `startDate`** — editing a started event is allowed.

The crucial helper:

```typescript
private toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

`<input type="datetime-local">` requires the format `YYYY-MM-DDTHH:mm` **in the user's local time zone, without offset**. We can't `iso.slice(0, 16)` because that would lose timezone correction. The helper converts a UTC ISO string to the local-time string the input expects.

And:

```typescript
private resolveImageUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
  return `${apiOrigin}${url}`;
}
```

Cover image URLs from upload are server-relative (`/uploads/foo.jpg`). The browser resolves them against the page origin (frontend on `:4200`), not the API (`:5000`). The helper strips the `/api/v1` suffix from `environment.apiUrl` and prepends the origin.

---

## Step 8: Build the detail page — `event-detail.component.ts`

Read-only with three destructive actions (Edit, Cancel, Delete) and a `ConfirmDialog` for the last two.

```typescript
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { EventService } from '../../../core/api/event.service';
import { environment } from '../../../../environments/environment';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { RelativeDatePipe } from '../../../shared/pipes/relative-date.pipe';
import { InviteLinkManagerComponent } from './invite-link-manager/invite-link-manager.component';   // phase 08
import { RsvpListComponent } from './rsvp-list/rsvp-list.component';                                 // phase 09

type DialogKind = 'cancel' | 'delete' | null;

@Component({
  selector: 'app-event-detail',
  imports: [
    RouterLink, DatePipe, RelativeDatePipe,
    StatusBadgeComponent, LoadingSpinnerComponent, ConfirmDialogComponent,
    InviteLinkManagerComponent, RsvpListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './event-detail.component.html',
})
export class EventDetailComponent {
  private readonly eventService = inject(EventService);
  private readonly router = inject(Router);

  readonly id = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly openDialog = signal<DialogKind>(null);

  protected readonly event = this.eventService.selectedEvent;

  protected readonly coverImageSrc = computed(() => {
    const url = this.event()?.coverImageUrl;
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    const apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
    return `${apiOrigin}${url}`;
  });

  protected readonly status = computed<{ text: string; variant: 'success' | 'danger' | 'default' }>(() => {
    const ev = this.event();
    if (!ev) return { text: 'Loading', variant: 'default' };
    if (ev.isCancelled) return { text: 'Cancelled', variant: 'danger' };
    const upcoming = new Date(ev.startDate).getTime() > Date.now();
    return upcoming
      ? { text: 'Upcoming', variant: 'success' }
      : { text: 'Past', variant: 'default' };
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-members
  private readonly loadEvent = effect(() => {
    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    this.errorMessage.set(null);
    this.eventService.getEvent(id).subscribe({
      next: () => this.loading.set(false),
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(this.eventService.error() ?? 'Could not load event.');
      },
    });
  });

  protected requestCancel(): void { this.openDialog.set('cancel'); }
  protected requestDelete(): void { this.openDialog.set('delete'); }
  protected closeDialog(): void { this.openDialog.set(null); }

  protected confirmCancel(): void {
    const ev = this.event();
    if (!ev || this.busy()) return;
    this.busy.set(true);
    this.eventService.cancelEvent(ev.id).subscribe({
      next: () => {
        this.busy.set(false); this.closeDialog();
        this.eventService.getEvent(ev.id).subscribe({ error: () => undefined });
      },
      error: () => {
        this.busy.set(false); this.closeDialog();
        this.errorMessage.set(this.eventService.error() ?? 'Could not cancel event.');
      },
    });
  }

  protected confirmDelete(): void {
    const ev = this.event();
    if (!ev || this.busy()) return;
    this.busy.set(true);
    this.eventService.deleteEvent(ev.id).subscribe({
      next: () => {
        this.busy.set(false); this.closeDialog();
        this.router.navigate(['/events']);
      },
      error: () => {
        this.busy.set(false); this.closeDialog();
        this.errorMessage.set(this.eventService.error() ?? 'Could not delete event.');
      },
    });
  }
}
```

### Key choices

- **`event = this.eventService.selectedEvent`** — the service's signal is the single source of truth. After `getEvent` succeeds the service updates `selectedEvent`; the template re-renders automatically.
- **`coverImageSrc` and `status` are `computed`** — they re-evaluate whenever `event()` changes.
- **`DialogKind` union** — instead of two booleans, one signal holds the *type* of dialog currently open (or null). Templates render at most one dialog: `@if (openDialog() === 'cancel') { ... }`.
- **Reload after cancel** — the cancel succeeded server-side; re-fetch shows the updated `IsCancelled = true` so the status badge updates.
- **Navigate away after delete** — there's no event to show; back to the list.
- **Imports the InviteLinkManager + RsvpList components** — these slot into the template directly. Until phases 08/09 are done, stub them out (`@Component({ template: '' })`).

---

## Step 9: Upgrade the dashboard

Replace the phase-05 dashboard with the version that surfaces event stats and the next 5 upcoming events:

```typescript
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EventService } from '../../core/api/event.service';
import { AuthService } from '../../core/auth/auth.service';
import type { EventSummaryDto } from '../../core/models/event.model';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { EventCardComponent } from './event-card/event-card.component';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, EventCardComponent, EmptyStateComponent, LoadingSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly eventService = inject(EventService);

  protected readonly displayName = this.auth.displayName;
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly events = signal<readonly EventSummaryDto[]>([]);

  protected readonly totalEvents = computed(() => this.events().length);

  protected readonly upcomingEvents = computed(() => {
    const now = Date.now();
    return this.events().filter(
      (e) => !e.isCancelled && new Date(e.startDate).getTime() > now,
    );
  });

  protected readonly upcomingCount = computed(() => this.upcomingEvents().length);

  protected readonly totalRsvpsGoing = computed(() =>
    this.events().reduce((sum, e) => sum + e.rsvpCount, 0),
  );

  protected readonly nextFive = computed(() =>
    [...this.upcomingEvents()]
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, 5),
  );

  protected trackById = (_: number, e: EventSummaryDto): string => e.id;

  constructor() {
    this.eventService
      .getEvents({ page: 1, pageSize: 50, sortBy: 'date', sortDir: 'asc' })
      .subscribe({
        next: (result) => {
          this.events.set(result.items);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.errorMessage.set(this.eventService.error() ?? 'Could not load events.');
        },
      });
  }
}
```

### Why fetch 50 and derive stats client-side?

For MVP scale (a single user with maybe 20–50 events at most). All four stats — total, upcoming, total RSVPs going, next 5 — derive from the same page. One request, four derived signals, no extra endpoints. When the dataset grows you'd add a dedicated `/dashboard-stats` endpoint and only fetch counts.

---

## Step 10: Stub the shared components and event-card

Three quick stubs you'll polish in phase 10:

`shared/components/loading-spinner/loading-spinner.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-loading-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="status" class="inline-flex items-center gap-2 text-slate-600">
      <span class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" aria-hidden="true"></span>
      <span class="text-sm">{{ label() }}</span>
    </div>
  `,
})
export class LoadingSpinnerComponent {
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly label = input<string>('Loading…');
}
```

`shared/components/empty-state/empty-state.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-empty-state',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="text-center rounded-lg border border-dashed border-slate-300 bg-white p-10">
      <p class="text-4xl" aria-hidden="true">{{ icon() }}</p>
      <h2 class="mt-3 text-lg font-semibold text-slate-900">{{ title() }}</h2>
      <p class="mt-1 text-sm text-slate-600">{{ message() }}</p>
      @if (actionLabel() && actionLink()) {
        <a [routerLink]="actionLink()" class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          {{ actionLabel() }}
        </a>
      }
    </div>
  `,
})
export class EmptyStateComponent {
  readonly icon = input<string>('📭');
  readonly title = input<string>('Nothing here');
  readonly message = input<string>('');
  readonly actionLabel = input<string | null>(null);
  readonly actionLink = input<string | null>(null);
}
```

`features/dashboard/event-card/event-card.component.ts`:

```typescript
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EventSummaryDto } from '../../../core/models/event.model';

@Component({
  selector: 'app-event-card',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a [routerLink]="['/events', event().id]" class="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:shadow">
      <header class="flex items-center gap-2">
        <span aria-hidden="true">{{ event().eventTypeIcon ?? '🎉' }}</span>
        <h3 class="truncate text-base font-semibold text-slate-900">{{ event().title }}</h3>
      </header>
      <p class="mt-1 text-sm text-slate-600">{{ event().startDate | date:'medium' }}</p>
      <p class="mt-1 text-xs text-slate-500">{{ event().rsvpCount }} going</p>
    </a>
  `,
})
export class EventCardComponent {
  readonly event = input.required<EventSummaryDto>();
}
```

For the other shared components referenced by `EventDetail` — `ConfirmDialog`, `StatusBadge`, `RelativeDatePipe` — stub similarly minimal versions. Phase 10 will polish them.

---

## Checkpoint

You've passed this phase when:

1. `ng serve` compiles with no errors.
2. From the dashboard, click "Create Event". The form loads with the event-type dropdown populated.
3. Submit with empty title → see the required error.
4. Fill the form, submit. Backend gets a POST, returns 201, you're redirected to `/events/{newId}`. Detail page shows the event.
5. Go to `/events`. See the new event in the table.
6. Type a search term — the URL doesn't change but the table re-filters after the 300 ms debounce.
7. Click a sort header twice — direction toggles.
8. Filter by event type from the dropdown.
9. Page through results (if you have >10 events; create some quickly via Swagger).
10. From the detail page, click Edit → modify the title → save. Redirected back to detail with new title.
11. Click Cancel → confirm dialog → event now shows the Cancelled badge.
12. Click Delete → confirm → redirected to /events → the event is gone.
13. Reload the dashboard — totals reflect your activity.
14. DevTools network tab confirms each action fires exactly one API call (no N+1 from the list view).

---

Next: [07-vertical-slice-uploads.md](./07-vertical-slice-uploads.md) — image uploads with magic-byte validation, size limits, and the file-storage strategy.
