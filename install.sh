#!/usr/bin/env bash
# kleosal-oc installer — macOS / Linux / Git Bash
# Usage: curl -fsSL https://raw.githubusercontent.com/NOOBHEKER/kleosal-oc/main/install.sh | bash
set -euo pipefail

REPO="NOOBHEKER/kleosal-oc"
BRANCH="${KLEOSAL_BRANCH:-main}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf '%s\n' "$*"; }

say "Kleosal OC installer"
say ""

if [ -n "${KLEOSAL_SRC:-}" ]; then
  SRC="${KLEOSAL_SRC%/}"
  say "Using local source: $SRC"
else
  command -v curl >/dev/null 2>&1 || { say "curl is required."; exit 1; }
  command -v tar >/dev/null 2>&1 || { say "tar is required."; exit 1; }
  say "Downloading $REPO ($BRANCH)..."
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz -C "$TMP"
  SRC="$TMP/kleosal-oc-$BRANCH/kleosal-oc"
fi

[ -d "$SRC/config" ] || { say "Source does not look like the kleosal-oc pack: $SRC"; exit 1; }

mkdir -p "$CONFIG_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$CONFIG_DIR/.kleosal-backup-$STAMP"
mkdir -p "$BACKUP"
for item in config agents commands rules skills themes plugins opencode.jsonc tui.json; do
  if [ -e "$CONFIG_DIR/$item" ]; then
    mkdir -p "$BACKUP/$(dirname "$item")"
    cp -R "$CONFIG_DIR/$item" "$BACKUP/$item"
  fi
done
say "Backup: $BACKUP"

mkdir -p "$CONFIG_DIR/config"
if [ -f "$CONFIG_DIR/opencode.jsonc" ]; then
  cp "$SRC/config/opencode.jsonc" "$CONFIG_DIR/config/opencode.kleosal.jsonc"
  say "Kept your opencode.jsonc; pack reference saved to config/opencode.kleosal.jsonc"
else
  cp "$SRC/config/opencode.jsonc" "$CONFIG_DIR/opencode.jsonc"
  say "Installed config/opencode.jsonc"
fi

if [ -f "$SRC/config/tui.json" ]; then
  if [ -f "$CONFIG_DIR/tui.json" ]; then
    cp "$SRC/config/tui.json" "$CONFIG_DIR/config/tui.kleosal.json"
    say "Kept your tui.json; pack reference saved to config/tui.kleosal.json"
  else
    cp "$SRC/config/tui.json" "$CONFIG_DIR/tui.json"
  fi
fi

for dir in agents commands rules skills themes plugins; do
  mkdir -p "$CONFIG_DIR/$dir"
  cp -R "$SRC/$dir/." "$CONFIG_DIR/$dir/"
done

if [ -z "${KLEOSAL_SKIP_NPM:-}" ] && command -v npm >/dev/null 2>&1; then
  say "Installing plugin SDK..."
  ( cd "$CONFIG_DIR" && npm install --silent @opencode-ai/plugin >/dev/null 2>&1 ) \
    || say "npm install @opencode-ai/plugin failed; run it manually in $CONFIG_DIR."
fi

SERVER="$CONFIG_DIR/plugins/cover-art/mcp/server.mjs"
say ""
say "Installed. Restart OpenCode, then try:"
say "  /art      cover art presets, faintness, layout"
say "  /goal     persistent goal tracking"
say "  /review   structured code review"
say ""
say "Optional cover-art MCP entry for opencode.jsonc:"
say "  \"mcp\": { \"servers\": { \"coverart\": { \"type\": \"local\", \"command\": [\"node\", \"$SERVER\"] } } }"
