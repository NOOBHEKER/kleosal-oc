---
description: kleosal-oc setup guide — WSL, Starship.rs, and environment configuration
---

# kleosal-oc Setup Guide

## WSL Setup (from Drew_the_AI_Guy)

If using WSL for opencode or Linux tools:

### Set WSL home to your Windows user folder
Edit `/etc/wsl.conf` in WSL:
```ini
[automount]
options = "metadata"
```

### Install Homebrew
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Install gcc (build tools)
```bash
sudo apt install build-essential
```

---

## Starship.rs Shell Prompt

Cross-platform shell prompt with git status, directory info, and more.

### Install

**Windows (scoop — no admin needed):**
```powershell
scoop install starship
```

**Windows (winget):**
```powershell
winget install Starship.Starship
```

**Linux/Mac:**
```bash
curl -sS https://starship.rs/install.sh | sh
```

### Add to shell

**PowerShell** — add to `$PROFILE`:
```powershell
Invoke-Expression (&starship init powershell)
```

**CMD** — add auto-run:
```reg
reg add "HKCU\Software\Microsoft\Command Processor" /v AutoRun /t REG_SZ /d "starship init cmd | invoke-expression" /f
```

### Config
- Config file: `~/.config/starship.toml`
- Docs: https://starship.rs

---

## Token-Saving Plugin (OpenSlimedit)

Already included in `opencode.jsonc`:
```json
"plugin": ["openslimedit@latest"]
```

Saves 11-45% tokens by compressing tool descriptions and compacting read output. Zero config — auto-installs on restart.

---

## Paste Workaround (Windows Terminal)

Windows Terminal intercepts Ctrl+V before opencode can handle it.

**Fix:** Use the `/paste` command instead:
1. Copy text anywhere (Ctrl+C)
2. Type `/paste` in opencode
3. Clipboard text is sent as your message

Command file: `commands/paste.md`
