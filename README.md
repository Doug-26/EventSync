# EventSync

A full-stack event management platform that lets organizers create events, generate shareable invite links, and collect RSVPs from guests — no sign-up required for invitees.

## Tech Stack

### Backend
- **.NET 10** — Minimal API with vertical-slice architecture
- **Entity Framework Core 10** — SQL Server (LocalDB) with code-first migrations
- **MediatR 14** — CQRS command/query handlers
- **FluentValidation 12** — Request validation via a pipeline behavior
- **Auth0 JWT Bearer** — Authentication (PKCE flow)
- **Swagger / OpenAPI** — Interactive API docs at `/swagger`

### Frontend
- **Angular 21** — Standalone components, signals, reactive forms
- **Tailwind CSS v4** — Utility-first styling
- **Auth0 Angular SDK** — Login/logout, silent token renewal
- **RxJS** — HTTP layer and async composition

## Features

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Project scaffold, Auth0 login/logout, JWT-protected API | ✅ |
| 2 | Event CRUD (create, read, update, soft-delete, cancel) | ✅ |
| 3 | Dashboard, event list (search, filter, sort, pagination), event detail, shared components | ✅ |
| 4A | Invite links backend — generate, list, deactivate; RSVP submission + validation | ✅ |
| 4B | Invite link manager UI, toast notifications, clipboard service | ✅ |
| 4C | Public RSVP page (anonymous), confirmation page, organizer RSVP list | ✅ |
| 5A | Backend security hardening — rate limiting, security headers, RFC 7807 error handling, CORS lockdown | ✅ |
| 5B | Frontend polish — global error handler + HTTP interceptor, skip-nav, accessible toasts, dev-only axe-core scan | ✅ |

## Project Structure

```
Events App/
├── client/                     # Angular 21 SPA
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/           # API services, auth, models
│   │   │   ├── features/       # Route-level feature modules
│   │   │   │   ├── auth/       # Login, callback
│   │   │   │   ├── dashboard/  # Dashboard overview
│   │   │   │   ├── events/     # Event CRUD + detail
│   │   │   │   └── public-rsvp/# Anonymous RSVP page
│   │   │   ├── layout/         # Header, footer, sidebar
│   │   │   └── shared/         # Reusable components, pipes, directives
│   │   └── environments/
│   └── angular.json
│
├── server/
│   └── EventSync.Api/          # .NET 10 Minimal API
│       ├── Common/             # Shared middleware, services, exceptions
│       ├── Data/               # EF Core DbContext, entities, configurations
│       ├── Features/           # Vertical slices
│       │   ├── Auth/           # Profile endpoints
│       │   ├── Events/         # Event CRUD
│       │   ├── EventTypes/     # Lookup data
│       │   ├── InviteLinks/    # Create, list, deactivate invite links
│       │   ├── RSVPs/          # Public + authenticated RSVP endpoints
│       │   └── Uploads/        # Image upload (magic-byte validation)
│       └── Migrations/
│
└── Events App.sln
```

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js 22+](https://nodejs.org/) and npm
- [SQL Server LocalDB](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/sql-server-express-localdb) (ships with Visual Studio)
- An [Auth0](https://auth0.com/) tenant (free tier works)

### Backend Setup

```bash
cd server/EventSync.Api

# Restore packages
dotnet restore

# Create the database and apply migrations
dotnet ef database update

# Run the API (http://localhost:5000)
dotnet run
```

The API starts on `http://localhost:5000`. Swagger UI is available at `http://localhost:5000/swagger`.

**Configuration**: Copy `appsettings.json` and create `appsettings.Development.json` with your connection string:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=EventSync;Trusted_Connection=true;TrustServerCertificate=true"
  }
}
```

Two additional configuration sections are honored at runtime:

- **`AllowedOrigins`** (string array) — origins permitted by CORS. Defaults to `http://localhost:4200` in Development; **must** be set explicitly in Production (wildcards are not supported).
- **`SecurityHeaders.Auth0Domain`** — appended to the CSP `connect-src` directive so the SPA can reach your Auth0 tenant. When omitted, the value is derived from `Auth0:Domain`.

### Frontend Setup

```bash
cd client

# Install dependencies
npm install

# Start the dev server (http://localhost:4200)
ng serve
```

### Auth0 Configuration

1. Create a **Single-Page Application** in your Auth0 dashboard.
2. Set **Allowed Callback URLs**: `http://localhost:4200/auth/callback`
3. Set **Allowed Logout URLs**: `http://localhost:4200`
4. Set **Allowed Web Origins**: `http://localhost:4200`
5. Create an **API** with identifier `https://eventsync-api`.
6. Update `client/src/environments/environment.ts` with your Auth0 domain and client ID.
7. Update `server/EventSync.Api/appsettings.json` with your Auth0 domain and audience.

## API Endpoints

### Authenticated (Bearer token required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/auth/profile` | Current user profile |
| PUT | `/api/v1/auth/profile` | Update display name / avatar |
| GET | `/api/v1/events` | List events (paginated, filterable) |
| POST | `/api/v1/events` | Create event |
| GET | `/api/v1/events/{id}` | Event detail with invite links + RSVP summary |
| PUT | `/api/v1/events/{id}` | Update event |
| PATCH | `/api/v1/events/{id}/cancel` | Cancel event |
| DELETE | `/api/v1/events/{id}` | Soft-delete event |
| POST | `/api/v1/events/{id}/invite-links` | Generate invite link |
| GET | `/api/v1/events/{id}/invite-links` | List invite links |
| DELETE | `/api/v1/invite-links/{id}` | Deactivate invite link |
| GET | `/api/v1/events/{id}/rsvps` | Paginated RSVP list |
| GET | `/api/v1/events/{id}/rsvps/summary` | RSVP counts |
| GET | `/api/v1/event-types` | Event type lookups |
| POST | `/api/v1/uploads/images` | Upload cover image |

### Public (no authentication)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/invite/{token}` | Public event info for invite page |
| POST | `/api/v1/invite/{token}/rsvp` | Submit or update RSVP |
| GET | `/health` | Health check |

## Architecture Decisions

- **Vertical slice architecture** — each feature (e.g., `CreateEvent`) contains its command/query, validator, and handler in a single file, reducing cross-cutting coupling.
- **Signals over RxJS for state** — component state uses Angular signals; RxJS is reserved for the HTTP layer where Observables are the natural fit.
- **Soft-delete with global query filters** — events are never physically removed; EF Core query filters hide them transparently.
- **Cryptographic invite tokens** — generated via `System.Security.Cryptography.RandomNumberGenerator` (256-bit entropy), not `Guid` or `Random`.
- **Public endpoints bypass the auth interceptor** — the Angular `authInterceptor` skips `/invite/` paths so guests never trigger a token renewal.
- **RFC 7807 ProblemDetails everywhere** — a global exception middleware translates `ValidationException`, `NotFoundException`, `ForbiddenAccessException`, and `InvalidInviteException` into standardized `application/problem+json` payloads with a `traceId`. Stack traces are included only in Development.
- **IP-partitioned rate limiting on the public RSVP endpoint** — fixed-window (5 requests / 10 minutes) using `System.Threading.RateLimiting`; rejections return `429` with a `Retry-After` header. Authenticated endpoints are intentionally unthrottled.
- **Strict HTTP security headers** — dedicated middleware sets CSP (`script-src 'self'`, no inline JS), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS (non-Development only). CORS reads `AllowedOrigins` from configuration — wildcards are never used.
- **Accessibility-first frontend** — skip-to-main-content link, semantic landmarks, focus-trapped confirm dialog, `aria-live` toast region, and a dev-only `axe-core` scan that re-runs on every navigation so violations surface immediately in the console.

## License

This project is for educational purposes.
