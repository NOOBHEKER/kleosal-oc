# PLUGIN SETUP

The plugins in this repo require the opencode plugin SDK to be installed.

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

3. Copy the plugin files from this repo's `plugins/` folder into your config's `plugins/` folder:
   ```bash
   # Windows (PowerShell)
   Copy-Item "path\to\github-opencode\plugins\*.js" "$env:USERPROFILE\.config\opencode\plugins\"

   # macOS / Linux
   cp path/to/github-opencode/plugins/*.js ~/.config/opencode/plugins/
   ```

4. Verify plugins are loaded:
   ```bash
   opencode debug plugins
   ```

## Platform-specific notes

| Plugin | Windows | macOS | Linux |
|--------|---------|-------|-------|
| `attribution.js` | ✅ | ✅ | ✅ |
| `env-protection.js` | ✅ | ✅ | ✅ |
| `notifications.js` | ✅ (MessageBox) | ⚠️ Silent fail | ⚠️ Silent fail |

The `notifications.js` plugin uses Windows-only APIs. On macOS/Linux it will silently do nothing (errors are caught). If you prefer, delete `notifications.js` on non-Windows systems.

## Removing plugins

Simply delete the `.js` file from your config's `plugins/` folder. opencode only loads what's present.

## Safety

- Plugins do **not** delete, modify, or move your files.
- `env-protection.js` only blocks `.env` reads (a safety feature).
- `notifications.js` only pops a desktop message when a session ends.
- `attribution.js` only prints a line when opencode starts.
- All plugin behavior is opt-in: remove the file to disable.
