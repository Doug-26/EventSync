using EventSync.Api.Data;
using EventSync.Api.Features.EventTypes.GetEventTypes;
using Microsoft.EntityFrameworkCore;

namespace EventSync.Api.Tests;

/// <summary>
/// Guards the in-memory <see cref="EventTypeCatalog"/>: the API serves it instead of
/// querying the table, so it must stay identical to what the model seeds.
/// </summary>
public sealed class EventTypeCatalogTests
{
    [Fact]
    public async Task Seeded_event_types_match_the_catalog()
    {
        await using var db = TestData.CreateContext();
        await db.Database.EnsureCreatedAsync(); // applies HasData seed

        var seeded = await db.EventTypes.OrderBy(t => t.Id)
            .Select(t => new { t.Id, t.Name, t.Icon })
            .ToListAsync();
        var catalog = EventTypeCatalog.All.OrderBy(t => t.Id)
            .Select(t => new { t.Id, t.Name, t.Icon })
            .ToList();

        Assert.Equal(11, catalog.Count);
        Assert.Equal(catalog, seeded);
    }

    [Fact]
    public async Task GetEventTypes_returns_all_types_sorted_by_name_without_a_database()
    {
        var result = await new GetEventTypesHandler().Handle(new GetEventTypesQuery(), CancellationToken.None);

        Assert.Equal(EventTypeCatalog.All.Count, result.Count);
        Assert.Equal(result.Select(t => t.Name).Order(StringComparer.OrdinalIgnoreCase), result.Select(t => t.Name));
    }

    [Fact]
    public void Find_returns_null_for_unknown_id()
    {
        Assert.NotNull(EventTypeCatalog.Find(1));
        Assert.Null(EventTypeCatalog.Find(999));
    }
}
