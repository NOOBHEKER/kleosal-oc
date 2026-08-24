# TROUBLESHOOTING

Common issues and fixes for the kleosal-oc collection.

## Plugins not loading

**Symptom:** `opencode debug plugins` shows no plugins, or errors on startup.

**Fix:**
1. Ensure dependencies are installed:
   ```bash
   cd ~/.config/opencode/plugins
   npm install @opencode-ai/plugin
   ```
2. Verify the plugin SDK version matches your opencode version:
   ```bash
   opencode --version
   npm ls @opencode-ai/plugin
   ```
3. Check for syntax errors in your plugin files:
   ```bash
   node --check plugins/attribution.js
   node --check plugins/env-protection.js
   node --check plugins/notifications.js
   ```

## Font not showing in conhost

**Symptom:** JetBrainsMono NFM doesn't appear in the console font dropdown.

**Fix:**
1. Reinstall the font (see `docs/FONT-SETUP.md`).
2. Whitelist it in the registry (admin required):
   ```powershell
   New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Console\TrueTypeFont" -Name "000" -Value "JetBrainsMono NFM" -PropertyType String -Force
   ```
3. Restart your console window.

## MCP servers timeout

**Symptom:** `context7` or `gh_grep` commands hang or fail.

**Fix:**
1. Check your network connection (MCP servers are remote).
2. Verify the URLs in `opencode.jsonc`:
   ```jsonc
   "mcp": {
     "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" },
     "gh_grep": { "type": "remote", "url": "https://mcp.grep.app" }
   }
   ```
3. Test connectivity:
   ```bash
   curl https://mcp.context7.com/mcp
   ```

## Model not responding

**Symptom:** `opencode/mimo-v2.5-free` returns errors or "unauthorized".

**Fix:**
1. Run `/connect` and sign in to opencode Zen (free).
2. Verify your `opencode.jsonc` has the correct model name.
3. Try an alternative free model (see `docs/MODEL-SETUP.md`).

## Notifications not appearing

**Symptom:** No desktop message when a session ends.

**Fix:**
- On Windows: ensure `notifications.js` is present and PowerShell is available.
- On macOS/Linux: this plugin is Windows-only and will silently do nothing. Delete `notifications.js` if unwanted.
- The notification only fires on `session.idle` (when the agent finishes its turn).

## Attribution line appearing

**Symptom:** A line `~ kleosal-oc by agastyas shii` appears when opencode starts.

**Info:** This is the run-time watermark from `attribution.js`. To remove it, delete `plugins/attribution.js`. The watermark is part of the MIT-licensed collection and does not affect functionality.

## General tips

- Always back up your `~/.config/opencode/` folder before making changes.
- Use `opencode debug config` to verify your config loads without errors.
- If something breaks, delete the new files and restore from backup.
