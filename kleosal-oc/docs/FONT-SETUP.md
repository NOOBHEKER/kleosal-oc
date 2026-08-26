# FONT SETUP — JetBrainsMono Nerd Font Mono

This guide explains how to install the **JetBrainsMono NFM** font for use in the opencode CLI (classic Windows console / conhost).

## Option A: Automatic install (recommended for Windows)

1. Download JetBrainsMono Nerd Font from the official source:
   - https://github.com/JetBrains/JetBrainsMono/releases
   - Look for `JetBrainsMono-2.304.zip` (or newer) under "Nerd Font" assets

2. Extract the zip and install all `.ttf` files (right-click → Install for all users, or double-click each).

3. Set the font in conhost:
   - Open a command prompt
   - Right-click title bar → Properties → Font tab
   - Select **JetBrainsMono NFM** (or "JetBrains Mono" if NFM isn't listed)
   - Click OK

4. Restart your console window for changes to take effect.

## Option B: Manual registry (advanced)

If the font doesn't appear in the dropdown, you may need to whitelist it in the console TrueType font list:

```powershell
# Run as Administrator
New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Console\TrueTypeFont" -Name "000" -Value "JetBrainsMono NFM" -PropertyType String -Force
```

Then set it as default via `HKCU\Console`:
```powershell
Set-ItemProperty -Path "HKCU:\Console" -Name "FaceName" -Value "JetBrainsMono NFM"
```

## Verification

Open a new console window and run:
```bash
opencode
```
The font should now be monospaced with proper glyph rendering (icons, ligatures).

## Notes

- This font is **optional** — opencode works fine with the default console font.
- The font is installed per-user by default. "Install for all users" requires admin.
- If the font name shows as "JetBrains Mono" (without "NFM"), use that name in the registry steps instead.
- No system files are modified by this step beyond font registration and console settings.
