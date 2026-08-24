# Plugins

This folder contains three opencode plugins. They require the `@opencode-ai/plugin` SDK to be installed.

## What each plugin does

| Plugin | Purpose | Platform |
|--------|---------|----------|
| `attribution.js` | Prints a subtle attribution line when opencode starts (run-time watermark) | Any |
| `env-protection.js` | Blocks opencode from reading `.env` files (secrets protection) | Any |
| `notifications.js` | Shows a Windows MessageBox when a session goes idle | Windows only |

## Setup

1. Install dependencies (run from the `plugins/` folder or your opencode config root):
   ```bash
   npm install @opencode-ai/plugin
   ```

2. Verify the plugins load:
   ```bash
   opencode debug plugins
   ```
   You should see `attribution`, `env-protection`, and `notifications` listed.

## Disabling a plugin

If you don't want a plugin, simply delete the `.js` file from this folder. opencode only loads plugins present in the `plugins/` directory.

- To disable notifications on non-Windows systems: delete `notifications.js`
- To disable attribution watermark: delete `attribution.js`
- To disable .env protection: delete `env-protection.js`

## Notes

- The `notifications.js` plugin uses PowerShell + `System.Windows.Forms.MessageBox`. On non-Windows systems it will silently fail (the error is caught). If you're on Linux/macOS, delete this file to avoid noise.
- Plugins are loaded automatically from `~/.config/opencode/plugins/`.
- No plugin will delete or modify your files — they only hook into opencode events for safety/UX.
