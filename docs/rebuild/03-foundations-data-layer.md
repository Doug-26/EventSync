# Phase 03 — Data Layer (EF Core)

Goal: replace the placeholder `User` + `AppDbContext` from phase 02 with the full five-entity model, write each Fluent API configuration, seed the `EventTypes` lookup table, and run the first migration. By the end, your SQL Server LocalDB contains every table the API needs.

Files we'll create / replace:

```
server/EventSync.Api/Data/
├── AppDbContext.cs                      # full version
├── Entities/
│   ├── User.cs                          # replace placeholder
│   ├── Event.cs
│   ├── EventType.cs
│   ├── InviteLink.cs
│   └── Rsvp.cs                          # also defines RsvpStatus enum
└── Configurations/
    ├── UserConfiguration.cs
    ├── EventConfiguration.cs
    ├── EventTypeConfiguration.cs
    ├── InviteLinkConfiguration.cs
    └── RsvpConfiguration.cs
```

> **Why split entities from configurations?** Entities are plain C# classes (POCOs) with no EF Core dependencies on top of them — they could be reused in another context. Configurations (the `IEntityTypeConfiguration<T>` classes) own all the persistence concerns: tables, columns, indexes, relationships, query filters. Keeps the model classes small and the persistence rules co-located.

---

## 1. The domain model at a glance

```
   ┌────────┐ 1..* organizes ┌────────┐ *..1  ┌───────────┐
   │  User  │────────────────│ Event  │───────│ EventType │
   └────────┘                └─┬──┬───┘       └───────────┘
                               │  │
                          1..* │  │ 1..*
                               │  │
                         ┌─────▼─┐│
                         │Invite ││
                         │ Link  │┼
                         └───┬───┘│
                             │    │
                          0..1    │
                             ▼    ▼
                           ┌────────┐
                           │  Rsvp  │
                           └────────┘
```

Key design choices we're enforcing through configurations:

| Decision | Mechanism |
|---|---|
| Soft-delete on `User` and `Event` | `IsDeleted` flag + global query filter |
| One organizer can have many events; deleting them is restricted | FK with `DeleteBehavior.Restrict` |
| Deleting an event cascades to its invite links | FK with `DeleteBehavior.Cascade` |
| Deleting an invite link does **not** delete its RSVPs (audit) | FK with `DeleteBehavior.SetNull` |
| One RSVP per (event, email) when email is provided | Filtered unique index |
| `Rsvp.Status` stored as `tinyint` (1 byte) | `HasConversion<byte>()` |

---

## 2. Entities

### 2a. `User.cs`

Replace `Data/Entities/User.cs`:

```csharp
namespace EventSync.Api.Data.Entities;

public class User
{
    public Guid Id { get; set; }
    public string Auth0Id { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public bool IsDeleted { get; set; }

    public ICollection<Event> OrganizedEvents { get; set; } = new List<Event>();
}
```

- **`Id` is `Guid`** — globally unique, doesn't leak count info (compared with sequential `int` IDs that telegraph "user #523" in URLs).
- **`Auth0Id`** — the `sub` claim from Auth0 (e.g. `"auth0|abc123"`). The unique identifier we use to map a logged-in user back to this row.
- **`Email`/`DisplayName` non-nullable + `= string.Empty`** — avoid `null` defaults. EF Core respects this and emits `NOT NULL DEFAULT ''` for new rows.
- **`AvatarUrl` nullable** — optional in Auth0 claims; reflects reality.
- **`UpdatedAt` nullable** — `null` means "never updated".
- **`IsDeleted`** — soft-delete flag.
- **`OrganizedEvents`** — navigation collection. Init to `new List<Event>()` so accidental `null` reference exceptions are impossible.

### 2b. `EventType.cs`

Create `Data/Entities/EventType.cs`:

```csharp
namespace EventSync.Api.Data.Entities;

public class EventType
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Icon { get; set; }

    public ICollection<Event> Events { get; set; } = new List<Event>();
}
```

- **`int Id`** (not Guid) — this is a *lookup table* with at most a dozen rows, seeded at migration time. Auto-increment integers are fine.
- **`Icon`** — emoji or other glyph the frontend renders next to the name.

### 2c. `Event.cs`

Create `Data/Entities/Event.cs`:

```csharp
namespace EventSync.Api.Data.Entities;

public class Event
{
    public Guid Id { get; set; }
    public Guid OrganizerId { get; set; }
    public int EventTypeId { get; set; }

    public string Title { get; set; } = string.Empty;
    public string OrganizerName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Location { get; set; }
    public bool IsVirtual { get; set; }
    public string? MeetingUrl { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public int? MaxAttendees { get; set; }
    public string? CoverImageUrl { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public bool IsDeleted { get; set; }
    public bool IsCancelled { get; set; }

    public User Organizer { get; set; } = null!;
    public EventType EventType { get; set; } = null!;
    public ICollection<InviteLink> InviteLinks { get; set; } = new List<InviteLink>();
    public ICollection<Rsvp> Rsvps { get; set; } = new List<Rsvp>();
}
```

- **`OrganizerId` FK + `Organizer` navigation** — the FK is the *required* part (EF Core uses it for joins); the navigation is convenience for `.Include(...)`.
- **`OrganizerName` is a separate field** — not just `Organizer.DisplayName`. Why? The organizer may want a different "presented as" name per event (e.g., personal account but the event is on behalf of their company).
- **`Description`/`Location` nullable** — optional.
- **`IsVirtual` + `MeetingUrl`** — modelling the "online event" case without needing a separate entity. The validator (phase 06) enforces "`MeetingUrl` required if `IsVirtual`".
- **`EndDate` nullable** — many short events don't need one.
- **`MaxAttendees` nullable** — `null` means unlimited.
- **`IsDeleted` vs `IsCancelled` — two orthogonal flags:**
  - `IsDeleted` = the organizer removed it; soft-deleted by query filter; invisible to everyone.
  - `IsCancelled` = the event is publicly known but won't take place; still visible (with a "cancelled" badge) to guests so they know not to come.
- **`= null!`** on `Organizer`/`EventType` — required navigations, nullable-warning-suppressed because EF Core populates them when loaded. (Without `= null!`, nullable-reference-types would warn.)

### 2d. `InviteLink.cs`

Create `Data/Entities/InviteLink.cs`:

```csharp
namespace EventSync.Api.Data.Entities;

public class InviteLink
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }

    public string Token { get; set; } = string.Empty;
    public DateTime? ExpiresAt { get; set; }
    public int? MaxUses { get; set; }
    public int UseCount { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }

    public Event Event { get; set; } = null!;
    public ICollection<Rsvp> Rsvps { get; set; } = new List<Rsvp>();
}
```

- **`Token`** — the URL-safe random string from `TokenGenerator` (phase 02 §7). Indexed unique in the configuration.
- **`ExpiresAt`/`MaxUses` nullable** — both limits are optional; `null` means "no limit".
- **`UseCount`** — incremented atomically by the RSVP handler (phase 09).
- **`IsActive = true`** — default in the entity, mirrored in the configuration (`HasDefaultValue(true)`).

### 2e. `Rsvp.cs` (and the `RsvpStatus` enum)

Create `Data/Entities/Rsvp.cs`:

```csharp
namespace EventSync.Api.Data.Entities;

public enum RsvpStatus : byte
{
    Pending = 0,
    Going = 1,
    NotGoing = 2,
    Maybe = 3,
}

public class Rsvp
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public Guid? InviteLinkId { get; set; }

    public string GuestName { get; set; } = string.Empty;
    public string? GuestEmail { get; set; }
    public RsvpStatus Status { get; set; }
    public string? Note { get; set; }

    public DateTime RespondedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public string? IpAddress { get; set; }

    public Event Event { get; set; } = null!;
    public InviteLink? InviteLink { get; set; }
}
```

- **`enum RsvpStatus : byte`** — explicit underlying type. Stored as `tinyint` (1 byte) in SQL Server (see configuration). Smaller storage, faster comparisons.
- **Numeric values are part of the persisted contract** — **don't renumber existing members**. If you add `Declined = 4`, you can't reuse `2` for something else without a data migration.
- **`Pending = 0`** — useful for organizer-side workflows (we could allow an organizer to "expect" a guest before they respond). The public submit-RSVP endpoint (phase 09) explicitly rejects `Pending` so guests can only choose Going/NotGoing/Maybe.
- **`InviteLinkId` nullable** — RSVPs from a deleted invite link should *survive*. When the link is deleted, EF Core sets this to `NULL` via `DeleteBehavior.SetNull` (configuration §3e).
- **`GuestEmail` nullable** — RSVPs can be anonymous (just a name). But when present, it enables idempotent updates: the same guest re-submitting updates rather than duplicates.
- **`IpAddress` capped at 45 chars** — that's the max length of a textual IPv6 address (`xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx`).

---

## 3. Configurations (Fluent API)

These classes implement `IEntityTypeConfiguration<T>` and are auto-applied by `modelBuilder.ApplyConfigurationsFromAssembly(...)` in the DbContext.

### 3a. `UserConfiguration.cs`

```csharp
using EventSync.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EventSync.Api.Data.Configurations;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("Users");
        builder.HasKey(u => u.Id);

        builder.Property(u => u.Auth0Id).HasMaxLength(128).IsRequired();
        builder.Property(u => u.Email).HasMaxLength(256).IsRequired();
        builder.Property(u => u.DisplayName).HasMaxLength(100).IsRequired();
        builder.Property(u => u.AvatarUrl).HasMaxLength(512);
        builder.Property(u => u.CreatedAt).IsRequired();
        builder.Property(u => u.IsDeleted).HasDefaultValue(false);

        builder.HasIndex(u => u.Auth0Id).IsUnique();

        builder.HasQueryFilter(u => !u.IsDeleted);
    }
}
```

- **Lengths matter** — `HasMaxLength` translates to `NVARCHAR(n)` instead of `NVARCHAR(MAX)`, which is faster to index and store.
- **`HasIndex(u => u.Auth0Id).IsUnique()`** — enforces "one local user per Auth0 identity". Also makes the `CurrentUserService.GetOrCreateUserAsync` lookup an index seek.
- **`HasQueryFilter(u => !u.IsDeleted)`** — global filter. Every query *automatically* appends `WHERE IsDeleted = 0`. This is the soft-delete enforcement; handler code never says `.Where(u => !u.IsDeleted)`.

> **Pitfall — `IgnoreQueryFilters()`:** Sometimes you genuinely need to query *all* users (admin "restore deleted" workflows). Call `_dbContext.Users.IgnoreQueryFilters().Where(...)`. Don't disable the filter globally.

### 3b. `EventTypeConfiguration.cs`

```csharp
using EventSync.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EventSync.Api.Data.Configurations;

public sealed class EventTypeConfiguration : IEntityTypeConfiguration<EventType>
{
    public void Configure(EntityTypeBuilder<EventType> builder)
    {
        builder.ToTable("EventTypes");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).ValueGeneratedOnAdd();

        builder.Property(t => t.Name).HasMaxLength(50).IsRequired();
        builder.Property(t => t.Icon).HasMaxLength(50);

        builder.HasIndex(t => t.Name).IsUnique();
    }
}
```

- **`ValueGeneratedOnAdd()`** — explicit "use IDENTITY". For `int` PKs, EF Core does this by default, but being explicit documents intent.
- **`HasIndex(t => t.Name).IsUnique()`** — prevents duplicate event type names. The seed data in `AppDbContext` already supplies all 9; this index catches future mistakes.

### 3c. `EventConfiguration.cs`

```csharp
using EventSync.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EventSync.Api.Data.Configurations;

public sealed class EventConfiguration : IEntityTypeConfiguration<Event>
{
    public void Configure(EntityTypeBuilder<Event> builder)
    {
        builder.ToTable("Events");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Title).HasMaxLength(200).IsRequired();
        builder.Property(e => e.OrganizerName).HasMaxLength(100).IsRequired().HasDefaultValue("");
        builder.Property(e => e.Description).HasMaxLength(2000);
        builder.Property(e => e.Location).HasMaxLength(300);
        builder.Property(e => e.MeetingUrl).HasMaxLength(512);
        builder.Property(e => e.CoverImageUrl).HasMaxLength(512);
        builder.Property(e => e.IsVirtual).HasDefaultValue(false);
        builder.Property(e => e.IsDeleted).HasDefaultValue(false);
        builder.Property(e => e.IsCancelled).HasDefaultValue(false);
        builder.Property(e => e.CreatedAt).IsRequired();
        builder.Property(e => e.StartDate).IsRequired();

        builder.HasOne(e => e.Organizer)
               .WithMany(u => u.OrganizedEvents)
               .HasForeignKey(e => e.OrganizerId)
               .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(e => e.EventType)
               .WithMany(t => t.Events)
               .HasForeignKey(e => e.EventTypeId)
               .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(e => new { e.OrganizerId, e.IsDeleted });
        builder.HasIndex(e => e.StartDate);

        builder.HasQueryFilter(e => !e.IsDeleted);
    }
}
```

- **Foreign keys with `DeleteBehavior.Restrict`** — you *cannot* hard-delete a user who has organized events. This is the right policy because we soft-delete instead.
- **`HasIndex(e => new { e.OrganizerId, e.IsDeleted })`** — composite index. The "list my events" query filters by organizer + (implicitly via query filter) IsDeleted. This index makes that an index seek.
- **`HasIndex(e => e.StartDate)`** — supports the default `ORDER BY StartDate` in the list endpoint.

### 3d. `InviteLinkConfiguration.cs`

```csharp
using EventSync.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EventSync.Api.Data.Configurations;

public sealed class InviteLinkConfiguration : IEntityTypeConfiguration<InviteLink>
{
    public void Configure(EntityTypeBuilder<InviteLink> builder)
    {
        builder.ToTable("InviteLinks");
        builder.HasKey(i => i.Id);

        builder.Property(i => i.Token).HasMaxLength(64).IsRequired();
        builder.Property(i => i.UseCount).HasDefaultValue(0);
        builder.Property(i => i.IsActive).HasDefaultValue(true);
        builder.Property(i => i.CreatedAt).IsRequired();

        builder.HasOne(i => i.Event)
               .WithMany(e => e.InviteLinks)
               .HasForeignKey(i => i.EventId)
               .OnDelete(DeleteBehavior.Cascade);

        builder.HasQueryFilter(i => !i.Event.IsDeleted);

        builder.HasIndex(i => i.Token).IsUnique();
    }
}
```

- **`Token` length 64** — comfortably accommodates the 43-character URL-safe Base64 produced by `TokenGenerator` plus headroom.
- **`DeleteBehavior.Cascade`** — if an event is *hard* deleted (admin tooling), its invite links go too. There's no value in orphan links pointing at nothing.
- **`HasQueryFilter(i => !i.Event.IsDeleted)`** — propagates the parent event's soft-delete. Without this, a query for invite links on a soft-deleted event would still return them, which is confusing.
- **`HasIndex(i => i.Token).IsUnique()`** — the token lookup happens on every public RSVP request. Indexed unique = O(log n) seek + collision protection.

### 3e. `RsvpConfiguration.cs`

```csharp
using EventSync.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EventSync.Api.Data.Configurations;

public sealed class RsvpConfiguration : IEntityTypeConfiguration<Rsvp>
{
    public void Configure(EntityTypeBuilder<Rsvp> builder)
    {
        builder.ToTable("Rsvps");
        builder.HasKey(r => r.Id);

        builder.Property(r => r.GuestName).HasMaxLength(100).IsRequired();
        builder.Property(r => r.GuestEmail).HasMaxLength(256);
        builder.Property(r => r.Status).HasConversion<byte>().IsRequired();
        builder.Property(r => r.Note).HasMaxLength(500);
        builder.Property(r => r.IpAddress).HasMaxLength(45);
        builder.Property(r => r.RespondedAt).IsRequired();

        builder.HasOne(r => r.Event)
               .WithMany(e => e.Rsvps)
               .HasForeignKey(r => r.EventId)
               .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(r => r.InviteLink)
               .WithMany(i => i.Rsvps)
               .HasForeignKey(r => r.InviteLinkId)
               .OnDelete(DeleteBehavior.SetNull);

        builder.HasQueryFilter(r => !r.Event.IsDeleted);

        builder.HasIndex(r => new { r.EventId, r.Status });

        builder.HasIndex(r => new { r.GuestEmail, r.EventId })
               .IsUnique()
               .HasFilter("[GuestEmail] IS NOT NULL");
    }
}
```

- **`HasConversion<byte>()`** — stores `RsvpStatus` as `tinyint`. EF Core handles the conversion in both directions.
- **`Event` FK `Restrict` + `InviteLink` FK `SetNull`** — SQL Server doesn't allow multiple cascade paths into the same table. If both were cascade, deleting an event (which cascades to invite links, which then would cascade to RSVPs) plus the direct event→RSVP cascade would create two paths to the same RSVPs and SQL Server would refuse to create the constraint. Restricting on the event side breaks the tie. (In practice we never hard-delete events anyway — soft-delete is the policy — so this configuration is purely about satisfying SQL Server's schema rules.)
- **`SetNull` on InviteLinkId** — see entity comments: a deleted invite link shouldn't erase the RSVPs that came through it.
- **`HasIndex(r => new { r.EventId, r.Status })`** — supports the RSVP summary query (`GROUP BY Status WHERE EventId = ?`).
- **Filtered unique index `HasFilter("[GuestEmail] IS NOT NULL")`** — *the* key piece of the RSVP idempotency design. SQL Server treats a `NULL`-allowing unique index as "all rows must be unique, including NULLs" — which means only one anonymous RSVP could ever exist per event. Adding the filter makes the uniqueness apply only when `GuestEmail` is supplied, so anonymous guests can RSVP freely and guests *with* emails get a one-row guarantee per event.

> **Pitfall — multiple cascade paths:** if you ever see `Introducing FOREIGN KEY constraint '...' may cause cycles or multiple cascade paths`, this is the situation. The fix is always to change one of the cascades to `Restrict` or `NoAction`.

---

## 4. `AppDbContext.cs`

Replace `Data/AppDbContext.cs`:

```csharp
using EventSync.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace EventSync.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<EventType> EventTypes => Set<EventType>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<InviteLink> InviteLinks => Set<InviteLink>();
    public DbSet<Rsvp> Rsvps => Set<Rsvp>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        modelBuilder.Entity<EventType>().HasData(
            new EventType { Id = 1, Name = "Seminar",             Icon = "\uD83C\uDF93" },
            new EventType { Id = 2, Name = "Meeting",             Icon = "\uD83D\uDCC5" },
            new EventType { Id = 3, Name = "Gathering",           Icon = "\uD83E\uDD1D" },
            new EventType { Id = 4, Name = "Wedding Anniversary", Icon = "\uD83D\uDC8D" },
            new EventType { Id = 5, Name = "Birthday",            Icon = "\uD83C\uDF82" },
            new EventType { Id = 6, Name = "Workshop",            Icon = "\uD83D\uDEE0\uFE0F" },
            new EventType { Id = 7, Name = "Conference",          Icon = "\uD83C\uDFA4" },
            new EventType { Id = 8, Name = "Other",               Icon = "\u2728" },
            new EventType { Id = 9, Name = "Church Anniversary",  Icon = "\u26EA" }
        );
    }
}
```

### Line-by-line

- **`DbSet<T> { get; } => Set<T>()`** — expression-bodied properties returning `Set<T>()`. Idiomatic in C# 9+; avoids the backing-field boilerplate.
- **`ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly)`** — discovers every `IEntityTypeConfiguration<T>` in the same assembly via reflection and applies it. No manual `modelBuilder.ApplyConfiguration(new UserConfiguration())` per entity.
- **`HasData(...)` — seed data for `EventType`** — these rows are created by the *migration* (not by application startup). Each `Id` is fixed so the migration is deterministic and re-runnable.
- **Unicode escapes (`\uD83C\uDF93`)** — surrogate-pair encoded emoji. When you see `\uD83C\uDF93`, that's "🎓" (graduation cap). Using escapes keeps the source file pure-ASCII so any editor / VCS handles it cleanly.

> **Why seed in `OnModelCreating` instead of a one-off SQL script?** Because EF Core tracks the seed data as part of the model snapshot. If you later change a name (e.g., "Gathering" → "Get-together"), the next migration auto-generates the UPDATE statement.

---

## 5. Make sure DI is wired up

In `Program.cs` (already done in phase 02 §10a, but verify):

```csharp
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlServer(connectionString));
```

If `AppDbContext` was the placeholder version (no `DbSet<EventType>` etc), it'll now compile against the full version automatically. No changes needed.

Also: the `CurrentUserService.GetOrCreateUserAsync` method (phase 02 §8) used `_dbContext.Users.FirstOrDefaultAsync(u => u.Auth0Id == auth0Id, …)`. That works as-is — `Users` is now a real `DbSet<User>` with the full schema.

---

## 6. Generate and apply the first migration

From `server/EventSync.Api/`:

```powershell
# Build first so the EF tools find the model assembly.
dotnet build

# Generate the initial migration.
dotnet ef migrations add InitialCreate -o Migrations

# Apply to LocalDB.
dotnet ef database update
```

> **Visual Studio note:** the equivalent in Package Manager Console (Tools → NuGet Package Manager → Package Manager Console) is:
> ```
> Add-Migration InitialCreate -OutputDir Migrations
> Update-Database
> ```
> Make sure the "Default project" dropdown is `EventSync.Api`. Either tool produces the **same migration files** — pick one and stick with it.

What `dotnet ef migrations add InitialCreate` does:
1. Builds the project (loads the compiled `AppDbContext`).
2. Compares the current model (entities + configurations + `HasData`) against the model snapshot (`Migrations/AppDbContextModelSnapshot.cs`, doesn't exist yet → empty).
3. Generates two files in `Migrations/`:
   - `<timestamp>_InitialCreate.cs` — `Up()` (create tables, indexes, FKs, insert seed rows) + `Down()` (the inverse).
   - `<timestamp>_InitialCreate.Designer.cs` — model snapshot for the new state.
   - `AppDbContextModelSnapshot.cs` — current cumulative snapshot.

What `dotnet ef database update` does:
1. Opens the LocalDB connection from `appsettings.Development.json`.
2. Creates `EventSync` if it doesn't exist (using `CREATE DATABASE`).
3. Creates the `__EFMigrationsHistory` table (if missing).
4. Runs `Up()` for every migration not yet listed in `__EFMigrationsHistory`.

> **Pitfall — EF Core 10 `PendingModelChangesWarning`:** if you skip `dotnet build` before `migrations add` (or use `--no-build`), EF Core may emit "No migrations were found in assembly" or refuse to run because the snapshot doesn't match. **Always build first; never use `--no-build`** with `migrations add` / `database update`.
>
> **Pitfall — `dotnet ef migrations remove --force`:** the `--force` flag *reverts* the migration in the database first. If `InitialCreate` is the only migration applied, that **drops every table**. Use plain `migrations remove` (no flag) to safely delete an unapplied migration file.

---

## 7. Verify the database

Use SQL Server Management Studio (SSMS), Azure Data Studio, or the VS Code "SQL Server (mssql)" extension to connect to `(localdb)\MSSQLLocalDB` and confirm:

```sql
-- All 6 expected tables exist (5 entities + EF migrations history).
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_CATALOG = 'EventSync';
-- Users, EventTypes, Events, InviteLinks, Rsvps, __EFMigrationsHistory

-- EventTypes is seeded with 9 rows.
SELECT * FROM EventTypes ORDER BY Id;
-- 1 Seminar 🎓
-- 2 Meeting 📅
-- ...etc.

-- Auth0Id has a unique index.
SELECT name, is_unique FROM sys.indexes WHERE object_id = OBJECT_ID('Users');

-- The filtered unique index on Rsvps has a filter clause.
SELECT i.name, i.has_filter, i.filter_definition
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('Rsvps') AND i.has_filter = 1;
-- → [GuestEmail] IS NOT NULL
```

---

## 8. Smoke-test from the running API

Start the API (`dotnet run` from `server/EventSync.Api/`) and add a temporary endpoint that exercises the DbContext:

```csharp
// Add temporarily inside Program.cs, just before app.Run():
app.MapGet("/debug/event-types", async (AppDbContext db) =>
    await db.EventTypes.OrderBy(t => t.Id).ToListAsync())
  .AllowAnonymous();
```

Hit `http://localhost:5000/debug/event-types` — you should get the 9 seeded rows. The middleware pipeline + DI + DbContext + query filter + everything is alive.

**Remove the temporary endpoint after testing.**

---

## Checkpoint

You've passed this phase when:

1. `dotnet build` (in `server/EventSync.Api/`) succeeds with zero errors.
2. `dotnet ef migrations add InitialCreate` produced files in `server/EventSync.Api/Migrations/` (one with a timestamp prefix).
3. `dotnet ef database update` ran without error.
4. `(localdb)\MSSQLLocalDB` has the `EventSync` database with 6 tables (5 entities + `__EFMigrationsHistory`).
5. `SELECT * FROM EventTypes` returns 9 rows with emojis in the `Icon` column.
6. The `Auth0Id` column on `Users` and the `Token` column on `InviteLinks` have unique indexes.
7. The `Rsvps` table has a filtered unique index on `(GuestEmail, EventId)`.
8. The temporary `/debug/event-types` endpoint returned all 9 event types — then you deleted it.

---

Next: [04-foundations-frontend.md](./04-foundations-frontend.md) — Angular app shell: `app.config.ts`, routing skeleton, Auth0 guard / interceptor, error interceptor, toast service, layout components, Tailwind verification, and an Auth0 tenant walkthrough.
