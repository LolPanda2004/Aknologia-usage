# Prebuilt agents

Background agents for each platform, built from `agent/` with the default server `http://localhost:8080`.
Point them at your server on first run (the address is remembered):

    ./aknologia-agent-darwin-arm64 -server https://your-service.onrender.com

For production, build with your server built in: `SERVER_URL=https://… ./scripts/build-desktop.sh`
(that also builds the desktop window). These binaries are unsigned.
