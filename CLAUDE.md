# EventSync — guide for Claude Code

EventSync is an event-invitation app. An organizer signs in, creates events, shares invite links or QR codes, and guests RSVP anonymously. The organizer then sees the responses and can export them.

It is a portfolio project that runs on Azure **free tiers at $0/month**. Many decisions follow from that, so read **Production & free-tier constraints** before touching hosting, health checks, startup or the database.

## Stack

| Area | Tech |
|---|---|
| Frontend (`client/`) | Angular 21: standalone components, signals, OnPush, new control flow, reactive forms. Tailwind CSS 4. `@auth0/auth0-angular` (PKCE, refresh tokens in localStorage). Vitest is configured, but there are no specs yet. |
| Backend (`server/EventSync.Api/`) | .NET 10 Minimal API. MediatR 14 vertical slices with a FluentValidation pipeline. EF Core 10 on SQL Server. Auth0 JWT bearer. Swagger in Development only. QRCoder. |
| Tests (`server/EventSync.Api.Tests/`) | xUnit. Integration tests use `WebApplicationFactory` with EF InMemory. There are 39 tests. |
| Prod hosting | Azure Static Web Apps Free (SPA), App Service **F1 Linux** (API), Azure SQL **Free Offer** (serverless DB), Auth0 free tenant |

## Repo map

- `client/src/app/`
  - `core/`: `api/` services, `auth/` (service, guard, interceptor), `error/` (error interceptor, global handler), `models/`.
  - `features/`: `auth`, `dashboard`, `events` (list, create, edit, detail, history, invite-link manager, RSVP list), `public-rsvp`.
  - `shared/`: components, pipes, services, validators.
  - `layout/`
- `server/EventSync.Api/`
  - `Program.cs` is the composition root and middleware pipeline.
  - `Features/<Feature>/<UseCase>/<UseCase>.cs`; features are Auth, Events, EventTypes, InviteLinks, RSVPs and Uploads.
  - `Common/`: middleware, exceptions, behaviors, services.
  - `Data/`: `AppDbContext` (seeds 11 EventTypes), Fluent configurations, entities.
  - `Migrations/`
- `.github/workflows/`: `azure-api-deploy.yml` (tests, then a ReadyToRun publish to App Service), `azure-web-deploy.yml` (SPA to SWA), `keep-alive.yml` (backup `/health` pinger).
- Docs:
  - `README.md`: features, phases, endpoints.
  - `DEPLOYMENT.md`: very long; Azure setup is in Part A. §6.6 covers migrations and §6.8 covers cold starts and the free budget.
  - `docs/rebuild/`: step-by-step rebuild guide, phases 01–07.
  - `.github/modernize/rearchitecture/artifacts/`: per-unit behavior and contract YAML.
  - `EventSync-Technical-Blueprint.html`: the original blueprint.
- `docker-compose.yaml` + `proxy/`: local stack (SQL Server 2022, api, nginx web, nginx proxy on :80). It reads `.env`, which must **never be committed**.

## Commands

```powershell
# Backend (needs server/EventSync.Api/appsettings.Development.json with ConnectionStrings:DefaultConnection, e.g. LocalDB)
scripts/run-backend.ps1            # restore + dotnet ef database update + dotnet run → http://localhost:5000 (Swagger /swagger)
scripts/run-backend.ps1 -SkipMigrations
dotnet test "Events App.sln"       # from repo root

# Frontend
scripts/run-frontend.ps1           # npm install + npm start → http://localhost:4200
cd client; npm run build           # production build (default config) → client/dist/client/browser

# Migrations (from server/EventSync.Api). Never use --no-build right after adding one.
dotnet ef migrations add <Name>

# Full local stack
docker compose up --build          # http://localhost; migrates automatically (Database__MigrateOnStartup=true)
```

There is no lint script or ESLint. Prettier settings live in `client/package.json` (printWidth 100, singleQuote).

## Conventions

**Backend**
- **One file per use case:**
  - `sealed record XxxQuery/XxxCommand(...) : IRequest<TDto>`
  - `sealed class XxxValidator : AbstractValidator<…>`
  - `sealed class XxxHandler : IRequestHandler<…>`
  - Namespace: `EventSync.Api.Features.<Feature>.<UseCase>`.
- Each feature has `<Feature>Endpoints.cs` with a `Map<Feature>Endpoints` extension. It uses `MapGroup("/api/v1/...")` and thin lambdas that call `mediator.Send`, plus `.WithName/.WithSummary/.Produces<>`. Public endpoints need an explicit `.AllowAnonymous()`.
- **Errors are exceptions, not Result types:**
  - `ValidationException`, `NotFoundException`, `ForbiddenAccessException`, `InvalidInviteException` (410), `EventFullException` (409).
  - `ExceptionHandlingMiddleware` turns them into RFC 7807 ProblemDetails.
- DTOs are positional records mapped by hand. Mapster is referenced but unused, so don't introduce it. Reads use `AsNoTracking()`.
- Ownership checks happen in handlers via `ICurrentUserService`. `GetOrCreateUserAsync` creates the local user on the first API call.
- Soft delete uses global query filters (`!IsDeleted`).
- **Timestamps:** audit timestamps use `DateTime.UtcNow`. User-entered event dates (`StartDate`, `EndDate`, `ExpiresAt`) are timezone-less local values compared with `DateTime.Now`. This is intentional.
- EF uses `EnableRetryOnFailure`, so **don't add manual transactions** (`BeginTransaction`/`TransactionScope`) unless you wrap them in `db.Database.CreateExecutionStrategy().ExecuteAsync(...)`.
- Public members have XML doc comments.

**Frontend**
- Use `inject()`, not constructor DI; `input()`/`input.required()`/`output()`; `computed()`; `@if`/`@for`.
- Components are OnPush with the `app-` selector prefix, in `kebab-name/kebab-name.component.ts`.
- Services are `providedIn: 'root'` and return Observables; signals hold UI state.
- Interceptors and guards are functional. The interceptor order is `authInterceptor`, then `errorInterceptor`.
- TS strict and `strictTemplates` are on. Styling is Tailwind utilities.
- Accessibility matters: live regions, focus traps, a skip link, and an axe scan in dev builds.

**General**
- Many files start with a `// Generated by GitHub Copilot` header. Leave existing headers alone; new files don't need one.
- Commits follow conventional style (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`).

## Features and history

**Phases** (see the `README.md` table):
1. Scaffold and Auth0.
2. Events CRUD, soft delete and cancel.
3. Dashboard (stats computed client-side), list with search/filter/sort/paging, and event detail.
4. Invite links and the anonymous RSVP flow: 4A backend, 4B manager UI, 4C public RSVP page and organizer list.
5. Hardening: 5A rate limiting, security headers, ProblemDetails and CORS lockdown; 5B interceptors, global error handler and accessibility.
6. Event history (past events).

**Later:**
- Docker stack.
- AWS experiments, now abandoned (`Dockerrun.aws.json` and `eb-app.zip` are leftovers).
- Azure free-tier CI/CD.
- Further features:
  - At most 3 active events per user.
  - RSVP capacity enforcement (409; only "Going" uses a seat).
  - CSV export with a formula-injection guard.
  - `.ics` calendar download.
  - QR codes for invite links.
  - 11 event types.
- Cold-start work (Nov 2026).

## Production and free-tier constraints

**Hosts**
- SPA: `https://ashy-coast-07caf1200.7.azurestaticapps.net`. The `.7.` hostname is the real one; both spellings are allowed in CORS.
- API: `https://eventsync-api-h0frhdfsb3gbeth3.southeastasia-01.azurewebsites.net`, hard-coded in `client/src/environments/environment.prod.ts`.

**App Service F1**
- No Always On; the app unloads after about 20 min idle.
- 60 CPU-minutes per day.
- Kept warm by cron-job.org (primary) and `keep-alive.yml` (backup), both pinging **`/health`** every 5–15 min.

**Azure SQL Free (serverless)**
- Min 0.5 vCore, auto-pause after 60 min, 100,000 vCore-seconds per month. On exhaustion it **auto-pauses until next month**, and the app is down.
- An online DB costs about 1,800 vCore-s per hour even when idle, so 24/7 uptime would use the whole budget in about 2.3 days.
- **Never schedule pings to `/health/ready`** or anything else that touches the DB.

**How the cold DB is handled**
- The SPA fires a no-cors `GET /health/ready` at bootstrap (`ServerStatusService.wakeServer()`).
- EF retries through error 40613.
- The error interceptor retries GETs on 0/502/503/504 for about 38 s.
- A "Waking up the server…" banner appears after 5 s.

**Migrations**
- They do **not** run on Azure startup (`Database:MigrateOnStartup` defaults to false).
- Apply them with `dotnet ef database update --connection "<prod>"`, or temporarily set the `Database__MigrateOnStartup=true` app setting. See DEPLOYMENT.md §6.6.

**Diagnosing errors**
- A browser "CORS preflight" error or `ERR_FAILED` right after idle almost always means App Service was cold or restarting. Its 502/503 pages have no CORS headers.
- To check, test a live preflight with curl before changing CORS code.

**Read-only Azure checks** (the az CLI is signed in on the dev machine):
- `az webapp list`
- `az sql db show ... --query "{status:status, autoPauseDelay:autoPauseDelay}"`
- `az monitor metrics list --resource <db-id> --metric free_amount_remaining`
- Ask before changing any Azure settings.

**Prod config**
- Comes from App Service environment variables: `ConnectionStrings__DefaultConnection`, `Auth0__*`, `AllowedHosts`, `AllowedOrigins__0`, `Frontend__BaseUrl`, `ASPNETCORE_ENVIRONMENT=Production`.
- `appsettings.Production.json` only holds placeholders.

## Known gotchas

- `client/public/staticwebapp.config.json` only does SPA fallback. The SPA calls the API cross-origin by its absolute URL; there is no `/api` proxy.
- Some endpoint files (`AuthEndpoints`, `EventEndpoints`, `InviteLinkEndpoints`) still catch `ValidationException` locally, even though the global middleware already handles it.
- `eb-app.zip` and `server/EventSync.Api/publish.zip` are build artifacts tracked in git.
- The initial bundle is slightly over the 500 kB budget warning in `angular.json`.
- `dotnet restore` reports NU190x vulnerability warnings for Microsoft.OpenApi 2.4.1 and System.Security.Cryptography.Pkcs 9.0.4. These are transitive packages.
