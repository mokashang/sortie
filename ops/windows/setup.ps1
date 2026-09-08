#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-time (and safely repeatable) Windows box setup for Sortie (spec §2): logon tasks, the daily
  backup task, Defender exclusions, power settings and, with -WithCaddy, the tailnet-only firewall rule.
.DESCRIPTION
  Every step replaces what it created before, so re-running is fine. This script never asks for
  or stores a password: automatic logon is configured by you with Sysinternals Autologon.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\setup.ps1
  powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\setup.ps1 -WithCaddy -CaddyExe C:\caddy\caddy.exe
#>
[CmdletBinding()]
param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$User = "$env:USERDOMAIN\$env:USERNAME",
  [switch]$WithCaddy,
  [string]$CaddyExe = "C:\caddy\caddy.exe",
  [switch]$SkipPower
)
$ErrorActionPreference = "Stop"

function Resolve-Cmd($name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $c) { throw "$name not found on PATH - install it first (see ops\windows\README.md)" }
  return $c.Source
}

$pm2 = Resolve-Cmd "pm2.cmd"
$npm = Resolve-Cmd "npm.cmd"
$ecosystem = Join-Path $Root "ops\windows\ecosystem.config.cjs"
$chromeCmd = Join-Path $Root "ops\windows\start-chrome.cmd"
$caddyfile = Join-Path $Root "ops\windows\Caddyfile"
$envFile = Join-Path $Root ".env"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data") | Out-Null

# Everything runs inside the interactive desktop session of $User: that is where Chrome and the
# attended claude sessions live. Never "run whether user is logged on or not" (that is session 0).
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$longRunning = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$oneShot = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

function Register-SortieTask($name, $action, $trigger, $settings) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  Write-Host "[task] $name registered"
}

function New-LogonTrigger($delaySeconds) {
  $t = New-ScheduledTaskTrigger -AtLogOn -User $User
  $t.Delay = "PT${delaySeconds}S"
  return $t
}

# 1. Server: pm2 brings up `sortie` from the ecosystem file (an already-running app is left alone).
Register-SortieTask "Sortie Server" `
  (New-ScheduledTaskAction -Execute $pm2 -Argument "start `"$ecosystem`" --only sortie" -WorkingDirectory $Root) `
  (New-LogonTrigger 20) $longRunning

# 2. Chrome with the job-hunting profile, so the Claude in Chrome extension is connected.
Register-SortieTask "Sortie Chrome" `
  (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$chromeCmd`"" -WorkingDirectory $Root) `
  (New-LogonTrigger 30) $oneShot

# 3. Daily online backup at 04:00 local (scripts/backup-db.ts via `npm run backup`).
Register-SortieTask "Sortie Backup" `
  (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"cd /d `"$Root`" && `"$npm`" run backup >> data\backup.log 2>&1`"" -WorkingDirectory $Root) `
  (New-ScheduledTaskTrigger -Daily -At 4:00AM) $oneShot

# 4. Caddy (phase 2, custom domain) — only with -WithCaddy.
if ($WithCaddy) {
  if (-not (Test-Path $CaddyExe)) { throw "Caddy not found at $CaddyExe (download a build with the cloudflare DNS module - see README)" }
  Register-SortieTask "Sortie Caddy" `
    (New-ScheduledTaskAction -Execute $CaddyExe -Argument "run --config `"$caddyfile`" --envfile `"$envFile`"" -WorkingDirectory $Root) `
    (New-LogonTrigger 25) $longRunning
  Remove-NetFirewallRule -DisplayName "Sortie Caddy (tailnet only)" -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "Sortie Caddy (tailnet only)" -Direction Inbound -Action Allow `
    -Program $CaddyExe -Protocol TCP -LocalPort 443 -RemoteAddress 100.64.0.0/10 -Profile Any | Out-Null
  Write-Host "[firewall] inbound 443 to caddy.exe allowed from 100.64.0.0/10 only"
} else {
  Unregister-ScheduledTask -TaskName "Sortie Caddy" -Confirm:$false -ErrorAction SilentlyContinue
}

# 5. Defender: keep real-time scanning off the database and node_modules (file locks + speed).
Add-MpPreference -ExclusionPath (Join-Path $Root "data"), (Join-Path $Root "node_modules")
Write-Host "[defender] excluded $Root\data and $Root\node_modules"

# 6. Power: an always-on box. The monitor may sleep; the machine may not.
if (-not $SkipPower) {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  powercfg /change monitor-timeout-ac 15
  powercfg /hibernate off
  powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
  powercfg /setactive SCHEME_CURRENT
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" -Name HiberbootEnabled -Value 0 -Type DWord
  Write-Host "[power] never sleep on AC; hibernate and fast startup off; lid close does nothing"
}

Write-Host ""
Write-Host "Done. Remaining manual steps (details in ops\windows\README.md):" -ForegroundColor Green
Write-Host "  1. Autologon (Sysinternals) so the desktop session exists after every reboot."
Write-Host "  2. First start now:  pm2 start `"$ecosystem`" --only sortie ; pm2 save"
Write-Host "  3. tailscale serve --bg 3000   (phase 1 URL: https://<machine>.<tailnet>.ts.net)"
Write-Host "  4. Set PROFILE= in ops\windows\start-chrome.cmd to the job-hunting Chrome profile folder."
