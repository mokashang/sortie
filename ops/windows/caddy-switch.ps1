<#
.SYNOPSIS
  Phase 2 (custom domain): hand port 443 from Tailscale Serve to Caddy, with pre-flight checks and
  automatic rollback. Run it as the normal (non-elevated) desktop user; it asks for UAC once.
.DESCRIPTION
  Reads SORTIE_DOMAIN / TS_HOSTNAME / TS_IP / CF_API_TOKEN from the repo's .env (the file the
  "Sortie Caddy" task loads with --envfile). Steps:
    1. Pre-flight, read-only: the four keys are set; caddy.exe has dns.providers.cloudflare;
       `caddy validate` passes; the domain's public A record (asked at 1.1.1.1) equals TS_IP.
    2. setup.ps1 -WithCaddy, elevated (one UAC prompt): registers the "Sortie Caddy" logon task and
       the tailnet-only firewall rules. Nothing is started yet, nothing is switched yet.
    3. tailscale serve off (frees 443), then Start-ScheduledTask "Sortie Caddy".
    4. Poll https://<SORTIE_DOMAIN>/api/settings and https://<TS_HOSTNAME>/api/settings until they
       answer 200 with a valid certificate (first issuance takes ~30-90 s) or -TimeoutSec passes.
    5. If the custom domain does not come up: stop + disable the task, `tailscale serve --bg 3000`,
       show the tail of data\caddy.log. The old URL is back within seconds.
  -Check runs step 1 only. -Rollback runs step 5 on its own.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File E:\sortie\ops\windows\caddy-switch.ps1 -Check
  powershell -ExecutionPolicy Bypass -File E:\sortie\ops\windows\caddy-switch.ps1
  powershell -ExecutionPolicy Bypass -File E:\sortie\ops\windows\caddy-switch.ps1 -Rollback
#>
[CmdletBinding()]
param(
  [string]$Root,
  [string]$EnvFile = "",
  [string]$CaddyExe = "C:\caddy\caddy.exe",
  [int]$TimeoutSec = 180,
  [switch]$Check,
  [switch]$Rollback
)
$ErrorActionPreference = "Stop"
trap { Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red; exit 1 }
if (-not $Root) {
  # Resolved in the body: with [CmdletBinding()] $PSScriptRoot / $PSCommandPath are EMPTY inside param() defaults
  # when the script runs via `powershell -File` (same fix as deploy.ps1, 2026-09-13).
  $scriptPath = $PSCommandPath
  if (-not $scriptPath) { $scriptPath = $MyInvocation.MyCommand.Path }
  if (-not $scriptPath) {
    $cl = [Environment]::GetCommandLineArgs()
    for ($i = 0; $i -lt $cl.Length - 1; $i++) { if ($cl[$i] -ieq "-File" -or $cl[$i] -ieq "-f") { $scriptPath = $cl[$i + 1]; break } }
  }
  if (-not $scriptPath) { throw "cannot locate this script (no PSCommandPath and no -File on the command line); pass -Root <repo>" }
  $Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent ((Resolve-Path -LiteralPath $scriptPath).Path)))
}
$TaskName = "Sortie Caddy"
if (-not $EnvFile) { $EnvFile = Join-Path $Root ".env" }
$Caddyfile = Join-Path $Root "ops\windows\Caddyfile"
$SetupPs1 = Join-Path $Root "ops\windows\setup.ps1"
$ProcessLog = Join-Path $Root "data\caddy.log"
Set-Location $Root

function Read-EnvFile($path) {
  if (-not (Test-Path $path)) { throw ".env not found: $path" }
  $dq = [char]34; $sq = [char]39
  $map = @{}
  # -Encoding UTF8: the default (ANSI, GBK on this box) mangles the UTF-8 comments and can swallow the newline after one.
  foreach ($line in Get-Content -Path $path -Encoding UTF8) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim()
    if ($v.Length -ge 2 -and (($v[0] -eq $dq -and $v[-1] -eq $dq) -or ($v[0] -eq $sq -and $v[-1] -eq $sq))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    $map[$k] = $v
  }
  return $map
}

function Test-Url($url) {
  # curl.exe ships with Windows 10+. Exit 0 and 200 = certificate verified against the system roots and the app answered.
  $code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 10 $url
  return ($LASTEXITCODE -eq 0 -and "$code" -eq "200")
}

function Show-CaddyLog {
  if (Test-Path $ProcessLog) {
    Write-Host "---- last 20 lines of $ProcessLog ----" -ForegroundColor Yellow
    Get-Content $ProcessLog -Tail 20
  }
}

function Invoke-Rollback($why) {
  Write-Host "ROLLBACK: $why" -ForegroundColor Yellow
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
  Start-Sleep -Seconds 2
  Get-Process -Name caddy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  & tailscale serve --bg 3000
  if ($LASTEXITCODE -ne 0) { Write-Host "tailscale serve --bg 3000 FAILED - run it by hand" -ForegroundColor Red }
  else { Write-Host "Tailscale Serve is back on 443; task '$TaskName' stopped and disabled." -ForegroundColor Green }
  Show-CaddyLog
}

if ($Rollback) { Invoke-Rollback "requested with -Rollback"; exit 0 }

# ---- 1. pre-flight (read-only) ----
$envMap = Read-EnvFile $EnvFile
$missing = @("SORTIE_DOMAIN", "TS_HOSTNAME", "TS_IP", "CF_API_TOKEN") | Where-Object { -not $envMap[$_] }
if ($missing.Count -gt 0) { throw "missing in ${EnvFile}: $($missing -join ', ') (see ops\windows\README.md section 8)" }
$domain = $envMap["SORTIE_DOMAIN"]; $tsHost = $envMap["TS_HOSTNAME"]; $tsIp = $envMap["TS_IP"]
Write-Host "domain     : $domain"
Write-Host "ts name    : $tsHost"
Write-Host "ts ip      : $tsIp"

if (-not (Test-Path $CaddyExe)) { throw "caddy not found at $CaddyExe (README section 8)" }
$mods = @(& $CaddyExe list-modules)
if (-not ($mods -match "^dns\.providers\.cloudflare$")) { throw "$CaddyExe lacks dns.providers.cloudflare - download the build with that plugin (README section 8)" }
Write-Host "caddy      : $(& $CaddyExe version) + dns.providers.cloudflare"
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw "curl.exe not found (it ships with Windows 10+ in System32)" }

& $CaddyExe validate --config $Caddyfile --envfile $EnvFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Caddyfile did not validate (see the message above)" }
Write-Host "caddyfile  : valid"

$answers = @()
try {
  $answers = @(Resolve-DnsName -Name $domain -Type A -Server 1.1.1.1 -DnsOnly -ErrorAction Stop | Where-Object { $_.Type -eq "A" } | ForEach-Object { $_.IPAddress })
} catch { }
if ($answers -contains $tsIp) { Write-Host "dns        : $domain -> $tsIp (public A record OK)" }
else { throw "public A record for $domain is [$($answers -join ', ')], expected $tsIp. Add or fix it in Cloudflare (Proxy status OFF / grey cloud), then wait a few minutes" }

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) { Write-Host "task       : registered ($($task.State))" } else { Write-Host "task       : not registered yet" }
Write-Host "serve      : $(@(& tailscale serve status)[0])"
if ($Check) { Write-Host "Pre-flight OK. Run again without -Check to switch." -ForegroundColor Green; exit 0 }

# ---- 2. register the task + firewall rules (elevated; nothing started, nothing switched) ----
Write-Host "==> setup.ps1 -WithCaddy (accept the UAC prompt)"
$p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$SetupPs1`"", "-Root", "`"$Root`"", "-WithCaddy", "-CaddyExe", "`"$CaddyExe`"", "-SkipPower")
if ($null -ne $p.ExitCode -and $p.ExitCode -ne 0) { throw "setup.ps1 -WithCaddy failed (exit code $($p.ExitCode)); nothing was switched" }
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { throw "task '$TaskName' is not registered after setup.ps1 (UAC declined?); nothing was switched" }

# ---- 3. hand 443 over ----
Write-Host "==> tailscale serve off"
& tailscale serve off
if ($LASTEXITCODE -ne 0) { throw "tailscale serve off failed; nothing was switched" }
Start-Sleep -Seconds 2

# ---- 4. start Caddy and wait for the names; any error from here on rolls back to Tailscale Serve ----
$okDomain = $false; $okTs = $false
try {
  Write-Host "==> Start-ScheduledTask '$TaskName'"
  Start-ScheduledTask -TaskName $TaskName
  $start = Get-Date
  $deadline = $start.AddSeconds($TimeoutSec)
  $mark = { param($ok) if ($ok) { "[ok]" } else { "[..]" } }
  while ($true) {
    Start-Sleep -Seconds 5
    if (-not $okDomain) { $okDomain = Test-Url "https://$domain/api/settings" }
    if (-not $okTs) { $okTs = Test-Url "https://$tsHost/api/settings" }
    Write-Host ("  {0}  {1} https://{2}   {3} https://{4}" -f (Get-Date).ToString("HH:mm:ss"), (& $mark $okDomain), $domain, (& $mark $okTs), $tsHost)
    if ($okDomain -and $okTs) { break }
    if ((Get-Date) -gt $deadline) { break }
    $state = (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State
    if ($state -ne "Running" -and (Get-Date) -gt $start.AddSeconds(20)) { Write-Host "task state is '$state'" -ForegroundColor Yellow; break }
  }
} catch {
  Invoke-Rollback "error after the hand-over: $($_.Exception.Message)"
  exit 1
}

if ($okDomain) {
  Write-Host "SWITCHED: https://$domain is served by Caddy on ${tsIp}:443" -ForegroundColor Green
  if ($okTs) { Write-Host "          https://$tsHost keeps working (certificate from tailscaled)" -ForegroundColor Green }
  else { Write-Host "          https://$tsHost did not answer yet - check $ProcessLog; the custom domain itself is fine" -ForegroundColor Yellow }
  Write-Host "Now open https://$domain from the Mac and the phone (Tailscale on)."
  Write-Host "Logs: $ProcessLog (process, certificates) and data\caddy-access.log (requests); status: Get-ScheduledTaskInfo '$TaskName'"
  exit 0
}
Invoke-Rollback "https://$domain did not answer within $TimeoutSec s"
exit 1
