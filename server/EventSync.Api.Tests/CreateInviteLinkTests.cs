using EventSync.Api.Common.Configuration;
using EventSync.Api.Common.Services;
using EventSync.Api.Features.InviteLinks.CreateInviteLink;
using FluentValidation;
using Microsoft.Extensions.Options;

namespace EventSync.Api.Tests;

/// <summary>
/// Tests for <see cref="CreateInviteLinkHandler"/>: past events get no new invite links.
/// </summary>
public sealed class CreateInviteLinkTests
{
    private static CreateInviteLinkHandler CreateHandler(
        EventSync.Api.Data.AppDbContext context, Guid eventId)
    {
        var organizer = context.Events.Single(e => e.Id == eventId).Organizer!;
        return new CreateInviteLinkHandler(
            new FakeCurrentUserService(organizer),
            context,
            new TokenGenerator(),
            Options.Create(new FrontendOptions { BaseUrl = "https://app.test" }));
    }

    private static CreateInviteLinkCommand Command(Guid eventId) => new(eventId, null, null);

    [Fact]
    public async Task UpcomingEvent_CreatesLink()
    {
        using var context = TestData.CreateContext();
        var (_, eventId) = TestData.SeedEvent(context, maxAttendees: null);

        var link = await CreateHandler(context, eventId).Handle(Command(eventId), CancellationToken.None);

        Assert.True(link.IsActive);
        Assert.Equal(2, context.InviteLinks.Count(l => l.EventId == eventId));
    }

    [Fact]
    public async Task PastEvent_IsRejected_AndCreatesNothing()
    {
        using var context = TestData.CreateContext();
        var (_, eventId) = TestData.SeedEvent(context, maxAttendees: null);
        context.Events.Single(e => e.Id == eventId).StartDate = DateTime.Now.AddHours(-1);
        context.SaveChanges();

        await Assert.ThrowsAsync<ValidationException>(
            () => CreateHandler(context, eventId).Handle(Command(eventId), CancellationToken.None));

        // Only the link TestData seeded remains.
        Assert.Equal(1, context.InviteLinks.Count(l => l.EventId == eventId));
    }
}
