<#
Runs the Angular frontend: installs dependencies and starts the dev server.

Usage:
  .\run-frontend.ps1
#>

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
$clientDir = Join-Path $repoRoot 'client'

Write-Host "Client directory: $clientDir"

Set-Location $clientDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'Node.js not found. Install Node.js (LTS) from https://nodejs.org/'
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error 'npm not found. Install Node.js to get npm.'
    exit 1
}

Write-Host "node version: $(node --version)"
Write-Host "npm version: $(npm --version)"

Write-Host 'Installing npm packages (this may take a few minutes)...'
npm install

Write-Host 'Starting Angular dev server (npm start)...'
npm start
