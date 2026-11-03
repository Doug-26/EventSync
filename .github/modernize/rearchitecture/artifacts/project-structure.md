# EventSync project structure

EventSync is a full-stack application: an Angular 21 SPA in `client/` and a .NET 10 minimal API in `server/EventSync.Api/`, backed by Azure SQL/SQL Server through EF Core. Auth0 is the external identity provider.

## Layers and entry points

- Frontend entry point: `client/src/main.ts`; route table: `client/src/app/app.routes.ts`; shared DI and HTTP interceptors: `client/src/app/app.config.ts`.
- Frontend domains: authentication, dashboard, event CRUD/detail, invite-link management, and anonymous public RSVP.
- Backend entry point: `server/EventSync.Api/Program.cs`; endpoint registration is split into vertical slices under `Features/`.
- Backend cross-cutting layer: `Common/` contains authentication helpers, exception/security middleware, validation, configuration, and services.
- Data layer: `Data/AppDbContext.cs`, entity classes, Fluent configurations, and EF migrations.
- Deployment: Azure App Service for the API, Azure Static Web Apps for the SPA, Azure SQL for persistence; GitHub Actions deploy each application independently.

## Functional areas

Auth/profile, event lifecycle, event-type lookup, invite links, anonymous RSVP/calendar/QR flows, organizer RSVP reporting/export, image uploads, health/readiness diagnostics.
