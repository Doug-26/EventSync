# EventSync — Rebuild From Scratch (Learning Guide)

A step-by-step guide to reconstructing **EventSync** end-to-end so that every architectural decision, file, and line of code makes sense. Designed for someone who wants to internalise the project deeply enough to defend it in an interview.

> **How to use this guide:** Follow the phases in order. Each phase has a **Checkpoint** at the end — don't move on until your local app matches the checkpoint description. Code is quoted directly from the working repo so you can compare with the original when stuck.

---

## What you'll build

**EventSync** is a full-stack event-management platform:

- **Organisers** sign in (Auth0), create events, upload cover images, generate shareable invite links with optional expiry / max-use limits, and view RSVP summaries.
- **Guests** open an invite link, see public event details, and submit an RSVP — no account required. The endpoint is rate-limited per IP.

```
┌─────────────────────────────────────────┐
│  Angular 21 SPA (client/)               │
│  • Standalone components + signals      │
│  • Tailwind CSS v4                      │
│  • Auth0 PKCE flow + silent renewal     │
└────────────────────┬────────────────────┘
                     │ HTTPS / CORS / JWT
┌────────────────────▼────────────────────┐
│  ASP.NET Core 10 Minimal API (server/)  │
│  • Vertical slices (MediatR + CQRS)     │
│  • Fluent validation pipeline           │
│  • EF Core 10 + SQL Server LocalDB      │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│  SQL Server LocalDB                     │
│  • 5 entities, soft-delete, audit       │
└─────────────────────────────────────────┘
```

---

## Prerequisites

Install these once before phase 01:

| Tool | Version | Why | Install command / link |
|------|---------|-----|------------------------|
| **.NET SDK** | 10.0+ | Backend | `winget install Microsoft.DotNet.SDK.10` |
| **Visual Studio 2022 (17.12+) or VS 2026** | latest | Backend IDE | https://visualstudio.microsoft.com — select *ASP.NET and web development* workload |
| **Node.js LTS** | 22.x | Angular CLI + build | `winget install OpenJS.NodeJS.LTS` |
| **Angular CLI** | 21.x | `ng` command | `npm install -g @angular/cli@21` |
| **VS Code** | latest | Frontend IDE | `winget install Microsoft.VisualStudioCode` — plus the "Angular Language Service" extension |
| **SQL Server LocalDB** | 2022 | Dev database | Ships with the SQL Server Express installer or VS workload |
| **Auth0 tenant** | free tier | Identity provider | Sign up at https://auth0.com (covered in phase 04) |
| **EF Core CLI** | matches SDK | `dotnet ef` | `dotnet tool install --global dotnet-ef --version 10.*` |
| **Git** | any | Version control | `winget install Git.Git` |

> **Visual Studio vs VS Code for the backend:** the original project was built with VS Code + the `dotnet` CLI, but rebuilding in Visual Studio is fully supported. `.csproj`, `.sln`, and source files are tooling-agnostic. Phase 01 shows both paths side by side.

---

## Reading order

| # | Phase | What you'll do |
|---|-------|----------------|
| [01](./01-environment-and-scaffolding.md) | Environment & scaffolding | Create solution, scaffold Web API + Angular, install all packages |
| [02](./02-foundations-backend.md) | Backend plumbing | `Common/` (exceptions, middleware, options, MediatR pipeline) + annotated `Program.cs` |
| [03](./03-foundations-data-layer.md) | EF Core data layer | All 5 entities, Fluent API configs, `AppDbContext`, first migration |
| [04](./04-foundations-frontend.md) | Angular app shell | `app.config`, routing, auth guard / interceptor, error interceptor, toast, layout, Tailwind, Auth0 tenant setup |
| [05](./05-vertical-slice-auth.md) | **Slice:** Auth | `Features/Auth` + login/callback/dashboard; first end-to-end PKCE flow |
| [06](./06-vertical-slice-events.md) | **Slice:** Events | CRUD + EventTypes lookup, list/create/edit/detail components, shared widgets |
| [07](./07-vertical-slice-uploads.md) | **Slice:** Image upload | Magic-byte validation, wire into event forms |
| [08](./08-vertical-slice-invite-links.md) | **Slice:** Invite links | Crypto-random tokens, invite manager UI, clipboard service |
| [09](./09-vertical-slice-rsvps.md) | **Slice:** RSVPs | Public RSVP flow, organizer view, rate limiting, status badge |
| [10](./10-polish-and-deployment.md) | Polish & deployment | Security headers, prod configs, deployment notes |
| [11](./11-interview-qa-appendix.md) | Interview Q&A | ~25 curated questions with model answers |

Each phase quotes code from the real repo so you can compare with the originals in `server/EventSync.Api/` and `client/`.

---

## Conventions used throughout

- **Code blocks** are quoted from the actual repo. Long files (e.g. `Program.cs`) are split into logical sections, each with its own explanation block.
- **Line-by-line explanations** reference line numbers inside the immediately preceding code block.
- **"Why this matters"** callouts explain non-obvious design decisions.
- **"Pitfall"** callouts highlight mistakes that are easy to make.
- **"Visual Studio note"** callouts call out where the VS GUI does something different from the CLI.
- Each phase ends with a **Checkpoint** — verification steps to confirm you're on track.
- Auth0 domain, client ID, and other secrets are written as `{PLACEHOLDERS}`. Phase 04 walks through creating your own Auth0 tenant.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Vertical slice** | A feature-complete folder grouping the command/query, handler, validator, DTO, and endpoint for one capability — no shared business logic between slices. |
| **CQRS** | Command Query Responsibility Segregation — write operations (commands) and read operations (queries) are separate types, handled separately. We use MediatR to dispatch them. |
| **MediatR** | An in-process messaging library. Endpoints send a command/query object; MediatR finds the matching handler and runs it through a pipeline of behaviours (e.g. validation). |
| **Pipeline behaviour** | Middleware for MediatR — runs before/after every handler. We use one for FluentValidation. |
| **Minimal API** | ASP.NET Core's lightweight endpoint syntax (`app.MapGet("/path", handler)`). Less ceremony than MVC controllers. |
| **Fluent API** | EF Core's strongly-typed configuration API (e.g. `entity.HasIndex(x => x.Email)`). Lives in `IEntityTypeConfiguration<T>` classes. |
| **Global query filter** | An EF Core LINQ predicate added to *every* query for an entity — used here for soft-delete (`!IsDeleted`). |
| **Soft delete** | Mark a row as deleted (`IsDeleted = true`) instead of physically removing it. Preserves audit trail. |
| **ProblemDetails / RFC 7807** | A standardised JSON error response format defined by IETF RFC 7807 (`type`, `title`, `status`, `detail`, `errors`). |
| **PKCE** | Proof Key for Code Exchange — an OAuth 2.0 extension that lets a public client (SPA) safely complete the authorisation-code flow without a client secret. |
| **JWT bearer** | An access token in JSON Web Token format, sent in the `Authorization: Bearer <token>` header. The API validates its signature, issuer, audience, and expiry. |
| **Standalone component** | An Angular component that declares its own imports — no `NgModule` required. The modern default. |
| **Signal** | Angular's reactive primitive (`signal(value)`). Reading inside a template/computed creates a fine-grained dependency. |
| **Functional guard / interceptor** | Angular's modern `(route, state) => ...` form instead of class-based guards/interceptors. Smaller and easier to compose. |
| **Vertical-slice checkpoint** | The "you should be able to do X end-to-end now" verification at the end of each slice phase. |

---

## Companion documents

- `EventSync-Technical-Blueprint.html` — original design doc (high-level phases, decisions log)
- `README.md` (root) — getting-started for running the existing repo
- `DEPLOYMENT.md` — Docker / Azure / AWS deployment guidance (referenced in phase 10)

Ready? Open [01-environment-and-scaffolding.md](./01-environment-and-scaffolding.md).
