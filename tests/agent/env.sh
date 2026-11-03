# Source for an isolated agent environment (subagent 2). AKN_SUB selects data subfolder.
W=C:/Users/Admin/Downloads/aknologia-usage/aknologia/tests/.sandbox/agent2
export AKN_DATA_DIR="$W/${AKN_SUB:-data}"
export HOME="$W/${AKN_HOME:-home}" USERPROFILE="$W/${AKN_HOME:-home}"
export APPDATA="$HOME/AppData/Roaming" LOCALAPPDATA="$HOME/AppData/Local"
export CLAUDE_CONFIG_DIR="$HOME/.claude" CODEX_HOME="$HOME/.codex"
export AKN_LISTEN=127.0.0.1:47812 AKN_SERVER=http://localhost:8092
AG=C:/Users/Admin/Downloads/aknologia-usage/aknologia/tests/bin/aknologia-agent.exe
