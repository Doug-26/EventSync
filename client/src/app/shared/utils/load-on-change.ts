import { Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';

/** Snapshot of a {@link loadOnChange} load. `value` is the last loaded value, if any. */
export interface LoadState<T> {
  readonly status: 'loading' | 'loaded' | 'error';
  readonly value: T | null;
}

/** Handle returned by {@link loadOnChange}. */
export interface LoadOnChange<T> {
  /** Current load state. */
  readonly state: Signal<LoadState<T>>;
  /** Re-runs the load for the current source value, keeping the current value visible meanwhile. */
  reload(): void;
}

/**
 * Runs `load` for the current value of `source`, and again whenever it changes. A change
 * cancels the in-flight request (`switchMap`), so a slow response for an old value can
 * never overwrite a newer one.
 *
 * - A source change shows `loading` (value cleared) and ends in `loaded` or `error`.
 * - `reload()` keeps the current value while it fetches; if the reload fails, the current
 *   value stays (the failure is still reported by the service's toast/error handling).
 *
 * Built on `toObservable`/`toSignal`/`switchMap`, which the app already ships, instead of
 * `rxResource`: Angular's resource runtime would otherwise land in every route's initial
 * bundle (~2.5 kB gzip). Must be called in an injection context (e.g. a field initializer).
 */
export function loadOnChange<S, T>(
  source: Signal<S>,
  load: (value: S) => Observable<T>,
): LoadOnChange<T> {
  const reload$ = new Subject<void>();
  const loading: LoadState<T> = { status: 'loading', value: null };

  const state = toSignal(
    toObservable(source).pipe(
      switchMap((value) =>
        reload$.pipe(
          startWith(undefined),
          switchMap((_, attempt) => {
            const isReload = attempt > 0;
            const request = load(value).pipe(
              map((result): LoadState<T> => ({ status: 'loaded', value: result })),
              catchError(() =>
                isReload ? EMPTY : of<LoadState<T>>({ status: 'error', value: null }),
              ),
            );
            return isReload ? request : request.pipe(startWith(loading));
          }),
        ),
      ),
    ),
    { initialValue: loading },
  );

  return { state, reload: () => reload$.next() };
}
