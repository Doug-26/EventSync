# Phase 01 — Environment & Scaffolding

Goal: end this phase with two minimal-but-working projects — an ASP.NET Core Web API that returns Swagger and an Angular SPA that boots in the browser. No business logic yet.

---

## 1. Visual Studio vs VS Code — does it matter?

**No — the resulting project is identical.** `.csproj`, `.sln`, and source files are tooling-agnostic. The original repo was built with VS Code + the `dotnet` CLI; rebuilding in Visual Studio works because both tools call the same underlying SDK.

Practical differences you'll hit during this phase:

| Concern | VS Code (CLI path) | Visual Studio (GUI path) |
|---|---|---|
| Create project | `dotnet new webapi` | File → New → Project → ASP.NET Core Web API |
| Add NuGet | `dotnet add package <Name>` | Right-click project → Manage NuGet Packages |
| EF migrations | `dotnet ef migrations add X` | Same CLI in integrated terminal, **or** Package Manager Console (`Add-Migration X`) |
| User secrets | `dotnet user-secrets set ...` | Right-click project → Manage User Secrets |
| Dev HTTPS cert | `dotnet dev-certs https --trust` | VS prompts on first F5 |
| Run | `dotnet run` / `dotnet watch run` | F5 (Debug) / Ctrl+F5 (without debugger) |

> **Visual Studio note** — VS will scaffold a `WeatherForecast` sample controller, an HTTPS launch profile, and (sometimes) an IIS Express launch profile. **Delete all three** so we match the repo: there are no controllers (we use Minimal APIs), and we bind only HTTP on `http://localhost:5000`.

We'll use **CLI commands** as the canonical instructions because they're identical on both Windows shells and the VS integrated terminal. Translate to GUI clicks as preferred.

---

## 2. Folder layout we're building toward

```
Events App/
├── Events App.sln                  # solution file at repo root
├── client/                         # Angular SPA (created in §5)
│   └── … standard ng new layout
├── server/
│   └── EventSync.Api/              # ASP.NET Core Web API (created in §3)
│       ├── EventSync.Api.csproj
│       ├── Program.cs
│       ├── appsettings.json
│       ├── appsettings.Development.json
│       ├── Properties/
│       │   └── launchSettings.json
│       ├── Common/                 # cross-cutting (phase 02)
│       ├── Data/                   # EF Core (phase 03)
│       ├── Features/               # vertical slices (phases 05+)
│       └── wwwroot/uploads/        # uploaded cover images (phase 07)
└── docs/rebuild/                   # this guide
```

Keep the `server/` and `client/` split — it makes deployment (separate containers / Azure resources) much simpler later.

---

## 3. Create the solution and the Web API project

Open a PowerShell prompt at the repo root.

```powershell
# Solution file at the repo root
dotnet new sln -n "Events App"

# Web API project in server/EventSync.Api
dotnet new webapi -n EventSync.Api -o server/EventSync.Api `
    --use-minimal-apis --no-https --no-openapi=false

# Add the project to the solution
dotnet sln "Events App.sln" add server/EventSync.Api/EventSync.Api.csproj
```

> **Visual Studio path:**
> 1. File → New → Project → "Blank Solution" → name `Events App`, save at repo root.
> 2. File → Add → New Project → "ASP.NET Core Web API" → name `EventSync.Api`, location `server`.
> 3. In the project wizard: Framework = **.NET 10**, Authentication = **None**, Configure for HTTPS = **off**, Enable Docker = **off**, Use controllers = **off** (gives us Minimal APIs), Enable OpenAPI = **on**.
> 4. After it's created, delete `WeatherForecast.cs` and the `WeatherForecast` record in `Program.cs`.

---

## 4. Configure `EventSync.Api.csproj`

Open `server/EventSync.Api/EventSync.Api.csproj` and replace it with:

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="FluentValidation" Version="12.1.1" />
    <PackageReference Include="FluentValidation.AspNetCore" Version="11.3.1" />
    <PackageReference Include="Mapster" Version="10.0.7" />
    <PackageReference Include="MediatR" Version="14.1.0" />
    <PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="10.0.7" />
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.4" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.7">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
    <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="10.0.7" />
    <PackageReference Include="Swashbuckle.AspNetCore" Version="10.1.7" />
    <PackageReference Include="Swashbuckle.AspNetCore.Filters" Version="10.0.1" />
  </ItemGroup>

</Project>
```

### Why each package is there

| Package | Purpose |
|---|---|
| `FluentValidation` | Declarative, fluent rule-builder for input validation (`RuleFor(x => x.Title).NotEmpty()`). |
| `FluentValidation.AspNetCore` | Wires FluentValidation into ASP.NET Core's model-binding pipeline so requests are validated automatically before they reach a handler. |
| `Mapster` | DTO ↔ entity mapping. Faster than AutoMapper, zero ceremony — `entity.Adapt<EventDto>()`. |
| `MediatR` | In-process command/query dispatch. Lets us write one handler per use case and avoid bloated controllers. |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | Validates JWTs from Auth0 (signature, issuer, audience, expiry). |
| `Microsoft.AspNetCore.OpenApi` | Built-in OpenAPI document support (we still need Swashbuckle for the UI + Bearer scheme). |
| `Microsoft.EntityFrameworkCore.Design` | Provides `dotnet ef` tooling (migrations, scaffolding). `<PrivateAssets>all</PrivateAssets>` keeps it out of the publish output. |
| `Microsoft.EntityFrameworkCore.SqlServer` | EF Core provider for SQL Server / LocalDB. |
| `Swashbuckle.AspNetCore` | Generates and hosts the Swagger UI. |
| `Swashbuckle.AspNetCore.Filters` | `SecurityRequirementsOperationFilter` — auto-stamps `[Authorize]` endpoints with the Bearer requirement in Swagger. |

Restore packages once you've saved the file:

```powershell
cd server/EventSync.Api
dotnet restore
```

> **Pitfall — Visual Studio:** if you change the `.csproj` from inside VS, Solution Explorer doesn't always trigger a restore. Use `Build → Clean Solution → Build Solution` or run `dotnet restore` from the integrated terminal.

---

## 5. Configure `launchSettings.json`

Replace `server/EventSync.Api/Properties/launchSettings.json` with the single HTTP-only profile we want:

```json
{
  "$schema": "https://json.schemastore.org/launchsettings.json",
  "profiles": {
    "http": {
      "commandName": "Project",
      "dotnetRunMessages": true,
      "launchBrowser": false,
      "launchUrl": "swagger",
      "applicationUrl": "http://localhost:5000",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    }
  }
}
```

### Why this shape

- **`http` only** — we deliberately omit `https` and `IIS Express` profiles. Local-dev traffic is plain HTTP on port 5000; HTTPS is enforced only in non-Development environments (you'll see that in phase 02's `Program.cs`).
- **`launchBrowser: false`** — we'll use Swagger via a deliberate URL once we add it; auto-opening browser tabs gets annoying.
- **`launchUrl: "swagger"`** — when you *do* manually open the run URL, you land on `/swagger`.
- **`ASPNETCORE_ENVIRONMENT=Development`** — gates Swagger UI, dev-only middleware, and verbose exception responses (see phase 02).

> **Visual Studio note:** the profile dropdown at the top of the IDE will show only "http" after this — perfect.

---

## 6. Configure `appsettings.json`

Replace `server/EventSync.Api/appsettings.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "AllowedOrigins": [
    "http://localhost:4200"
  ],
  "Auth0": {
    "Domain": "{YOUR_AUTH0_DOMAIN}",
    "Audience": "https://eventsync-api"
  },
  "Frontend": {
    "BaseUrl": "http://localhost:4200"
  },
  "SecurityHeaders": {
    "Auth0Domain": "{YOUR_AUTH0_DOMAIN}",
    "AdditionalConnectSources": []
  }
}
```

And create `appsettings.Development.json` (it overrides the values above when `ASPNETCORE_ENVIRONMENT=Development`):

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "ConnectionStrings": {
    "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=EventSync;Trusted_Connection=true;TrustServerCertificate=true"
  },
  "Frontend": {
    "BaseUrl": "http://localhost:4200"
  }
}
```

### What each section drives

- **`AllowedOrigins`** — fed into the CORS policy in phase 02. Frontend origin **only**; not `"*"`.
- **`Auth0:Domain` / `Auth0:Audience`** — used by the JWT bearer middleware to validate tokens. Leave the placeholder for now; phase 04 walks you through creating an Auth0 tenant and filling these in.
- **`Frontend:BaseUrl`** — used when the API needs to construct user-facing URLs (e.g., for invite emails in a future phase).
- **`SecurityHeaders:Auth0Domain`** — appended to the CSP `connect-src` so the SPA can talk to Auth0 from the browser. Defaults to `Auth0:Domain` if not specified.
- **`ConnectionStrings:DefaultConnection`** (Development only) — points EF Core at LocalDB. The DB doesn't have to exist yet; `dotnet ef database update` creates it in phase 03.

> **Pitfall — secrets in source control:** `appsettings.json` is committed to git. Never put production secrets there. The repo's `.gitignore` excludes `appsettings.Development.json` so per-developer connection strings stay private; double-check that's still the case after scaffolding.

---

## 7. Initial `Program.cs`

Replace `server/EventSync.Api/Program.cs` with this minimal version. We'll grow it through every phase that follows.

```csharp
var builder = WebApplication.CreateBuilder(args);

if (builder.Environment.IsDevelopment())
{
    builder.WebHost.UseUrls("http://localhost:5000");
}

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapGet("/health", () => Results.Ok(new
{
    status = "healthy",
    timestamp = DateTime.UtcNow,
}));

app.Run();
```

### Line-by-line

1. `WebApplication.CreateBuilder` — sets up configuration sources (`appsettings*.json`, env vars, command-line), default logging, DI container, and the Kestrel host.
2. `if (… IsDevelopment()) UseUrls(...)` — pins local dev to `http://localhost:5000`. In Production, `ASPNETCORE_URLS` or the hosting platform decides the binding.
3. `AddEndpointsApiExplorer` / `AddSwaggerGen` — registers OpenAPI discovery for Minimal APIs and the Swagger document generator.
4. `app.UseSwagger()` / `app.UseSwaggerUI()` — exposes `/swagger/v1/swagger.json` and the interactive UI at `/swagger`. Gated to Development so production never leaks API schema.
5. `app.MapGet("/health", …)` — a tiny public endpoint we can `curl` to confirm the app is alive. We'll keep this in the final version.

---

## 8. Verify the backend boots

```powershell
cd server/EventSync.Api
dotnet run
```

Expected output ends with `Now listening on: http://localhost:5000`.

In another terminal:

```powershell
curl http://localhost:5000/health
# → {"status":"healthy","timestamp":"2026-…"}
```

Open `http://localhost:5000/swagger` — you should see the Swagger UI with the `Health` operation.

Stop the server (Ctrl+C). The backend foundation is good.

---

## 9. Scaffold the Angular SPA

Switch to a VS Code terminal at the repo root.

```powershell
# Angular CLI 21 globally if you haven't already
npm install -g @angular/cli@21

# Create the app — no SSR, no Zone.js prompt, our routing.
ng new client `
    --standalone `
    --routing `
    --style=css `
    --ssr=false `
    --strict `
    --skip-tests
```

When the wizard prompts about analytics, decline. When the install finishes, verify it boots:

```powershell
cd client
ng serve --port 4200
```

Open `http://localhost:4200` — you should see the default Angular landing page. Stop with Ctrl+C.

---

## 10. Install Angular runtime dependencies

We need Auth0, Tailwind v4, and a few build-time helpers. From `client/`:

```powershell
# Runtime
npm install @auth0/auth0-angular@^2.9.0

# Tailwind v4 (new architecture: peer + PostCSS plugin)
npm install -D tailwindcss@^4.2.4 `
              @tailwindcss/postcss@^4.2.4 `
              @tailwindcss/forms@^0.5.11 `
              postcss@^8.5.12

# Dev / test
npm install -D vitest@^4.0.8 jsdom@^27.1.0 axe-core@^4.11.4
```

Open `client/package.json` and confirm `dependencies` and `devDependencies` match the table in the [project README](./README.md#prerequisites).

### Why each one

| Package | Purpose |
|---|---|
| `@auth0/auth0-angular` | Wraps the Auth0 SPA SDK with an Angular-friendly module: services, guards, observables. |
| `tailwindcss` (v4) | Utility-first CSS. v4's CSS-first config means no `tailwind.config.js` is required. |
| `@tailwindcss/postcss` | Tailwind v4's PostCSS plugin — Angular's build pipeline runs PostCSS over your CSS. |
| `@tailwindcss/forms` | Sensible defaults for form controls. |
| `postcss` | Required peer for the Tailwind PostCSS plugin. |
| `vitest` / `jsdom` / `axe-core` | Test runner + DOM simulation + accessibility checks (used in later optional test work; install them now to match the repo). |

---

## 11. Wire up Tailwind v4

Tailwind v4 is *significantly* different from v3 — no `tailwind.config.js` by default, no `init` command. Two files are all you need:

**`client/.postcssrc.json`** (create at the `client/` root):

```json
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

**`client/src/styles.css`** — replace its contents:

```css
@import "tailwindcss";

@source "./**/*.{html,ts}";

html { scroll-behavior: smooth; }
body {
  min-height: 100vh;
  background-color: #f8fafc;
  color: #0f172a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

:where(a, button, input, select, textarea):focus-visible {
  outline: 2px solid #4f46e5;
  outline-offset: 2px;
}
```

### Line-by-line

1. `@import "tailwindcss"` — pulls in Tailwind's reset + utilities. Replaces the v3 `@tailwind base; @tailwind components; @tailwind utilities;` trio.
2. `@source "./**/*.{html,ts}"` — tells Tailwind which files to scan for utility class names. Without this, the JIT compiler can't see your templates and `class="bg-indigo-600"` produces no CSS.
3. Body defaults give us a soft off-white background (`slate-50`) and dark text.
4. `:focus-visible` ring keeps keyboard navigation legible without showing a ring on mouse clicks.

> **Pitfall — Tailwind v4:** if classes appear in DevTools but don't take effect, you almost certainly forgot the `@source` directive. v3 used `content` in the config file; v4 uses this CSS directive instead.

---

## 12. Configure the Angular environments

Create `client/src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:5000/api/v1',
  auth0: {
    domain: '{YOUR_AUTH0_DOMAIN}',
    clientId: '{YOUR_AUTH0_CLIENT_ID}',
    authorizationParams: {
      redirect_uri: 'http://localhost:4200/auth/callback',
      audience: 'https://eventsync-api',
    },
    cacheLocation: 'localstorage' as const,
    useRefreshTokens: true,
  },
};
```

Create `client/src/environments/environment.prod.ts` mirroring it with production values (you'll fill these in for deployment in phase 10):

```typescript
export const environment = {
  production: true,
  apiUrl: 'https://api.yourdomain.com/api/v1',
  auth0: {
    domain: '{PROD_AUTH0_DOMAIN}',
    clientId: '{PROD_AUTH0_CLIENT_ID}',
    authorizationParams: {
      redirect_uri: 'https://yourdomain.com/auth/callback',
      audience: 'https://eventsync-api',
    },
    cacheLocation: 'localstorage' as const,
    useRefreshTokens: true,
  },
};
```

### Why these fields

- **`apiUrl`** — base URL the Angular services hit. `v1` matches the backend's `MapGroup("/api/v1/…")` paths we'll add in phase 02+.
- **`auth0.domain` / `auth0.clientId`** — tenant + SPA app identifier (you'll create in phase 04).
- **`authorizationParams.redirect_uri`** — where Auth0 sends the browser after sign-in. Must be **whitelisted** in the Auth0 dashboard.
- **`authorizationParams.audience`** — API identifier in Auth0; required for Auth0 to return an access token (JWT) and not just an ID token.
- **`cacheLocation: 'localstorage'`** — keeps the session across page reloads (default is in-memory only).
- **`useRefreshTokens: true`** — silent renewal via refresh tokens; avoids the third-party-cookie iframe trick (which Safari and modern browsers block).

> **Visual Studio Code note:** if `import { environment } from '../environments/environment'` later shows a red squiggle, restart the TypeScript server (Ctrl+Shift+P → "TypeScript: Restart TS Server"). VS Code caches old paths during scaffolding.

---

## 13. Recommended `.gitignore` additions

The Angular CLI and `dotnet new` already ship `.gitignore` files. Append these to whichever you keep at the repo root (create one if needed):

```gitignore
# VS Code / VS scratch
.vs/
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
!.vscode/tasks.json

# Per-developer secrets
server/EventSync.Api/appsettings.Development.json

# .NET build outputs already covered by template, but be explicit:
**/bin/
**/obj/

# Node / Angular caches
client/node_modules/
client/.angular/
client/dist/

# OS / IDE noise
Thumbs.db
.DS_Store
```

> **Note:** committing `appsettings.json` (with placeholder secrets) is fine; committing `appsettings.Development.json` (with your real connection string and any user secrets) is **not**. The gitignore above enforces that split.

---

## Checkpoint

You've passed this phase when **all** of these are true:

1. From `server/EventSync.Api/`:
   ```powershell
   dotnet run
   ```
   prints `Now listening on: http://localhost:5000` with no errors.

2. `curl http://localhost:5000/health` returns `{"status":"healthy",…}`.

3. `http://localhost:5000/swagger` renders the Swagger UI showing the `Health` endpoint.

4. From `client/`:
   ```powershell
   ng serve --port 4200
   ```
   builds with no errors and `http://localhost:4200` renders the default Angular page.

5. Replace `app.html` with `<h1 class="text-3xl font-bold text-indigo-600">EventSync</h1>` and reload — the heading is large, bold, and indigo. **Tailwind v4 is working.**

6. Both projects build clean from Visual Studio (F5) **or** the CLI — confirms the project files are tooling-agnostic.

If any of these fail, the most common culprit is a missing prerequisite (especially **.NET 10 SDK** or **Node 22 LTS**). Re-check the [prerequisites table](./README.md#prerequisites) before continuing.

---

Next: [02-foundations-backend.md](./02-foundations-backend.md) — the cross-cutting plumbing (exceptions, middleware, options, MediatR pipeline) and the fully-annotated `Program.cs`.
