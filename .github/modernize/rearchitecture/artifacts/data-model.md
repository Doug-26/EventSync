# EventSync data model

The persisted model is relational and uses EF Core configurations/migrations.

- `User`: Auth0 subject, email, display name, avatar, timestamps, soft-delete; owns events.
- `Event`: organizer and event-type foreign keys, title/details/location, virtual-meeting fields, dates, capacity, cover image, cancellation and soft-delete state.
- `EventType`: seeded lookup with name/icon; one type has many events.
- `InviteLink`: event foreign key, opaque token, expiry/use limits, usage count, active state; one link has many RSVPs.
- `Rsvp`: event and optional invite-link foreign keys, guest details, status enum, timestamps, IP address.

Important existing behavior: events and users use global soft-delete filters; RSVP status numeric values are persisted; server-generated timestamps are UTC. No schema redesign is implied by this artifact.
