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