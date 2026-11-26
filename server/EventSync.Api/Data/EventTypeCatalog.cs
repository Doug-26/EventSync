using EventSync.Api.Data.Entities;

namespace EventSync.Api.Data;

/// <summary>
/// The fixed set of event types. It is the single source for both the <c>HasData</c> seed in
/// <see cref="AppDbContext"/> and the read paths, which serve it from memory so listing or
/// validating a type never needs a SQL round trip (or wakes the serverless database).
/// </summary>
/// <remarks>
/// Ids are stable so migrations stay deterministic. Adding or changing a type means editing
/// this list <b>and</b> adding a migration. Do not attach these instances to a
/// <see cref="Microsoft.EntityFrameworkCore.DbContext"/>; they are shared, read-only data.
/// </remarks>
public static class EventTypeCatalog
{
    /// <summary>All event types, in Id order.</summary>
    public static IReadOnlyList<EventType> All { get; } =
    [
        new() { Id = 1, Name = "Seminar", Icon = "📖" },          // 📖 Open Book
        new() { Id = 2, Name = "Meeting", Icon = "📅" },          // 📅 Calendar
        new() { Id = 3, Name = "Gathering", Icon = "🤝" },        // 🤝 Handshake
        new() { Id = 4, Name = "Wedding Anniversary", Icon = "💍" }, // 💍 Ring
        new() { Id = 5, Name = "Birthday", Icon = "🎂" },         // 🎂 Birthday Cake
        new() { Id = 6, Name = "Workshop", Icon = "🛠️" },   // 🛠️ Hammer and Wrench
        new() { Id = 7, Name = "Conference", Icon = "🏢" },       // 🏢 Office Building
        new() { Id = 8, Name = "Other", Icon = "✨" },                  // ✨ Sparkles
        new() { Id = 9, Name = "Church Events", Icon = "⛪" },       // ⛪ Church
        new() { Id = 10, Name = "Swimming Vacation", Icon = "🏖️" }, // 🏖️ Beach with Umbrella
        new() { Id = 11, Name = "Family Reunion", Icon = "👨‍👩‍👧‍👦" }, // 👨‍👩‍👧‍👦 Family
    ];

    private static readonly Dictionary<int, EventType> ById = All.ToDictionary(t => t.Id);

    /// <summary>Looks up an event type by Id.</summary>
    /// <param name="id">The event type Id.</param>
    /// <returns>The event type, or <c>null</c> when no type has that Id.</returns>
    public static EventType? Find(int id) => ById.GetValueOrDefault(id);
}
