param([string]$Exe, [string]$Args1 = "-scan-once")
$p = Start-Process -FilePath $Exe -ArgumentList $Args1 -NoNewWindow -PassThru -RedirectStandardOutput "$env:AKN_DATA_DIR.out.txt"
$peak = 0; $sw = [Diagnostics.Stopwatch]::StartNew()
while (-not $p.HasExited) { try { $p.Refresh(); if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 } } catch {}; Start-Sleep -Milliseconds 50 }
$sw.Stop()
"elapsed_s=$([math]::Round($sw.Elapsed.TotalSeconds,2)) peak_ws_MB=$([math]::Round($peak/1MB,1))"
Get-Content "$env:AKN_DATA_DIR.out.txt"
