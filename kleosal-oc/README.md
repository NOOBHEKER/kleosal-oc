# kleosal-oc

A collection of opencode CLI improvements: custom agents, commands, rules, skills, plugins, themes, and config — all organized by topic and safe to install.

**Created by agastyas shii** · [github.com/agastyas-shii](https://github.com/agastyas-shii)

---

## What's included

| Category | Files | Description |
|----------|-------|-------------|
| **Config** | `config/opencode.jsonc`, `config/tui.json` | Main config: free vision model, MCP servers, formatter, keybinds, theme |
| **Agents** | `agents/deep-search.md`, `agents/web-results.md` | Research agents (web + codebase, analytical web) |
| **Commands** | `commands/goal.md` | Persistent goal tracking (`/goal`) |
| **Rules** | `rules/AGENTS.md` | Global behavior rules for all agents |
| **Skills** | `skills/git-release/`, `skills/code-review/` | Release notes + structured code review |
| **Plugins** | `plugins/` | Attribution watermark, .env protection, desktop notifications |
| **Theme** | `themes/lavender-dark.json` | Dark lavender color scheme |
| **Docs** | `docs/` | Setup guides for font, plugins, model, troubleshooting |

---

## Quick start

### 1. Copy config files

```bash
# Windows (PowerShell)
Copy-Item "config\*" "$env:USERPROFILE\.config\opencode\"
Copy-Item "agents\*" "$env:USERPROFILE\.config\opencode\agents\"
Copy-Item "commands\*" "$env:USERPROFILE\.config\opencode\commands\"
Copy-Item "rules\*" "$env:USERPROFILE\.config\opencode\rules\"
Copy-Item "skills\*" "$env:USERPROFILE\.config\opencode\skills\"
Copy-Item "themes\*" "$env:USERPROFILE\.config\opencode\themes\"
Copy-Item "plugins\*" "$env:USERPROFILE\.config\opencode\plugins\"

# macOS / Linux
cp -r config/* ~/.config/opencode/
cp -r agents/* ~/.config/opencode/agents/
cp -r commands/* ~/.config/opencode/commands/
cp -r rules/* ~/.config/opencode/rules/
cp -r skills/* ~/.config/opencode/skills/
cp -r themes/* ~/.config/opencode/themes/
cp -r plugins/* ~/.config/opencode/plugins/
```

### 2. Install plugin dependencies

```bash
cd ~/.config/opencode/plugins
npm install @opencode-ai/plugin
```

### 3. Sign in for the free model

```bash
opencode
/connect   # select opencode (Zen), sign in at opencode.ai/auth (free)
```

### 4. Verify

```bash
opencode debug config
opencode debug plugins
```

---

## Per-topic setup

Each topic has its own folder and documentation. Read only what you need:

- **Font** → `docs/FONT-SETUP.md`
- **Plugins** → `docs/PLUGIN-SETUP.md` (or `plugins/README.md`)
- **Model** → `docs/MODEL-SETUP.md`
- **Troubleshooting** → `docs/TROUBLESHOOTING.md`

---

## Safety

- No system files are deleted or modified by this collection.
- Plugins only hook into opencode events (safety/UX) — they don't touch your files.
- All config is opt-in: remove any file you don't want.
- Back up your existing `~/.config/opencode/` before installing.

---

## License

MIT — see [LICENSE](LICENSE). Attribution watermark is included as a courtesy; removing it does not void the license, but we ask you keep it when redistributing.

---

~ agastyas shii · github.com/agastyas-shii
