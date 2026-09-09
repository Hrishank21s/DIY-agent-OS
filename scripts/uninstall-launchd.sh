#!/usr/bin/env bash
set -euo pipefail

LABEL="com.agentos.server"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "AgentOS launchd service unloaded and plist removed."
else
  echo "No AgentOS launchd plist found at $PLIST."
fi
