using System.Security.Claims;
using EventSync.Api.Common.Services;
using EventSync.Api.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EventSync.Api.Tests;

/// <summary>
/// Covers <see cref="CurrentUserService.GetCurrentUserIdAsync"/>: first-call provisioning
/// and serving later calls from the in-memory cache without touching the database.
/// </summary>
public sealed class CurrentUserServiceTests
{
    private static CurrentUserService CreateService(AppDbContext db, IMemoryCache cache, string auth0Id)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", auth0Id), new Claim("email", "someone@test.local")],
            authenticationType: "Test"));
        var accessor = new HttpContextAccessor { HttpContext = new DefaultHttpContext { User = principal } };
        return new CurrentUserService(accessor, db, cache);
    }

    [Fact]
    public async Task GetCurrentUserIdAsync_provisions_user_on_first_call()
    {
        await using var db = TestData.CreateContext();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var service = CreateService(db, cache, "auth0|new-user");

        var id = await service.GetCurrentUserIdAsync();

        var stored = await db.Users.SingleAsync(u => u.Auth0Id == "auth0|new-user");
        Assert.Equal(stored.Id, id);
    }

    [Fact]
    public async Task GetCurrentUserIdAsync_serves_repeat_calls_from_cache()
    {
        await using var db = TestData.CreateContext();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var first = await CreateService(db, cache, "auth0|cached").GetCurrentUserIdAsync();

        // Remove the row: a second lookup that hit the DB would re-provision a NEW id.
        db.Users.RemoveRange(db.Users);
        await db.SaveChangesAsync();

        // A new scoped service instance (as on the next request) sharing the singleton cache.
        var second = await CreateService(db, cache, "auth0|cached").GetCurrentUserIdAsync();

        Assert.Equal(first, second);
        Assert.Empty(db.Users);
    }

    [Fact]
    public async Task GetCurrentUserIdAsync_throws_when_unauthenticated()
    {
        await using var db = TestData.CreateContext();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var accessor = new HttpContextAccessor { HttpContext = new DefaultHttpContext() };
        var service = new CurrentUserService(accessor, db, cache);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.GetCurrentUserIdAsync());
    }
}
