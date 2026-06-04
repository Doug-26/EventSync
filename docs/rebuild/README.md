# EventSync — Rebuild From Scratch (Learning Guide)

A step-by-step guide to reconstructing **EventSync** end-to-end so that every architectural decision, file, and line of code makes sense. Designed for someone who wants to internalise the project deeply enough to defend it in an interview.

> **How to use this guide:** Follow the phases in order. Each phase is broken into **small numbered steps**. After every step you'll run a command (usually `dotnet build` or `ng build`) and check the expected output before moving on. Each phase also ends with a **Checkpoint** — don't move on until your local app matches the checkpoint description. Code is quoted directly from the working repo so you can compare with the original when stuck.

### The build-from-scratch style

Every phase follows the same template:

1. **Goal** (one sentence) + **Prerequisites** (which prior phases must be done).
2. **Numbered steps**. Each step:
   - Names one file (or one section of a long file) to add or edit.
   - Quotes the code in full.
   - Explains the non-obvious lines.
   - Tells you exactly which command to run and what output to expect.
   - Calls out **Pitfalls** and **Why this matters** inline.
3. **Checkpoint** — end-of-phase verification (boot the app, hit endpoints, query the DB, click through the UI).
4. **Next phase** link.

If a build fails mid-phase, **stop and fix it before moving to the next step**. The whole point of the per-step builds is that the error is now localised to the change you just made.

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
| [06a](./06a-vertical-slice-events-backend.md) | **Slice:** Events — Backend | CRUD + EventTypes lookup: DTOs, validators, handlers, endpoints |
| [06b](./06b-vertical-slice-events-frontend.md) | **Slice:** Events — Frontend | `EventService`, list/create/edit/detail components, validators, shared widgets |
| [07](./07-vertical-slice-uploads.md) | **Slice:** Image upload | Magic-byte validation, wire into event forms |
| [08](./08-vertical-slice-invite-links.md) | **Slice:** Invite links | Crypto-random tokens, invite manager UI, clipboard service |
| [09](./09-vertical-slice-rsvps.md) | **Slice:** RSVPs | Public RSVP flow, organizer view, rate limiting, status badge |
| [10](./10-polish-and-deployment.md) | Polish & deployment | Security headers, prod configs, deployment notes |
| [11](./11-interview-qa-appendix.md) | Interview Q&A | ~25 curated questions with model answers |

Each phase quotes code from the real repo so you can compare with the originals in `server/EventSync.Api/` and `client/`.

---

## Conventions used throughout

- **One step = one file (or one section of a long file).** Don't combine steps; the per-step build check is how you localise errors.
- **Code blocks** are quoted from the actual repo, lightly cleaned for clarity. Long files (e.g. `Program.cs`, `AppDbContext`) are built up incrementally across several steps with a `dotnet build` between each.
- **Run blocks** show the exact command in a fenced ```powershell or ```bash block. **Expected output** follows in its own fenced block so you know what "success" looks like.
- **"Why each line"** bullets reference line numbers inside the immediately preceding code block. Skipped for trivial one-liners and pure config.
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
