# Phase 05 — Vertical Slice 1: Auth Profile

Goal: build the first **end-to-end vertical slice**. Backend `Features/Auth` exposes `GET /api/v1/auth/profile` and `PUT /api/v1/auth/profile`. Frontend consumes them and replaces the placeholder dashboard with a real authenticated screen.

This is the simplest possible slice — no validators with complex rules, no database side-effects beyond updating one row, no file uploads. Use it to internalise the slice pattern. Every later feature (Events, RSVPs, Invite Links, Uploads) uses the same anatomy.

---

## Vertical-slice anatomy

```
server/EventSync.Api/Features/Auth/
├── AuthEndpoints.cs       # MapGet / MapPut registrations
├── UserProfileDto.cs      # Public response type
├── GetProfile/
│   └── GetProfile.cs      # Query + Handler (no validator needed)
└── UpdateProfile/
    └── UpdateProfile.cs   # Command + Validator + Handler

client/src/app/
├── core/models/user-profile.model.ts   # Mirrors the DTO
├── core/api/auth-api.service.ts        # Typed HTTP client
└── features/
    ├── auth/{login, auth-callback}/    # Already created in phase 04, polished here
    └── dashboard/dashboard.component.* # Replaces phase-04 placeholder
```

> **Why per-slice folders inside a single feature?** Each request type owns its file. `GetProfile.cs` holds the query record, handler, and (if needed) validator. Adding `DeleteProfile` later means a single new file in a `DeleteProfile/` folder — zero edits to anything else.

---

## 1. The DTO — `UserProfileDto.cs`

Create `server/EventSync.Api/Features/Auth/UserProfileDto.cs`:

```csharp
namespace EventSync.Api.Features.Auth;

public record UserProfileDto(Guid Id, string Email, string DisplayName, string? AvatarUrl);
```

- **`record`** — value-equality + immutable by default. Perfect for DTOs (you want two profiles with the same fields to compare equal in tests).
- **Why not return the `User` entity directly?** Entities can include navigation properties (Events list, etc.) and EF-tracked metadata. DTOs are the public contract you control — adding a column to `User` shouldn't accidentally leak it through the API.
- **`Guid` serialises as a JSON string** — `"id": "5f4...-..."`. The frontend mirror types it as `string`.

---

## 2. The query — `GetProfile.cs`

Create `server/EventSync.Api/Features/Auth/GetProfile/GetProfile.cs`:

```csharp
using EventSync.Api.Common.Services;
using MediatR;

namespace EventSync.Api.Features.Auth.GetProfile;

public sealed record GetProfileQuery : IRequest<UserProfileDto>;

public sealed class GetProfileHandler : IRequestHandler<GetProfileQuery, UserProfileDto>
{
    private readonly ICurrentUserService _currentUser;

    public GetProfileHandler(ICurrentUserService currentUser)
    {
        _currentUser = currentUser;
    }

    public async Task<UserProfileDto> Handle(GetProfileQuery request, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetOrCreateUserAsync(cancellationToken);
        return new UserProfileDto(user.Id, user.Email, user.DisplayName, user.AvatarUrl);
    }
}
```

### Line-by-line

- **`sealed record GetProfileQuery : IRequest<UserProfileDto>`** — a marker request type. `sealed` because nobody should derive from it. `IRequest<TResponse>` tells MediatR the handler returns `UserProfileDto`.
- **Parameterless record** — `GetProfileQuery` carries no data because everything we need (the current user) comes from the auth principal, not the request body.
- **`ICurrentUserService.GetOrCreateUserAsync`** — JIT (just-in-time) provisioning. The first time a user authenticates with Auth0, we don't yet have a row in our `Users` table. This method:
  1. Reads `auth0_sub` from the JWT claims.
  2. Looks up the user by `Auth0Sub`.
  3. If not found, inserts a new `User` row using claims (email, name, picture) from the token.
  4. Returns the `User` entity.
- **No validator** — there's nothing to validate; the request has no body.

---

## 3. The command — `UpdateProfile.cs`

Create `server/EventSync.Api/Features/Auth/UpdateProfile/UpdateProfile.cs`:

```csharp
using EventSync.Api.Common.Services;
using EventSync.Api.Data;
using FluentValidation;
using MediatR;

namespace EventSync.Api.Features.Auth.UpdateProfile;

public sealed record UpdateProfileCommand(string DisplayName, string? AvatarUrl)
    : IRequest<UserProfileDto>;

public sealed class UpdateProfileValidator : AbstractValidator<UpdateProfileCommand>
{
    public UpdateProfileValidator()
    {
        RuleFor(x => x.DisplayName)
            .NotEmpty()
            .MaximumLength(100);

        RuleFor(x => x.AvatarUrl)
            .MaximumLength(512)
            .Must(BeAValidAbsoluteUrl)
                .WithMessage("AvatarUrl must be a valid absolute http(s) URL.")
            .When(x => !string.IsNullOrWhiteSpace(x.AvatarUrl));
    }

    private static bool BeAValidAbsoluteUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }
}

public sealed class UpdateProfileHandler : IRequestHandler<UpdateProfileCommand, UserProfileDto>
{
    private readonly ICurrentUserService _currentUser;
    private readonly AppDbContext _dbContext;

    public UpdateProfileHandler(ICurrentUserService currentUser, AppDbContext dbContext)
    {
        _currentUser = currentUser;
        _dbContext = dbContext;
    }

    public async Task<UserProfileDto> Handle(UpdateProfileCommand request, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetOrCreateUserAsync(cancellationToken);

        user.DisplayName = request.DisplayName.Trim();
        user.AvatarUrl = string.IsNullOrWhiteSpace(request.AvatarUrl) ? null : request.AvatarUrl.Trim();
        user.UpdatedAt = DateTime.Now;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return new UserProfileDto(user.Id, user.Email, user.DisplayName, user.AvatarUrl);
    }
}
```

### Line-by-line

- **Three classes in one file** — convention. The command, its validator, and its handler all belong together. Keep them together so a developer reading the file sees the full pipeline.
- **`UpdateProfileValidator`** — auto-discovered by FluentValidation's assembly scan (`AddValidatorsFromAssemblyContaining<Program>()`) and runs *both* automatically on the request body (HTTP boundary) *and* through `ValidationBehavior<,>` (MediatR pipeline). Defence-in-depth.
- **`.When(x => !string.IsNullOrWhiteSpace(x.AvatarUrl))`** — conditional rules. URL validation only runs if a URL was supplied. Otherwise an empty avatar is treated as "remove the avatar".
- **`Uri.TryCreate(... UriKind.Absolute ...)`** — must be a full URL, not a relative path. We additionally require `http`/`https` — never accept `javascript:` or `data:` URLs which could lead to XSS when rendered as `<img src>` (browsers do generally block them in `img.src`, but defence-in-depth).
- **Handler reads then mutates `user`** — `GetOrCreateUserAsync` returns the *tracked* entity from the DbContext, so mutating its properties marks it as Modified. `SaveChangesAsync` writes the single UPDATE.
- **`.Trim()`** — silently fix leading/trailing whitespace. Validators check `NotEmpty` after trim conceptually; if a user pastes `"  Alice  "`, we store `"Alice"`.
- **`user.UpdatedAt = DateTime.Now`** — manual stamp. (A `SaveChangesInterceptor` could automate this; we opted for explicit code at the cost of one line per write.)
- **Return the freshly persisted DTO** — the frontend can update its signal with the canonical value (in case the server trimmed/normalised the input).

---

## 4. The endpoint mapper — `AuthEndpoints.cs`

Create `server/EventSync.Api/Features/Auth/AuthEndpoints.cs`:

```csharp
using EventSync.Api.Features.Auth.GetProfile;
using EventSync.Api.Features.Auth.UpdateProfile;
using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace EventSync.Api.Features.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/auth")
            .WithTags("Auth")
            .RequireAuthorization();

        group.MapGet("/profile", async (IMediator mediator, CancellationToken ct) =>
        {
            var profile = await mediator.Send(new GetProfileQuery(), ct);
            return Results.Ok(profile);
        })
        .WithName("GetProfile")
        .WithSummary("Get the current user's profile (provisions on first call).")
        .Produces<UserProfileDto>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized);

        group.MapPut("/profile", async (
            [FromBody] UpdateProfileCommand command,
            IMediator mediator,
            CancellationToken ct) =>
        {
            try
            {
                var updated = await mediator.Send(command, ct);
                return Results.Ok(updated);
            }
            catch (ValidationException ex)
            {
                var errors = ex.Errors
                    .GroupBy(e => e.PropertyName)
                    .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());
                return Results.ValidationProblem(errors);
            }
        })
        .WithName("UpdateProfile")
        .WithSummary("Update the current user's display name and avatar URL.")
        .Produces<UserProfileDto>(StatusCodes.Status200OK)
        .ProducesValidationProblem()
        .Produces(StatusCodes.Status401Unauthorized);

        return app;
    }
}
```

### Line-by-line

- **`MapGroup("/api/v1/auth")`** — all endpoints inherit the path prefix and the tags/auth requirements added to the group.
- **`.WithTags("Auth")`** — groups endpoints in Swagger UI.
- **`.RequireAuthorization()`** — every endpoint in the group needs a valid bearer token. Without this, anyone could call `/profile`.
- **`IMediator mediator, CancellationToken ct` parameters** — minimal APIs do parameter binding from DI for services and from `HttpContext.RequestAborted` for `CancellationToken`. No `[FromServices]` needed.
- **`[FromBody] UpdateProfileCommand`** — explicit to make the binding source obvious (the framework can infer it, but explicit is clearer).
- **`try/catch (ValidationException)`** — Note: this catch block is a fallback. The same `ValidationException` is also caught by our `ExceptionHandlingMiddleware` from phase 02. We keep the local handler because it returns `Results.ValidationProblem` with the exact RFC 7807 shape Angular's reactive forms expect. The middleware's version writes a slightly different format used by other errors.
- **`.Produces<T>(...)`** / **`.ProducesValidationProblem()`** — OpenAPI metadata. Swagger UI shows the response shapes; clients generated from the OpenAPI doc get strong types.

### Wire it into `Program.cs`

In `server/EventSync.Api/Program.cs`, find the section near the bottom labelled "Map endpoint groups" and add (or uncomment from phase 02):

```csharp
using EventSync.Api.Features.Auth;
// ...
app.MapAuthEndpoints();
```

Build + run the backend:

```powershell
cd server/EventSync.Api
dotnet run
```

Hit `https://localhost:5000/swagger`. You should see the **Auth** tag with `GET /api/v1/auth/profile` and `PUT /api/v1/auth/profile`. Both should show a lock icon (require auth).

---

## 5. Test the backend in Swagger

To test, you need a real bearer token. Easiest path:

1. Run the frontend (`ng serve` in `client/`) and log in. Open DevTools → Application → Local Storage → look at any `@@auth0spajs@@...::access_token` value. Copy the `access_token` field from the JSON.
2. In Swagger, click **Authorize** (top right) → enter `Bearer {paste your token}`.
3. Try `GET /api/v1/auth/profile`. First call: should return your provisioned user (Id is a fresh Guid, Email/DisplayName/AvatarUrl from Auth0 claims).
4. Try `PUT /api/v1/auth/profile` with body `{ "displayName": "New Name", "avatarUrl": null }`. Should return 200 with the updated profile.
5. Try the same PUT with `{ "displayName": "", "avatarUrl": "javascript:alert(1)" }`. Should return 400 with field-level errors.

> **Visual Studio note:** With the API project running, the Swagger UI also lives at `https://localhost:5000/swagger`. The **Test Explorer** doesn't have tests yet (we don't write unit tests in this guide), but VS will let you set breakpoints inside `UpdateProfileHandler.Handle` and step through.

---

## 6. The frontend mirror — `user-profile.model.ts`

Create `client/src/app/core/models/user-profile.model.ts`:

```typescript
export interface UserProfileDto {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl?: string | null;
}
```

- **`interface`** (not `class`) — purely structural; no runtime cost. TypeScript erases at compile time.
- **`readonly`** — discourages accidental mutation in components.
- **`id: string`** — backend `Guid` serialises to a JSON string.
- **`avatarUrl?: string | null`** — both `undefined` (field absent) and `null` (field explicitly null) are valid. The backend always emits the field but may set it to `null`.

---

## 7. The typed client — `auth-api.service.ts`

Create `client/src/app/core/api/auth-api.service.ts`:

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import type { UserProfileDto } from '../models/user-profile.model';

export interface UpdateProfilePayload {
  readonly displayName: string;
  readonly avatarUrl?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/auth`;

  getProfile(): Observable<UserProfileDto> {
    return this.http.get<UserProfileDto>(`${this.baseUrl}/profile`);
  }

  updateProfile(payload: UpdateProfilePayload): Observable<UserProfileDto> {
    return this.http.put<UserProfileDto>(`${this.baseUrl}/profile`, payload);
  }
}
```

### Line-by-line

- **`providedIn: 'root'`** — singleton, tree-shakable. No need to register in `app.config.ts`.
- **`private readonly baseUrl = \`${environment.apiUrl}/auth\``** — single source of truth for the auth API root. Concatenated once in the constructor.
- **`HttpClient.get<T>` / `.put<T>`** — `T` is a *type assertion* on the response body; no runtime validation. If the backend returns a different shape, TypeScript won't catch it (use Zod or similar for runtime parsing if needed; not done in this project).
- **Bearer token attachment is automatic** — the `authInterceptor` from phase 04 already prepends `Authorization: Bearer …` for any URL starting with `environment.apiUrl`. The service doesn't think about auth.
- **`UpdateProfilePayload` is duplicated from `UpdateProfileCommand`** — by design. The shared shape is the wire contract, not a code artefact. If you wanted full type-sharing, generate TypeScript from the OpenAPI doc; we skipped that to keep the build simple.

---

## 8. Polish the login page

Replace the stub from phase 04 with `client/src/app/features/auth/login/login.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12 sm:px-6"
      aria-labelledby="login-heading"
    >
      <div class="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div class="text-center">
          <p class="text-3xl" aria-hidden="true">📅</p>
          <h1 id="login-heading" class="mt-2 text-2xl font-semibold text-slate-900">
            Sign in to EventSync
          </h1>
          <p class="mt-2 text-sm text-slate-600">
            Plan, share, and track event RSVPs in one place.
          </p>
        </div>

        <button
          type="button"
          (click)="onSignIn()"
          [disabled]="isBusy()"
          [attr.aria-busy]="isBusy() ? 'true' : 'false'"
          class="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          @if (isBusy()) {
            <span aria-hidden="true">…</span>
            <span>Redirecting…</span>
          } @else {
            <span aria-hidden="true">🔐</span>
            <span>Sign in with Auth0</span>
          }
        </button>

        <p class="mt-6 text-center text-xs text-slate-500">
          By signing in you agree to the EventSync terms of service.
        </p>
      </div>
    </section>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly isBusy = computed(() => this.auth.isLoading());

  constructor() {
    effect(() => {
      if (!this.auth.isLoading() && this.auth.isAuthenticated()) {
        const target = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
        this.router.navigateByUrl(target);
      }
    });
  }

  protected onSignIn(): void {
    const target = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
    this.auth.login({ target });
  }
}
```

### Line-by-line — focus on `effect` + `returnUrl`

- **`effect(() => { ... })`** — runs whenever any signal read inside it changes. Reads `isLoading()` and `isAuthenticated()`. When the user lands on `/login` already signed in, this immediately bounces them to their target.
- **`route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard'`** — preserves the destination the `authGuard` redirected from. So when someone deep-links to `/events/abc123` while signed out, the guard sends them to `/login?returnUrl=%2Fevents%2Fabc123`, and after login they end up on the original URL.
- **`auth.login({ target })`** — passes the URL as Auth0 `appState`. The SDK echoes it back via `appState$` after the callback; we don't currently subscribe to that — the `effect` above re-runs once the session is restored and handles navigation. Either path works.
- **`[disabled]="isBusy()"`** + **`[attr.aria-busy]`** — visual disable + a screen-reader announcement during the redirect.

---

## 9. Polish the callback page

Replace `client/src/app/features/auth/auth-callback/auth-callback.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-auth-callback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4"
      aria-labelledby="callback-heading"
    >
      <div class="text-center">
        <h1 id="callback-heading" class="sr-only">Completing sign-in</h1>
        <div
          class="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600"
          aria-hidden="true"
        ></div>
        <p role="status" aria-live="polite" class="mt-4 text-sm font-medium text-slate-700">
          Completing sign-in…
        </p>
      </div>
    </section>
  `,
})
export class AuthCallbackComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (this.auth.isLoading()) return;
      const target = this.auth.isAuthenticated() ? '/dashboard' : '/login';
      this.router.navigateByUrl(target);
    });
  }
}
```

- **What the Auth0 SDK does invisibly while this is on screen**: parses `code` + `state` from the URL, exchanges them for tokens at Auth0's `/oauth/token`, validates the ID token signature, stores tokens, removes the query string from the URL, emits `isAuthenticated$ = true`.
- **The `effect`** then forwards to `/dashboard` (success) or `/login` (failure — happens if the user denied consent or there was a state mismatch).

---

## 10. The real dashboard

> The full dashboard in the repo also shows event stats and the next five events. Those depend on the **Events** slice from phase 06. For now, build a profile-only dashboard; phase 06 extends it.

Replace `client/src/app/features/dashboard/dashboard.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { AuthApiService } from '../../core/api/auth-api.service';
import { AuthService } from '../../core/auth/auth.service';
import type { UserProfileDto } from '../../core/models/user-profile.model';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-4xl px-4 py-8 sm:px-6" aria-labelledby="dashboard-heading">
      <h1 id="dashboard-heading" class="text-3xl font-bold text-slate-900">
        Welcome back, {{ displayName() }}!
      </h1>

      @if (profile(); as p) {
        <dl class="mt-6 grid gap-4 sm:grid-cols-2">
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <dt class="text-xs font-semibold uppercase text-slate-500">Email</dt>
            <dd class="mt-1 text-slate-900">{{ p.email }}</dd>
          </div>
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <dt class="text-xs font-semibold uppercase text-slate-500">User ID</dt>
            <dd class="mt-1 truncate text-xs text-slate-700">{{ p.id }}</dd>
          </div>
        </dl>
      } @else if (loading()) {
        <p class="mt-6 text-slate-600">Loading profile…</p>
      } @else if (error()) {
        <p role="alert" class="mt-6 rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {{ error() }}
        </p>
      }
    </section>
  `,
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly api = inject(AuthApiService);

  protected readonly displayName = this.auth.displayName;
  protected readonly profile = signal<UserProfileDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.api.getProfile().subscribe({
      next: (p) => { this.profile.set(p); this.loading.set(false); },
      error: () => { this.error.set('Could not load profile.'); this.loading.set(false); },
    });
  }
}
```

### Line-by-line

- **`this.api.getProfile().subscribe`** in the constructor — fires once when the component is constructed. Triggers the JIT user provisioning on the backend.
- **`signal<UserProfileDto | null>(null)`** — `null` initial state lets the template gate the entire DL with `@if (profile(); as p)`.
- **`error.set(...)`** — generic message. Detail is already in the toast (the error interceptor showed it).
- **`@if (...; as p)`** — Angular 17+ control flow with aliasing. Inside the block `p` is non-null.

### Why the constructor pattern?

We don't use `OnInit` because the constructor runs in the injection context and signals work cleanly there. For HTTP calls, either works — pick the convention your team prefers. The repo's real dashboard also runs HTTP in the constructor.

---

## 11. The full sign-in flow (sequence)

```
Browser           Angular (SPA)          Auth0                  EventSync API
   │                  │                    │                          │
   │ → /dashboard     │                    │                          │
   │                  │  authGuard waits   │                          │
   │                  │  for isLoading=false                          │
   │                  │  isAuth=false      │                          │
   │ ← redirect /login│                    │                          │
   │ user clicks Sign in                   │                          │
   │ → loginWithRedirect()                 │                          │
   │ ─────────────────────────── /authorize?response_type=code        │
   │                                        │  (Universal Login UI)  │
   │ user enters creds; Auth0 sets cookie   │                          │
   │ ← 302 redirect /auth/callback?code=…&state=…                     │
   │ callback component mounts              │                          │
   │ SDK exchanges code+state ──────→ /oauth/token (PKCE verifier)    │
   │                          ← {access_token, id_token, refresh_token}
   │ effect: isAuth=true → router /dashboard                          │
   │ dashboard ctor → getProfile() ────────────────→ GET /auth/profile│
   │ authInterceptor: ─────── getAccessTokenSilently → cached token   │
   │           attaches Authorization: Bearer …                       │
   │                                          backend: JWT validated  │
   │                                          ICurrentUserService     │
   │                                          inserts row if missing  │
   │ ← 200 { id, email, displayName, avatar }                          │
   │ profile.set(p) → DOM updates                                     │
```

> **Why does the access token contain `sub` like `auth0|6500…` even for Google sign-ins?** Auth0 is the identity provider; it wraps Google/Facebook/etc as connections. The `sub` claim identifies the *Auth0 user*, which has a stable mapping to the underlying connection identity.

---

## Checkpoint

You've passed this phase when:

1. Backend builds and `dotnet run` starts on port 5000.
2. Swagger UI shows the `Auth` tag with GET + PUT profile endpoints.
3. From the frontend: log in, land on dashboard, see your email + Guid id displayed.
4. Check the `Users` table in SQL Server (e.g., SSMS): a row exists with `Auth0Sub` matching your Auth0 user `sub`.
5. Open DevTools → Network. The dashboard fires `GET /auth/profile` and you see `Authorization: Bearer …` in the request headers and a `200` response with the profile JSON.
6. Kill the backend (`Ctrl+C`). Hard-refresh the dashboard. You see the error toast "Unable to connect…" and the local-state "Could not load profile." message — confirming the error interceptor + component error handling fire together cleanly.
7. Restart the backend and refresh. The dashboard loads again without an additional sign-in.
8. (Optional) Manually call `PUT /auth/profile` from Swagger with a new `displayName`. Refresh the dashboard — but note Auth0's `name` claim doesn't change. The header still shows the Auth0 display name (because `AuthService.displayName` is sourced from the Auth0 user claims, not the local profile). This is a real design choice you'd debate in an interview: do you mirror Auth0 → local, local → Auth0 (Management API), or display both? Our current design uses Auth0 for header display and lets the local DisplayName be the "EventSync-only" alias.

---

Next: [06-vertical-slice-events.md](./06-vertical-slice-events.md) — the biggest slice. Event CRUD + EventType lookup + list/detail/edit pages + dashboard stats.
