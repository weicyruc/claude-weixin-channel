#!/usr/bin/env bash
# install.sh — Install claude-weixin-channel as a local Claude Code plugin
set -e

PLUGIN_ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── 1. Find claude binary ─────────────────────────────────────────────────────
find_claude() {
  if command -v claude &>/dev/null; then
    command -v claude; return
  fi
  # macOS: Claude native app (try all installed versions, newest first)
  local p
  for p in $(ls -dt "$HOME/Library/Application Support/Claude/claude-code/"*/claude 2>/dev/null); do
    [ -x "$p" ] && echo "$p" && return
  done
  # Linux: common locations
  for p in "$HOME/.local/bin/claude" "/usr/local/bin/claude" "/usr/bin/claude"; do
    [ -x "$p" ] && echo "$p" && return
  done
  echo ""
}

CLAUDE="$(find_claude)"
if [ -z "$CLAUDE" ]; then
  echo "Error: claude CLI not found. Make sure Claude Code is installed." >&2
  exit 1
fi

# ── 2. Check bun ─────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "Error: bun is not installed. Install it from https://bun.sh" >&2
  exit 1
fi

# ── 3. Install dependencies ───────────────────────────────────────────────────
echo "Installing dependencies..."
bun install --cwd "$PLUGIN_ROOT" --silent

# ── 4. Install plugin via claude CLI ─────────────────────────────────────────
# Strategy:
# - Temporarily write a marketplace.json that points plugin source to the
#   local .git directory (file:// URL), so the plugin is installed from the
#   local clone rather than fetching from GitHub.
# - Add $PLUGIN_ROOT as a permanent marketplace (stored as "directory" source
#   in settings, so the marketplace entry survives even after this script).
# - Install the plugin.
# - Restore marketplace.json to the canonical GitHub-URL version.
#
# The marketplace must stay registered because removing it also removes the
# plugin. Future `claude plugin update weixin` will re-read the restored
# marketplace.json and pull from GitHub.
echo "Registering plugin..."

MKTPLACE_JSON="$PLUGIN_ROOT/.claude-plugin/marketplace.json"
MKTPLACE_BAK="$PLUGIN_ROOT/.claude-plugin/marketplace.json.bak"

# Back up the canonical marketplace.json (GitHub URL version)
cp "$MKTPLACE_JSON" "$MKTPLACE_BAK"

# Write a local-install version (file:// URL → installs from local .git)
cat > "$MKTPLACE_JSON" << EOF
{
  "\$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "weicyruc-plugins",
  "description": "Claude Code plugins by weicyruc",
  "owner": {"name": "weicyruc"},
  "plugins": [{
    "name": "weixin",
    "description": "WeChat channel for Claude Code — connect WeChat direct messages to Claude with built-in access control.",
    "category": "productivity",
    "source": {"source": "url", "url": "file://$PLUGIN_ROOT/.git"},
    "homepage": "https://github.com/weicyruc/claude-weixin-channel"
  }]
}
EOF

# Ensure marketplace.json is restored on exit (even on error)
restore_marketplace() {
  mv -f "$MKTPLACE_BAK" "$MKTPLACE_JSON" 2>/dev/null || true
}
trap restore_marketplace EXIT

# Remove any leftover weicyruc-plugins marketplace/plugin
"$CLAUDE" plugin uninstall weixin@weicyruc-plugins 2>/dev/null || true
"$CLAUDE" plugin marketplace remove weicyruc-plugins 2>/dev/null || true

# Add the project directory as a permanent marketplace
"$CLAUDE" plugin marketplace add "$PLUGIN_ROOT" --scope user

# Install the plugin (reads local file:// source from marketplace.json)
"$CLAUDE" plugin install weixin@weicyruc-plugins --scope user

# trap restores marketplace.json to the GitHub-URL version on exit

echo ""
echo "Done! Restart Claude Code, then run /weixin:configure to log in."
