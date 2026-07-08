# EventSync — Deployment Guide

A beginner-friendly, step-by-step handoff guide for taking the EventSync app from "works on my laptop" to "live on the internet." This document is self-contained: you do **not** need GitHub Copilot or any AI assistant to follow it.

> **Audience.** You are comfortable building the app locally (you've finished Phases 1–5 of the technical blueprint), but you are **new to Docker, Azure, and AWS.** Every new concept is defined the first time it appears.

## How to use this guide

- Work top-to-bottom. Each section builds on the previous one **up to and including Section 3 (Docker)**.
- After Section 3, pick **one** cloud track:
  - **Section 4 — Cloud Track A: Azure** → for Microsoft Azure.
  - **Section 5 — Cloud Track B: AWS** → for Amazon Web Services.
- The two tracks are **fully independent.** You can do Track A now and Track B months later (or never), without re-reading anything.
- **Checkpoints.** Every section ends with a "✅ Stop & verify" block. If the checks pass, your progress is saved — you can close the laptop and come back tomorrow.
- **Pitfalls.** Watch for ⚠ callouts — those are the spots where first-timers usually get stuck.
- **Stuck for more than ~30 minutes?** Don't grind. Copy the error message + which step you're on and ask in a forum (see [Section 8](#section-8--what-if-i-get-stuck-learning-resources)).

## Table of contents

| # | Section | First-time estimate |
|---|---------|--------------------:|
| 0 | [Overview & prerequisites](#section-0--overview--prerequisites) | 30–60 min |
| 1 | [Handoff from your current laptop](#section-1--handoff-from-your-current-laptop) | 15 min |
| 2 | [First run on the new laptop (no Docker yet)](#section-2--first-run-on-the-new-laptop-no-docker-yet) | 30 min |
| 3 | [Phase 6 — Local Docker](#section-3--phase-6--local-docker) | 60–90 min |
| 4 | [Cloud Track A: Azure](#section-4--cloud-track-a-azure) | 90–120 min |
| 5 | [Cloud Track B: AWS](#section-5--cloud-track-b-aws) | 120–150 min |
| 6 | [Maintenance & day-2 operations](#section-6--maintenance--day-2-operations) | reference |
| 7 | [Glossary & cheat sheets](#section-7--glossary--cheat-sheets) | reference |
| 8 | [What if I get stuck? — Learning resources](#section-8--what-if-i-get-stuck-learning-resources) | reference |

---

## Section 0 — Overview & prerequisites

### What you're deploying

```
        ┌─────────────────────────────┐
        │   Angular SPA (client/)     │  ← what users see in their browser
        └─────────────┬───────────────┘
                      │ HTTPS
        ┌─────────────▼───────────────┐
        │   .NET 10 API (server/)     │  ← business logic, auth, DB
        └─────────────┬───────────────┘
                      │
        ┌─────────────▼───────────────┐
        │      SQL Server DB          │  ← persistent data
        └─────────────────────────────┘

   External:  Auth0 (login provider — already configured)
```

You will deploy the same three components three different ways:

| Where | API | SPA | DB |
|---|---|---|---|
| **Local Docker** (Section 3) | container | container behind Nginx | container |
| **Azure** (Section 4) | App Service | Static Web Apps | Azure SQL (Free Offer) |
| **AWS** (Section 5) | Elastic Beanstalk | S3 + CloudFront | RDS SQL Server Express |

### Tools you need on the new laptop

Install one at a time and run the verification command before moving on. **All tools are free.**

| # | Tool | What it does | Get it | Verify |
|---|------|--------------|--------|--------|
| 1 | **.NET 10 SDK** | Compiles and runs the API. | `dot.net` → "Download .NET" → SDK x64 | `dotnet --version` → starts with `10.` |
| 2 | **Node.js 22 LTS** | Builds the Angular app. | `nodejs.org` → LTS installer | `node --version` → `v22.x.x` |
| 3 | **Angular CLI** | The `ng` command. | `npm install -g @angular/cli` | `ng version` → Angular CLI: 21.x |
| 4 | **Git** | Version control. | `git-scm.com` | `git --version` |
| 5 | **SQL Server LocalDB** | Lightweight DB for local dev (Section 2 only). Comes free with the .NET workload in Visual Studio or as a standalone download. | Search "SQL Server Express LocalDB download" on `microsoft.com` | `SqlLocalDB info` |
| 6 | **Docker Desktop** | Runs containers locally (Section 3 onward). On Windows, accept the WSL2 option in the installer. | `docker.com` → Get Docker | `docker --version` and `docker compose version` |
| 7 | **Azure CLI** | Talk to Azure from the terminal (Section 4 only). | `learn.microsoft.com/cli/azure/install-azure-cli-windows` | `az --version` |
| 8 | **AWS CLI v2** | Talk to AWS from the terminal (Section 5 only). | `aws.amazon.com/cli` | `aws --version` → `aws-cli/2.x` |
| 9 | **VS Code** + extensions | Editor. Install C# Dev Kit, Angular Language Service, Tailwind CSS IntelliSense, Docker, Azure Tools, AWS Toolkit. | `code.visualstudio.com` | open VS Code |

> ⚠ **Common mistake — Docker Desktop on Windows.** The first launch asks if you want to use the **WSL2 backend**. Say yes. If you accidentally chose Hyper-V, open Docker Desktop → Settings → General → check **Use the WSL 2 based engine** → Apply & Restart.

### Accounts you need

| Account | Why | Cost |
|---------|-----|------|
| **GitHub** | Hosts the repo, runs CI/CD. | Free |
| **Auth0** | Login provider. *You already have a dev tenant.* | Free |
| **Azure** (only for Track A) | Cloud hosting. Sign up at `azure.microsoft.com/free`. | $200 credit + 12-month free + always-free tier |
| **AWS** (only for Track B) | Cloud hosting. Sign up at `aws.amazon.com/free`. | 12-month free tier + always-free tier |

> ⚠ **Both Azure and AWS require a credit card to sign up.** They won't charge it unless you exceed free-tier quotas, but this guide includes explicit cost-control steps in each track so you don't get surprised.

### ✅ Stop & verify

Run each command and confirm the output matches:

```powershell
dotnet --version           # 10.x.x
node --version             # v22.x.x
ng version                 # Angular CLI: 21.x
git --version              # git version 2.x
docker --version           # Docker version 27+ (or newer)
docker compose version     # Docker Compose version v2.x
```

If any command fails with "not recognized," close and reopen your terminal. Most installers update `PATH` only for **new** shells.

---

## Section 1 — Handoff from your current laptop

**Goal:** Make sure both laptops are looking at the same code, via GitHub. Skip this section if your repo is already on GitHub and both laptops are in sync.

### 1.1 Push your work to GitHub (current laptop)

1. Open a terminal in the project root.

2. Make sure nothing is uncommitted:

   ```powershell
   git status
   ```

   If you see modified files, commit them:

   ```powershell
   git add .
   git commit -m "WIP: handoff to other laptop"
   ```

3. If you don't have a remote yet:

   - Go to `github.com/new` → repository name `eventsync` → **Private** → **Create repository**.
   - Copy the URL it shows (e.g., `https://github.com/yourname/eventsync.git`).
   - Wire it up:

     ```powershell
     git remote add origin https://github.com/yourname/eventsync.git
     git branch -M main
     git push -u origin main
     ```

   ✅ You should see: `* [new branch] main -> main`.

4. If you already have a remote, just push:

   ```powershell
   git push
   ```

### 1.2 Capture your secrets (do this once, in a password manager)

You'll need these on the new laptop and in cloud configs. Copy them somewhere safe — **never commit them.**

| Secret | Where it lives now | Where to find it |
|--------|-------------------|------------------|
| Auth0 Domain | `client/src/environments/environment.ts` and `server/EventSync.Api/appsettings.Development.json` | Auth0 dashboard → Applications → EventSync SPA |
| Auth0 Client ID | same | same |
| Auth0 API Audience | `appsettings.Development.json` (`Auth0:Audience`) | Auth0 dashboard → APIs → EventSync API → Identifier |
| LocalDB connection string | `appsettings.Development.json` | the file itself |

> ⚠ **`appsettings.Development.json` should be in `.gitignore` already** (the blueprint set this up in Phase 1). Verify it isn't committed: `git ls-files | findstr Development.json` should print nothing.

### ✅ Stop & verify

- `git status` on the current laptop says "nothing to commit, working tree clean."
- `github.com/yourname/eventsync` shows your latest commit.
- Auth0 Domain, Client ID, and Audience are written down somewhere safe.

---

## Section 2 — First run on the new laptop (no Docker yet)

**Goal:** Get the app running on the new laptop the "normal" way (no containers, no cloud) — to confirm the new machine's toolchain is healthy before we add complexity.

### 2.1 Clone the repo

```powershell
cd C:\
mkdir Projects
cd Projects
git clone https://github.com/yourname/eventsync.git
cd eventsync
```

### 2.2 Set up your local config files

These are **not** in the repo on purpose (they hold secrets).

1. Create `server/EventSync.Api/appsettings.Development.json`:

   ```json
   {
     "ConnectionStrings": {
       "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=EventSync;Trusted_Connection=true;TrustServerCertificate=true"
     },
     "Auth0": {
       "Domain": "YOUR-TENANT.auth0.com",
       "Audience": "https://eventsync-api"
     },
     "AllowedOrigins": [ "http://localhost:4200" ],
     "Frontend": { "BaseUrl": "http://localhost:4200" }
   }
   ```

   Replace `YOUR-TENANT.auth0.com` with the domain you saved in Section 1.2.

2. Create `client/src/environments/environment.ts`:

   ```ts
   export const environment = {
     production: false,
     apiUrl: 'http://localhost:5000/api/v1',
     auth0: {
       domain: 'YOUR-TENANT.auth0.com',
       clientId: 'YOUR-CLIENT-ID',
       authorizationParams: {
         redirect_uri: window.location.origin + '/auth/callback',
         audience: 'https://eventsync-api',
       },
     },
   } as const;
   ```

### 2.3 Run the backend

```powershell
cd server\EventSync.Api
dotnet restore
dotnet ef database update
dotnet run
```

✅ You should see: `Now listening on: http://localhost:5000`. Open `http://localhost:5000/health` in a browser → `{"status":"healthy",...}`.

> ⚠ **`dotnet ef` not found?** Install it once: `dotnet tool install --global dotnet-ef`.

### 2.4 Run the frontend (new terminal)

```powershell
cd client
npm ci
ng serve
```

✅ Open `http://localhost:4200` → log in via Auth0 → create one test event.

### ✅ Stop & verify

- API health endpoint returns 200.
- You can log in and create an event.
- That event shows up in the dashboard after refresh.

If any of these fail, **do not** move on to Docker. Docker won't fix a broken local setup; it will just hide the problem.

---

## Section 3 — Phase 6 — Local Docker

**Goal:** Run the entire app (API + SPA + DB + reverse proxy) with one command: `docker compose up`. This is the foundation for both cloud tracks.

### 3.1 Docker concepts in 60 seconds

> **Container** — a lightweight, isolated process that bundles your app *with all its dependencies* (runtime, OS libraries). Think "a tiny VM that boots in seconds and weighs MBs not GBs."
>
> **Image** — the blueprint a container is created from. You build an image once, then run many containers from it.
>
> **Dockerfile** — a text recipe that tells Docker how to build an image (start from this base OS, copy these files, run these commands).
>
> **docker-compose.yml** — a text file describing **multiple** containers that work together (e.g., API + DB + Nginx), plus how they talk to each other.
>
> **Volume** — a folder on your laptop that survives even when the container is deleted (used for the database files so you don't lose data on restart).
>
> **Reverse proxy** — a server (we'll use Nginx) that sits in front of the API + SPA and forwards `/api/*` to the API and everything else to the SPA. Result: the browser sees **one** origin (`http://localhost`) instead of two (`:4200` + `:5000`), so no CORS headaches and the production-style relative `/api/v1` URLs Just Work.

### 3.2 You are here

```
Already working:                 Adding now:
─────────────────                ─────────────
ng serve  (4200)        ─→       client container + Nginx (port 80)
dotnet run (5000)       ─→       api container (port 5000, internal only)
LocalDB                  ─→       SQL Server container + volume
                                  Nginx reverse proxy (port 80 on host)
```

### 3.3 Create the Docker files

You'll add several new files. Create each one with the **exact** contents shown.

#### File 1 — `server/Dockerfile`

> **What this is:** Recipe to package the .NET API into a runnable image. We use a *multi-stage build* — a fat SDK image compiles the code, then we copy only the compiled output into a tiny runtime image. Result: a ~200 MB image instead of ~700 MB.

```dockerfile
# ---------- Stage 1: build ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy csproj first and restore — this layer is cached when only code changes.
COPY EventSync.Api/EventSync.Api.csproj EventSync.Api/
RUN dotnet restore EventSync.Api/EventSync.Api.csproj

# Now copy the rest and publish.
COPY EventSync.Api/ EventSync.Api/
RUN dotnet publish EventSync.Api/EventSync.Api.csproj \
    -c Release \
    -o /app/publish \
    --no-restore

# ---------- Stage 2: runtime ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# Cloud platforms expect the app to listen on $PORT or 8080.
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "EventSync.Api.dll"]
```

#### File 2 — `server/.dockerignore`

> **What this is:** Tells Docker to ignore these files when sending your project to the build engine. Without it, Docker uploads `bin/`, `obj/`, etc., and builds are slow.

```
**/bin/
**/obj/
**/.vs/
**/*.user
**/appsettings.Development.json
**/.git/
```

#### File 3 — `client/Dockerfile`

> **What this is:** Build the Angular app in a Node container, then serve the resulting static files from a tiny Nginx container.

```dockerfile
# ---------- Stage 1: build the Angular app ----------
FROM node:22-alpine AS build
WORKDIR /src

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build -- --configuration=production

# ---------- Stage 2: serve with Nginx ----------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/client/browser /usr/share/nginx/html

EXPOSE 80
```

#### File 4 — `client/.dockerignore`

```
node_modules/
dist/
.angular/
.vscode/
.git/
```

#### File 5 — `client/nginx.conf`

> **What this is:** Tells Nginx how to serve the Angular app — most importantly, that any URL the SPA doesn't recognize should fall back to `index.html` (so client-side routing works on refresh).

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 256;

    # Cache hashed assets aggressively; never cache index.html.
    location ~* \.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-store";
    }

    # SPA fallback — unknown URL → serve index.html.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

#### File 6 — `proxy/nginx.conf`

> **What this is:** The reverse proxy. `/api/*` goes to the API container, everything else goes to the SPA container. This is what lets the SPA's `/api/v1` relative URL work.

Create the folder first: `mkdir proxy`.

```nginx
upstream api_upstream { server api:8080; }
upstream web_upstream { server web:80; }

server {
    listen 80;
    server_name _;

    # Forward real client info to the API so rate limiting works.
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    location /api/ {
        proxy_pass http://api_upstream;
    }

    # Uploaded files (event images) are served by the API from wwwroot/uploads.
    # Without this block, /uploads/* would fall through to the SPA container → 404.
    location /uploads/ {
        proxy_pass http://api_upstream;
        client_max_body_size 10m;   # match the API's upload limit
    }

    location /health {
        proxy_pass http://api_upstream;
    }

    location / {
        proxy_pass http://web_upstream;
    }
}
```

#### File 7 — `docker-compose.yml` (at repo root)

> **What this is:** The orchestration file. One file, one command (`docker compose up`), four containers running together on a private network.

```yaml
services:
  db:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: "${SA_PASSWORD}"
      MSSQL_PID: "Express"
    ports:
      - "1433:1433"   # exposed for debugging; safe to remove
    volumes:
      - sqldata:/var/opt/mssql
    healthcheck:
      test: ["CMD-SHELL", "/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P \"$$MSSQL_SA_PASSWORD\" -No -Q 'SELECT 1' || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  api:
    build:
      context: ./server
      dockerfile: Dockerfile
    environment:
      ASPNETCORE_ENVIRONMENT: "Production"
      # appsettings.Production.json has AllowedHosts as a placeholder; without
      # an override here, the Host-filtering middleware returns HTTP 400 for
      # every request (including /health).
      AllowedHosts: "*"
      ConnectionStrings__DefaultConnection: "Server=db,1433;Database=EventSync;User Id=sa;Password=${SA_PASSWORD};TrustServerCertificate=True;Encrypt=False"
      Auth0__Domain: "${AUTH0_DOMAIN}"
      Auth0__Audience: "${AUTH0_AUDIENCE}"
      AllowedOrigins__0: "${FRONTEND_URL}"
      Frontend__BaseUrl: "${FRONTEND_URL}"
    depends_on:
      db:
        condition: service_healthy
    volumes:
      # Persist uploaded event images across container rebuilds.
      # Without this, every `docker compose up --build api` wipes them.
      - uploads:/app/wwwroot/uploads
    expose:
      - "8080"

  web:
    build:
      context: ./client
      dockerfile: Dockerfile
    expose:
      - "80"

  proxy:
    image: nginx:1.27-alpine
    volumes:
      - ./proxy/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - "80:80"
    depends_on:
      - api
      - web

volumes:
  sqldata:
  uploads:
```

#### File 8 — `.env.example` (at repo root)

> **What this is:** A template for the real `.env` file (which is **not** committed). Copy it to `.env` and fill in real values.

```
SA_PASSWORD=ChangeMe_LongStrongP@ssword123!
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://eventsync-api
FRONTEND_URL=http://localhost
```

Now copy and fill in:

```powershell
copy .env.example .env
# Open .env in VS Code and replace the placeholders
```

> ⚠ **SQL Server password complexity.** Must be ≥ 8 chars and include 3 of: uppercase, lowercase, digit, symbol. If the `db` container exits within 10 seconds, the password was rejected — check `docker compose logs db`.

#### File 9 — Update `.gitignore` (at repo root)

Open `.gitignore` and add these lines if they aren't already there:

```
# Local secrets — NEVER commit
.env

# Build outputs
**/publish/
**/bin/
**/obj/
**/dist/
**/node_modules/
**/.angular/
```

### 3.4 Tiny code changes

Two small edits before the first container run.

#### 3.4.1 Auto-migrate the DB on startup

So we don't have to run `dotnet ef database update` manually in containers and cloud, add a small block to `Program.cs`.

Open `server/EventSync.Api/Program.cs`. Find the line where the WebApplication is built (looks like `var app = builder.Build();`). **Right after that line**, paste:

```csharp
// Auto-apply EF Core migrations in non-Development environments.
// Keeps deploys to Docker / Azure / AWS hands-free.
if (!app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<EventSync.Api.Data.AppDbContext>();
    await db.Database.MigrateAsync();
}
```

> ⚠ **Why `!IsDevelopment` and not `IsProduction`?** Docker, Azure, and AWS all run as `Production`. Local LocalDB runs as `Development`. Using `!IsDevelopment` covers all three deployment targets in one line.

#### 3.4.2 Persist the Auth0 session across page refreshes (SPA)

The dev environment file already enables `localStorage` token caching + refresh tokens, but the production environment file does not. Without these two settings, every browser refresh on the Dockerized site forces a re-login.

Open `client/src/environments/environment.prod.ts` and update the `auth0` block so it matches the dev file:

```ts
export const environment = {
  production: true,
  apiUrl: '/api/v1',
  auth0: {
    domain: 'YOUR-TENANT.auth0.com',
    clientId: 'YOUR-CLIENT-ID',
    // Persist tokens in localStorage so the session survives page refresh.
    cacheLocation: 'localstorage' as const,
    // Use refresh tokens (with rotation) for silent renewal — modern browsers
    // block 3rd-party cookies, so iframe-based silent auth often fails.
    useRefreshTokens: true,
    authorizationParams: {
      redirect_uri: window.location.origin + '/auth/callback',
      audience: 'https://eventsync-api',
    },
  },
} as const;
```

> ⚠ **Security trade-off.** `localStorage` is readable by any JS on the same origin, so an XSS bug could leak the token. Your app's strict CSP, Angular's HTML sanitization, and no third-party scripts mitigate this — it's the standard Auth0 SPA recommendation when there's no same-origin BFF.

### 3.5 Run it

```powershell
# From the repo root
docker compose up --build
```

This downloads images (~1 GB the first time, cached after), builds your two images, and starts everything. Expect 3–5 minutes the first time.

✅ You should see, in order:
- `db-1 ... Recovery is complete.`
- `api-1 ... Now listening on: http://[::]:8080`
- `proxy-1 ... start worker processes`

Open `http://localhost` → the EventSync app loads, you can log in, create events, generate invite links.

### 3.6 Docker cheat sheet

```powershell
docker compose up --build       # build + start (foreground, Ctrl+C to stop)
docker compose up --build -d    # same, but detached (runs in background)
docker compose ps               # list running containers
docker compose logs -f api      # tail logs from the api container
docker compose down             # stop and remove containers (keeps the DB volume)
docker compose down -v          # ALSO delete the DB volume (fresh DB next time)
docker compose restart api      # restart just the api after a code change
```

### 3.7 If something breaks

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `port 80 is already in use` | IIS or Skype using port 80 | Stop the service, or change `"80:80"` to `"8080:80"` in `docker-compose.yml` (then open `http://localhost:8080`). |
| `port 1433 is already in use` | LocalDB or another SQL instance running | Either stop it, or remove the `1433:1433` line in `docker-compose.yml` (the API still works because it talks to the DB on the internal network). |
| `db` container restarts in a loop | SA password too weak | Pick a stronger password in `.env`, then `docker compose down -v` (wipes the volume so the new password takes effect). |
| `api` says "no migrations found" | Forgot to copy the project files in the Dockerfile | Re-run with `docker compose build --no-cache api`. |
| `http://localhost/health` returns **400 Bad Request** | `appsettings.Production.json` has `AllowedHosts: "__SET_VIA_ENV__"`. The Host-filtering middleware rejects every request. | Make sure the `AllowedHosts: "*"` line is present in the `api` `environment:` block of `docker-compose.yml` (File 7). Then `docker compose up -d --force-recreate api`. |
| Uploaded event image returns **404** at `/uploads/...` | Reverse proxy has no `/uploads/` route, so the request falls through to the SPA container. | Confirm `proxy/nginx.conf` (File 6) includes the `location /uploads/ { proxy_pass http://api_upstream; }` block, then `docker compose restart proxy`. |
| Image was visible, then disappeared after rebuild | API container's `/app/wwwroot/uploads` is ephemeral. | Confirm the `uploads:/app/wwwroot/uploads` volume mount and the `uploads:` entry under top-level `volumes:` in `docker-compose.yml` (File 7). Re-upload the image. |
| Every page refresh forces you to sign in again | `environment.prod.ts` is missing `cacheLocation: 'localstorage'` and `useRefreshTokens: true`, so the SDK keeps tokens in memory only. | Apply Section 3.4.2, then **rebuild** the web image: `docker compose up -d --build web`. Hard-refresh the browser (Ctrl+Shift+R). |
| SPA loads but login fails | Auth0 callback URL doesn't include `http://localhost` | Auth0 dashboard → Applications → your SPA → add `http://localhost, http://localhost/auth/callback` to **Allowed Callback URLs**, `http://localhost` to **Allowed Logout URLs** and **Allowed Web Origins**. Save. |

### ✅ Stop & verify

- `docker compose ps` shows all 4 services as `running` / `healthy`.
- `http://localhost/health` returns `{"status":"healthy",...}`.
- You can log in, create an event, copy an invite link, open it in an incognito window, submit an RSVP.
- `docker compose down` then `docker compose up -d` brings the app back with the **same data** (the volume survived).

Commit your work:

```powershell
git add .
git commit -m "Phase 6: Dockerize (api + web + db + proxy)"
git push
```

🎉 **Local Docker is done.** Now choose a cloud:

- **Microsoft Azure?** → Continue to [Section 4](#section-4--cloud-track-a-azure).
- **Amazon Web Services?** → Skip to [Section 5](#section-5--cloud-track-b-aws).
- **Just wanted Docker?** → You're done. Jump to [Section 6](#section-6--maintenance--day-2-operations) for day-2 ops.

---

## Section 4 — Cloud Track A: Azure

**Goal:** Deploy EventSync to Azure for free, with HTTPS, a managed database, and automatic deployments on every `git push`.

**Architecture:**

```
   Browser
     │ HTTPS
     ▼
   Azure Static Web Apps  ────/api/*────▶  Azure App Service (.NET 10, Linux F1)
   (Angular SPA, free)                     │
                                           ▼
                                       Azure SQL Database (Free Offer)
```

**Estimated cost:** $0/month — all three services used here are permanently free within their quotas (not 12-month limited). The only way to incur charges is to accidentally pick the wrong SQL tier, enable Application Insights, or exceed 5 GB/month outbound data. Follow the ⚠ callouts below to avoid all three.

### 4.1 Azure concepts in 60 seconds

> **Resource Group** — a labeled folder that holds all the Azure things for one project. Delete the group → everything in it is deleted (great for cleanup).
>
> **App Service** — managed hosting for web apps. You hand Azure your compiled code; Azure runs it, scales it, gives it HTTPS.
>
> **App Service Plan** — the *machine* App Services run on. The **F1** tier is free (limited CPU, 1 GB RAM, no custom domain SSL — fine for portfolio).
>
> **Static Web Apps** — purpose-built free hosting for SPAs (CDN + HTTPS + preview URLs for pull requests + built-in API routing).
>
> **Azure SQL Database** — managed SQL Server. The **Free Offer** gives you 100,000 vCore-seconds and 32 GB free per month, forever (when within quotas).

### 4.2 You are here

```
Have:                              Adding:
─────                              ───────
Code on GitHub                     Resource group
Working Docker setup               Azure SQL Database (Free Offer)
                                   App Service (.NET 10, F1)
                                   Static Web Apps (Angular)
                                   GitHub Actions for auto-deploy
```

### A.1 Prerequisites

1. Active free Azure account (`azure.microsoft.com/free` if you don't have one).
2. Sign in to the CLI once:

   ```powershell
   az login
   ```

   ✅ A browser pops up, you authenticate, the CLI prints your subscription as JSON. Note the `id` field — that's your subscription ID.

3. Pick a region close to you and set it as a variable for this terminal session:

   ```powershell
   $REGION = "eastasia"     # or "westus2", "westeurope", etc.
   $SUFFIX = "demo$(Get-Random -Maximum 9999)"  # makes globally unique names
   ```

### A.2 Provision resources

We'll do each step **Portal-first** (clicks in `portal.azure.com`) with the CLI alternative underneath. Use whichever you prefer.

#### A.2.1 Resource Group (1 min)

**Portal:**
1. Top search bar → type `Resource groups` → click the matching service.
2. Click the blue **+ Create** button (top-left).
3. Resource group name: `eventsync-rg`. Region: same as `$REGION` above.
4. **Review + create** → **Create**.

**CLI alternative:**

```powershell
az group create --name eventsync-rg --location $REGION
```

✅ You should see `"provisioningState": "Succeeded"`.

#### A.2.2 Azure SQL Database — Free Offer (5 min)

> ⚠ **The Free Offer is NOT the default option.** You'll be tempted to pick "Basic" because it's first. Don't — read carefully.

**Portal:**
1. Top search bar → `SQL databases` → click the service → **+ Create**.
2. **Basics** tab:
   - Resource group: `eventsync-rg`.
   - Database name: `EventSync`.
   - Server: click **Create new**.
     - Server name: `eventsync-sql-<your-suffix>` (must be globally unique, lowercase, no spaces).
     - Location: same region.
     - Authentication method: **Use SQL authentication**.
     - Server admin login: `eventsyncadmin`.
     - Password: pick a strong one and **save it in your password manager.**
     - Click **OK**.
   - Want to use SQL elastic pool? **No**.
   - Workload environment: **Development**.
   - **Compute + storage** → click **Configure database** → at the very top, look for **Apply offer** or a banner saying *"Try Azure SQL Database serverless for free"* → click **Apply** → **Apply**.

   > ⚠ **Verify before leaving this screen.** The pricing summary at the bottom of **Review + create** must show **$0.00/month**. If it shows any other amount, go back and re-apply the Free Offer. Once created on the wrong tier, there is no in-place downgrade — you would have to recreate the database.

3. **Networking** tab:
   - Connectivity method: **Public endpoint**.
   - Allow Azure services and resources to access this server: **Yes**.
   - Add current client IPv4 address: **Yes**.
4. **Review + create** → **Create**. Wait 3–5 minutes.

**CLI alternative** (Free Offer is not directly available via the simple `az sql` CLI yet; this creates a Basic tier instead — Portal is recommended here):

```powershell
$SQL_ADMIN = "eventsyncadmin"
$SQL_PASSWORD = Read-Host "Enter a strong SQL admin password" -AsSecureString
$SQL_PASSWORD_PLAIN = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SQL_PASSWORD))

az sql server create --name "eventsync-sql-$SUFFIX" --resource-group eventsync-rg `
  --location $REGION --admin-user $SQL_ADMIN --admin-password $SQL_PASSWORD_PLAIN

az sql db create --resource-group eventsync-rg --server "eventsync-sql-$SUFFIX" `
  --name EventSync --service-objective Basic   # <-- not the free offer

az sql server firewall-rule create --resource-group eventsync-rg `
  --server "eventsync-sql-$SUFFIX" --name AllowAzure `
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

✅ When the database is ready, open it in the Portal → **Connection strings** → **ADO.NET** tab → copy the connection string. Replace `{your_password}` with the real password and save the result for step A.2.3.

The connection string format:

```
Server=tcp:eventsync-sql-XXXX.database.windows.net,1433;Initial Catalog=EventSync;Persist Security Info=False;User ID=eventsyncadmin;Password=YOUR_PASSWORD;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

#### A.2.3 App Service (.NET 10, Linux F1) (3 min)

**Portal:**
1. Top search bar → `App Services` → **+ Create** → **Web App**.
2. **Basics**:
   - Resource group: `eventsync-rg`.
   - Name: `eventsync-api-<suffix>` (becomes part of your URL: `eventsync-api-<suffix>.azurewebsites.net`).
   - Publish: **Code**.
   - Runtime stack: **.NET 10 (LTS)**.
   - Operating System: **Linux**.
   - Region: same as before.
   - Pricing plan: click **Change size** → **Free F1** → **Apply**.

   > ⚠ **Azure defaults to B1 (~$13/month), not F1.** Always click **Change size** and confirm **F1** is selected before hitting Review + create. Also, if a screen offers to enable **Application Insights**, skip it — it has costs beyond a small free quota.

3. **Review + create** → **Create**. Wait 1–2 minutes.

**CLI alternative:**

```powershell
az appservice plan create --name eventsync-plan --resource-group eventsync-rg `
  --sku F1 --is-linux

az webapp create --name "eventsync-api-$SUFFIX" --resource-group eventsync-rg `
  --plan eventsync-plan --runtime "DOTNETCORE:10.0"
```

#### A.2.4 Configure the App Service (5 min)

Now we tell it about the database and Auth0.

**Portal:**
1. Open your new App Service.
2. Left menu → **Settings** → **Environment variables** → **Application settings** tab.
3. Click **+ Add** for each row below. **Name format matters** — the double underscores `__` are how .NET represents nested config:

   | Name | Value |
   |------|-------|
   | `ConnectionStrings__DefaultConnection` | (the ADO.NET string from A.2.2) |
   | `Auth0__Domain` | your Auth0 domain |
   | `Auth0__Audience` | `https://eventsync-api` |
   | `ASPNETCORE_ENVIRONMENT` | `Production` |
   | `WEBSITES_PORT` | `8080` |
   | `AllowedHosts` | `*` *(or your App Service hostname, e.g. `eventsync-api-<suffix>.azurewebsites.net`)* |

   We'll add `AllowedOrigins__0` and `Frontend__BaseUrl` after A.2.5 (we need the SWA URL first).

4. Click **Apply** at the top → **Confirm**. The app restarts.

**CLI alternative:**

```powershell
az webapp config appsettings set --name "eventsync-api-$SUFFIX" --resource-group eventsync-rg `
  --settings `
    "ConnectionStrings__DefaultConnection=<paste-connection-string>" `
    "Auth0__Domain=<your-tenant>.auth0.com" `
    "Auth0__Audience=https://eventsync-api" `
    "ASPNETCORE_ENVIRONMENT=Production" `
    "WEBSITES_PORT=8080" `
    "AllowedHosts=*"
```

> ⚠ **Heads-up about uploaded images.** App Service's local disk is *persistent within a single instance*, so the API's `wwwroot/uploads` folder survives restarts — but it's lost if you ever scale out (multiple instances), redeploy, or swap slots. For a portfolio site on F1 (single instance, no swap) this is fine. To make it bulletproof, mount an [Azure Files share](https://learn.microsoft.com/azure/app-service/configure-connect-to-azure-storage) at `/home/site/wwwroot/wwwroot/uploads` or refactor the API to store uploads in Azure Blob Storage.

#### A.2.5 Azure Static Web Apps (3 min)

**Portal:**
1. Top search bar → `Static Web Apps` → **+ Create**.
2. **Basics**:
   - Resource group: `eventsync-rg`.
   - Name: `eventsync-web`.
   - Plan type: **Free**.
   - Region: nearest.
   - Deployment source: **Other** *(we'll wire up GitHub Actions ourselves in A.5).*
3. **Review + create** → **Create**.
4. Open the new resource → on the **Overview** page, copy the **URL** (`https://<random>.azurestaticapps.net`). **Save it** — this is your production SPA URL.

**CLI alternative:**

```powershell
az staticwebapp create --name eventsync-web --resource-group eventsync-rg `
  --location $REGION --sku Free
```

#### A.2.6 Finish App Service config

Now add the two remaining environment variables (App Service → Environment variables):

| Name | Value |
|------|-------|
| `AllowedOrigins__0` | the SWA URL from A.2.5 (no trailing slash) |
| `Frontend__BaseUrl` | same SWA URL |

Apply → Confirm.

### A.3 Deploy the code (first time, manual)

#### A.3.1 API → App Service

```powershell
cd server\EventSync.Api
dotnet publish -c Release -o publish
Compress-Archive -Path publish\* -DestinationPath publish.zip -Force

az webapp deploy --resource-group eventsync-rg --name "eventsync-api-$SUFFIX" `
  --src-path publish.zip --type zip
```

Wait 2–3 minutes. ✅ Visit `https://eventsync-api-<suffix>.azurewebsites.net/health` → `{"status":"healthy",...}`.

> ⚠ **First request can take 30+ seconds** — F1 plans cold-start slowly. Hit refresh once or twice.

#### A.3.2 SPA → Static Web Apps

The SPA needs to call your API via the SWA's built-in routing. Create `client/staticwebapp.config.json`:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "/assets/*", "*.{css,js,svg,png,jpg,ico,woff2}"]
  },
  "routes": [
    {
      "route": "/api/*",
      "rewrite": "https://eventsync-api-REPLACE_ME.azurewebsites.net/api/{*}"
    }
  ]
}
```

Replace `eventsync-api-REPLACE_ME` with your actual App Service name.

Build and deploy:

```powershell
cd client
npm ci
npm run build -- --configuration=production

npm install -g @azure/static-web-apps-cli
swa deploy ./dist/client/browser --deployment-token "<GET-FROM-PORTAL>"
```

To get the deployment token: Static Web App → **Overview** → top toolbar → **Manage deployment token** → copy.

✅ Open `https://<random>.azurestaticapps.net` → the SPA loads.

### A.4 Auth0 production callbacks

Auth0 dashboard → **Applications** → your SPA app → **Settings**. Find the three lists below and **append** (comma-separated, don't replace) your SWA URL:

- **Allowed Callback URLs:** add `https://<random>.azurestaticapps.net/auth/callback`
- **Allowed Logout URLs:** add `https://<random>.azurestaticapps.net`
- **Allowed Web Origins:** add `https://<random>.azurestaticapps.net`

Scroll down → **Save Changes**.

> ⚠ **Trailing slashes matter.** `https://foo.azurestaticapps.net` and `https://foo.azurestaticapps.net/` are *different* to Auth0. Match exactly what your browser shows.

### A.5 GitHub Actions CI/CD

Now every `git push` to `main` will rebuild and redeploy automatically.

#### A.5.1 Save secrets in GitHub

1. App Service publish profile:

   ```powershell
   az webapp deployment list-publishing-profiles --name "eventsync-api-$SUFFIX" `
     --resource-group eventsync-rg --xml | clip
   ```

   The XML is now in your clipboard.

2. Go to `github.com/yourname/eventsync` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

   - Name: `AZURE_WEBAPP_PUBLISH_PROFILE` → Value: paste the XML → **Add secret**.
   - Name: `AZURE_STATIC_WEB_APPS_API_TOKEN` → Value: the deployment token from A.3.2 → **Add secret**.

#### A.5.2 API workflow — `.github/workflows/azure-api-deploy.yml`

```yaml
name: Deploy API to Azure App Service

on:
  push:
    branches: [main]
    paths:
      - 'server/**'
      - '.github/workflows/azure-api-deploy.yml'
  workflow_dispatch:

env:
  WEBAPP_NAME: eventsync-api-REPLACE_WITH_YOUR_SUFFIX
  DOTNET_VERSION: '10.0.x'
  PROJECT_PATH: server/EventSync.Api/EventSync.Api.csproj

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: ${{ env.DOTNET_VERSION }}

      - run: dotnet restore ${{ env.PROJECT_PATH }}
      - run: dotnet build ${{ env.PROJECT_PATH }} -c Release --no-restore
      - run: dotnet publish ${{ env.PROJECT_PATH }} -c Release -o publish --no-build

      - uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ env.WEBAPP_NAME }}
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: publish
```

#### A.5.3 SPA workflow — `.github/workflows/azure-web-deploy.yml`

```yaml
name: Deploy SPA to Azure Static Web Apps

on:
  push:
    branches: [main]
    paths:
      - 'client/**'
      - '.github/workflows/azure-web-deploy.yml'
  pull_request:
    branches: [main]
    paths: ['client/**']

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: client/package-lock.json

      - run: npm ci
        working-directory: ./client

      - run: npm run build -- --configuration=production
        working-directory: ./client

      - uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          app_location: '/client'
          output_location: 'dist/client/browser'
          skip_app_build: true
          action: 'upload'
```

Commit and push:

```powershell
git add .github/ client/staticwebapp.config.json
git commit -m "Phase 7A: Azure CI/CD"
git push
```

Go to GitHub → **Actions** tab → watch both workflows turn green. ✅

### A.6 Smoke test

1. Open the SWA URL in a fresh incognito window.
2. Click **Sign In** → log in via Auth0 → land on Dashboard.
3. Create an event.
4. Generate an invite link → copy it.
5. Open the invite link in another incognito window (no login) → submit an RSVP.
6. Back in the organizer view, refresh → new RSVP shows.

### A.7 Logs, rollback, cost control

| Task | How |
|------|-----|
| **View API logs** | App Service → **Monitoring** → **Log stream**. |
| **View SPA build logs** | GitHub → **Actions** → click the run. |
| **Rollback the API** | App Service → **Deployment** → **Deployment slots** (or push the previous commit). |
| **Wipe everything to save cost** | `az group delete --name eventsync-rg --yes --no-wait` — deletes every resource in the group. |
| **Set a budget alert** | Top search → **Cost Management + Billing** → **Budgets** → **+ Add** → $5 monthly alert at 80%. |

#### $0 cost verification checklist

Run this once after provisioning to confirm nothing is billing unexpectedly:

- [ ] **Azure SQL** — Portal → your database → **Overview** → Pricing tier shows **Free**.
- [ ] **App Service plan** — Portal → `eventsync-plan` → **Pricing tier** shows **F1 Free**.
- [ ] **Static Web Apps** — Portal → `eventsync-web` → **Overview** → Plan shows **Free**.
- [ ] **Application Insights** — Portal → Resource group `eventsync-rg` → confirm no Application Insights resource exists.
- [ ] **Budget alert** — Cost Management + Billing → Budgets → `eventsync-budget` is active with a $5 cap.

> **What can still cause a charge:** Azure SQL Free Offer allows 100,000 vCore-seconds/month. At typical portfolio-app usage (a few logins and event creates per day) you will use well under 10% of this. The serverless tier auto-pauses after 1 hour of inactivity, so idle nights cost nothing. Outbound data over 5 GB/month would also add pennies — extremely unlikely for a portfolio app.

### ✅ Stop & verify (Track A complete)

- `https://<random>.azurestaticapps.net` shows your app over HTTPS.
- Login works.
- Creating an event persists across browser sessions.
- A trivial commit to `main` triggers a green Actions run.
- A $5 budget alert is configured.
- The $0 cost verification checklist in A.7 is ticked off.

🎉 **Azure deployment done.** Optional next step: [Section 5 (AWS)](#section-5--cloud-track-b-aws) for portfolio parity, or [Section 6](#section-6--maintenance--day-2-operations) for day-2 ops.

---

## Section 5 — Cloud Track B: AWS

**Goal:** Deploy EventSync to AWS for free (within 12-month free-tier limits), with HTTPS, a managed database, and automatic deployments on every `git push`.

> ✋ **This track is fully independent from Track A.** You do NOT need an Azure deployment to follow it. Skip here directly from the end of Section 3.

**Architecture:**

```
   Browser
     │ HTTPS
     ▼
   CloudFront ───/api/*───▶  Elastic Beanstalk (.NET 10 container on t3.micro)
     │                          │
     ▼                          ▼
   S3 (Angular SPA)         RDS SQL Server Express (Free Tier)
```

**Estimated cost:** $0 for the first 12 months **only if** you stay within free-tier hours. Elastic Beanstalk on a single `t3.micro` EC2 instance is free-tier eligible (750 hours/month) — see B.2.4.

### 5.1 AWS concepts in 60 seconds

> **IAM** — Identity & Access Management. Every action in AWS requires permission. You'll create an IAM **user** for yourself and (later) an IAM **role** for GitHub Actions.
>
> **VPC** — Virtual Private Cloud. A private network where your resources live.
>
> **Security Group** — a firewall attached to a resource. Whitelist-based (deny by default).
>
> **ECR** — Elastic Container Registry. AWS's equivalent of Docker Hub. Stores your built images.
>
> **Elastic Beanstalk** — a managed platform that provisions and runs your app on an EC2 instance for you (it wires up the instance, security, health checks, and deploys). You hand it your container image (via a small `Dockerrun.aws.json`) and it runs it. A single `t3.micro` instance is **free-tier eligible** for 12 months (750 hours/month). **Note:** AWS App Runner stopped accepting new customers on April 30, 2026, so this guide uses Elastic Beanstalk instead.
>
> **S3** — object storage (files). Can also host static websites.
>
> **CloudFront** — global CDN. Sits in front of S3 (and optionally Elastic Beanstalk) for HTTPS, caching, low latency.
>
> **RDS** — Relational Database Service. Managed SQL Server. **SQL Server Express Edition** is the only SKU eligible for the 12-month free tier.

### 5.2 You are here

```
Have:                              Adding:
─────                              ───────
Code on GitHub                     IAM user + AWS CLI configured
Working Docker setup               RDS SQL Server Express (Free Tier)
                                   ECR repository
                                   Elastic Beanstalk env (.NET 10 API)
                                   S3 bucket + CloudFront (Angular SPA)
                                   GitHub Actions for auto-deploy
                                   $1 AWS Budget alert
```

### B.1 Prerequisites

1. Active AWS free-tier account (`aws.amazon.com/free`).

2. Create an IAM user for yourself:

   - Console (`console.aws.amazon.com`) → search **IAM** → **Users** → **Create user**.
   - User name: `eventsync-admin`.
   - Check **Provide user access to the AWS Management Console** (optional, for browsing) → next.
   - Permissions → **Attach policies directly** → check **AdministratorAccess**. (Portfolio simplicity; tighten later.) → next → **Create user**.
   - Open the new user → **Security credentials** tab → **Create access key** → **Command Line Interface (CLI)** → check the confirmation → next → **Create access key**.
   - **Copy both** the **Access key ID** and **Secret access key** into your password manager. You'll never see the secret again.

3. Sign in to AWS as the IAM user (not root) before doing the AWS console steps in this section:

  - Go to the IAM sign-in page (`https://<account-id-or-alias>.signin.aws.amazon.com/console`) **or** from the sign-in screen click **Sign in as IAM user**.
  - Enter your account ID (or account alias), IAM username, and IAM password.
  - Use the **root** user only for rare account-level tasks (billing, account recovery, root security changes), not for routine deployment work.
  - If you did not enable console access when creating `eventsync-admin`, either re-create the user with console access or edit the user in IAM to enable console login.

4. Configure the CLI:

   ```powershell
   aws configure
   # AWS Access Key ID: (paste)
   # AWS Secret Access Key: (paste)
   # Default region name: us-east-1     (or your nearest region)
   # Default output format: json
   ```

   ✅ Test: `aws sts get-caller-identity` should print your account ID and user ARN.

5. Set environment variables for this terminal session:

   ```powershell
   $REGION = "us-east-1"
   $SUFFIX = "demo$(Get-Random -Maximum 9999)"
   $ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text)
   ```

### B.2 Provision resources

#### B.2.1 Create the RDS database (10 min provisioning)

> ⚠ **You MUST select "SQL Server Express Edition" specifically.** Standard / Enterprise / Web editions are NOT free-tier eligible and will charge you immediately.

**Console:**
1. Search **RDS** → **Create database**.
2. Choose a database creation method: **Standard create**.
3. Engine options: **Microsoft SQL Server**.
4. Edition: **SQL Server Express Edition**. *(Critical.)*
5. Templates: **Free tier**. *(Confirms you'll stay free.)*
6. DB instance identifier: `eventsync-db`.
7. Master username: `eventsyncadmin`. Master password: strong; save to password manager.
8. Instance configuration: leave the default (`db.t3.micro`).
9. Storage: 20 GiB. **Uncheck** "Enable storage autoscaling" to avoid surprises.
10. Connectivity:
    - VPC: default.
    - **Public access: No.** *(Elastic Beanstalk reaches it privately inside the same VPC.)*
    - VPC security group: **Create new** → name `eventsync-db-sg`.
11. Database authentication: **Password authentication**.
12. Additional configuration → Initial database name: `EventSync`.
13. **Create database**. Wait ~10 minutes.

When ready, open the DB → **Connectivity & security** tab → copy the **Endpoint** (e.g., `eventsync-db.xxxxx.us-east-1.rds.amazonaws.com`).

Your connection string will look like:

```
Server=eventsync-db.xxxxx.us-east-1.rds.amazonaws.com,1433;Database=EventSync;User Id=eventsyncadmin;Password=YOUR_PASSWORD;TrustServerCertificate=True;Encrypt=False
```

#### B.2.2 Push the API image to ECR (5 min)

```powershell
# Create the registry
aws ecr create-repository --repository-name eventsync-api --region $REGION

# Log Docker in to your private registry
aws ecr get-login-password --region $REGION | `
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# Build, tag, push  (run from the repo root)
docker build -t eventsync-api -f server/Dockerfile server/
docker tag eventsync-api:latest "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/eventsync-api:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/eventsync-api:latest"
```

What each command does:

1. `aws ecr create-repository ...`
  Creates a private ECR repository named `eventsync-api` in your selected region.
2. `aws ecr get-login-password ... | docker login ...`
  Gets a short-lived auth token from AWS and logs Docker into your private ECR registry.
3. `docker build -t eventsync-api -f server/Dockerfile server/`
  Builds your API image from `server/Dockerfile` and tags it locally as `eventsync-api:latest`.
4. `docker tag eventsync-api:latest .../eventsync-api:latest`
  Adds an ECR-formatted tag so Docker knows where to push the image.
5. `docker push .../eventsync-api:latest`
  Uploads the image layers to ECR so Elastic Beanstalk can pull and deploy them.

If you are using **Command Prompt** (`cmd.exe`) instead of PowerShell:

```cmd
aws ecr create-repository --repository-name eventsync-api --region %REGION%

aws ecr get-login-password --region %REGION% | docker login --username AWS --password-stdin %ACCOUNT_ID%.dkr.ecr.%REGION%.amazonaws.com

docker build -t eventsync-api -f server/Dockerfile server/
docker tag eventsync-api:latest %ACCOUNT_ID%.dkr.ecr.%REGION%.amazonaws.com/eventsync-api:latest
docker push %ACCOUNT_ID%.dkr.ecr.%REGION%.amazonaws.com/eventsync-api:latest
```

✅ Console → ECR → **Repositories** → `eventsync-api` → an image with tag `latest`.

#### B.2.3 Create a security group for the API and open the DB to it

Elastic Beanstalk will run your API on an EC2 instance inside your VPC. That instance must reach RDS on port 1433. We pre-create a security group now, then attach it to the Beanstalk environment in B.2.4.

**Console:**
1. Search **EC2** → left menu **Security Groups** → **Create security group**.
   - Name: `eventsync-eb-sg`.
   - Description: `EventSync API (Elastic Beanstalk) instances`.
   - VPC: the **default** VPC (the same one your RDS uses).
   - Leave inbound empty; leave outbound as default (all traffic). → **Create security group**.
2. Open the **RDS security group** (`eventsync-db-sg`) → **Inbound rules** → **Edit** → **Add rule**:
   - Type **MSSQL** (port 1433).
   - Source → select `eventsync-eb-sg`.
   - **Save rules**.

#### B.2.4 Create the Elastic Beanstalk environment (10 min)

Elastic Beanstalk (EB) runs your container image on a managed EC2 instance. On a single `t3.micro` instance it fits inside the 12-month free tier.

**First, create the deploy descriptor.** In your repo, create `server/Dockerrun.aws.json` — this tells EB which image to run and which port to expose:

```json
{
  "AWSEBDockerrunVersion": "1",
  "Image": {
    "Name": "REPLACE_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/eventsync-api:latest",
    "Update": "true"
  },
  "Ports": [
    { "ContainerPort": 8080, "HostPort": 80 }
  ]
}
```

Replace `REPLACE_ACCOUNT_ID` (and the region, if yours differs) with your real values. Then zip just this file for upload:

PowerShell:
```powershell
Compress-Archive -Path server\Dockerrun.aws.json -DestinationPath eb-app.zip -Force
```

Command Prompt (`cmd.exe`):
```cmd
powershell -Command "Compress-Archive -Path server\Dockerrun.aws.json -DestinationPath eb-app.zip -Force"
```

**Console:**
1. Search **Elastic Beanstalk** → **Create application**.
2. Application name: `eventsync-api`.
3. Environment tier: **Web server environment**.
4. Platform: **Docker** → Platform branch: **Docker running on 64bit Amazon Linux 2023**.
5. Application code: **Upload your code** → upload `eb-app.zip`.
6. Presets: **Single instance (free tier eligible)**. → **Next**.
7. **Service access**: allow EB to **create and use a new service role**; for the EC2 instance profile, pick `aws-elasticbeanstalk-ec2-role` (or let EB create it). → **Next**.
8. **Set up networking, database, and tags**:
   - VPC: your **default** VPC.
   - Public IP address: **Activated**.
   - Instance subnets: check at least one subnet (two is fine). → **Next**.
9. **Configure instance traffic and scaling**:
   - **EC2 security groups**: check `eventsync-eb-sg` (from B.2.3).
   - Instance type: **t3.micro**. → **Next**.
10. **Configure updates, monitoring, and logging** → scroll to **Environment properties** → add each:

    | Name | Value |
    |------|-------|
    | `ASPNETCORE_ENVIRONMENT` | `Production` |
    | `AllowedHosts` | `*` |
    | `ConnectionStrings__DefaultConnection` | the RDS string from B.2.1 |
    | `Auth0__Domain` | your Auth0 domain |
    | `Auth0__Audience` | `https://eventsync-api` |
    | `AllowedOrigins__0` | placeholder (fill after B.2.6) |
    | `Frontend__BaseUrl` | placeholder (fill after B.2.6) |

11. **Next** → review → **Submit**. Wait 5–10 min.

✅ Environment health goes **Green**/**OK**. Copy the environment **Domain** (e.g., `eventsync-api-env.eba-xxxx.ap-southeast-1.elasticbeanstalk.com`) — that's your API URL. Test `http://<eb-domain>/health` → `{"status":"healthy",...}`.

> ⚠ **ECR pull permission.** The EC2 instance profile must be allowed to read ECR. If the environment shows an image-pull error in **Logs**, attach the `AmazonEC2ContainerRegistryReadOnly` policy to the `aws-elasticbeanstalk-ec2-role` (IAM → Roles → that role → **Add permissions**), then **Actions → Restart app server(s)**.

> ⚠ **Heads-up about uploaded images.** The Beanstalk EC2 instance disk is **ephemeral** — a redeploy or instance replacement starts with an empty `wwwroot/uploads`. The local-Docker upload flow will *appear* to work but files can vanish on the next deploy. For production-grade uploads, refactor the API's `UploadEndpoints` to write to an **S3 bucket** (signed URLs back to the client) instead of the local filesystem. Until then, treat uploads as throwaway.

> 💸 **Cost note.** A single `t3.micro` fits the 12-month free tier (750 hours/month). After that, expect roughly **$9–10/month** for the EC2 instance. Keep the environment **Single instance** (no load balancer) to avoid the extra ~$18/month an ALB would add. To stop paying between demos: **Actions → Terminate environment** (recreate later from the same `eb-app.zip`).

#### B.2.5 S3 bucket for the SPA (3 min)

PowerShell:

```powershell
$BUCKET = "eventsync-web-$SUFFIX"
aws s3api create-bucket --bucket $BUCKET --region $REGION `
  --create-bucket-configuration LocationConstraint=$REGION
```

Command Prompt (`cmd.exe`):

```cmd
set BUCKET=eventsync-web-%SUFFIX%
aws s3api create-bucket --bucket %BUCKET% --region %REGION% --create-bucket-configuration LocationConstraint=%REGION%
```

(Omit the `--create-bucket-configuration` flag if your region is `us-east-1`.)

Build the SPA (the relative `/api/v1` from `environment.prod.ts` will be routed by CloudFront to Elastic Beanstalk — no env file edit needed):

PowerShell:

```powershell
cd client
npm ci
npm run build -- --configuration=production

aws s3 sync ./dist/client/browser "s3://$BUCKET" --delete
```

Command Prompt (`cmd.exe`):

```cmd
cd client
npm ci
npm run build -- --configuration=production

aws s3 sync .\dist\client\browser s3://%BUCKET% --delete
```

#### B.2.6 CloudFront distribution (5 min + ~20 min propagation)

CloudFront does three jobs for us: serves the SPA over HTTPS, fixes SPA routing (404 → `/index.html`), and forwards `/api/*` to Elastic Beanstalk so the SPA's relative URLs work.

**Console:**
1. Search **CloudFront** → **Create distribution**.
2. **Origin domain**: click the box → pick your S3 bucket from the dropdown.
3. **Origin access**: **Origin access control settings (recommended)** → **Create new OAC** → defaults → **Create**.
4. **Default cache behavior**:
   - Viewer protocol policy: **Redirect HTTP to HTTPS**.
   - Allowed HTTP methods: **GET, HEAD**.
5. **Web Application Firewall (WAF)**: **Do not enable** (extra cost).
6. **Default root object**: `index.html`.
7. **Create distribution**.

After it's created (the table shows **Deployed**, ~15–20 min):

8. Open the distribution → **Origins** tab → **Create origin**:
   - Origin domain: the Elastic Beanstalk environment domain (just the hostname, no `http://`).
   - Protocol: **HTTP only**. Port 80. *(Single-instance EB serves plain HTTP; CloudFront adds HTTPS for the browser.)*
   - Name: `eb-api`. → **Create origin**.
9. **Behaviors** tab → **Create behavior**:
   - Path pattern: `/api/*`.
   - Origin: `eb-api`.
   - Viewer protocol policy: **Redirect HTTP to HTTPS**.
   - Allowed HTTP methods: **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**.
   - Cache policy: **CachingDisabled**.
   - Origin request policy: **AllViewerExceptHostHeader**.
   - **Create behavior**.
10. **Error pages** tab → **Create custom error response** (do this twice):
    - For `403` → Customize error response **Yes** → Response page path `/index.html` → HTTP response code **200**.
    - Same for `404`.

11. **S3 bucket policy** (so CloudFront can read it): the OAC setup printed a snippet — **Copy policy** → go to S3 → your bucket → **Permissions** → **Bucket policy** → paste → **Save**.

✅ Open the **Distribution domain name** (e.g., `https://d1234abcd.cloudfront.net`) → SPA loads.

#### B.2.7 Finish Elastic Beanstalk config

Go back to Elastic Beanstalk → `eventsync-api` environment → **Configuration** → **Updates, monitoring, and logging** → **Edit** → **Environment properties** → update the placeholders:

| Name | Value |
|------|-------|
| `AllowedOrigins__0` | your CloudFront URL (e.g., `https://d1234abcd.cloudfront.net`) |
| `Frontend__BaseUrl` | same |

**Apply** to save. ✅ The environment updates and returns to **Green**/**OK**.

### B.3 Auth0 production callbacks

Same as Track A — append your CloudFront URL to Auth0:

- **Allowed Callback URLs:** add `https://d1234abcd.cloudfront.net/auth/callback`
- **Allowed Logout URLs:** add `https://d1234abcd.cloudfront.net`
- **Allowed Web Origins:** add `https://d1234abcd.cloudfront.net`

Save Changes.

### B.4 GitHub Actions CI/CD

#### B.4.1 Save AWS credentials in GitHub

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → add three secrets:

- `AWS_ACCESS_KEY_ID` — your IAM access key.
- `AWS_SECRET_ACCESS_KEY` — your IAM secret.
- `AWS_REGION` — e.g., `us-east-1`.

> 💡 **Better long-term:** use OIDC federation (no long-lived secrets in GitHub). See `docs.github.com/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services`. For first deployment, IAM keys are fine.

Also add:

- `EB_APPLICATION_NAME` — `eventsync-api`.
- `EB_ENVIRONMENT_NAME` — your EB environment name (e.g., `eventsync-api-env`).
- `EB_S3_BUCKET` — the Elastic Beanstalk storage bucket (e.g., `elasticbeanstalk-ap-southeast-1-<account-id>`), created automatically the first time you use Elastic Beanstalk.
- `ECR_REPOSITORY` — `eventsync-api`.
- `S3_BUCKET` — your bucket name from B.2.5.
- `CLOUDFRONT_DISTRIBUTION_ID` — CloudFront → your distribution → ID.

#### B.4.2 API workflow — `.github/workflows/aws-api-deploy.yml`

```yaml
name: Deploy API to AWS Elastic Beanstalk

on:
  push:
    branches: [main]
    paths:
      - 'server/**'
      - '.github/workflows/aws-api-deploy.yml'
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr

      - name: Build, tag, push image
        env:
          REGISTRY: ${{ steps.ecr.outputs.registry }}
          REPO: ${{ secrets.ECR_REPOSITORY }}
          TAG: ${{ github.sha }}
        run: |
          docker build -t $REGISTRY/$REPO:$TAG -t $REGISTRY/$REPO:latest -f server/Dockerfile server/
          docker push $REGISTRY/$REPO:$TAG
          docker push $REGISTRY/$REPO:latest

      - name: Package Dockerrun for Elastic Beanstalk
        run: zip -j eb-app.zip server/Dockerrun.aws.json

      - name: Create EB application version and deploy
        env:
          APP: ${{ secrets.EB_APPLICATION_NAME }}
          ENVNAME: ${{ secrets.EB_ENVIRONMENT_NAME }}
          BUCKET: ${{ secrets.EB_S3_BUCKET }}
          VERSION: ${{ github.sha }}
        run: |
          aws s3 cp eb-app.zip "s3://$BUCKET/eventsync-api/$VERSION.zip"
          aws elasticbeanstalk create-application-version \
            --application-name "$APP" \
            --version-label "$VERSION" \
            --source-bundle S3Bucket="$BUCKET",S3Key="eventsync-api/$VERSION.zip"
          aws elasticbeanstalk update-environment \
            --environment-name "$ENVNAME" \
            --version-label "$VERSION"
```

> ℹ️ Because `Dockerrun.aws.json` references the `:latest` tag, each deploy creates a new EB application version that re-pulls the freshly pushed image. The IAM user needs `elasticbeanstalk:*`, `s3:PutObject` on the EB bucket, and ECR push permissions (covered by `AdministratorAccess` from B.1).

#### B.4.3 SPA workflow — `.github/workflows/aws-web-deploy.yml`

```yaml
name: Deploy SPA to AWS S3 + CloudFront

on:
  push:
    branches: [main]
    paths:
      - 'client/**'
      - '.github/workflows/aws-web-deploy.yml'
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: client/package-lock.json

      - run: npm ci
        working-directory: ./client

      - run: npm run build -- --configuration=production
        working-directory: ./client

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Sync to S3
        run: aws s3 sync ./client/dist/client/browser s3://${{ secrets.S3_BUCKET }} --delete

      - name: Invalidate CloudFront cache
        run: |
          aws cloudfront create-invalidation `
            --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} `
            --paths "/*"
```

Commit and push:

```powershell
git add .github/
git commit -m "Phase 7B: AWS CI/CD"
git push
```

✅ Both workflows go green on GitHub → Actions.

### B.5 Smoke test + MANDATORY budget alert

1. Open CloudFront URL → log in → create event → invite link → submit RSVP in incognito. All should work.

2. **Set a $1 budget alert** — Elastic Beanstalk EC2 + RDS-over-quota can quietly add up:

   - Console → **Billing and Cost Management** → **Budgets** → **Create budget**.
   - Template: **Monthly cost budget** → next.
   - Budget name: `eventsync-cost-cap`. Amount: `1` USD.
   - Email recipients: your email.
   - **Create budget**.

   You'll get an email the moment you exceed $1/month. **Do not skip this.**

### B.6 Logs, rollback, cost control

| Task | How |
|------|-----|
| **View API logs** | Elastic Beanstalk → environment → **Logs** → **Request logs**. |
| **View SPA logs** | GitHub → **Actions** → click the run. |
| **Roll back the API** | Elastic Beanstalk → environment → **Application versions** → select a previous version → **Deploy**, OR push the previous git commit. |
| **Stop paying between demos** | Elastic Beanstalk → environment → **Actions** → **Terminate environment**. Recreate later from `eb-app.zip`. |
| **Wipe everything** (in dependency order) | Elastic Beanstalk → **Terminate environment**, then delete the application; CloudFront → **Disable** then **Delete**; S3 → **Empty bucket** then **Delete**; ECR → **Delete repository**; RDS → **Delete** (uncheck "Create final snapshot"); security group `eventsync-eb-sg` → **Delete**. |

### ✅ Stop & verify (Track B complete)

- CloudFront URL serves the SPA over HTTPS.
- Login works; data persists across sessions.
- A trivial commit to `main` triggers both green Actions runs.
- $1 AWS Budget alert is configured.
- End-of-day habit: if you are done testing, run `aws rds stop-db-instance --db-instance-identifier eventsync-db --region ap-southeast-1`.

🎉 **AWS deployment done.**

---

## Section 6 — Maintenance & day-2 operations

### 6.1 Keep your two laptops in sync

Whichever laptop you sit down at, **first**:

```powershell
git pull
```

When you're done for the session:

```powershell
git add .
git commit -m "what you did"
git push
```

Never edit on both at once without pushing — you'll create merge conflicts.

### 6.2 Where to look when things break

| Symptom | Local Docker | Azure | AWS |
|---------|--------------|-------|-----|
| White page on SPA | `docker compose logs web` | SWA → **Functions** → **Invocations** | CloudFront → distribution → check origin status |
| API 500s | `docker compose logs api` | App Service → **Log stream** | Elastic Beanstalk → environment → **Logs** |
| Login fails (Auth0) | Browser dev tools → Network tab → look at the `/authorize` request URL | same | same |
| DB connection refused | `docker compose logs db` | App Service → Log stream → look for "connection timeout" | Elastic Beanstalk → Logs → look for "Network-related" errors. Check the security group rule in B.2.3. |

### 6.3 Rotate Auth0 credentials

If a secret leaks:

1. Auth0 dashboard → Applications → your SPA → **Settings** → scroll to **Client Secret** → **Rotate** *(SPA apps usually don't use a client secret — only relevant for the API).*
2. For the API: Auth0 → APIs → your API → **Machine to Machine Applications** → rotate the secret of any app that consumes it.
3. Update the value in:
   - Local: `appsettings.Development.json`.
   - Docker: `.env`.
   - Azure: App Service → Environment variables.
   - AWS: Elastic Beanstalk → environment → Configuration → Environment properties → Apply.
4. The **Client ID** is **not** a secret — it's embedded in the SPA bundle by design. Don't try to "hide" it.

### 6.4 Updating the app

Just push to `main`. The right CI/CD workflow picks up the change (Azure files trigger Azure workflows, AWS files trigger AWS workflows — paths filter handles this).

### 6.5 AWS RDS tiny start/stop routine + weekly checklist

Use this routine to avoid surprise RDS charges when you're not actively demoing or testing.

#### Tiny start/stop routine (copy/paste)

PowerShell:

```powershell
# Stop when done for the day (pauses DB compute charges)
aws rds stop-db-instance --db-instance-identifier eventsync-db --region ap-southeast-1

# Start before a demo/test session
aws rds start-db-instance --db-instance-identifier eventsync-db --region ap-southeast-1

# Quick status check
aws rds describe-db-instances --db-instance-identifier eventsync-db --region ap-southeast-1 --query "DBInstances[0].DBInstanceStatus" --output text
```

Command Prompt (`cmd.exe`):

```cmd
:: Stop when done for the day (pauses DB compute charges)
aws rds stop-db-instance --db-instance-identifier eventsync-db --region ap-southeast-1

:: Start before a demo/test session
aws rds start-db-instance --db-instance-identifier eventsync-db --region ap-southeast-1

:: Quick status check
aws rds describe-db-instances --db-instance-identifier eventsync-db --region ap-southeast-1 --query "DBInstances[0].DBInstanceStatus" --output text
```

> ⚠ RDS can auto-start after about 7 days in `stopped` state. If you're trying to stay near $0, check it weekly and stop it again if needed.

#### Weekly checklist (5 minutes)

1. Billing console → Cost Explorer → filter Service = **RDS** → confirm no unexpected spikes this week.
2. Billing console → Bills → open **Relational Database Service** → verify line items are expected (instance-hours, storage, backup, CPU credits).
3. RDS console → `eventsync-db` → verify status is `stopped` when you are not actively using it.
4. Budgets console → confirm your `$1` monthly alert is still configured and email notifications are enabled.
5. If the DB was auto-started or left running, stop it with the command above.

---

## Section 7 — Glossary & cheat sheets

### Glossary

| Term | Plain English |
|------|---------------|
| **Container** | An isolated process that bundles your app + its dependencies. Like a lightweight VM. |
| **Image** | The blueprint a container is created from. |
| **Registry** | A storage server for images. (Docker Hub, ECR, GitHub Container Registry.) |
| **Dockerfile** | A text recipe for building an image. |
| **docker-compose** | A file describing multiple containers that work together. |
| **Volume** | A folder on your host machine that survives container deletion. |
| **Reverse proxy** | A server that sits in front of your app and forwards requests (Nginx, CloudFront). |
| **Free tier** | Free for a *limited* time (usually 12 months) or up to a *limited* quota. |
| **Always-free** | Free *forever*, up to a quota. |
| **App Service** (Azure) | Managed web app hosting. |
| **App Service Plan** | The machine your App Services run on. |
| **Static Web Apps** (Azure) | Managed hosting purpose-built for SPAs. |
| **Elastic Beanstalk** (AWS) | Managed platform that provisions an EC2 instance and runs your container on it. |
| **S3** | AWS object storage. Can host static websites. |
| **CloudFront** | AWS global CDN. |
| **RDS** | Managed relational database (AWS). |
| **Security Group** | A firewall attached to an AWS resource. |
| **IAM** | AWS Identity & Access Management — controls who can do what. |
| **OIDC** | A way for GitHub Actions to get short-lived AWS credentials without storing long-lived secrets. |
| **vCore** | A virtual CPU core, billing unit for Azure SQL serverless. |
| **CI/CD** | Continuous Integration / Continuous Deployment — automated build + deploy on every commit. |
| **Runner** | The machine that executes a GitHub Actions workflow. |
| **JWT** | JSON Web Token. The login token Auth0 issues. |

### Docker cheat sheet

```powershell
docker compose up --build      # build + start
docker compose up -d           # detached
docker compose down            # stop
docker compose down -v         # stop + delete volumes
docker compose logs -f api     # tail logs
docker compose ps              # status
docker exec -it <id> sh        # shell into a container
docker system prune -a         # nuke unused images (frees disk)
```

### Azure CLI cheat sheet

```powershell
az login
az account show
az group list --output table
az webapp log tail --name <name> --resource-group eventsync-rg
az group delete --name eventsync-rg --yes --no-wait    # ☢ delete everything
```

### AWS CLI cheat sheet

```powershell
aws sts get-caller-identity
aws s3 ls
aws s3 sync ./dist/client/browser s3://my-bucket --delete
aws elasticbeanstalk describe-environments --environment-names eventsync-api-env
aws elasticbeanstalk update-environment --environment-name eventsync-api-env --version-label <label>
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
aws rds describe-db-instances --db-instance-identifier eventsync-db
```

### "Where do I look when X fails" decision tree

```
SPA shows white page
├── Open browser dev tools → Console tab
│   ├── 404 on a JS file       → SPA build didn't include it. Rebuild + redeploy.
│   └── CSP / CORS error       → backend AllowedOrigins doesn't include this URL.
└── Network tab → does index.html load?
    ├── 200, but JS errors      → see Console tab above
    └── 403 or 404               → CloudFront/SWA routing rule missing for SPA fallback

API returns 500
├── Local Docker  → docker compose logs api
├── Azure         → App Service → Log stream
└── AWS           → Elastic Beanstalk → environment → Logs
    → look for stack trace. Common: DB connection refused (security group, password, server name).

Login fails (Auth0)
├── Browser dev tools → Network → /authorize request
│   ├── "callback url mismatch" → add the URL to Auth0 SPA settings
│   └── "invalid audience"      → API env var Auth0__Audience wrong
└── After redirect → /auth/callback returns 404
    → SPA routing fallback missing. Check CloudFront error responses (B.2.6) or SWA navigationFallback (A.3.2).
```

---

## Section 8 — What if I get stuck? — Learning resources

When a concept doesn't click, these **free, vendor-official** resources are the fastest way to fix the mental model. Bookmark them.

### Docker
- Get Started tutorial — `docs.docker.com/get-started/`
- Play with Docker (free in-browser sandbox) — `labs.play-with-docker.com`

### Azure
- AZ-900 Azure Fundamentals learning path (free) — `learn.microsoft.com/training/paths/azure-fundamentals/`
- Host a web application with Azure App Service — `learn.microsoft.com/training/modules/host-a-web-app-with-azure-app-service/`
- Static Web Apps quickstart — `learn.microsoft.com/azure/static-web-apps/getting-started`

### AWS
- AWS Cloud Practitioner Essentials (free) — `aws.amazon.com/training/learn-about/cloud-practitioner/`
- Elastic Beanstalk Docker platform docs — `docs.aws.amazon.com/elasticbeanstalk/latest/dg/create_deploy_docker.html`
- S3 + CloudFront static site tutorial — `docs.aws.amazon.com/AmazonS3/latest/userguide/website-hosting-cloudfront-walkthrough.html`

### EF Core
- Migrations — `learn.microsoft.com/ef/core/managing-schemas/migrations/`

### GitHub Actions
- Learn GitHub Actions — `docs.github.com/actions/learn-github-actions`
- OIDC with AWS — `docs.github.com/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services`

### Auth0
- Angular SPA quickstart — `auth0.com/docs/quickstart/spa/angular`
- ASP.NET Core API quickstart — `auth0.com/docs/quickstart/backend/aspnet-core-webapi`

---

### Escalation rule

> **If you've been stuck on a single step for more than ~30 minutes:** stop, copy the exact error message + which step number you're on, and ask. Good places:
> - Microsoft Q&A (Azure) — `learn.microsoft.com/answers`
> - AWS re:Post — `repost.aws`
> - Stack Overflow — tag with `docker`, `azure`, `aws`, `entity-framework-core`, etc.
> - The .NET / Angular Discord communities
>
> Don't grind. A fresh pair of eyes will spot a typo in 30 seconds that you'll miss for two hours.

---

*EventSync Deployment Guide · June 2026 · Compatible with .NET 10, Angular 21, Docker 27+, Azure CLI 2.60+, AWS CLI v2.*
