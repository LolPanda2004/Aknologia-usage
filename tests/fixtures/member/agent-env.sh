# Source this to get an isolated agent environment (never touches the real ~/.claude, ~/.codex, %AppData%).
R=/c/Users/Admin/Downloads/aknologia-usage/aknologia/tests/.sandbox/member
W=C:/Users/Admin/Downloads/aknologia-usage/aknologia/tests/.sandbox/member
SUB=${AKN_SUB:-data}
export AKN_DATA_DIR="$W/$SUB"
export HOME="$W/home" USERPROFILE="$W/home" APPDATA="$W/home/AppData/Roaming" LOCALAPPDATA="$W/home/AppData/Local"
export CLAUDE_CONFIG_DIR="$W/home/.claude" CODEX_HOME="$W/home/.codex"
export AKN_LISTEN=127.0.0.1:47811
