# Real-data check: reads YOUR ~/.claude and ~/.codex session files and syncs usage numbers to a LOCAL
# server only. Uses its own data folder and port, and restores the start-at-login registry value at the end.
#   powershell -ExecutionPolicy Bypass -File tests\real-check.ps1 [-Server URL -Port N -Exe path -Sandbox name -Email e -Code c]
param(
  [string]$Server = 'http://localhost:8080',
  [int]$Port = 47813,
  [string]$Exe = 'tests\bin\akn-agent-real.exe',
  [string]$Sandbox = 'real',
  [string]$Email = 'me-mv26cxm1@example.test',
  [string]$Code = 'M2G4-AE7B'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "tests\.sandbox\$Sandbox"
$data = Join-Path $out 'data'
$exe = Join-Path $root $Exe
$base = "http://127.0.0.1:$Port/v1"
$invite = @{ email = $Email; code = $Code; password = 'Real-check-2026!x' }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$utf8 = New-Object Text.UTF8Encoding $false

New-Item -ItemType Directory -Force $data | Out-Null
$env:AKN_DATA_DIR = $data
$regBefore = (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).AknologiaUsage

Write-Host '1/5 Scanning your session files once...'
$sw = [Diagnostics.Stopwatch]::StartNew()
& $exe -scan-once -server $Server   # the first run fixes the agent's server URL
Write-Host ("    scan took {0:N1} s" -f $sw.Elapsed.TotalSeconds)

# Turn off start-at-login in this test data folder so the background run doesn't register itself.
$sp = Join-Path $data 'state.json'
if (Test-Path $sp) {
  $raw = [IO.File]::ReadAllText($sp)
  [IO.File]::WriteAllText($sp, ($raw -replace '"startAtLogin":\s*true', '"startAtLogin":false'), $utf8)
}

Write-Host "2/5 Starting the agent on 127.0.0.1:$Port..."
$p = Start-Process $exe -ArgumentList '-listen', "127.0.0.1:$Port", '-server', $Server -WindowStyle Hidden -PassThru
try {
  $tok = $null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try { $tok = ([IO.File]::ReadAllText((Join-Path $data 'agent.token'))).Trim(); Invoke-RestMethod "$base/status" -Headers @{ 'X-Agent-Token' = $tok } | Out-Null; break } catch { $tok = $null }
  }
  if (-not $tok) { throw "The agent did not start. See $data\agent.log" }
  $h = @{ 'X-Agent-Token' = $tok }

  Write-Host '3/5 Joining the local test workspace...'
  try { Invoke-RestMethod "$base/auth/accept-invite" -Method Post -Headers $h -ContentType 'application/json' -Body ($invite | ConvertTo-Json) | Out-Null }
  catch { Write-Host "    (accept-invite: $($_.Exception.Message) - fine if you already ran this once)" }

  Write-Host '4/5 Force sync...'
  $sw.Restart()
  try { Invoke-RestMethod "$base/sync" -Method Post -Headers $h -ContentType 'application/json' -Body '{}' -TimeoutSec 600 | Out-Null }
  catch { Write-Host "    sync: $($_.Exception.Message)" }
  # Sync runs in the background; wait until the queue is empty (max 10 minutes).
  for ($i = 0; $i -lt 600; $i++) {
    $st = Invoke-RestMethod "$base/status" -Headers $h
    if (-not $st.syncing -and $st.queued -eq 0) { break }
    if ($st.lastError) { Write-Host "    sync error: $($st.lastError)"; break }
    Start-Sleep -Seconds 1
  }
  Write-Host ("    queued after sync: {0}" -f $st.queued)
  Write-Host ("    sync took {0:N1} s" -f $sw.Elapsed.TotalSeconds)

  Write-Host "5/5 Saving results to $out ..."
  $status = Invoke-RestMethod "$base/status" -Headers $h
  [IO.File]::WriteAllText((Join-Path $out 'status.json'), ($status | ConvertTo-Json -Depth 20), $utf8)
  foreach ($d in 1, 7, 30, 400) {
    $s = Invoke-RestMethod "$base/summary?days=$d" -Headers $h
    [IO.File]::WriteAllText((Join-Path $out "summary-$d.json"), ($s | ConvertTo-Json -Depth 20), $utf8)
  }
  Write-Host 'Done.'
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  $regAfter = (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).AknologiaUsage
  if ($regAfter -ne $regBefore) {
    if ($null -eq $regBefore) { Remove-ItemProperty $runKey -Name AknologiaUsage -ErrorAction SilentlyContinue }
    else { Set-ItemProperty $runKey -Name AknologiaUsage -Value $regBefore }
    Write-Host '    start-at-login registry value restored'
  }
}
