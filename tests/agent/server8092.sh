#!/bin/sh
# start|stop the private QA server on :8092 (own DB on :55432)
R=/c/Users/Admin/Downloads/aknologia-usage/aknologia
case "$1" in
start)
  cd "$R/backend"
  PORT=8092 DEV_MODE=true SYNC_MINUTE=${SYNC_MINUTE:-17} DATABASE_URL='postgres://postgres:postgres@localhost:55432/aknologia?sslmode=disable' \
    nohup "$R/tests/agent/.bin/akn-server.exe" >> "$R/tests/agent/.server-8092.log" 2>&1 &
  for i in $(seq 1 40); do curl -sf http://localhost:8092/api/v1/health >/dev/null && echo up && exit 0; sleep 0.5; done; echo notup; exit 1;;
stop)
  powershell -NoProfile -File "$R/tests/agent/stop8092.ps1"; echo stopped;;
esac
