# Phase 02 — Backend Foundations

**Goal:** build every cross-cutting piece the API needs *before* we add a single feature — custom exceptions, middleware, options, the MediatR validation pipeline, the JWT bearer setup, CORS, rate limiting, and the full `Program.cs`. By the end of this phase, the API will be **ready to host vertical slices** but won't have any business endpoints yet (just `/health`).

**Prerequisites:** Phase 01 complete. Confirm with:

```powershell
cd server/EventSync.Api
dotnet build
```

**Expected output:**

```
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

Folder we're filling in:

```
server/EventSync.Api/
├── Common/
│   ├── Behaviors/ValidationBehavior.cs
│   ├── Configuration/FrontendOptions.cs
│   ├── Exceptions/
│   │   ├── ForbiddenAccessException.cs
│   │   ├── InvalidInviteException.cs
│   │   └── NotFoundException.cs
│   ├── Middleware/
│   │   ├── ExceptionHandlingMiddleware.cs
│   │   └── SecurityHeadersMiddleware.cs
│   ├── Models/PagedResult.cs
│   └── Services/
│       ├── CurrentUserService.cs
│       └── TokenGenerator.cs
└── Program.cs                       # rewritten in §10
```

> **Why all this up front?** Vertical slices (phases 05–09) assume these utilities exist. Building them once means each slice is short and focused on its own domain logic.

---

## Step 1: Add custom exceptions

Why bother with custom exceptions instead of returning `Results.NotFound()` directly?

- **Separation of concerns** — handlers throw domain-meaningful errors; one piece of middleware decides how to render them.
- **Consistent HTTP responses** — every 404 has the same shape, no matter which feature produces it.
- **Easier to test** — `Assert.Throws<NotFoundException>(...)` is cleaner than parsing HTTP responses.

Create `Common/Exceptions/NotFoundException.cs`:

```csharp
namespace EventSync.Api.Common.Exceptions;

public sealed class NotFoundException : Exception
{
    public NotFoundException(string entity)
        : base($"{entity} was not found.")
    {
        Entity = entity;
    }

    public string Entity { get; }
}
```

- The constructor takes an entity *name* (e.g., `"Event"`), not a raw ID. The message that ships to the client is generic ("Event was not found.") — no IDs to enumerate, no info leaked.
- `Entity` is exposed so logging can be structured (`{Entity}` placeholder).

Create `Common/Exceptions/ForbiddenAccessException.cs`:

```csharp
namespace EventSync.Api.Common.Exceptions;

public sealed class ForbiddenAccessException : Exception
{
    public ForbiddenAccessException()
        : base("You do not have permission to perform this action.") { }

    public ForbiddenAccessException(string message) : base(message) { }
}
```

- We distinguish this from .NET's built-in `UnauthorizedAccessException` so domain code that **deliberately** rejects (e.g. "you are not the organizer") doesn't depend on a BCL-defined exception.
- Both get mapped to HTTP 403 in the middleware — see §5.

Create `Common/Exceptions/InvalidInviteException.cs`:

```csharp
namespace EventSync.Api.Common.Exceptions;

public sealed class InvalidInviteException : Exception
{
    public InvalidInviteException(string message) : base(message) { }
}
```

- This will be thrown by the RSVP handler when a token is **unknown, expired, exhausted, or deactivated**. Maps to HTTP **410 Gone** — that status code's exact meaning ("the resource is permanently gone") matches an invalidated invite better than 404.

> **Pitfall — error messages and information disclosure:** Notice the message is intentionally vague ("Invite link unavailable"). It must not reveal *why* — that would let an attacker probe valid tokens by observing different error strings.

---

## Step 2: Add `PagedResult<T>`

Two endpoints (list events, list RSVPs) need a paged response shape. One small generic record covers both.

Create `Common/Models/PagedResult.cs`:

```csharp
namespace EventSync.Api.Common.Models;

public sealed record PagedResult<T>(
    IReadOnlyList<T> Items,
    int Page,
    int PageSize,
    int TotalCount)
{
    public int TotalPages => PageSize <= 0 || TotalCount <= 0
        ? 0
        : (int)Math.Ceiling(TotalCount / (double)PageSize);
}
```

- `record` gives us value equality + auto-generated constructor/properties — useful in tests.
- `IReadOnlyList<T>` prevents accidental mutation downstream.
- `TotalPages` is **computed**, not stored, so callers can rely on it being consistent with `TotalCount`/`PageSize`.

> **Why not just `IEnumerable<T>`?** Because the client needs to know the total count to render "page 2 of 9" — and `IEnumerable` doesn't carry that. The envelope makes the contract explicit.

---

## Step 3: Add `FrontendOptions` (Options pattern)

ASP.NET Core's Options pattern lets us bind a configuration section into a strongly-typed POCO once and inject `IOptions<T>` wherever needed.

Create `Common/Configuration/FrontendOptions.cs`:

```csharp
namespace EventSync.Api.Common.Configuration;

public sealed class FrontendOptions
{
    public const string SectionName = "Frontend";

    public string BaseUrl { get; set; } = string.Empty;
}
```

- `SectionName` is a constant so we never magic-string the section name at the registration site.
- `BaseUrl` matches the `Frontend:BaseUrl` value in `appsettings.json` (added in phase 01).
- Default of empty string ensures the property is never `null`; we'll validate during registration.

> **Why the Options pattern instead of `IConfiguration["Frontend:BaseUrl"]`?** Strong typing (compile-time errors if you rename the property), centralised defaults, validation (`IValidateOptions<T>`), and trivial unit-test substitution via `Options.Create(new FrontendOptions { BaseUrl = "…" })`.

---

## Step 4: Add the MediatR validation pipeline

This is what makes "send a command → run validation → run handler" automatic. Without it, every handler would need to manually invoke its validator.

Create `Common/Behaviors/ValidationBehavior.cs`:

```csharp
using FluentValidation;
using MediatR;

namespace EventSync.Api.Common.Behaviors;

public sealed class ValidationBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly IEnumerable<IValidator<TRequest>> _validators;

    public ValidationBehavior(IEnumerable<IValidator<TRequest>> validators)
    {
        _validators = validators;
    }

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        if (!_validators.Any())
        {
            return await next(cancellationToken);
        }

        var context = new ValidationContext<TRequest>(request);

        var results = await Task.WhenAll(
            _validators.Select(v => v.ValidateAsync(context, cancellationToken)));

        var failures = results
            .Where(r => !r.IsValid)
            .SelectMany(r => r.Errors)
            .ToList();

        if (failures.Count > 0)
        {
            throw new ValidationException(failures);
        }

        return await next(cancellationToken);
    }
}
```

### Line-by-line

- **Generic constraint `where TRequest : notnull`** — MediatR requires it; ensures we never validate a null request.
- **Constructor injection of `IEnumerable<IValidator<TRequest>>`** — DI gives us every validator registered for the request type. Zero validators is fine (`!_validators.Any()` short-circuits).
- **`ValidationContext<TRequest>`** — FluentValidation's wrapper around the object being validated.
- **`Task.WhenAll(...)`** — runs all validators concurrently. Typical request has 1 validator so this is essentially the same as awaiting one, but if you ever add cross-cutting validators (e.g., "is the user's tenant active?") they run in parallel.
- **`throw new ValidationException(failures)`** — gathers every failure (not just the first). The `ExceptionHandlingMiddleware` (next section) translates this into a 400 ProblemDetails response containing the structured errors.

> **Why throw instead of returning a `Result<T>`?** MediatR's `IPipelineBehavior` signature returns `Task<TResponse>` — there's no slot for "validation failed". Throwing keeps handlers simple (they never receive invalid input) and lets one place own the HTTP translation.

---

## Step 5: Add `ExceptionHandlingMiddleware` — RFC 7807 ProblemDetails

This is the single source of truth for "an exception became an HTTP response". Every error in the system flows through here.

Create `Common/Middleware/ExceptionHandlingMiddleware.cs`:

```csharp
using System.Diagnostics;
using System.Text.Json;
using EventSync.Api.Common.Exceptions;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace EventSync.Api.Common.Middleware;

public sealed class ExceptionHandlingMiddleware
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;
    private readonly IHostEnvironment _environment;

    public ExceptionHandlingMiddleware(
        RequestDelegate next,
        ILogger<ExceptionHandlingMiddleware> logger,
        IHostEnvironment environment)
    {
        _next = next;
        _logger = logger;
        _environment = environment;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            await HandleExceptionAsync(context, ex);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        var traceId = Activity.Current?.Id ?? context.TraceIdentifier;

        var (status, title, detail) = exception switch
        {
            ValidationException => (
                StatusCodes.Status400BadRequest,
                "Validation failed",
                "One or more validation errors occurred."),
            ForbiddenAccessException fax => (
                StatusCodes.Status403Forbidden,
                "Forbidden",
                fax.Message),
            UnauthorizedAccessException => (
                StatusCodes.Status403Forbidden,
                "Forbidden",
                "You do not have permission to perform this action."),
            NotFoundException nfe => (
                StatusCodes.Status404NotFound,
                "Resource not found",
                nfe.Message),
            KeyNotFoundException knf => (
                StatusCodes.Status404NotFound,
                "Resource not found",
                knf.Message),
            InvalidInviteException iie => (
                StatusCodes.Status410Gone,
                "Invite link unavailable",
                iie.Message),
            _ => (
                StatusCodes.Status500InternalServerError,
                "Server error",
                "An unexpected error occurred."),
        };

        if (status >= 500)
        {
            _logger.LogError(exception,
                "Unhandled exception while processing {Method} {Path}. TraceId={TraceId}",
                context.Request.Method, context.Request.Path, traceId);
        }
        else
        {
            _logger.LogWarning(exception,
                "Handled {ExceptionType} ({Status}) while processing {Method} {Path}. TraceId={TraceId}",
                exception.GetType().Name, status,
                context.Request.Method, context.Request.Path, traceId);
        }

        if (context.Response.HasStarted)
        {
            _logger.LogWarning("Response already started; cannot write ProblemDetails. TraceId={TraceId}", traceId);
            return;
        }

        var problem = new ProblemDetails
        {
            Type = $"https://httpstatuses.io/{status}",
            Title = title,
            Status = status,
            Detail = detail,
            Instance = context.Request.Path,
        };
        problem.Extensions["traceId"] = traceId;

        if (exception is ValidationException validation)
        {
            var errors = validation.Errors
                .GroupBy(e => e.PropertyName)
                .ToDictionary(
                    g => string.IsNullOrWhiteSpace(g.Key) ? "_" : g.Key,
                    g => g.Select(e => e.ErrorMessage).ToArray());
            problem.Extensions["errors"] = errors;
        }

        if (_environment.IsDevelopment())
        {
            problem.Extensions["exception"] = exception.GetType().FullName;
            problem.Extensions["stackTrace"] = exception.StackTrace;
            if (exception.InnerException is not null)
            {
                problem.Extensions["innerException"] = new
                {
                    type = exception.InnerException.GetType().FullName,
                    message = exception.InnerException.Message,
                };
            }
        }

        context.Response.Clear();
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/problem+json";
        await JsonSerializer.SerializeAsync(context.Response.Body, problem, JsonOptions);
    }
}

public static class ExceptionHandlingMiddlewareExtensions
{
    public static IApplicationBuilder UseExceptionHandling(this IApplicationBuilder app)
        => app.UseMiddleware<ExceptionHandlingMiddleware>();
}
```

### Line-by-line

- **`JsonSerializerOptions(JsonSerializerDefaults.Web)`** — camelCase property names + case-insensitive deserialisation; matches the rest of ASP.NET Core's JSON defaults.
- **`InvokeAsync`** — single try/catch wraps the whole downstream pipeline. Any unhandled exception below this middleware lands here.
- **`Activity.Current?.Id`** — uses the W3C TraceContext ID when available (set by ASP.NET Core hosting), falling back to ASP.NET's `TraceIdentifier`. This `traceId` is echoed back to the client so they can quote it in a bug report.
- **The big `switch` expression** — pattern-matches on exception type. Add a new exception type? Add one arm. Default → 500 + generic message.
- **Log levels split by status:** 5xx → `LogError` (server bug), 4xx → `LogWarning` (client error, but still useful to track). Structured fields (`{Method}`, `{Path}`, `{TraceId}`) so logs are queryable in Application Insights / Seq.
- **`context.Response.HasStarted` guard** — if the response already started streaming, we can't rewrite the status code. Log and bail.
- **`ProblemDetails`** is the BCL type from `Microsoft.AspNetCore.Mvc` that renders to the RFC 7807 shape:
  ```json
  {
    "type": "https://httpstatuses.io/400",
    "title": "Validation failed",
    "status": 400,
    "detail": "...",
    "instance": "/api/v1/events",
    "traceId": "00-abc-…",
    "errors": { "title": ["Title is required"] }
  }
  ```
- **`errors` extension** for `ValidationException` — groups failures by `PropertyName` so the frontend can show inline messages per field.
- **Dev-only diagnostics block** — adds `exception`, `stackTrace`, `innerException`. The single most important rule for this middleware: **never** include these in non-Development environments. Leaking stack traces is a classic OWASP A05 (Security Misconfiguration) issue.
- **`Response.Clear()`** — drops any partially-written headers from before the exception.
- **`Content-Type: application/problem+json`** — the official media type for RFC 7807 responses.
- **Extension method `UseExceptionHandling()`** — keeps `Program.cs` clean (`app.UseExceptionHandling()` reads better than `app.UseMiddleware<ExceptionHandlingMiddleware>()`).

> **Pitfall — middleware ordering:** This middleware must be registered **early** (immediately after `UseForwardedHeaders`). If it's after `UseAuthentication`, auth exceptions won't be caught.

---

## Step 6: Add `SecurityHeadersMiddleware`

Browsers obey HTTP response headers to enforce defenses (CSP, clickjacking, MIME sniffing, HSTS). We send a strict default set on every response.

Create `Common/Middleware/SecurityHeadersMiddleware.cs`:

```csharp
using Microsoft.Extensions.Options;

namespace EventSync.Api.Common.Middleware;

public sealed class SecurityHeadersOptions
{
    public const string SectionName = "SecurityHeaders";

    public string? Auth0Domain { get; set; }
    public string[]? AdditionalConnectSources { get; set; }
}

public sealed class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IHostEnvironment _environment;
    private readonly string _csp;

    public SecurityHeadersMiddleware(
        RequestDelegate next,
        IHostEnvironment environment,
        IOptions<SecurityHeadersOptions> options)
    {
        _next = next;
        _environment = environment;
        _csp = BuildContentSecurityPolicy(options.Value);
    }

    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;

            headers.Remove("Server");
            headers.Remove("X-Powered-By");

            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            headers["Content-Security-Policy"] = _csp;

            if (!_environment.IsDevelopment())
            {
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
            }

            return Task.CompletedTask;
        });

        return _next(context);
    }

    private static string BuildContentSecurityPolicy(SecurityHeadersOptions options)
    {
        var connectSources = new List<string> { "'self'" };

        if (!string.IsNullOrWhiteSpace(options.Auth0Domain))
        {
            connectSources.Add($"https://{options.Auth0Domain}");
        }

        if (options.AdditionalConnectSources is { Length: > 0 } additional)
        {
            connectSources.AddRange(additional.Where(s => !string.IsNullOrWhiteSpace(s)));
        }

        var connectSrc = string.Join(' ', connectSources);

        return string.Join("; ", new[]
        {
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            $"connect-src {connectSrc}",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
        });
    }
}

public static class SecurityHeadersMiddlewareExtensions
{
    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app)
        => app.UseMiddleware<SecurityHeadersMiddleware>();
}
```

### Line-by-line

- **`SecurityHeadersOptions`** lives in the same file because it's tightly coupled to the middleware. The configuration `SecurityHeaders` section in `appsettings.json` binds here.
- **`OnStarting` callback** — headers can only be set before the response body starts streaming. `OnStarting` registers a hook that fires just before the first byte.
- **`Server` / `X-Powered-By` removal** — reduces fingerprinting (less info for an attacker about what stack you're running).
- **`X-Content-Type-Options: nosniff`** — prevents browsers from MIME-sniffing a response into something more dangerous (e.g., interpreting an uploaded image as JavaScript).
- **`X-Frame-Options: DENY`** — blocks the page from being framed; defends against clickjacking. (CSP `frame-ancestors 'none'` is the modern equivalent; we send both for older-browser support.)
- **`Referrer-Policy: strict-origin-when-cross-origin`** — only the origin is sent in `Referer` for cross-origin requests; the path is hidden.
- **`Permissions-Policy`** — disables APIs we never use (camera, mic, geolocation). One less attack surface.
- **`Content-Security-Policy` (CSP)** — the big one. We build it from a small set of directives:
  - `default-src 'self'` — by default only same-origin resources allowed.
  - `script-src 'self'` — **no inline scripts**, no remote scripts. Forces XSS to use a CSP-violating mechanism.
  - `style-src 'self' 'unsafe-inline'` — Angular's component styles are inlined via `<style>` tags, so we need `'unsafe-inline'` here. (You could replace with nonces for stricter policy.)
  - `img-src 'self' data: https:` — allows data-URIs (e.g., inline avatars) and any HTTPS source (Auth0 profile pics).
  - `connect-src 'self' https://{auth0-domain}` — XHR/fetch only allowed to our own origin and the Auth0 tenant (for silent token renewal).
  - `frame-ancestors 'none'` — modern clickjacking defense.
  - `base-uri 'self'`, `form-action 'self'` — prevents `<base>` and `<form action=…>` hijacking.
  - `object-src 'none'` — blocks `<object>`/`<embed>` (legacy Flash/Java vectors).
- **HSTS (`Strict-Transport-Security`)** — only outside Development. We don't want to pin a developer's browser to HTTPS on `localhost` and brick it for other local projects.

> **Pitfall — CSP and Auth0:** If you forget the `connect-src https://{auth0-domain}` entry, Auth0's silent token renewal will silently fail (no console error in some browsers — just a hang). The `SecurityHeadersOptions.Auth0Domain` exists exactly to make this easy.

---

## Step 7: Add `TokenGenerator`

Used in phase 08 to mint invite-link tokens. Must be **cryptographically random**.

Create `Common/Services/TokenGenerator.cs`:

```csharp
using System.Security.Cryptography;

namespace EventSync.Api.Common.Services;

public interface ITokenGenerator
{
    string GenerateUrlSafeToken(int byteLength = 32);
}

public sealed class TokenGenerator : ITokenGenerator
{
    public string GenerateUrlSafeToken(int byteLength = 32)
    {
        if (byteLength < 16)
        {
            throw new ArgumentOutOfRangeException(
                nameof(byteLength),
                "Token must use at least 16 bytes (128 bits) of entropy.");
        }

        var bytes = RandomNumberGenerator.GetBytes(byteLength);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }
}
```

### Line-by-line

- **`RandomNumberGenerator.GetBytes(n)`** — uses the OS CSPRNG (CryptGenRandom on Windows, `/dev/urandom` on Linux). Suitable for secrets.
- **Default `byteLength: 32`** — 256 bits of entropy, encoded as ~43 URL-safe characters. Long enough that brute-forcing a single token is computationally infeasible.
- **Floor of 16 bytes** — guards against accidental misuse. 128 bits is the minimum we accept.
- **Base64 → URL-safe** — replaces `+`/`/` (illegal in URLs without encoding) with `-`/`_`; strips `=` padding (also legal in RFC 4648 §5).

> **Why not `Guid.NewGuid()`?** Guids only have 122 bits of entropy and v4 Guids have known structural bits (version, variant nibbles). Worse, some Guid generators (e.g., sequential / COMB Guids) are *predictable*. For something a guest pastes into a URL, predictability is a security flaw.

---

## Step 8: Add `CurrentUserService` — bridging Auth0 claims to our `Users` table

Auth0 owns *who you are*; our database owns *what you've created*. We need a small service to map between them: read the validated JWT claims, find or create a `User` row.

Create `Common/Services/CurrentUserService.cs`:

```csharp
using System.Security.Claims;
using EventSync.Api.Data;
using EventSync.Api.Data.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace EventSync.Api.Common.Services;

public interface ICurrentUserService
{
    string? Auth0Id { get; }
    string? Email { get; }
    string? Name { get; }
    string? Picture { get; }
    bool IsAuthenticated { get; }

    Task<User> GetOrCreateUserAsync(CancellationToken cancellationToken = default);
}

public sealed class CurrentUserService : ICurrentUserService
{
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly AppDbContext _dbContext;

    public CurrentUserService(IHttpContextAccessor httpContextAccessor, AppDbContext dbContext)
    {
        _httpContextAccessor = httpContextAccessor;
        _dbContext = dbContext;
    }

    private ClaimsPrincipal? Principal => _httpContextAccessor.HttpContext?.User;

    public string? Auth0Id =>
        Principal?.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? Principal?.FindFirstValue("sub");

    public string? Email => Principal?.FindFirstValue(ClaimTypes.Email)
                            ?? Principal?.FindFirstValue("email");

    public string? Name => Principal?.FindFirstValue("name")
                           ?? Principal?.FindFirstValue("nickname")
                           ?? Principal?.FindFirstValue(ClaimTypes.Name);

    public string? Picture => Principal?.FindFirstValue("picture");

    public bool IsAuthenticated => !string.IsNullOrWhiteSpace(Auth0Id);

    public async Task<User> GetOrCreateUserAsync(CancellationToken cancellationToken = default)
    {
        var auth0Id = Auth0Id
            ?? throw new UnauthorizedAccessException("No authenticated user on the current request.");

        var user = await _dbContext.Users
            .FirstOrDefaultAsync(u => u.Auth0Id == auth0Id, cancellationToken);

        if (user is not null)
        {
            return user;
        }

        var now = DateTime.Now;
        user = new User
        {
            Id = Guid.NewGuid(),
            Auth0Id = auth0Id,
            Email = Email ?? string.Empty,
            DisplayName = !string.IsNullOrWhiteSpace(Name) ? Name! : (Email ?? "New User"),
            AvatarUrl = Picture,
            CreatedAt = now,
        };

        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return user;
    }
}
```

> **Note:** `User` entity (`Data/Entities/User.cs`) and `AppDbContext` are created in phase 03. The compiler will error on those references until then — that's expected. You can comment out the `GetOrCreateUserAsync` body if you want to compile the project after this phase and before phase 03; we'll uncomment it then.

### Line-by-line

- **Interface separates contract from implementation** — handlers depend on `ICurrentUserService`, which makes unit-testing trivial (`Mock<ICurrentUserService>`).
- **`IHttpContextAccessor`** — required to reach `HttpContext.User` outside an endpoint. Registered in `Program.cs` via `AddHttpContextAccessor()`.
- **Two-key claim lookups** (e.g., `ClaimTypes.NameIdentifier ?? "sub"`) — ASP.NET Core's JWT bearer middleware maps inbound claims (`sub` → `nameidentifier`) unless `MapInboundClaims = false`. We try the mapped name first, then the raw OIDC name. Defensive coding for either configuration.
- **`Email`/`Name`/`Picture`** are optional in Auth0 — depending on social provider, scopes, and user behavior, any of them might be missing. Hence the nullable getters and the fallback chain.
- **`GetOrCreateUserAsync` — JIT provisioning:** the first time a user signs in, we create their row in our `Users` table. This avoids a separate "register" endpoint — the moment they hit any authenticated endpoint, they exist locally.
- **`UnauthorizedAccessException`** — thrown when there's no `sub` claim at all, meaning either the JWT was invalid (auth pipeline would normally reject it) or some endpoint is calling this from an unauthenticated context. Either way, 403 (mapped by middleware) is the right answer.

> **Pitfall — concurrent first-sign-in races:** Two simultaneous requests from a brand-new user can both reach `FirstOrDefaultAsync == null` and both try to `Add`. The Auth0Id has a unique index (phase 03), so one will succeed and the other gets a `DbUpdateException`. For an MVP this is acceptable (the failing request retries); production-hardened versions wrap this in a transaction with `IsolationLevel.Serializable` or use `MERGE`/upsert.

---

## Step 9: Stub the entity references

> Phase 03 builds the real EF entities. For this phase to compile, add minimal stubs so the `CurrentUserService` type-checks.

`CurrentUserService` references `Data/Entities/User.cs` and `Data/AppDbContext.cs`. These come in phase 03. For now, create empty placeholder files so the project still compiles:

```powershell
mkdir -p server/EventSync.Api/Data/Entities
@'
namespace EventSync.Api.Data.Entities;

public class User
{
    public Guid Id { get; set; }
    public string Auth0Id { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public DateTime CreatedAt { get; set; }
}
'@ | Out-File -Encoding utf8 server/EventSync.Api/Data/Entities/User.cs

@'
using EventSync.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace EventSync.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }
    public DbSet<User> Users => Set<User>();
}
'@ | Out-File -Encoding utf8 server/EventSync.Api/Data/AppDbContext.cs
```

Phase 03 will replace both files with the full versions.

---

## Step 10: Rewrite the full `Program.cs`

Replace `server/EventSync.Api/Program.cs` with the canonical version. It's long, so we'll walk through it in five logical sections.

```csharp
using System.Threading.RateLimiting;
using EventSync.Api.Common.Behaviors;
using EventSync.Api.Common.Configuration;
using EventSync.Api.Common.Middleware;
using EventSync.Api.Common.Services;
using EventSync.Api.Data;
using FluentValidation;
using FluentValidation.AspNetCore;
using MediatR;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.Filters;

var builder = WebApplication.CreateBuilder(args);

if (builder.Environment.IsDevelopment())
{
    builder.WebHost.UseUrls("http://localhost:5000");
}
```

The `using` directives import everything we need — note we've pre-imported the slice namespaces (`Features.Auth`, `Features.Events`, …) so the endpoint mappers at the bottom resolve. They don't exist yet; phases 05+ will add them, and we'll add the `using` lines + `Map…Endpoints()` calls as we go. For now, **remove the slice-related usings and `Map…Endpoints()` calls** — we'll re-add them per phase.

### 10a. Core services (DI registrations)

```csharp
// EF Core
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("Missing connection string 'DefaultConnection'.");
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlServer(connectionString));

// MediatR — scan the current assembly for handlers/behaviors.
builder.Services.AddMediatR(cfg =>
{
    cfg.RegisterServicesFromAssembly(typeof(Program).Assembly);
    cfg.AddOpenBehavior(typeof(ValidationBehavior<,>));
});

// FluentValidation — auto ASP.NET Core integration + assembly scanning.
builder.Services.AddFluentValidationAutoValidation();
builder.Services.AddValidatorsFromAssembly(typeof(Program).Assembly);

// Current-user service requires HTTP context access.
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUserService, CurrentUserService>();

// Strongly-typed options.
builder.Services.Configure<FrontendOptions>(
    builder.Configuration.GetSection(FrontendOptions.SectionName));
builder.Services.Configure<SecurityHeadersOptions>(options =>
{
    builder.Configuration.GetSection(SecurityHeadersOptions.SectionName).Bind(options);
    if (string.IsNullOrWhiteSpace(options.Auth0Domain))
    {
        options.Auth0Domain = builder.Configuration["Auth0:Domain"];
    }
});

// Cryptographically-secure token generator (stateless — safe as a singleton).
builder.Services.AddSingleton<ITokenGenerator, TokenGenerator>();

// Forwarded headers — required behind a reverse proxy so RemoteIpAddress is correct.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});
```

- **`AddDbContext` with `UseSqlServer`** — registers the EF Core context as scoped. The throwing null-check ensures we fail fast if the connection string is missing.
- **`AddMediatR`** scans `typeof(Program).Assembly` for every `IRequestHandler<,>`. `AddOpenBehavior(typeof(ValidationBehavior<,>))` registers the open-generic pipeline behavior so it runs for every request.
- **`AddFluentValidationAutoValidation` + `AddValidatorsFromAssembly`** — the ASP.NET Core auto-validation hooks model binding (`[FromBody]` requests), and the assembly scan registers every `IValidator<T>` in our app. With the MediatR behavior, this gives us **two layers of defense**: validation runs at the HTTP boundary *and* at the handler boundary.
- **`AddHttpContextAccessor`** — needed for `CurrentUserService` to access `HttpContext.User`.
- **`AddScoped<ICurrentUserService, CurrentUserService>`** — scoped because it holds a reference to `AppDbContext` (also scoped).
- **`Configure<FrontendOptions>` / `Configure<SecurityHeadersOptions>`** — bind config sections. The SecurityHeaders block has a small bit of logic: if `SecurityHeaders:Auth0Domain` is empty, derive it from `Auth0:Domain` so a single tenant change updates both places.
- **`AddSingleton<ITokenGenerator>`** — safe as singleton because the underlying `RandomNumberGenerator` is thread-safe and the service holds no state.
- **`Configure<ForwardedHeadersOptions>`** — when behind a reverse proxy (nginx, Azure App Service), the proxy puts the real client IP in `X-Forwarded-For`. This middleware (added in §10d) reads it and updates `Connection.RemoteIpAddress` so our rate limiter sees the correct IP. `KnownNetworks.Clear()` / `KnownProxies.Clear()` allows trusting any upstream — tighten in production by listing your proxy's IP.

### 10b. Authentication + Authorization (JWT bearer to Auth0)

```csharp
var auth0Domain = builder.Configuration["Auth0:Domain"]
    ?? throw new InvalidOperationException("Missing configuration 'Auth0:Domain'.");
var auth0Audience = builder.Configuration["Auth0:Audience"]
    ?? throw new InvalidOperationException("Missing configuration 'Auth0:Audience'.");

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = $"https://{auth0Domain}/";
        options.Audience = auth0Audience;
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = $"https://{auth0Domain}/",
            ValidAudience = auth0Audience,
            NameClaimType = System.Security.Claims.ClaimTypes.NameIdentifier,
            RoleClaimType = "https://eventsync-api/roles",
        };

        options.MapInboundClaims = true;
    });

builder.Services.AddAuthorization();
```

- **`AddAuthentication(JwtBearerDefaults.AuthenticationScheme)`** — declares JWT bearer as the default scheme. `[Authorize]` / `.RequireAuthorization()` now means "require a valid JWT".
- **`options.Authority`** — the issuer base URL. ASP.NET Core fetches the OIDC discovery document at `{Authority}/.well-known/openid-configuration` to learn signing keys. Trailing slash is required by Auth0.
- **`options.Audience`** — the API identifier registered in Auth0. The JWT's `aud` claim must equal this.
- **`RequireHttpsMetadata = !IsDevelopment()`** — production must use HTTPS for the discovery document; dev can use HTTP for `localhost`.
- **`TokenValidationParameters`** — explicit validation rules:
  - **Issuer** — JWT's `iss` must equal `https://{domain}/`.
  - **Audience** — JWT's `aud` must equal our audience.
  - **Lifetime** — `exp` claim must be in the future.
  - **Signing key** — JWT's signature must verify against keys from the discovery document.
- **`NameClaimType = ClaimTypes.NameIdentifier`** — what `User.Identity!.Name` returns. Mapped from `sub`.
- **`RoleClaimType = "https://eventsync-api/roles"`** — Auth0 puts custom roles in this namespaced claim (a Rule/Action populates it). `[Authorize(Roles = "admin")]` will read here.
- **`MapInboundClaims = true`** — translates OIDC claim names (`sub`, `email`) to .NET claim type URIs (`http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`, `…/emailaddress`). Hence `CurrentUserService` checks both forms.
- **`AddAuthorization()`** — registers the authorization services (`IAuthorizationService` etc.). Required for `RequireAuthorization()` to work.

### 10c. CORS, rate limiting, Swagger

```csharp
const string CorsPolicyName = "EventSyncCors";
var allowedOrigins = builder.Configuration
    .GetSection("AllowedOrigins")
    .Get<string[]>() ?? [];

if (allowedOrigins.Length == 0 && builder.Environment.IsDevelopment())
{
    allowedOrigins = ["http://localhost:4200"];
}

builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicyName, policy => policy
        .WithOrigins(allowedOrigins)
        .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE")
        .WithHeaders("Authorization", "Content-Type")
        .AllowCredentials());
});

const string RsvpRateLimitPolicy = "RsvpLimit";
var rsvpWindow = TimeSpan.FromMinutes(10);

builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy(RsvpRateLimitPolicy, httpContext =>
    {
        var partitionKey = ResolveClientIp(httpContext) ?? "unknown";

        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey,
            _ => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 5,
                QueueLimit = 0,
                Window = rsvpWindow,
            });
    });

    options.OnRejected = async (context, cancellationToken) =>
    {
        var retryAfterSeconds = (int)Math.Ceiling(rsvpWindow.TotalSeconds);
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var lease))
        {
            retryAfterSeconds = (int)Math.Ceiling(lease.TotalSeconds);
        }

        context.HttpContext.Response.Headers.RetryAfter = retryAfterSeconds.ToString();
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.HttpContext.Response.ContentType = "application/json";

        var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("RateLimiter");
        logger.LogWarning(
            "Rate limit hit for {Path} from {Ip}. RetryAfter={RetryAfter}s",
            context.HttpContext.Request.Path,
            ResolveClientIp(context.HttpContext),
            retryAfterSeconds);

        await context.HttpContext.Response.WriteAsJsonAsync(
            new { message = "Too many requests. Please try again later.", retryAfter = retryAfterSeconds },
            cancellationToken);
    };
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new() { Title = "EventSync API v1", Version = "v1" });

    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Description = "Paste **only** the JWT (without the 'Bearer ' prefix).",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
    });

    options.OperationFilter<SecurityRequirementsOperationFilter>(true, "Bearer");
});
```

- **CORS:**
  - `WithOrigins(...)` — explicit allowlist; **never** `AllowAnyOrigin()` together with `AllowCredentials()` (browser rejects that combo).
  - `WithMethods(...)` — only the methods we actually use.
  - `WithHeaders("Authorization", "Content-Type")` — minimum needed for bearer auth + JSON requests.
  - `AllowCredentials()` — required for the bearer header to be forwarded by the browser on CORS requests.
  - **Dev fallback** — if `AllowedOrigins` is empty in Development, default to `localhost:4200` so first-time setup just works.

- **Rate limiting:**
  - **`RateLimitPartition.GetFixedWindowLimiter(partitionKey, …)`** — one limiter per IP (the partition key). Default partition would share a single bucket across everyone, which is useless for IP-based limits.
  - **Fixed window 5 per 10 minutes** — small enough to discourage spam, large enough that genuine users updating their RSVP a few times aren't blocked.
  - **`QueueLimit = 0`** — over-limit requests are rejected immediately, not queued.
  - **`OnRejected`** — custom 429 response with the standard `Retry-After` header. The hand-rolled JSON body is more friendly than ASP.NET's default empty body.

- **Swagger:**
  - **`AddSecurityDefinition("Bearer", …)`** — describes the bearer scheme so Swagger renders the "Authorize" button.
  - **`OperationFilter<SecurityRequirementsOperationFilter>(true, "Bearer")`** — automatically tags every `[Authorize]` endpoint with the bearer requirement; the `true` argument suppresses adding it to anonymous endpoints.

> **Why no Swagger UI authorization for the public `/invite/...` endpoints?** Those endpoints are decorated with `.AllowAnonymous()` (in phase 09). The operation filter sees that and skips them.

### 10d. The HTTP request pipeline

```csharp
var app = builder.Build();

app.UseForwardedHeaders();

app.UseExceptionHandling();
app.UseSecurityHeaders();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseRouting();

app.UseCors(CorsPolicyName);

app.UseAuthentication();
app.UseAuthorization();

app.UseRateLimiter();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options => options.SwaggerEndpoint("/swagger/v1/swagger.json", "EventSync API v1"));
}

app.UseStaticFiles();

var uploadsPhysicalPath = Path.Combine(app.Environment.ContentRootPath, "wwwroot", "uploads");
if (!Directory.Exists(uploadsPhysicalPath))
{
    Directory.CreateDirectory(uploadsPhysicalPath);
}

app.UseStaticFiles(new StaticFileOptions
{
    RequestPath = "/uploads",
    FileProvider = new PhysicalFileProvider(uploadsPhysicalPath)
});

app.MapGet("/health", () => Results.Ok(new
{
    status = "healthy",
    timestamp = DateTime.UtcNow,
}))
.WithName("HealthCheck")
.WithTags("Diagnostics")
.AllowAnonymous();

// Feature endpoint groups — added one per phase 05–09.
// app.MapAuthEndpoints();
// app.MapEventEndpoints();
// app.MapEventTypeEndpoints();
// app.MapUploadEndpoints();
// app.MapInviteLinkEndpoints();
// app.MapRsvpEndpoints(RsvpRateLimitPolicy);

app.Run();
```

**Order matters. Each line's job:**

1. **`UseForwardedHeaders()`** — populates `Connection.RemoteIpAddress` from `X-Forwarded-For` if behind a proxy. Must run *before* anything that reads the IP (rate limiter).
2. **`UseExceptionHandling()`** — catches every downstream exception. Placed before middleware that might throw.
3. **`UseSecurityHeaders()`** — registers `OnStarting`, so it must run before anything writes the response.
4. **`UseHsts()` / `UseHttpsRedirection()`** — Production only.
5. **`UseRouting()`** — required before `UseCors`/`UseAuthorization` so they can see endpoint metadata.
6. **`UseCors(...)`** — must be before `UseAuthentication`/`UseAuthorization`; preflight OPTIONS requests must succeed without auth.
7. **`UseAuthentication()`** — identifies the user (populates `HttpContext.User`).
8. **`UseAuthorization()`** — enforces `[Authorize]`/`RequireAuthorization()`.
9. **`UseRateLimiter()`** — applied to specific endpoints by name (`RequireRateLimiting("RsvpLimit")` — see phase 09).
10. **`UseSwagger()` / `UseSwaggerUI()`** — Development only. Order doesn't matter much here.
11. **`UseStaticFiles()` (twice)** — first call serves `wwwroot/` with defaults; the second explicitly maps `/uploads` to `wwwroot/uploads/` to be robust against hosting setups that don't enable webroot static serving. The `Directory.CreateDirectory(...)` call ensures the folder exists on first launch (avoids a "no such directory" startup crash).
12. **`MapGet("/health", …)`** — public smoke-test endpoint.

> **Pitfall — middleware order bugs:** swap `UseAuthentication` and `UseCors`, and CORS preflights start failing intermittently. Swap `UseRouting` after `UseCors`, and the CORS policy can't resolve endpoint metadata. Treat this list as canonical.

### 10e. The `ResolveClientIp` helper + partial Program

At the bottom of `Program.cs`:

```csharp
static string? ResolveClientIp(HttpContext httpContext)
{
    if (httpContext.Request.Headers.TryGetValue("X-Forwarded-For", out var forwarded) &&
        !string.IsNullOrWhiteSpace(forwarded))
    {
        var firstHop = forwarded.ToString().Split(',', 2)[0].Trim();
        if (!string.IsNullOrEmpty(firstHop))
        {
            return firstHop;
        }
    }

    return httpContext.Connection.RemoteIpAddress?.ToString();
}

public partial class Program { }
```

- **`ResolveClientIp`** — reads `X-Forwarded-For` (proxy-injected) preferring the **first** entry (the original client) and falls back to the transport-level IP. Used by the rate limiter's partition key + the `OnRejected` log.
- **`public partial class Program { }`** — makes the auto-generated `Program` class public so `WebApplicationFactory<Program>` works in integration tests later.

> **Security note on `X-Forwarded-For`:** This header is **attacker-controlled** if your app receives traffic directly. Only trust it when behind a proxy that overwrites it. We use it for rate-limit *partitioning* and *logging* — never for authorization. That's the only safe use.

---

## Checkpoint

You've passed this phase when:

1. The project compiles:
   ```powershell
   cd server/EventSync.Api
   dotnet build
   ```
   **Expected output:**
   ```
   Build succeeded.
       0 Warning(s)
       0 Error(s)
   ```

2. `dotnet run` starts without crashing (the slice `Map…Endpoints()` calls are commented out, so no missing-type errors).
   **Expected output (last lines):**
   ```
   info: Microsoft.Hosting.Lifetime[14]
         Now listening on: http://localhost:5000
   info: Microsoft.Hosting.Lifetime[0]
         Application started. Press Ctrl+C to shut down.
   ```

3. `curl -i http://localhost:5000/health` returns `200`. Check the headers include:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Content-Security-Policy: default-src 'self'; …`

4. `http://localhost:5000/swagger` shows the `Health` endpoint and an **Authorize** button in the top-right (Bearer scheme).

5. If you trigger a deliberate exception (e.g., add `app.MapGet("/boom", () => { throw new EventSync.Api.Common.Exceptions.NotFoundException("Event"); });` temporarily), hitting `/boom` returns a `404` with body:
   ```json
   {
     "type": "https://httpstatuses.io/404",
     "title": "Resource not found",
     "status": 404,
     "detail": "Event was not found.",
     "instance": "/boom",
     "traceId": "00-…"
   }
   ```
   Remove the `/boom` endpoint after testing.

---

Next: [03-foundations-data-layer.md](./03-foundations-data-layer.md) — replace the placeholder entities with the real five-entity model, write the Fluent API configurations, and run the first migration.
