<#
.SYNOPSIS
  Deploy the checked-out branch on the Windows box (spec §2). Replaces the macOS
  `npm run build && launchctl kickstart ...` step.
.DESCRIPTION
  Refuses to restart while an attended session the server spawned is alive, or a user_chrome
  run is running (restarting pm2 would kill the claude child it launched). -Force skips the guard.
  Steps: git pull --ff-only -> npm ci -> npm run build -> pm2 restart sortie -> wait for the API.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\deploy.ps1
  powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\deploy.ps1 -Force
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$Base = "http://127.0.0.1:3000"
)
$ErrorActionPreference = "Stop"
Set-Location $Root

function Get-Json($url) {
  try { return Invoke-RestMethod -Uri $url -TimeoutSec 5 } catch { return $null }
}

if (-not $Force) {
  $attended = Get-Json "$Base/api/executor/dispatch"
  $status = Get-Json "$Base/api/executor/status"
  $spawnAlive = [bool]($attended -and $attended.spawn -and $attended.spawn.alive)
  $running = @()
  if ($status -and $status.runs) {
    $running = @($status.runs | Where-Object { $_.channel -eq "user_chrome" -and $_.status -eq "running" })
  }
  if ($spawnAlive -or $running.Count -gt 0) {
    Write-Host "Refusing to deploy: attended work in progress (spawned session alive: $spawnAlive; running user_chrome runs: $($running.Count))." -ForegroundColor Yellow
    Write-Host "Wait for it to finish, or re-run with -Force." -ForegroundColor Yellow
    exit 2
  }
}

Write-Host "==> git pull --ff-only"
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull failed" }

Write-Host "==> npm ci"
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

Write-Host "==> npm run build"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed - server NOT restarted. .next may be partially overwritten: fix the build and re-run." }

Write-Host "==> pm2 restart sortie"
pm2 restart sortie --update-env
if ($LASTEXITCODE -ne 0) { throw "pm2 restart failed (is the app registered? pm2 start ops\windows\ecosystem.config.cjs --only sortie)" }

$deadline = (Get-Date).AddSeconds(60)
$ok = $null
do {
  Start-Sleep -Seconds 2
  $ok = Get-Json "$Base/api/executor/status"
} until ($ok -or (Get-Date) -gt $deadline)
if (-not $ok) { throw "server did not answer on $Base within 60s - check: pm2 logs sortie" }

$sha = git rev-parse --short HEAD
$subject = git log -1 --pretty=%s
Write-Host "==> deployed $sha : $subject" -ForegroundColor Green
