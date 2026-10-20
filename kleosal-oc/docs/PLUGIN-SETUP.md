# PLUGIN SETUP

The pack's server-side `.js` plugins require the opencode plugin SDK. The
`cover-art/` TUI plugin has **no npm dependencies**; it only needs OpenCode 2.x.

## Prerequisites

- **Node.js 18+** installed (check with `node --version`)
- **npm** available (bundled with Node.js)
- opencode CLI installed and on your PATH

## Installation

1. Navigate to your opencode config plugins folder:
   ```bash
   # Windows
   cd %USERPROFILE%\.config\opencode\plugins

   # macOS / Linux
   cd ~/.config/opencode/plugins
   ```

2. Install the plugin SDK:
   ```bash
   npm install @opencode-ai/plugin
   ```

3. Copy the plugin files and folders from this repo's `plugins/` folder into your config's `plugins/` folder:
   ```bash
   # Windows (PowerShell)
   Copy-Item "path\to\github-opencode\plugins\*" "$env:USERPROFILE\.config\opencode\plugins\" -Recurse

   # macOS / Linux
   cp -r path/to/github-opencode/plugins/* ~/.config/opencode/plugins/
   ```

4. Verify plugins are loaded:
   ```bash
   opencode debug plugins
   ```

   Cover art is a TUI plugin, so it won't appear in that list. Restart opencode
   and run `/art` on the home screen.

## Cover art

`cover-art/` is a zero-dependency TUI plugin: a theme-adaptive digital rain for the
home screen with the real `opencode` wordmark left readable. It is masked around
the wordmark, prompt, tab bar, footer, and scrollbar, so text is never covered.

- `/art` switches presets, faintness, full-screen/left-panel layout, and custom frames.
- Config: `~/.config/opencode/cover-art.json`.
- Optional MCP tools: see [`../plugins/cover-art/README.md`](../plugins/cover-art/README.md).
- Full plugin docs: [`../plugins/cover-art/README.md`](../plugins/cover-art/README.md).

## Platform-specific notes

| Plugin | Windows | macOS | Linux |
|--------|---------|-------|-------|
| `attribution.js` | ✅ | ✅ | ✅ |
| `env-protection.js` | ✅ | ✅ | ✅ |
| `notifications.js` | ✅ (MessageBox) | ⚠️ Silent fail | ⚠️ Silent fail |
| `cover-art/` | ✅ | ✅ | ✅ |

The `notifications.js` plugin uses Windows-only APIs. On macOS/Linux it will silently do nothing (errors are caught). If you prefer, delete `notifications.js` on non-Windows systems.

## Removing plugins

Simply delete the `.js` file from your config's `plugins/` folder. opencode only loads what's present. To remove cover art, delete the `cover-art/` folder (or set `"enabled": false` in `cover-art.json`).

## Safety

- Plugins do **not** delete, modify, or move your files.
- `env-protection.js` only blocks `.env` reads (a safety feature).
- `notifications.js` only pops a desktop message when a session ends.
- `attribution.js` only prints a line when opencode starts.
- `cover-art/` only draws the home screen; prompt and conversation views are untouched.
- All plugin behavior is opt-in: remove the file/folder to disable.
