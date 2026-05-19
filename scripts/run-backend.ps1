<#
Runs the backend: restores packages, applies EF migrations, and runs the API.

Usage:
  .\run-backend.ps1          # restore, migrate, run
  .\run-backend.ps1 -SkipMigrations  # restore + run without applying migrations
#>

Param(
    [switch]$SkipMigrations
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
$apiDir = Join-Path $repoRoot 'server\EventSync.Api'

Write-Host "Repository root: $repoRoot"
Write-Host "API directory: $apiDir"

Set-Location $apiDir

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    Write-Error 'dotnet CLI not found. Install .NET 10 SDK: https://dotnet.microsoft.com/download/dotnet/10.0'
    exit 1
}

Write-Host "dotnet version: $(dotnet --version)"

Write-Host 'Restoring NuGet packages...'
dotnet restore

# Ensure dotnet-ef is available
$efAvailable = $false
try {
    dotnet ef --version > $null 2>&1
    $efAvailable = $true
} catch {
    $efAvailable = $false
}

if (-not $efAvailable) {
    Write-Host 'dotnet-ef not found; installing global tool (may require PATH refresh)...'
    dotnet tool install --global dotnet-ef
}

if (-not $SkipMigrations) {
    Write-Host 'Applying EF Core migrations...'
    dotnet ef database update
} else {
    Write-Host 'Skipping migrations (requested).'
}

Write-Host 'Starting API (dotnet run)...'
dotnet run
