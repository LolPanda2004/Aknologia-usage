# Stops only the agent listening on 127.0.0.1:47812 (ours)
Get-NetTCPConnection -State Listen -LocalPort 47812 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force; "killed $($_.OwningProcess)" }
