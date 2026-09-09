#!/usr/bin/env bash
set -euo pipefail

# AgentOS launchd installer for macOS.
# Creates a LaunchAgent so the server auto-starts after reboot and restarts
# if it crashes.

# Resolve the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Project root (parent of scripts/)
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

LABEL="com.agentos.server"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

echo "=== AgentOS launchd installer ==="

# --- Detect Node ---
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  # Common paths
  for c in "$HOME/.local/bin/node" "$HOME/.nvm/versions/node"/*/bin/node /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
    if [[ -x "$c" ]]; then
      NODE_BIN="$c"
      break
    fi
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: Could not detect Node.js. Install Node >= 20." >&2
  exit 1
fi
# If nvm dir, expand the glob
if [[ "$NODE_BIN" == *"versions/node"* ]]; then
  NODE_BIN="$(echo "$NODE_BIN" | head -1)"
fi
echo "  Node: $NODE_BIN"

# --- Detect OpenCode ---
OC_BIN="$(command -v opencode || true)"
if [[ -z "$OC_BIN" ]]; then
  for c in "$HOME/.opencode/bin/opencode" "$HOME/.local/bin/opencode" /usr/local/bin/opencode /opt/homebrew/bin/opencode; do
    if [[ -x "$c" ]]; then
      OC_BIN="$c"
      break
    fi
  done
fi
if [[ -z "$OC_BIN" ]]; then
  echo "WARNING: opencode not found in PATH. AgentOS will still run but tasks won't execute until OpenCode is configured." >&2
  OC_BIN="opencode"
fi
echo "  OpenCode: $OC_BIN"

# --- Server executable ---
SERVER_ENTRY="$ROOT_DIR/server/dist/index.js"
if [[ ! -f "$SERVER_ENTRY" ]]; then
  echo "ERROR: Server build not found at $SERVER_ENTRY. Run 'npm run build' first." >&2
  exit 1
fi

# --- Determine data dir ---
DATA_DIR="${AGENTOS_DATA_DIR:-$HOME/.agentos}"

# --- Create LaunchAgents dir ---
mkdir -p "$HOME/Library/LaunchAgents"

# --- Write plist ---
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${SERVER_ENTRY}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENTOS_DATA_DIR</key>
    <string>${DATA_DIR}</string>
    <key>AGENTOS_OPENCODE_PATH</key>
    <string>${OC_BIN}</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${DATA_DIR}/launchd-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/launchd-stderr.log</string>
</dict>
</plist>
EOF

chmod 644 "$PLIST"
echo "  Plist written: $PLIST"

# --- Load the agent ---
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "  launchd agent loaded."

echo
echo "AgentOS will now start automatically at login/reboot and restart if it crashes."
echo "View logs: $DATA_DIR/launchd-stdout.log (and -stderr.log)"
echo "Stop service: scripts/uninstall-launchd.sh"
