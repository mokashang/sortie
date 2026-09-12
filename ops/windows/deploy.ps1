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
  # $PSScriptRoot can be empty when the script is launched through a nested `powershell -File` (seen 2026-09-11).
  [string]$Root = $(if ($PSScriptRoot) { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) } else { Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }),
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

$before = git rev-parse HEAD
Write-Host "==> git pull --ff-only"
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull failed" }

# `npm ci` wipes node_modules first. On Windows that fails with EPERM while the server is running,
# because the native modules it has loaded (better-sqlite3, next-swc, node-pty) are locked files -
# and by then half of node_modules is already gone (2026-09-11). So: only reinstall when the
# lockfile actually changed (or node_modules is missing), and stop the server first so the locks
# are released. A deploy that does not touch dependencies keeps the old server up until the build
# has succeeded.
git diff --quiet $before HEAD -- package-lock.json
$lockChanged = ($LASTEXITCODE -ne 0)
$needInstall = $lockChanged -or -not (Test-Path (Join-Path $Root "node_modules/next/package.json"))
$stopped = $false
if ($needInstall) {
  Write-Host "==> dependencies changed (or node_modules missing): pm2 stop sortie, then npm ci"
  pm2 stop sortie | Out-Null
  $stopped = $true
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed - server is STOPPED. Fix the install (re-run npm ci), then: pm2 restart sortie --update-env" }
} else {
  Write-Host "==> package-lock.json unchanged since $($before.Substring(0,7)): skipping npm ci"
}

Write-Host "==> npm run build"
npm run build
if ($LASTEXITCODE -ne 0) {
  if ($stopped) { throw "build failed - server is STOPPED (dependencies were reinstalled). Fix the build, then: pm2 restart sortie --update-env" }
  throw "build failed - server NOT restarted. .next may be partially overwritten: fix the build and re-run."
}

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
