<#
.SYNOPSIS
  Brings the pm2 app `sortie` up when it is not running. The "Sortie Server" task runs this at logon and
  every 10 minutes after that (setup.ps1 step 1), hidden through run-hidden.js.
.DESCRIPTION
  It acts only when the app is missing (no pm2 daemon - a fresh boot - or the app not registered) or
  errored (pm2 gave up after max_restarts): it starts it from ecosystem.config.cjs, or restarts it, and
  waits until it answers. Everything else is left alone on purpose:
    - online / launching: `pm2 start <ecosystem>` restarts an app that is already up (with updateEnv),
      so the task's old action, pm2.cmd itself, could never be repeated;
    - stopped: deploy.ps1 stops it around `npm ci` and vacuum-db wants it stopped. `pm2 stop sortie`
      keeps it down; `pm2 kill` or `pm2 delete sortie` does not (it is back within 10 minutes).
  The old action also put a console window on the desktop, and closing it during a boot (LastTaskResult
  0xC000013A) left the server down from 2026-10-25 to 11-02: two boots, no daemon.
  Exit 0 = nothing to do, or it answers; 1 = started but not answering within -ReadySec (run-hidden.js
  retries); 2 = pm2 itself failed. Only actions and failures go to data\server-start.log; a failure also
  pushes an ntfy notification to NTFY_TOPIC from .env, at most once every 6 hours.
  -App / -Ecosystem / -Url / -NtfyServer exist for testing against a throwaway pm2 app.
#>
param(
  [string]$App = "sortie",
  [string]$Ecosystem,
  [string]$Url = "http://127.0.0.1:3000/login",
  [int]$ReadySec = 180,
  [string]$Pm2 = (Join-Path $env:APPDATA "npm\pm2.cmd"),
  [string]$NtfyServer = "https://ntfy.sh"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $Ecosystem) { $Ecosystem = Join-Path $PSScriptRoot "ecosystem.config.cjs" }
$dataDir = Join-Path $Root "data"
$logFile = Join-Path $dataDir "server-start.log"
$alertFile = Join-Path $dataDir "server-start-alert.txt"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

function Write-Log([string]$msg) {
  Add-Content -Path $logFile -Value ("{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $App, $msg) -Encoding UTF8
}

# No stderr redirection on pm2 anywhere: in Windows PowerShell 5.1 with ErrorActionPreference=Stop, a
# redirected stderr line from a native program is a terminating error.
function Get-AppStatus {
  # On a fresh boot this spawns the pm2 daemon, with the task's environment (never a Claude shell's).
  $out = & $Pm2 jlist
  if ($LASTEXITCODE -ne 0) { throw "pm2 jlist exited $LASTEXITCODE" }
  # The list is the last line; "[PM2] Spawning PM2 daemon ..." lines come first when it starts one.
  $json = @($out | Where-Object { $_ -match '^\s*\[\s*(\{|\])' }) | Select-Object -Last 1
  if (-not $json) { throw "pm2 jlist printed no process list" }
  # Not ConvertFrom-Json: every app's env holds both USERNAME and username, which 5.1 rejects as a duplicate.
  Add-Type -AssemblyName System.Web.Extensions
  $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $ser.MaxJsonLength = [int]::MaxValue
  foreach ($p in @($ser.DeserializeObject($json))) {
    if ($p["name"] -eq $App) { return [string]$p["pm2_env"]["status"] }
  }
  return "missing"
}

# Any HTTP answer counts (as in deploy.ps1): the first request may run a schema migration first.
function Test-Answers {
  try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 | Out-Null; return $true }
  catch { return [bool]$_.Exception.Response }
}

function Send-Alert([string]$body) {
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path $envFile)) { return }
  $m = Get-Content -Path $envFile -Encoding UTF8 | Select-String '^\s*NTFY_TOPIC\s*=\s*"?([A-Za-z0-9_-]{1,64})"?\s*$' | Select-Object -First 1
  if (-not $m) { return }
  if ((Test-Path $alertFile) -and ((Get-Date) - (Get-Item $alertFile).LastWriteTime) -lt (New-TimeSpan -Hours 6)) { return }
  try {
    Invoke-RestMethod -Method Post -Uri "$NtfyServer/$($m.Matches[0].Groups[1].Value)" -TimeoutSec 15 `
      -Headers @{ Title = "Sortie server is down"; Priority = "high" } -ContentType "text/plain; charset=utf-8" `
      -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
    Set-Content -Path $alertFile -Value (Get-Date -Format o)
  } catch {
    Write-Log "ntfy push failed: $($_.Exception.Message)"
  }
}

try {
  $status = Get-AppStatus
} catch {
  Write-Log "pm2 not usable: $($_.Exception.Message)"
  Send-Alert "pm2 does not answer on $env:COMPUTERNAME ($($_.Exception.Message)). See $logFile."
  exit 2
}

if ($status -eq "missing") {
  & $Pm2 start $Ecosystem --only $App | Out-Null
} elseif ($status -eq "errored") {
  & $Pm2 restart $App | Out-Null
} else {
  exit 0
}
if ($LASTEXITCODE -ne 0) {
  Write-Log "was $status; pm2 exited $LASTEXITCODE while starting it"
  Send-Alert "pm2 could not start $App on $env:COMPUTERNAME (it was $status). See $logFile."
  exit 2
}
Write-Log "was $status - started, waiting for $Url"

$deadline = (Get-Date).AddSeconds($ReadySec)
do {
  Start-Sleep -Seconds 3
  $up = Test-Answers
} until ($up -or (Get-Date) -gt $deadline)
if ($up) {
  Write-Log "answers"
  exit 0
}
Write-Log "no answer from $Url after $ReadySec s"
Send-Alert "$App was $status and still does not answer $Url $ReadySec s after a start on $env:COMPUTERNAME. Check pm2 status and data\pm2-err.log."
exit 1
