#!/usr/bin/env bash
# install.sh — Register claude-weixin-channel as a local Claude Code plugin
set -e

PLUGIN_ROOT="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_JSON="$HOME/.claude.json"
PLUGINS_JSON="$HOME/.claude/plugins/installed_plugins.json"

# ── 1. Check bun ────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "Error: bun is not installed. Install it from https://bun.sh" >&2
  exit 1
fi

# ── 2. Install dependencies ──────────────────────────────────────────────────
echo "Installing dependencies..."
bun install --cwd "$PLUGIN_ROOT" --silent

# ── 3. Register MCP server in ~/.claude.json ─────────────────────────────────
if [ ! -f "$CLAUDE_JSON" ]; then
  echo '{"mcpServers":{}}' > "$CLAUDE_JSON"
fi

BUN_PATH="$(command -v bun)"

python3 - <<PYEOF
import json, sys

path = "$CLAUDE_JSON"
with open(path) as f:
    d = json.load(f)

d.setdefault("mcpServers", {})["weixin"] = {
    "type": "stdio",
    "command": "$BUN_PATH",
    "args": ["run", "--cwd", "$PLUGIN_ROOT", "--silent", "start"],
    "env": {"CLAUDE_PLUGIN_ROOT": "$PLUGIN_ROOT"}
}

with open(path, "w") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print("  ✓ MCP server registered in ~/.claude.json")
PYEOF

# ── 4. Register plugin in installed_plugins.json (for skills) ────────────────
mkdir -p "$HOME/.claude/plugins"
if [ ! -f "$PLUGINS_JSON" ]; then
  echo '{"version":2,"plugins":{}}' > "$PLUGINS_JSON"
fi

NOW="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

python3 - <<PYEOF
import json

path = "$PLUGINS_JSON"
with open(path) as f:
    d = json.load(f)

d.setdefault("plugins", {})["weixin@local"] = [{
    "scope": "user",
    "installPath": "$PLUGIN_ROOT",
    "version": "1.0.0",
    "installedAt": "$NOW",
    "lastUpdated": "$NOW"
}]

with open(path, "w") as f:
    json.dump(d, f, indent=2)
print("  ✓ Plugin registered in ~/.claude/plugins/installed_plugins.json")
PYEOF

echo ""
echo "Done! Restart Claude Code, then run /weixin:configure to log in."
