# Phase 04 — Frontend Foundations (Angular App Shell)

Goal: build every cross-cutting frontend piece — DI setup, routing, Auth0 wrapper, auth guard, HTTP interceptors, error handling, toast service, layout (header/footer), and an Auth0 tenant walkthrough. By the end, the SPA boots, displays the header/footer, redirects unauthenticated users to a login page, and is ready for vertical slices.

Files we'll create / replace:

```
client/src/app/
├── app.config.ts                       # full DI
├── app.routes.ts                       # route table skeleton
├── app.ts / app.html / app.css         # root shell
├── core/
│   ├── auth/
│   │   ├── auth.service.ts             # Auth0 wrapper
│   │   ├── auth.guard.ts               # functional guard
│   │   └── auth.interceptor.ts         # bearer + session-loss handling
│   └── error/
│       ├── error.interceptor.ts        # HTTP → toast translation
│       └── global-error-handler.ts     # last-resort handler
├── shared/
│   ├── services/toast.service.ts
│   └── components/toast-container/…
└── layout/
    ├── header/…
    └── footer/…
```

> **Why so much before the first feature?** The same way phase 02 set up backend plumbing so each vertical slice could be small, this phase sets up the frontend equivalents. Every Angular feature added from phase 05 onward assumes these utilities exist.

---

## 1. Set up your Auth0 tenant (do this first)

Auth0 is the identity provider — sign-up, social login, MFA, password reset all live there. Three things to create:

### 1a. Sign up / log in to Auth0

1. Visit https://auth0.com and create a free account (no credit card needed for the dev tier).
2. Pick a tenant name (e.g., `your-name-dev`). The tenant **domain** is what your app talks to: `your-name-dev.us.auth0.com`. Save it.

### 1b. Create the Application (SPA)

1. Dashboard → **Applications → Applications → Create Application**.
2. Name: `EventSync Web`. Type: **Single Page Application**. Create.
3. On the **Settings** tab, set:
   - **Allowed Callback URLs**: `http://localhost:4200/auth/callback`
   - **Allowed Logout URLs**: `http://localhost:4200`
   - **Allowed Web Origins**: `http://localhost:4200`
   - **Allowed Origins (CORS)**: `http://localhost:4200`
4. Scroll to **Advanced Settings → Grant Types** — ensure **Authorization Code** and **Refresh Token** are both ticked.
5. Save. Copy the **Client ID** from the top — you'll paste it into `environment.ts`.

### 1c. Create the API audience

1. Dashboard → **Applications → APIs → Create API**.
2. Name: `EventSync API`. **Identifier**: `https://eventsync-api` (exact string; this becomes the JWT `aud` claim). Signing algorithm: **RS256**.
3. After creation, on the **Settings** tab enable **Allow Offline Access** (so refresh tokens are issued).
4. (Optional, recommended) **Token Settings → Token Expiration**: set Access Token Lifetime to something reasonable (e.g., 36 000 seconds = 10 hours). Default is 86 400.

### 1d. Plug the values into config

`client/src/environments/environment.ts` (replace placeholders from phase 01):

```typescript
auth0: {
  domain: 'your-name-dev.us.auth0.com',      // ← from §1a
  clientId: 'AbC123…XyZ',                    // ← from §1b
  authorizationParams: {
    redirect_uri: 'http://localhost:4200/auth/callback',
    audience: 'https://eventsync-api',        // ← from §1c
  },
  cacheLocation: 'localstorage' as const,
  useRefreshTokens: true,
},
```

`server/EventSync.Api/appsettings.json`:

```json
"Auth0": {
  "Domain": "your-name-dev.us.auth0.com",
  "Audience": "https://eventsync-api"
},
"SecurityHeaders": {
  "Auth0Domain": "your-name-dev.us.auth0.com"
}
```

> **Pitfall:** the **identifier** of the Auth0 API (`https://eventsync-api`) is **not** a real URL — it's just a unique string. Don't try to navigate to it. The Auth0 docs use HTTPS-style identifiers because they're guaranteed unique and look like an audience claim should.

---

## 2. `app.config.ts` — Application DI

Replace `client/src/app/app.config.ts`:

```typescript
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAuth0 } from '@auth0/auth0-angular';

import { authInterceptor } from './core/auth/auth.interceptor';
import { errorInterceptor } from './core/error/error.interceptor';
import { GlobalErrorHandler } from './core/error/global-error-handler';
import { environment } from '../environments/environment';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, errorInterceptor])),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideAuth0(environment.auth0),
  ],
};
```

### Line-by-line

- **`provideBrowserGlobalErrorListeners()`** — Angular 21 default; routes uncaught `window.error` / unhandled promise rejections into Angular's `ErrorHandler` (our `GlobalErrorHandler`).
- **`provideRouter(routes, withComponentInputBinding())`** — registers our route table and enables `@Input()` binding from route params/queries (e.g., a component with `@Input() id!: string` automatically receives `:id` from the URL).
- **`provideHttpClient(withFetch(), withInterceptors([...]))`** — modern `HttpClient` backed by the Fetch API (better than the legacy `XMLHttpRequest` backend; supports streaming, no Zone.js workarounds). Interceptors run in declaration order: `authInterceptor` runs first (attaches Bearer), `errorInterceptor` second (sees the response).
- **`{ provide: ErrorHandler, useClass: GlobalErrorHandler }`** — replaces Angular's default ErrorHandler with ours.
- **`provideAuth0(environment.auth0)`** — initialises the Auth0 SPA SDK. The shape of the object matches the SDK's `AuthClientConfig` (domain, clientId, authorizationParams, cacheLocation, useRefreshTokens).

> **Why no `provideAnimations()`?** Toasts use plain CSS animation; we don't pull in `@angular/animations`. Keeps the bundle smaller.

---

## 3. `app.routes.ts` — Route table

Replace `client/src/app/app.routes.ts`:

```typescript
import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
    title: 'Sign in — EventSync',
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/auth-callback/auth-callback.component').then(
        (m) => m.AuthCallbackComponent,
      ),
    title: 'Signing in — EventSync',
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    title: 'Dashboard — EventSync',
  },
  {
    path: 'events',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/events/events.routes').then((m) => m.EVENTS_ROUTES),
  },
  {
    path: 'rsvp',
    loadChildren: () =>
      import('./features/public-rsvp/public-rsvp.routes').then((m) => m.PUBLIC_RSVP_ROUTES),
  },
  { path: '**', redirectTo: 'dashboard' },
];
```

### Line-by-line

- **`{ path: '', pathMatch: 'full', redirectTo: 'dashboard' }`** — root URL goes to dashboard. `pathMatch: 'full'` is mandatory for empty-path redirects (otherwise *every* URL prefix-matches and bounces).
- **`loadComponent: () => import(...).then(m => m.X)`** — lazy-load a single standalone component. Each becomes its own chunk in the build output.
- **`title`** — sets `<title>` automatically when the route activates (Angular 17+ feature). Improves accessibility and tab/bookmark labels.
- **`canActivate: [authGuard]`** — functional guard; runs before navigation completes. See §5.
- **`loadChildren: () => import(...).then(m => m.EVENTS_ROUTES)`** — lazy-load a *route subtree*. The events feature has its own list/create/detail/edit routes (phase 06); they're not loaded until the user hits `/events/*`.
- **`/rsvp` has no guard** — public RSVP pages are anonymous. The backend is the sole authority on whether a token is valid.
- **`{ path: '**', redirectTo: 'dashboard' }`** — wildcard. Unknown URL → dashboard (which then redirects to /login if anonymous). A more polished version would render a custom 404 page; this is the MVP behaviour.

> **Note:** the `loadComponent`/`loadChildren` paths reference files we haven't created yet (`login.component`, `dashboard.component`, `events.routes`, `public-rsvp.routes`). Phase 05+ creates them. For now you can comment out the routes that don't exist — uncomment them as each phase adds the files.

---

## 4. The root component (`app.ts` + `app.html` + `app.css`)

`client/src/app/app.ts`:

```typescript
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { FooterComponent } from './layout/footer/footer';
import { HeaderComponent } from './layout/header/header';
import { ToastContainerComponent } from './shared/components/toast-container/toast-container.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ToastContainerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
```

- **Standalone component** — `imports` array lists everything used in the template; no NgModule.
- **`ChangeDetectionStrategy.OnPush`** — Angular skips change detection on this component unless inputs change, an event fires, or a signal it reads changes. The signal-based services (toast, auth) integrate cleanly with this — fewer wasted re-renders.

`client/src/app/app.html`:

```html
<div class="flex min-h-screen flex-col">
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-indigo-700 focus:px-3 focus:py-2 focus:text-white"
  >
    Skip to main content
  </a>

  <app-header />

  <main id="main-content" class="flex-1" tabindex="-1">
    <router-outlet />
  </main>

  <app-footer />
</div>

<app-toast-container />
```

- **`flex flex-col min-h-screen`** — sticky footer pattern. Main grows to fill remaining space.
- **Skip-link** (`Skip to main content`) — first focusable element. Hidden visually (`sr-only`) until focused (`focus:not-sr-only`). Lets keyboard users jump past the header. **WCAG 2.4.1 (Bypass Blocks)** requirement.
- **`<main tabindex="-1">`** — `tabindex="-1"` allows programmatic focus (when the skip link fires) without inserting `<main>` into the tab order.
- **`<app-toast-container />`** — *outside* the layout div so toasts always overlay (fixed positioning).

`client/src/app/app.css`:

```css
:host {
  display: block;
}
```

- Components are inline by default; making `:host` block-level prevents subtle layout glitches.

---

## 5. The auth wrapper (`AuthService`)

Create `client/src/app/core/auth/auth.service.ts`:

```typescript
import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { Observable, firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth0 = inject(Auth0Service);

  readonly isLoading = toSignal(this.auth0.isLoading$, { initialValue: true });
  readonly isAuthenticated = toSignal(this.auth0.isAuthenticated$, { initialValue: false });
  readonly user = toSignal(this.auth0.user$, { initialValue: undefined });

  readonly displayName = computed(() => {
    const u = this.user();
    return u?.name ?? u?.nickname ?? u?.email ?? 'Account';
  });
  readonly avatarUrl = computed(() => this.user()?.picture ?? null);

  login(appState?: { target?: string }): void {
    this.auth0.loginWithRedirect({ appState }).subscribe({
      error: (err) => console.error('[Auth] loginWithRedirect failed', err),
    });
  }

  logout(): void {
    this.auth0
      .logout({ logoutParams: { returnTo: window.location.origin } })
      .subscribe({
        error: (err) => console.error('[Auth] logout failed', err),
      });
  }

  /** Local-only logout — clears SDK state without round-tripping to Auth0. */
  logoutLocal(): void {
    this.auth0.logout({ openUrl: false }).subscribe({
      error: (err) => console.error('[Auth] local logout failed', err),
    });
  }

  async getAccessToken(): Promise<string> {
    return firstValueFrom(this.auth0.getAccessTokenSilently());
  }

  getAccessToken$(): Observable<string> {
    return this.auth0.getAccessTokenSilently();
  }
}
```

### Line-by-line

- **`AuthService as Auth0Service`** — rename import so our class name doesn't collide with the SDK's.
- **`toSignal(observable$, { initialValue })`** — adapter from RxJS to Angular signals. The Auth0 SDK exposes `isLoading$`, `isAuthenticated$`, `user$` as observables; we convert them to signals so components can read them without subscriptions.
- **`isLoading` initial value `true`** — assume "still loading" until the SDK says otherwise. This is critical for the guard (§6).
- **`displayName`/`avatarUrl` are `computed` signals** — automatically re-derive when `user` changes. Component templates that bind to them update reactively.
- **`login()` / `logout()` use `.subscribe()`** — the Auth0 SDK returns cold observables; they don't execute until subscribed. Easy mistake to call `auth0.loginWithRedirect()` and wonder why nothing happened.
- **`logoutLocal()`** — calls the SDK's `logout` with `openUrl: false`. Clears local session state without redirecting through Auth0's `/v2/logout`. Used by the interceptor (§7) when the session is dead and we want to take the user to our `/login` directly.
- **`getAccessToken$()`** — `getAccessTokenSilently()` either returns a cached valid token or attempts silent renewal via the refresh token. Returns an observable so the interceptor (§7) can chain `.pipe(timeout(...), catchError(...))`.

> **Why a wrapper at all?** Three reasons: (1) translate observables to signals (the SDK doesn't); (2) add `logoutLocal()` (not in the SDK); (3) give us a single seam to mock in tests.

---

## 6. The auth guard (`auth.guard.ts`)

Create `client/src/app/core/auth/auth.guard.ts`:

```typescript
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { Observable, combineLatest, filter, map, take } from 'rxjs';

export const authGuard: CanActivateFn = (_route, state): Observable<boolean | UrlTree> => {
  const auth0 = inject(Auth0Service);
  const router = inject(Router);

  return combineLatest([auth0.isLoading$, auth0.isAuthenticated$]).pipe(
    filter(([isLoading]) => !isLoading),
    take(1),
    map(([, isAuthenticated]) =>
      isAuthenticated
        ? true
        : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }),
    ),
  );
};
```

### Line-by-line — and why this exact shape

- **`CanActivateFn`** is the functional guard signature: `(route, state) => Observable<boolean | UrlTree> | …`. No class needed.
- **`combineLatest([isLoading$, isAuthenticated$])`** — emits whenever either source emits. Initial values: `[true, false]`.
- **`filter(([isLoading]) => !isLoading)`** — **this is the race-condition fix**. On a hard refresh of `/dashboard`, the SDK starts in `isLoading=true, isAuthenticated=false`. Without this filter, the guard would immediately see "not authenticated" and bounce to `/login` even though the session is valid in storage. The filter waits until the SDK has actually finished bootstrapping.
- **`take(1)`** — guards must complete the observable; otherwise the navigation hangs.
- **`router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } })`** — returning a `UrlTree` *redirects* (instead of cancelling). The `returnUrl` query param lets the login page send the user back to where they intended.

> **Security note** — this is a UX guard, **not** an authorization mechanism. A determined user can edit JS to bypass it. The API enforces real authorization via JWT validation; that's the security boundary. The guard exists so users don't see flash-of-protected-content.

---

## 7. The auth interceptor (`auth.interceptor.ts`)

This is the most subtle piece of the entire frontend. It attaches the bearer token, but it *also* handles every silent-renewal failure path so a dead session smoothly redirects to login.

Create `client/src/app/core/auth/auth.interceptor.ts`:

```typescript
import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError, timeout } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ToastService } from '../../shared/services/toast.service';
import { AuthService } from './auth.service';

const AUTH_TOKEN_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MESSAGE = 'auth_timeout';

let redirecting = false;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  if (isPublicEndpoint(req.url)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const toast = inject(ToastService);
  const router = inject(Router);

  return auth.getAccessToken$().pipe(
    timeout({
      each: AUTH_TOKEN_TIMEOUT_MS,
      with: () => throwError(() => new Error(AUTH_TIMEOUT_MESSAGE)),
    }),
    catchError((err) => {
      if (isSessionUnrecoverable(err)) {
        console.warn('[Auth] Session unrecoverable — routing to /login.', err);
        handleSessionLoss(auth, toast, router);
      } else {
        console.error('[Auth] Failed to retrieve access token:', err);
      }
      return throwError(() => err);
    }),
    switchMap((token) => {
      redirecting = false;
      if (!token) {
        return next(req);
      }
      return next(withBearer(req, token));
    }),
  );
};

function isSessionUnrecoverable(err: unknown): boolean {
  if (err instanceof Error && err.message === AUTH_TIMEOUT_MESSAGE) return true;
  return isRefreshTokenError(err);
}

function isRefreshTokenError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const record = err as Record<string, unknown>;

  if (
    record['error'] === 'login_required' ||
    record['error'] === 'missing_refresh_token' ||
    record['error'] === 'invalid_grant'
  ) return true;

  const message = typeof record['message'] === 'string' ? record['message'].toLowerCase() : '';
  return (
    message.includes('missing refresh token') ||
    message.includes('invalid refresh token') ||
    message.includes('unknown or invalid refresh token')
  );
}

function handleSessionLoss(auth: AuthService, toast: ToastService, router: Router): void {
  if (redirecting) return;
  redirecting = true;

  toast.error('Session expired. Please log in again.');
  auth.logoutLocal();

  const returnUrl = router.url && router.url !== '/login' ? router.url : '/dashboard';
  router.navigate(['/login'], { queryParams: { returnUrl } });
}

function isPublicEndpoint(url: string): boolean {
  const path = url.startsWith(environment.apiUrl) ? url.slice(environment.apiUrl.length) : url;
  return path.startsWith('/invite/');
}

function withBearer<T>(req: HttpRequest<T>, token: string): HttpRequest<T> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
```

### Line-by-line

- **`AUTH_TOKEN_TIMEOUT_MS = 10_000`** — bounds two failure modes the Auth0 SDK doesn't bound itself: silent-renewal hangs (third-party cookies disabled → invisible iframe never loads) and offline / very slow networks during refresh. Without this, the user just sees a spinner forever.
- **Module-level `redirecting` flag** — when an event-detail page fires 3 parallel requests and they all fail because the session is dead, we want **one** toast and **one** redirect, not three. The flag is reset on the next successful token retrieval.
- **`req.url.startsWith(environment.apiUrl)` guard** — only attach tokens to our own API. Never leak tokens to third-party origins. This is the audit line; don't relax it.
- **`isPublicEndpoint(req.url)` guard** — the public RSVP endpoints under `/invite/...` are anonymous; if a signed-out guest hits the RSVP page, calling `getAccessToken$()` would throw and the page would never render.
- **`timeout({ each: ..., with: ... })`** — RxJS operator that errors if no value arrives within 10 seconds. The `with` builder lets us emit a *specific* error so `catchError` can distinguish "timeout" from "SDK error".
- **`catchError` → `handleSessionLoss`** — `isSessionUnrecoverable` matches both the timeout sentinel and Auth0's specific refresh-token error codes/messages. On a hit: toast + local logout + redirect to /login.
- **Why both error codes *and* message substrings in `isRefreshTokenError`?** The SDK is inconsistent — some failures expose `error: 'login_required'`, others only set the message. Defensive matching covers both.
- **`switchMap(token => ...)`** — if token retrieval succeeded, attach the bearer and forward. We also reset `redirecting = false` here so a fresh login → fresh session-loss sequence can retrigger.
- **`req.clone({ setHeaders })`** — `HttpRequest` is immutable; you clone to modify.

> **Pitfall — Inverted interceptor order:** if you put `errorInterceptor` *before* `authInterceptor` in `app.config.ts`, the error interceptor never sees the response of authenticated requests because the bearer-attachment step throws before the request even fires. Keep `authInterceptor` first.

---

## 8. The error interceptor (`error.interceptor.ts`)

Create `client/src/app/core/error/error.interceptor.ts`:

```typescript
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { ToastService } from '../../shared/services/toast.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      switch (error.status) {
        case 0:
          toast.error('Unable to connect. Check your internet.');
          break;
        case 400:
          // Validation problems — forms display per-field messages.
          break;
        case 401: {
          toast.error('Session expired. Please log in again.');
          const returnUrl = router.url && router.url !== '/login' ? router.url : '/dashboard';
          router.navigate(['/login'], { queryParams: { returnUrl } });
          break;
        }
        case 403:
          toast.error("You don't have permission to do that.");
          break;
        case 404:
          toast.error('Not found.');
          break;
        case 410:
          // Public-RSVP pages render a Gone-specific message; pass through.
          break;
        case 429:
          toast.error('Too many attempts. Please wait a moment.');
          break;
        default:
          if (error.status >= 500) {
            toast.error('Something went wrong. Please try again.');
          }
          break;
      }

      return throwError(() => error);
    }),
  );
};
```

### Line-by-line / per-status decisions

- **`status === 0`** — network failure / CORS / DNS. No HTTP response at all.
- **`400`** — *don't* show a toast. The form component reads the response body (`error.error.errors`) and shows field-level messages. A toast would be redundant noise.
- **`401`** — the bearer wasn't valid (expired between attachment and reaching the server, revoked, etc.). Toast + redirect. We always re-throw so callers can also react if needed.
- **`403`** — authenticated but not allowed (e.g., trying to view someone else's event). Generic message; we don't reveal whether the resource exists.
- **`404`** — generic "not found". Some pages handle this specifically (the event-detail page might show a custom "event removed" view), so we still re-throw.
- **`410 Gone`** — the public RSVP page maps this to its own "this invite is no longer available" UI; a generic toast would confuse the guest.
- **`429`** — rate limit. Tells the user to wait without spamming retries.
- **`5xx`** — generic "something went wrong". Detailed messages are server-side log info, not user-facing.
- **`return throwError(() => error)`** — always re-throw so the caller's `subscribe({ error: ... })` runs. The toast is *side effect*, not termination.

---

## 9. The global error handler (`global-error-handler.ts`)

Create `client/src/app/core/error/global-error-handler.ts`:

```typescript
import { ErrorHandler, Injectable, inject, isDevMode } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { ToastService } from '../../shared/services/toast.service';

@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toast = inject(ToastService);

  handleError(error: unknown): void {
    if (isDevMode()) {
      console.error('[GlobalErrorHandler]', error);
    } else {
      console.error('[GlobalErrorHandler]', this.summarize(error));
    }

    if (this.isHttpError(error)) {
      return;
    }

    this.toast.error('Something went wrong. Please try again.');
  }

  private isHttpError(error: unknown): boolean {
    return (
      error instanceof HttpErrorResponse ||
      (typeof error === 'object' &&
        error !== null &&
        (error as { rejection?: unknown }).rejection instanceof HttpErrorResponse)
    );
  }

  private summarize(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    if (typeof error === 'string') return error;
    return 'Unknown error';
  }
}
```

### Line-by-line

- **`implements ErrorHandler`** — Angular calls `handleError` for **any** uncaught error in change detection, lifecycle hooks, or unhandled promise rejections.
- **`isDevMode()`** — gates verbose logging. Production builds suppress the full object (which may contain user data or stack traces).
- **`isHttpError` early return** — HTTP errors were already toast-handled by the error interceptor. Without this check, the user gets **two** toasts for every HTTP failure.
- **The double check (`error instanceof HttpErrorResponse` OR `error.rejection instanceof HttpErrorResponse`)** — Angular wraps unhandled promise rejections in an object with a `rejection` property. Some HTTP errors arrive that way.
- **`summarize`** — single-line, PII-free string for production logs.

---

## 10. The toast service + container

Create `client/src/app/shared/services/toast.service.ts`:

```typescript
import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  readonly id: string;
  readonly type: ToastType;
  readonly message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  static readonly AUTO_DISMISS_MS = 4000;

  readonly toasts = signal<readonly ToastMessage[]>([]);

  success(message: string): string { return this.push('success', message); }
  error(message: string): string   { return this.push('error', message); }
  info(message: string): string    { return this.push('info', message); }

  dismiss(id: string): void {
    this.toasts.update((current) => current.filter((t) => t.id !== id));
  }

  private push(type: ToastType, message: string): string {
    const id = this.nextId();
    const toast: ToastMessage = { id, type, message };
    this.toasts.update((current) => [...current, toast]);
    setTimeout(() => this.dismiss(id), ToastService.AUTO_DISMISS_MS);
    return id;
  }

  private nextId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `toast-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }
}
```

### Line-by-line

- **`readonly toasts = signal<readonly ToastMessage[]>([])`** — single reactive source-of-truth. Components read `toasts()` in their template; updates re-render automatically.
- **`toasts.update(current => [...current, toast])`** — immutable update. Signals only fire when the reference changes; mutating the array in place would not trigger re-render.
- **Auto-dismiss via `setTimeout`** — fire-and-forget. Re-entrant `dismiss()` is a no-op (filter removes nothing) so a user manually dismissing before the timer is safe.
- **`crypto.randomUUID()`** with fallback — modern browsers support it; the fallback covers very old runtimes (and Node test environments). No `uuid` package needed.

Create `client/src/app/shared/components/toast-container/toast-container.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ToastService, type ToastType } from '../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toast-container.component.html',
  styleUrl: './toast-container.component.css',
})
export class ToastContainerComponent {
  private readonly toastService = inject(ToastService);

  protected readonly toasts = this.toastService.toasts;

  protected readonly styles = computed(() => {
    const map: Record<ToastType, { container: string; icon: string; label: string }> = {
      success: { container: 'bg-emerald-600 text-white', icon: '\u2713', label: 'Success' },
      error:   { container: 'bg-rose-600 text-white',    icon: '\u2715', label: 'Error' },
      info:    { container: 'bg-slate-800 text-white',   icon: '\u2139', label: 'Information' },
    };
    return map;
  });

  protected dismiss(id: string): void { this.toastService.dismiss(id); }
}
```

`toast-container.component.html`:

```html
<div
  class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-stretch gap-2 p-4 sm:inset-x-auto sm:right-0 sm:bottom-0 sm:max-w-sm sm:items-end"
  tabindex="-1"
>
  @for (toast of toasts(); track toast.id) {
    <div
      role="status"
      aria-live="polite"
      class="toast-enter pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 shadow-lg ring-1 ring-black/5"
      [class]="styles()[toast.type].container"
    >
      <span aria-hidden="true" class="mt-0.5 text-base font-bold leading-none">
        {{ styles()[toast.type].icon }}
      </span>
      <span class="sr-only">{{ styles()[toast.type].label }}:</span>
      <p class="flex-1 text-sm leading-snug">{{ toast.message }}</p>
      <button
        type="button"
        class="-mr-1 rounded p-1 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        [attr.aria-label]="'Dismiss ' + styles()[toast.type].label.toLowerCase() + ' notification'"
        (click)="dismiss(toast.id)"
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  }
</div>
```

`toast-container.component.css`:

```css
@keyframes toast-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.toast-enter {
  animation: toast-slide-in 180ms ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter { animation: none; }
}
```

### Why this shape

- **`pointer-events-none` on the container, `pointer-events-auto` on each toast** — clicks pass through empty space (no invisible overlay blocking clicks).
- **`role="status"` + `aria-live="polite"`** — screen readers announce new toasts without stealing focus from the current activity.
- **`@for (… ; track toast.id)`** — Angular's new control flow (replaces `*ngFor`). The `track` is mandatory; using `toast.id` ensures stable DOM nodes so animations only run on real additions.
- **`prefers-reduced-motion`** — accessibility win for users who disable motion in their OS.

---

## 11. Header + Footer

`client/src/app/layout/footer/footer.ts`:

```typescript
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './footer.html',
  styleUrl: './footer.css',
})
export class FooterComponent {
  private readonly nowYear = signal(new Date().getFullYear());
  protected readonly year = computed(() => this.nowYear());
}
```

`footer.html`:

```html
<footer class="mt-auto border-t border-slate-200 bg-white">
  <div class="mx-auto max-w-6xl px-4 py-4 text-center text-sm text-slate-600 sm:px-6">
    <p>&copy; {{ year() }} EventSync. All rights reserved.</p>
  </div>
</footer>
```

`footer.css`: empty (or a single `:host { display: contents; }` if you prefer).

> **Why a signal for the year?** Marginal — the year doesn't change during a session. But it forces us to never call `new Date()` directly in a template (which would re-execute every change detection cycle).

`client/src/app/layout/header/header.ts`:

```typescript
import {
  ChangeDetectionStrategy, Component, ElementRef, computed,
  inject, signal, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-header',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './header.html',
  styleUrl: './header.css',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'closeMenu()',
  },
})
export class HeaderComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly isPublicPage = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.startsWith('/rsvp')),
    ),
    { initialValue: this.router.url.startsWith('/rsvp') },
  );

  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  protected readonly isMenuOpen = signal(false);

  protected readonly isAuthenticated = this.auth.isAuthenticated;
  protected readonly isLoading = this.auth.isLoading;
  protected readonly displayName = this.auth.displayName;
  protected readonly avatarUrl = this.auth.avatarUrl;

  protected readonly avatarInitial = computed(() => {
    const name = this.displayName();
    return name?.charAt(0)?.toUpperCase() ?? '?';
  });

  protected toggleMenu(): void { this.isMenuOpen.update((open) => !open); }

  protected closeMenu(): void {
    if (!this.isMenuOpen()) return;
    this.isMenuOpen.set(false);
    this.menuButton()?.nativeElement.focus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.isMenuOpen()) return;
    const target = event.target as Node | null;
    const button = this.menuButton()?.nativeElement;
    if (button && target && (button === target || button.contains(target))) return;
    this.isMenuOpen.set(false);
  }

  protected onSignOut(): void {
    this.isMenuOpen.set(false);
    this.auth.logout();
  }
}
```

### Key things to notice

- **`host: { '(document:click)': '...', '(document:keydown.escape)': '...' }`** — declarative host listeners. `document:click` lets us close the menu when clicking outside; `Escape` is the keyboard equivalent.
- **`viewChild<ElementRef<HTMLButtonElement>>('menuButton')`** — modern signal-based ViewChild (Angular 17+). Strongly typed; `menuButton()` returns the ElementRef.
- **`isPublicPage`** — derived from the router event stream; on `/rsvp/*` the header simplifies (no login button, no nav). Demonstrates the `toSignal` pattern for observables that aren't from a service.
- **Avatar fallback** — if no `picture` claim, show the first letter of the display name on an indigo circle. Common UX pattern; never leaves users with a broken image icon.
- **`onDocumentClick`** — explicit guard: only close if the click wasn't on the trigger button itself (otherwise toggling would immediately re-close).

The full template (`header.html`) is in the repo — copy it verbatim. The key sections are:

- Auth-aware right-hand nav (sign-in button when anonymous, avatar/name dropdown when authenticated, skeleton placeholder while `isLoading`).
- `<a routerLink="/">` logo when on protected pages; non-link logo on public RSVP pages.
- Accessible menu: `aria-haspopup="menu"`, `aria-expanded`, `role="menu"` / `role="menuitem"`.

---

## 12. Final verification

You'll need login/dashboard placeholders (we'll flesh them out in phase 05). For now, create minimal stubs so the routes resolve:

```typescript
// client/src/app/features/auth/login/login.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-md p-8 text-center">
      <h1 class="mb-4 text-2xl font-bold">Welcome to EventSync</h1>
      <button
        type="button"
        class="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        (click)="signIn()"
      >Sign in with Auth0</button>
    </section>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  signIn(): void { this.auth.login(); }
}
```

```typescript
// client/src/app/features/auth/auth-callback/auth-callback.component.ts
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-auth-callback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="p-8 text-center text-slate-600">Signing you in…</p>`,
})
export class AuthCallbackComponent {}
```

```typescript
// client/src/app/features/dashboard/dashboard.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-4xl p-8">
      <h1 class="mb-2 text-3xl font-bold">Dashboard</h1>
      <p class="text-slate-700">Hello, {{ name() }}.</p>
    </section>
  `,
})
export class DashboardComponent {
  protected readonly name = inject(AuthService).displayName;
}
```

For now, comment out the `/events` and `/rsvp` routes in `app.routes.ts` — we'll uncomment them in phases 06 and 09.

Now build + run:

```powershell
cd client
ng serve --port 4200
```

---

## Checkpoint

You've passed this phase when:

1. The Angular build compiles with no errors (`ng serve` runs).
2. Open `http://localhost:4200/`. You're redirected to `/login` (the guard fires).
3. The header renders with the EventSync title/logo and a "Sign in" button.
4. Click "Sign in". You're redirected to Auth0's Universal Login.
5. After logging in (sign up if needed), you land on `/auth/callback` momentarily, then `/dashboard`.
6. The header now shows your avatar + display name + dropdown. Clicking the avatar opens a menu. Clicking outside or pressing `Escape` closes it. Sign-out works and redirects you back to `/login`.
7. Open DevTools → Application → Local Storage → `http://localhost:4200`. You see Auth0-prefixed keys (`@@auth0spajs@@...`) — the SDK's session cache.
8. Hard-refresh `/dashboard` while signed in. **You stay on dashboard**, not flicker to `/login`. This proves the `authGuard` race-condition fix works.
9. Network tab: navigate to a (still nonexistent) `http://localhost:4200/dashboard` and watch the request flow — you'll see `getAccessTokenSilently` activity from the Auth0 SDK and no requests to your API yet (you haven't built any data endpoints).
10. Trigger a fake error: open DevTools console and run `await fetch('http://localhost:5000/api/v1/events', { headers: { Authorization: 'Bearer fake' } }).then(r => r.status)`. Should return 401 from the API.

---

Next: [05-vertical-slice-auth.md](./05-vertical-slice-auth.md) — first full end-to-end slice. Backend `Features/Auth` (profile get/update) + frontend `auth.service` + filling in the dashboard with the user's actual profile from the API.
