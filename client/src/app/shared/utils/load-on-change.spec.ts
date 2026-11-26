import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, throwError } from 'rxjs';

import { loadOnChange } from './load-on-change';

/** Creates a loader in an injection context with one controllable Subject per request. */
function setup(initial = 'a') {
  const source = signal(initial);
  const requests: { key: string; response: Subject<string> }[] = [];
  const injector = TestBed.inject(Injector);
  const loader = runInInjectionContext(injector, () =>
    loadOnChange(source, (key) => {
      const response = new Subject<string>();
      requests.push({ key, response });
      return response;
    }),
  );
  const flush = () => TestBed.tick();
  return { source, requests, loader, flush };
}

describe('loadOnChange', () => {
  it('loads for the initial source value', () => {
    const { requests, loader, flush } = setup();
    flush();

    expect(loader.state()).toEqual({ status: 'loading', value: null });
    expect(requests.map((r) => r.key)).toEqual(['a']);

    requests[0].response.next('A');
    expect(loader.state()).toEqual({ status: 'loaded', value: 'A' });
  });

  it('cancels the in-flight request when the source changes (no out-of-order overwrite)', () => {
    const { source, requests, loader, flush } = setup();
    flush();

    source.set('b');
    flush();
    expect(requests.map((r) => r.key)).toEqual(['a', 'b']);
    expect(requests[0].response.observed).toBe(false); // first request unsubscribed

    requests[1].response.next('B');
    requests[0].response.next('A (late)'); // a stale response must be ignored
    expect(loader.state()).toEqual({ status: 'loaded', value: 'B' });
  });

  it('keeps the current value visible during reload()', () => {
    const { requests, loader, flush } = setup();
    flush();
    requests[0].response.next('A');

    loader.reload();
    expect(requests).toHaveLength(2);
    expect(loader.state()).toEqual({ status: 'loaded', value: 'A' });

    requests[1].response.next('A2');
    expect(loader.state()).toEqual({ status: 'loaded', value: 'A2' });
  });

  it('reports a failed first load as error', () => {
    const source = signal('a');
    const injector = TestBed.inject(Injector);
    const loader = runInInjectionContext(injector, () =>
      loadOnChange(source, () => throwError(() => new Error('boom'))),
    );
    TestBed.tick();

    expect(loader.state()).toEqual({ status: 'error', value: null });
  });

  it('keeps the current value when a reload fails', () => {
    const { requests, loader, flush } = setup();
    flush();
    requests[0].response.next('A');

    loader.reload();
    requests[1].response.error(new Error('boom'));
    expect(loader.state()).toEqual({ status: 'loaded', value: 'A' });

    // And the loader still works afterwards.
    loader.reload();
    requests[2].response.next('A3');
    expect(loader.state()).toEqual({ status: 'loaded', value: 'A3' });
  });
});
