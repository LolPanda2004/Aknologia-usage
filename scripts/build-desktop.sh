#!/usr/bin/env bash
# Builds the desktop app (Wails window + background agent) for the current OS and packages it into
# landing/download/ so the server's /download/ page offers it.
#   SERVER_URL=https://usage.yourco.com ./scripts/build-desktop.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SERVER_URL="${SERVER_URL:-http://localhost:8080}"
VERSION="${VERSION:-1.0.0}"
LDFLAGS="-s -w -X main.defaultServer=${SERVER_URL} -X main.version=${VERSION}"
OUT=dist; mkdir -p "$OUT" landing/download

echo "→ building the window (Wails)"
( cd desktop && go mod tidy && wails build -clean -trimpath )

case "$(uname -s)" in
  Darwin)
    APP="desktop/build/bin/Aknologia Usage.app"
    ( cd agent && GOARCH=arm64 go build -trimpath -ldflags "$LDFLAGS" -o "../$OUT/agent-arm64" ./cmd/aknologia-agent \
      && GOARCH=amd64 go build -trimpath -ldflags "$LDFLAGS" -o "../$OUT/agent-amd64" ./cmd/aknologia-agent )
    lipo -create -output "$APP/Contents/MacOS/aknologia-agent" "$OUT/agent-arm64" "$OUT/agent-amd64"
    ( cd desktop/build/bin && ditto -c -k --keepParent "Aknologia Usage.app" ../../../landing/download/aknologia-usage-macos.zip )
    ;;
  Linux)
    ( cd agent && go build -trimpath -ldflags "$LDFLAGS" -o ../desktop/build/bin/aknologia-agent ./cmd/aknologia-agent )
    tar -C desktop/build/bin -czf landing/download/aknologia-usage-linux.tar.gz .
    ;;
  MINGW*|MSYS*|CYGWIN*)
    ( cd agent && go build -trimpath -ldflags "$LDFLAGS -H=windowsgui" -o ../desktop/build/bin/aknologia-agent.exe ./cmd/aknologia-agent )
    ( cd desktop/build/bin && powershell -Command "Compress-Archive -Force -Path * -DestinationPath ../../../landing/download/aknologia-usage-windows.zip" )
    ;;
esac
echo "✓ packaged into landing/download/ (served at \$PUBLIC_URL/download/)"
