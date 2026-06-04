# Phase 06a — Vertical Slice 2: Events Backend

**Goal:** build the entire Events backend — CRUD + cancel + paginated list with search/filter/sort + EventTypes lookup. This is the canonical CQRS slice that every other backend feature follows.

**Prerequisites:** Phase 05 complete. Confirm with:

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

```
server/EventSync.Api/Features/
├── Events/
│   ├── EventEndpoints.cs           # 6 routes: list, get-by-id, create, update, delete, cancel
│   ├── Common/EventDto.cs          # All shared DTOs (EventDto, EventSummaryDto, EventDetailDto, EventTypeDto, OrganizerDto, RsvpSummaryDto, InviteLinkDto)
│   ├── CreateEvent/CreateEvent.cs  # Command + Validator + Handler
│   ├── GetEvents/GetEvents.cs      # Paged query + Handler
│   ├── GetEventById/GetEventById.cs# Detail query + Handler
│   ├── UpdateEvent/UpdateEvent.cs  # Command + Validator + Handler
│   ├── DeleteEvent/DeleteEvent.cs  # Soft-delete command + Handler
│   └── CancelEvent/CancelEvent.cs  # Cancel flag command + Handler
└── EventTypes/
    ├── EventTypeEndpoints.cs       # GET /event-types
    └── GetEventTypes/GetEventTypes.cs
```

## Two orthogonal flags: `IsDeleted` vs `IsCancelled`

This is the most-asked design question in the slice. They look similar but mean different things:

| Flag | Meaning | Who sets it | Visible to guests? | Visible to organizer? | Index |
|------|---------|-------------|--------------------|----------------------|-------|
| `IsDeleted` | Event is gone from the user's view | `DELETE /events/{id}` | No (filtered by query filter) | No (filtered by query filter) | Filtered (`HasFilter("IsDeleted = 0")`) |
| `IsCancelled` | Event still exists; guests should know it's not happening | `PATCH /events/{id}/cancel` | Yes (with "Cancelled" badge) | Yes | None |

A cancelled event still appears in lists with a strike-through badge. A deleted event is gone from every read. The combination matters: you can `Cancel` first (notify guests), then `Delete` later (clean up). You can't un-cancel via the API; that's a deliberate constraint.

---

## Step 1: Add the shared DTOs — `Common/EventDto.cs`

All Event-related DTOs live in one file because they reference each other and every endpoint in the slice uses some subset:

```csharp
namespace EventSync.Api.Features.Events.Common;

public sealed record EventTypeDto(int Id, string Name, string? Icon);

public sealed record OrganizerDto(string DisplayName, string? AvatarUrl);

public sealed record RsvpSummaryDto(int Going, int NotGoing, int Maybe, int Total);

public sealed record EventDto(
    Guid Id,
    string Title,
    string OrganizerName,
    string? Description,
    string? Location,
    bool IsVirtual,
    string? MeetingUrl,
    DateTime StartDate,
    DateTime? EndDate,
    int? MaxAttendees,
    bool IsCancelled,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    EventTypeDto EventType);

public sealed record EventSummaryDto(
    Guid Id,
    string Title,
    string EventTypeName,
    string? EventTypeIcon,
    DateTime StartDate,
    DateTime? EndDate,
    string? Location,
    bool IsVirtual,
    bool IsCancelled,
    int RsvpCount,
    string? CoverImageUrl,
    DateTime CreatedAt);

public sealed record InviteLinkDto(
    Guid Id,
    string Token,
    string Url,
    DateTime? ExpiresAt,
    int? MaxUses,
    int UseCount,
    bool IsActive,
    DateTime CreatedAt);

public sealed record EventDetailDto(
    Guid Id,
    string Title,
    string OrganizerName,
    string? Description,
    string? Location,
    bool IsVirtual,
    string? MeetingUrl,
    DateTime StartDate,
    DateTime? EndDate,
    int? MaxAttendees,
    string? CoverImageUrl,
    bool IsCancelled,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    EventTypeDto EventType,
    OrganizerDto Organizer,
    RsvpSummaryDto Rsvps,
    IReadOnlyList<InviteLinkDto> InviteLinks);
```

### Three projections for three audiences

- **`EventDto`** — the "write response" returned by `Create` and `Update`. Excludes the heavy stuff (organizer profile, RSVP counts, invite links) that the caller already knows or doesn't need right after a write.
- **`EventSummaryDto`** — list-view projection used by `GET /events`. Flat (joins `EventType` name + icon). Includes a single `RsvpCount` (going only). Optimised for table/card rendering with no N+1.
- **`EventDetailDto`** — full detail returned by `GET /events/{id}`. Wraps every related projection: type, organizer, RSVP summary, invite links. Used by the event detail page (one round-trip = full page).

> **Why not return entities?** Three reasons: (1) entities can contain navigation cycles that break the JSON serializer; (2) entities expose all columns (e.g., `IsDeleted`, `Auth0Sub`) that aren't meant for the API; (3) DTOs are versionable — you can add fields to entities without breaking clients.

---

## Step 2: Add `CreateEvent.cs` — the canonical write slice

```csharp
using EventSync.Api.Common.Services;
using EventSync.Api.Data;
using EventSync.Api.Data.Entities;
using EventSync.Api.Features.Events.Common;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace EventSync.Api.Features.Events.CreateEvent;

public sealed record CreateEventCommand(
    string Title,
    string OrganizerName,
    string? Description,
    int EventTypeId,
    string? Location,
    bool IsVirtual,
    string? MeetingUrl,
    DateTime StartDate,
    DateTime? EndDate,
    int? MaxAttendees,
    string? CoverImageUrl) : IRequest<EventDto>;

public sealed class CreateEventValidator : AbstractValidator<CreateEventCommand>
{
    public CreateEventValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.OrganizerName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Description).MaximumLength(2000);
        RuleFor(x => x.EventTypeId).GreaterThan(0);
        RuleFor(x => x.Location).MaximumLength(300);

        RuleFor(x => x.MeetingUrl)
            .Must(BeAValidAbsoluteUrl)
                .WithMessage("MeetingUrl must be a valid absolute http(s) URL.")
            .MaximumLength(1024)
            .When(x => !string.IsNullOrWhiteSpace(x.MeetingUrl));

        RuleFor(x => x.StartDate)
            .GreaterThan(_ => DateTime.Now)
                .WithMessage("StartDate must be in the future.");

        RuleFor(x => x.EndDate)
            .GreaterThan(x => x.StartDate)
                .WithMessage("EndDate must be after StartDate.")
            .When(x => x.EndDate.HasValue);

        RuleFor(x => x.MaxAttendees)
            .GreaterThanOrEqualTo(1)
            .When(x => x.MaxAttendees.HasValue);

        RuleFor(x => x.CoverImageUrl)
            .Must(BeAValidImageUrl)
                .WithMessage("CoverImageUrl must be a valid https URL or an /uploads/ path.")
            .MaximumLength(512)
            .When(x => !string.IsNullOrWhiteSpace(x.CoverImageUrl));
    }

    private static bool BeAValidAbsoluteUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    private static bool BeAValidImageUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (value.StartsWith("/uploads/", StringComparison.Ordinal)) return true;
        return BeAValidAbsoluteUrl(value);
    }
}

public sealed class CreateEventHandler : IRequestHandler<CreateEventCommand, EventDto>
{
    private readonly ICurrentUserService _currentUser;
    private readonly AppDbContext _dbContext;

    public CreateEventHandler(ICurrentUserService currentUser, AppDbContext dbContext)
    {
        _currentUser = currentUser;
        _dbContext = dbContext;
    }

    public async Task<EventDto> Handle(CreateEventCommand request, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetOrCreateUserAsync(cancellationToken);

        var eventType = await _dbContext.EventTypes
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == request.EventTypeId, cancellationToken)
            ?? throw new ValidationException(
                [new FluentValidation.Results.ValidationFailure(
                    nameof(request.EventTypeId),
                    $"EventTypeId {request.EventTypeId} does not exist.")]);

        var now = DateTime.Now;
        var entity = new Event
        {
            Id = Guid.NewGuid(),
            OrganizerId = user.Id,
            EventTypeId = request.EventTypeId,
            Title = request.Title.Trim(),
            OrganizerName = request.OrganizerName.Trim(),
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            Location = string.IsNullOrWhiteSpace(request.Location) ? null : request.Location.Trim(),
            IsVirtual = request.IsVirtual,
            MeetingUrl = string.IsNullOrWhiteSpace(request.MeetingUrl) ? null : request.MeetingUrl.Trim(),
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            MaxAttendees = request.MaxAttendees,
            CoverImageUrl = string.IsNullOrWhiteSpace(request.CoverImageUrl) ? null : request.CoverImageUrl.Trim(),
            CreatedAt = now,
            IsCancelled = false,
            IsDeleted = false,
        };

        _dbContext.Events.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new EventDto(
            entity.Id, entity.Title, entity.OrganizerName, entity.Description,
            entity.Location, entity.IsVirtual, entity.MeetingUrl, entity.StartDate,
            entity.EndDate, entity.MaxAttendees, entity.IsCancelled,
            entity.CreatedAt, entity.UpdatedAt,
            new EventTypeDto(eventType.Id, eventType.Name, eventType.Icon));
    }
}
```

### Line-by-line — the design choices to call out

**Validator**

- **`MaxLength` enforced both here and in EF configurations** — DB constraint is the ultimate truth (SQL Server won't let an over-length value through), but failing at the validator gives a friendly RFC 7807 error before EF even tries.
- **`.GreaterThan(_ => DateTime.Now)` on `StartDate`** — only for `Create`. `UpdateEventValidator` makes this optional (toggle), because legitimate edits to a started event (typo fix, end-time extension) should not require future-dating.
- **`.When(x => x.EndDate.HasValue)`** — pattern repeated for every optional rule. Without it, the rule would *always* run and report "EndDate must be after StartDate" for null inputs.
- **`BeAValidImageUrl`** accepts either an absolute URL *or* a server-relative `/uploads/...` path. This is the upload contract: the upload endpoint (phase 07) returns `/uploads/abc123.png`, and the client posts that string straight back when creating/updating events.

**Handler**

- **Look up EventType first** — we want a clean `ValidationException` if the ID is bad, *not* an FK constraint error from EF. The check is an extra round-trip (small lookup table; usually cached by SQL Server's plan cache).
- **`AsNoTracking()`** — the EventType is only read, never mutated. No change tracking saves memory and a few CPU cycles.
- **Manual `Guid.NewGuid()`** — we don't rely on DB-generated ids because we want the GUID *before* `SaveChanges` so we can return it without re-fetching.
- **`OrganizerName` is stored on the event, not joined from User** — by design. The current user's display name today might differ from the name they used when creating the event ("Alice (work)" vs "Alice"). The event captures the name at write time.
- **Trim everything** — strings are normalised in the handler, not the validator, because we want the persisted value to be canonical regardless of which path executed.
- **Return the freshly-built DTO** — no re-read from DB. We already have everything (the entity + the type we just verified).

---

## Step 3: Add `GetEvents.cs` — paged query

```csharp
using EventSync.Api.Common.Models;
using EventSync.Api.Common.Services;
using EventSync.Api.Data;
using EventSync.Api.Data.Entities;
using EventSync.Api.Features.Events.Common;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace EventSync.Api.Features.Events.GetEvents;

public sealed record GetEventsQuery(
    int Page = 1,
    int PageSize = 10,
    string? Search = null,
    int? TypeId = null,
    string SortBy = "date",
    string SortDir = "asc") : IRequest<PagedResult<EventSummaryDto>>;

public sealed class GetEventsHandler : IRequestHandler<GetEventsQuery, PagedResult<EventSummaryDto>>
{
    private const int MinPageSize = 1;
    private const int MaxPageSize = 50;

    private readonly ICurrentUserService _currentUser;
    private readonly AppDbContext _dbContext;

    public GetEventsHandler(ICurrentUserService currentUser, AppDbContext dbContext)
    {
        _currentUser = currentUser;
        _dbContext = dbContext;
    }

    public async Task<PagedResult<EventSummaryDto>> Handle(
        GetEventsQuery request, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetOrCreateUserAsync(cancellationToken);

        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, MinPageSize, MaxPageSize);

        IQueryable<Event> query = _dbContext.Events
            .AsNoTracking()
            .Where(e => e.OrganizerId == user.Id);

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            query = query.Where(e => EF.Functions.Like(e.Title, $"%{search}%"));
        }

        if (request.TypeId is int typeId && typeId > 0)
        {
            query = query.Where(e => e.EventTypeId == typeId);
        }

        var sortDescending = string.Equals(request.SortDir, "desc", StringComparison.OrdinalIgnoreCase);
        query = (request.SortBy?.ToLowerInvariant()) switch
        {
            "title" => sortDescending
                ? query.OrderByDescending(e => e.Title)
                : query.OrderBy(e => e.Title),
            _ => sortDescending
                ? query.OrderByDescending(e => e.StartDate)
                : query.OrderBy(e => e.StartDate),
        };

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(e => new EventSummaryDto(
                e.Id,
                e.Title,
                e.EventType.Name,
                e.EventType.Icon,
                e.StartDate,
                e.EndDate,
                e.Location,
                e.IsVirtual,
                e.IsCancelled,
                e.Rsvps.Count(r => r.Status == RsvpStatus.Going),
                e.CoverImageUrl,
                e.CreatedAt))
            .ToListAsync(cancellationToken);

        return new PagedResult<EventSummaryDto>(items, page, pageSize, totalCount);
    }
}
```

### Line-by-line

- **`Math.Clamp(request.PageSize, 1, 50)`** — server-side guard against `?pageSize=10000` denial-of-service. Without this a malicious client could request a million rows.
- **Soft-delete is implicit** — `_dbContext.Events` already applies the global query filter `e => !e.IsDeleted` from phase 03. We do not need to add it explicitly.
- **`EF.Functions.Like(e.Title, $"%{search}%")`** — translates to SQL `LIKE`. Stays server-side; case-insensitive under SQL Server's default collation (`SQL_Latin1_General_CP1_CI_AS`).
- **`OrderBy` / `OrderByDescending` returns `IOrderedQueryable<>`** — the `switch` expression branches both assign back to `IQueryable<>` because Skip/Take don't need the ordered type.
- **Two DB round-trips: `CountAsync` then `ToListAsync`** — necessary for pagination. The count uses the *filtered but unpaged* query; the list applies skip/take.
- **`Select` projection happens server-side** — `.Select(e => new EventSummaryDto(...))` is translated to SQL `SELECT` listing only the projected columns. EF generates a JOIN to `EventType` for `e.EventType.Name`/`Icon`, and a correlated subquery for `e.Rsvps.Count(...)`. No client-side evaluation = no N+1.
- **`PagedResult<T>`** — comes from `Common/Models/PagedResult.cs` (phase 02). Wraps items + page + pageSize + totalCount and exposes a computed `TotalPages`.

---

## Step 4: Add `GetEventById.cs` — detail query with related data

```csharp
using EventSync.Api.Common.Configuration;
using EventSync.Api.Common.Services;
using EventSync.Api.Data;
using EventSync.Api.Data.Entities;
using EventSync.Api.Features.Events.Common;
using EventSync.Api.Features.InviteLinks.CreateInviteLink;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EventSync.Api.Features.Events.GetEventById;

public sealed record GetEventByIdQuery(Guid Id) : IRequest<EventDetailDto>;

public sealed class GetEventByIdHandler : IRequestHandler<GetEventByIdQuery, EventDetailDto>
{
    private readonly ICurrentUserService _currentUser;
    private readonly AppDbContext _dbContext;
    private readonly FrontendOptions _frontend;

    public GetEventByIdHandler(
        ICurrentUserService currentUser,
        AppDbContext dbContext,
        IOptions<FrontendOptions> frontendOptions)
    {
        _currentUser = currentUser;
        _dbContext = dbContext;
        _frontend = frontendOptions.Value;
    }

    public async Task<EventDetailDto> Handle(GetEventByIdQuery request, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetOrCreateUserAsync(cancellationToken);

        var ev = await _dbContext.Events
            .AsNoTracking()
            .Include(e => e.EventType)
            .Include(e => e.Organizer)
            .FirstOrDefaultAsync(e => e.Id == request.Id, cancellationToken)
            ?? throw new KeyNotFoundException($"Event {request.Id} not found.");

        if (ev.OrganizerId != user.Id)
            throw new UnauthorizedAccessException("You do not have access to this event.");

        var counts = await _dbContext.Rsvps
            .AsNoTracking()
            .Where(r => r.EventId == ev.Id)
            .GroupBy(r => r.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var going    = counts.FirstOrDefault(c => c.Status == RsvpStatus.Going)?.Count    ?? 0;
        var notGoing = counts.FirstOrDefault(c => c.Status == RsvpStatus.NotGoing)?.Count ?? 0;
        var maybe    = counts.FirstOrDefault(c => c.Status == RsvpStatus.Maybe)?.Count    ?? 0;
        var total    = going + notGoing + maybe;

        var links = await _dbContext.InviteLinks
            .AsNoTracking()
            .Where(l => l.EventId == ev.Id)
            .OrderByDescending(l => l.CreatedAt)
            .ToListAsync(cancellationToken);

        var linkDtos = links
            .Select(l => CreateInviteLinkHandler.ToDto(l, _frontend.BaseUrl))
            .ToList();

        return new EventDetailDto(
            ev.Id, ev.Title, ev.OrganizerName, ev.Description,
            ev.Location, ev.IsVirtual, ev.MeetingUrl,
            ev.StartDate, ev.EndDate, ev.MaxAttendees, ev.CoverImageUrl,
            ev.IsCancelled, ev.CreatedAt, ev.UpdatedAt,
            new EventTypeDto(ev.EventType.Id, ev.EventType.Name, ev.EventType.Icon),
            new OrganizerDto(ev.OrganizerName, ev.Organizer.AvatarUrl),
            new RsvpSummaryDto(going, notGoing, maybe, total),
            linkDtos);
    }
}
```

### Key choices

- **Throws `KeyNotFoundException` and `UnauthorizedAccessException`** — the endpoint catches them and translates to 404/403. We could throw our custom `NotFoundException`/`ForbiddenAccessException` instead (which the middleware would handle); we use BCL types here for variety. Both work; pick one convention per project.
- **`Include(e => e.EventType)` + `Include(e => e.Organizer)`** — eager-loads navigation properties so we can project them into the DTO without extra queries.
- **`GROUP BY Status`** — one round-trip returns Going/NotGoing/Maybe counts. The alternative (three separate `CountAsync` calls) is three round-trips.
- **`FrontendOptions`** injected via `IOptions<>`** — invite links need the frontend base URL to produce shareable URLs (`https://eventsync.app/rsvp/{token}`). The handler asks the helper from phase 08's `CreateInviteLinkHandler.ToDto(...)` (we'll create it then). For phase 06a, you can stub `InviteLinks = []` to avoid the cross-feature dependency until phase 08 — or just write a copy of `ToDto` here for now.
- **`linkDtos` will be empty until phase 08** — that's fine; the endpoint shape is set up correctly.

> **Temporary phase-06a workaround:** since `CreateInviteLinkHandler` doesn't exist yet, replace the `linkDtos` block with:
> ```csharp
> var linkDtos = new List<InviteLinkDto>();
> ```
> Restore the real version in phase 08.

---

## Step 5: Add `UpdateEvent.cs`

Mirror of `CreateEvent` with three differences. Quoting the parts that differ:

```csharp
public sealed class UpdateEventValidator : AbstractValidator<UpdateEventCommand>
{
    /// <summary>Per-tenant toggle. Defaults false: edits allowed even after start.</summary>
    public static bool EnforceFutureStart { get; set; }

    public UpdateEventValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        // ... same as Create ...

        // Conditional rule.
        RuleFor(x => x.StartDate)
            .GreaterThan(_ => DateTime.Now)
                .WithMessage("StartDate must be in the future.")
            .When(_ => EnforceFutureStart);

        // ... rest same as Create ...
    }
}
```

And the handler:

```csharp
public async Task<EventDto> Handle(UpdateEventCommand request, CancellationToken cancellationToken)
{
    var user = await _currentUser.GetOrCreateUserAsync(cancellationToken);

    var entity = await _dbContext.Events
        .Include(e => e.EventType)
        .FirstOrDefaultAsync(e => e.Id == request.Id, cancellationToken)
        ?? throw new KeyNotFoundException($"Event {request.Id} not found.");

    if (entity.OrganizerId != user.Id)
        throw new UnauthorizedAccessException("You do not have permission to modify this event.");

    if (entity.EventTypeId != request.EventTypeId)
    {
        var typeExists = await _dbContext.EventTypes
            .AsNoTracking()
            .AnyAsync(t => t.Id == request.EventTypeId, cancellationToken);

        if (!typeExists)
            throw new ValidationException(
                [new FluentValidation.Results.ValidationFailure(
                    nameof(request.EventTypeId),
                    $"EventTypeId {request.EventTypeId} does not exist.")]);

        entity.EventTypeId = request.EventTypeId;
        entity.EventType = null!;  // force reload below
    }

    entity.Title = request.Title.Trim();
    // ... assign all other fields ...
    entity.UpdatedAt = DateTime.Now;

    await _dbContext.SaveChangesAsync(cancellationToken);

    if (entity.EventType is null)
        await _dbContext.Entry(entity).Reference(e => e.EventType).LoadAsync(cancellationToken);

    return new EventDto(/* ... */);
}
```

### Three differences vs Create

1. **`Include(e => e.EventType)`** when loading — we need it tracked (not `AsNoTracking`) because we're mutating the entity, and we already have the EventType navigation populated for the response.
2. **`EnforceFutureStart` toggle** — class-level `public static bool` set by tests or config. Off by default for usability.
3. **EventType swap logic** — if the user changes the type:
   - Verify the new ID exists (otherwise throw ValidationException with the same shape Create uses).
   - Update the FK and **null out the navigation property** with `entity.EventType = null!`. This forces EF to *not* keep the stale tracked relationship.
   - After `SaveChangesAsync`, call `_dbContext.Entry(entity).Reference(e => e.EventType).LoadAsync()` to load the new EventType for the response.

> **Why not just re-fetch?** You could `_dbContext.Events.Include(e => e.EventType).FirstOrDefaultAsync(...)` after the save. Reference loading is a single round-trip per navigation and arguably clearer.

---

## Step 6: Add `DeleteEvent.cs` — soft delete

```csharp
public sealed record DeleteEventCommand(Guid Id) : IRequest<Unit>;

public sealed class DeleteEventHandler : IRequestHandler<DeleteEventCommand, Unit>
{
    private readonly ICurrentUserService _currentUser;
    private readonly AppDbContext _dbContext;

    public DeleteEventHandler(ICurrentUserService currentUser, AppDbContext dbContext)
    {
        _currentUser = currentUser;
        _dbContext = dbContext;
    }

    public async Task<Unit> Handle(DeleteEventCommand request, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetOrCreateUserAsync(cancellationToken);

        var entity = await _dbContext.Events
            .FirstOrDefaultAsync(e => e.Id == request.Id, cancellationToken)
            ?? throw new KeyNotFoundException($"Event {request.Id} not found.");

        if (entity.OrganizerId != user.Id)
            throw new UnauthorizedAccessException("You do not have permission to delete this event.");

        entity.IsDeleted = true;
        entity.UpdatedAt = DateTime.Now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Unit.Value;
    }
}
```

### Key points

- **`IRequest<Unit>`** — MediatR's `Unit` is the equivalent of `void` for async returns. Use it when a handler has no return value but needs to be `await`able through `IMediator.Send`.
- **Soft delete = flip a flag** — `IsDeleted = true`. The global query filter from phase 03 immediately hides this row from every other read.
- **Cascading deletes?** None needed in code. Cancellation cascades naturally too — guests can't RSVP to a deleted event because they can't read it. Stored RSVPs remain in the DB with `EventId` pointing at the (now hidden) event — useful for audit, recoverable if you ever un-delete.

> **Real DELETE vs soft delete debate:** soft delete keeps history but eats DB space and complicates uniqueness constraints (a deleted email might conflict with a new sign-up). For EventSync, the trade-off is fine: events have no unique business keys other than `Id`. For `User` we use the same pattern but it would be questionable if we had a unique `Email` constraint without filtering on `IsDeleted = 0`.

---

## Step 7: Add `CancelEvent.cs`

Almost identical to delete but flips `IsCancelled`:

```csharp
public sealed record CancelEventCommand(Guid Id) : IRequest<Unit>;

public sealed class CancelEventHandler : IRequestHandler<CancelEventCommand, Unit>
{
    // ... ctor identical to Delete ...

    public async Task<Unit> Handle(CancelEventCommand request, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetOrCreateUserAsync(cancellationToken);

        var entity = await _dbContext.Events
            .FirstOrDefaultAsync(e => e.Id == request.Id, cancellationToken)
            ?? throw new KeyNotFoundException($"Event {request.Id} not found.");

        if (entity.OrganizerId != user.Id)
            throw new UnauthorizedAccessException("You do not have permission to cancel this event.");

        entity.IsCancelled = true;
        entity.UpdatedAt = DateTime.Now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Unit.Value;
    }
}
```

> **Why a separate command instead of a generic `PatchEvent(field, value)` ?** Intention. The endpoint `PATCH /events/{id}/cancel` is HTTP-verb-explicit: anyone reading logs or the API spec knows what happened. Generic PATCH endpoints invite frontend mistakes ("Did I send the right value?").

---

## Step 8: Add `EventEndpoints.cs`

```csharp
using EventSync.Api.Common.Models;
using EventSync.Api.Features.Events.CancelEvent;
using EventSync.Api.Features.Events.Common;
using EventSync.Api.Features.Events.CreateEvent;
using EventSync.Api.Features.Events.DeleteEvent;
using EventSync.Api.Features.Events.GetEventById;
using EventSync.Api.Features.Events.GetEvents;
using EventSync.Api.Features.Events.UpdateEvent;
using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace EventSync.Api.Features.Events;

public static class EventEndpoints
{
    public static IEndpointRouteBuilder MapEventEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/events")
            .WithTags("Events")
            .RequireAuthorization();

        group.MapGet("/", async (
            IMediator mediator,
            CancellationToken ct,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] string? search = null,
            [FromQuery] int? typeId = null,
            [FromQuery] string sortBy = "date",
            [FromQuery] string sortDir = "asc") =>
        {
            var result = await mediator.Send(
                new GetEventsQuery(page, pageSize, search, typeId, sortBy, sortDir), ct);
            return Results.Ok(result);
        })
        .WithName("GetEvents")
        .Produces<PagedResult<EventSummaryDto>>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized);

        group.MapGet("/{id:guid}", async (Guid id, IMediator mediator, CancellationToken ct) =>
        {
            try
            {
                var ev = await mediator.Send(new GetEventByIdQuery(id), ct);
                return Results.Ok(ev);
            }
            catch (KeyNotFoundException ex) { return Results.NotFound(new { error = ex.Message }); }
            catch (UnauthorizedAccessException) { return Results.Forbid(); }
        })
        .WithName("GetEventById")
        .Produces<EventDetailDto>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status403Forbidden);

        group.MapPost("/", async ([FromBody] CreateEventCommand command, IMediator mediator, CancellationToken ct) =>
        {
            try
            {
                var ev = await mediator.Send(command, ct);
                return Results.Created($"/api/v1/events/{ev.Id}", ev);
            }
            catch (ValidationException ex) { return ToValidationProblem(ex); }
        })
        .Produces<EventDto>(StatusCodes.Status201Created)
        .ProducesValidationProblem();

        group.MapPut("/{id:guid}", async (
            Guid id, [FromBody] UpdateEventCommand body, IMediator mediator, CancellationToken ct) =>
        {
            // Route id is authoritative; ignore any value in the body.
            var command = body with { Id = id };
            try
            {
                var ev = await mediator.Send(command, ct);
                return Results.Ok(ev);
            }
            catch (ValidationException ex) { return ToValidationProblem(ex); }
            catch (KeyNotFoundException ex) { return Results.NotFound(new { error = ex.Message }); }
            catch (UnauthorizedAccessException) { return Results.Forbid(); }
        })
        .Produces<EventDto>(StatusCodes.Status200OK)
        .ProducesValidationProblem();

        group.MapDelete("/{id:guid}", async (Guid id, IMediator mediator, CancellationToken ct) =>
        {
            try { await mediator.Send(new DeleteEventCommand(id), ct); return Results.NoContent(); }
            catch (KeyNotFoundException ex) { return Results.NotFound(new { error = ex.Message }); }
            catch (UnauthorizedAccessException) { return Results.Forbid(); }
        })
        .Produces(StatusCodes.Status204NoContent);

        group.MapPatch("/{id:guid}/cancel", async (Guid id, IMediator mediator, CancellationToken ct) =>
        {
            try { await mediator.Send(new CancelEventCommand(id), ct); return Results.NoContent(); }
            catch (KeyNotFoundException ex) { return Results.NotFound(new { error = ex.Message }); }
            catch (UnauthorizedAccessException) { return Results.Forbid(); }
        })
        .Produces(StatusCodes.Status204NoContent);

        return app;
    }

    private static IResult ToValidationProblem(ValidationException ex)
    {
        var errors = ex.Errors
            .GroupBy(e => e.PropertyName)
            .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());
        return Results.ValidationProblem(errors);
    }
}
```

### Design notes

- **`Results.Created("/api/v1/events/{id}", ev)`** — RFC 7231 says POST that creates a resource should return `201 Created` with a `Location` header. The framework adds the header from the URL string.
- **`var command = body with { Id = id }`** — `with` clones a record with overridden properties. The route ID is authoritative; we don't trust the body's ID even if present.
- **`{id:guid}` route constraint** — only matches valid Guids. Garbage like `/events/abc` is a 404 *before* the handler runs.
- **`MapPatch(".../cancel")`** — semantic action endpoints (PATCH on a sub-path) are clearer than PUT/PATCH with body fields. Same for `MapPatch("/rsvps/{id}/respond")` later.

---

## Step 9: Add the EventTypes lookup

`server/EventSync.Api/Features/EventTypes/GetEventTypes/GetEventTypes.cs`:

```csharp
using EventSync.Api.Data;
using EventSync.Api.Features.Events.Common;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace EventSync.Api.Features.EventTypes.GetEventTypes;

public sealed record GetEventTypesQuery() : IRequest<IReadOnlyList<EventTypeDto>>;

public sealed class GetEventTypesHandler : IRequestHandler<GetEventTypesQuery, IReadOnlyList<EventTypeDto>>
{
    private readonly AppDbContext _dbContext;

    public GetEventTypesHandler(AppDbContext dbContext) => _dbContext = dbContext;

    public async Task<IReadOnlyList<EventTypeDto>> Handle(
        GetEventTypesQuery request, CancellationToken cancellationToken) =>
        await _dbContext.EventTypes
            .AsNoTracking()
            .OrderBy(t => t.Name)
            .Select(t => new EventTypeDto(t.Id, t.Name, t.Icon))
            .ToListAsync(cancellationToken);
}
```

`server/EventSync.Api/Features/EventTypes/EventTypeEndpoints.cs`:

```csharp
using EventSync.Api.Features.Events.Common;
using EventSync.Api.Features.EventTypes.GetEventTypes;
using MediatR;

namespace EventSync.Api.Features.EventTypes;

public static class EventTypeEndpoints
{
    public static IEndpointRouteBuilder MapEventTypeEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/event-types")
            .WithTags("EventTypes")
            .RequireAuthorization();

        group.MapGet("/", async (IMediator mediator, CancellationToken ct) =>
            Results.Ok(await mediator.Send(new GetEventTypesQuery(), ct)))
            .WithName("GetEventTypes")
            .Produces<IReadOnlyList<EventTypeDto>>(StatusCodes.Status200OK);

        return app;
    }
}
```

### Why a separate lookup endpoint?

- The frontend's create-event form needs the dropdown of types. Without this endpoint the UI would either hardcode the list (DB drift risk) or include event types inside every Event read response (wasted bytes).
- `.RequireAuthorization()` even though the data is non-sensitive — keeps a consistent auth posture; no anonymous reads anywhere except `/invite/...` and Swagger.

---

## Step 10: Wire up `Program.cs`

In your `Program.cs`, uncomment (or add):

```csharp
using EventSync.Api.Features.Events;
using EventSync.Api.Features.EventTypes;
// ...
app.MapEventEndpoints();
app.MapEventTypeEndpoints();
```

Build + run:

```powershell
cd server/EventSync.Api
dotnet run
```

**Expected output:**

```
Build succeeded.
    0 Warning(s)
    0 Error(s)
Now listening on: http://localhost:5000
```

---

## Checkpoint

You've passed this phase when:

1. Swagger UI shows the **Events** tag with all 6 endpoints (list, get, create, update, delete, cancel) and **EventTypes** with GET.
2. With a bearer token in Swagger, `GET /event-types` returns the 9 seeded rows (Birthday, Wedding, Meeting, etc.).
3. `POST /events` with a valid body returns 201. Verify in SSMS that a row appeared in `dbo.Events` with your `OrganizerId`.
4. `POST /events` with `Title: ""` returns 400 with the FluentValidation error in `errors`.
5. `POST /events` with `EventTypeId: 999` returns 400 with `EventTypeId 999 does not exist.`.
6. `GET /events/{id}` for the new event returns full detail with `Rsvps: { going: 0, ... }` and `InviteLinks: []`.
7. `GET /events/{someoneElsesId}` returns 403 (test by manually inserting an event with a different `OrganizerId` in SSMS, then retrieving it).
8. `GET /events?search=birthday&typeId=1&sortBy=title&sortDir=desc` works and returns a `PagedResult<EventSummaryDto>`.
9. `DELETE /events/{id}` returns 204. Verify in SSMS the row is still there with `IsDeleted = 1`. A subsequent `GET /events/{id}` returns 404 (filtered).
10. `PATCH /events/{id}/cancel` returns 204. The row's `IsCancelled = 1` but it still appears in `GET /events`.

---

Next: [06b-vertical-slice-events-frontend.md](./06b-vertical-slice-events-frontend.md) — the Events list, create form, edit form, detail page, and the polished dashboard with stats.
