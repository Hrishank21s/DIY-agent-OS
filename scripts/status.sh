#!/usr/bin/env bash
set -euo pipefail

LABEL="com.agentos.server"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

echo "=== AgentOS status ==="

if [[ -f "$PLIST" ]]; then
  echo "launchd plist: INSTALLED ($PLIST)"
  if launchctl list | grep -q "$LABEL"; then
    echo "launchd service: LOADED"
  else
    echo "launchd service: NOT LOADED"
  fi
else
  echo "launchd plist: NOT INSTALLED"
fi

# Check process
PID="$(pgrep -f 'dist/index.js' | head -1 || true)"
if [[ -n "$PID" ]]; then
  echo "process: RUNNING (PID $PID)"
else
  echo "process: NOT RUNNING"
fi

# Check port
PORT="${AGENTOS_PORT:-3000}"
if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  echo "port $PORT: OPEN"
else
  echo "port $PORT: CLOSED"
fi
