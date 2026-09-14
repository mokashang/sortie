# Inner half of run-hidden.js (read the comment there first). Started hidden by that script; starts the
# program with a hidden console, waits, and exits with the program's exit code. Two more duties:
#   - every 250 ms it checks that its parent (the task's wscript.exe) is still alive: Stop-ScheduledTask
#     ends only that process, so without this Caddy would outlive the task, keep port 443 and make the
#     next start fail;
#   - -Retries N / -RetryDelaySec S restart the program when it exits non-zero (Caddy cannot bind the
#     Tailscale IP while the adapter is still coming up after a reboot). Task Scheduler's own
#     "restart on failure" setting never fires for a non-zero exit code (checked 2026-09-14), so the
#     retry has to live here. The task is stopped by the user -> no retry, exit code 0.
param(
  [int]$Retries = 0,
  [int]$RetryDelaySec = 60,
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$ProgramArgs
)
$ErrorActionPreference = "Stop"

$parentId = (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId
$parent = [System.Diagnostics.Process]::GetProcessById($parentId)   # throws if it is already gone

# Start-Process joins the list with spaces and does not quote elements containing spaces (PowerShell 5.1).
$quoted = @($ProgramArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } })
$startArgs = @{ FilePath = $Exe; WindowStyle = "Hidden"; PassThru = $true; WorkingDirectory = (Get-Location).Path }
if ($quoted.Count -gt 0) { $startArgs.ArgumentList = ($quoted -join " ") }

# Sleeps in 250 ms steps so a stopped task is noticed during a retry delay too.
function Wait-UnlessParentGone([int]$ms) {
  $until = (Get-Date).AddMilliseconds($ms)
  while ((Get-Date) -lt $until) {
    if ($parent.HasExited) { return $false }
    Start-Sleep -Milliseconds 250
  }
  return $true
}

$attempt = 0
while ($true) {
  $child = Start-Process @startArgs
  while (-not $child.WaitForExit(250)) {
    if ($parent.HasExited) {
      try { $child.Kill() } catch {}
      exit 0
    }
  }
  $code = $child.ExitCode
  if ($code -eq 0 -or $attempt -ge $Retries) { exit $code }
  $attempt++
  if (-not (Wait-UnlessParentGone ($RetryDelaySec * 1000))) { exit 0 }
}
