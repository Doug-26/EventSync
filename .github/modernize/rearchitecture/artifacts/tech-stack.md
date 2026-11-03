# EventSync technology stack

- Frontend: Angular 21, TypeScript, RxJS, Auth0 Angular SDK, Tailwind CSS 4, standalone components/signals.
- Backend: .NET 10, ASP.NET Core Minimal APIs, EF Core 10 SQL Server provider, MediatR 14, FluentValidation 12, Auth0 JWT bearer, Swashbuckle/OpenAPI, QRCoder.
- Data: SQL Server-compatible database with code-first EF migrations. Entities are User, Event, EventType, InviteLink, and Rsvp.
- Runtime configuration: `AllowedOrigins`, `Auth0`, `ConnectionStrings:DefaultConnection`, `Frontend:BaseUrl`, and security-header settings.
- Deployment: Azure App Service Linux Free tier, Azure Static Web Apps, Azure SQL Free offer. GitHub Actions uses .NET 10 and Node 22.
- Relevant live constraint: CORS is an explicit configuration allowlist in `Program.cs`; it is not inferred from the Static Web Apps host.
