# kleosal-oc

A collection of opencode CLI improvements: custom agents, commands, rules, skills, plugins, themes, and config — all organized by topic and safe to install.

**Created by agastyas shii** · [github.com/agastyas-shii](https://github.com/agastyas-shii)

---

## One-command install

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/NOOBHEKER/kleosal-oc/main/install.ps1 | iex
```

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/NOOBHEKER/kleosal-oc/main/install.sh | bash
```

The installer backs up your existing config, copies the pack, and keeps your
`opencode.jsonc` / `tui.json` (the pack versions are saved as reference copies).
Restart opencode afterwards.

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
| **Cover art** | `plugins/cover-art/` | Full-screen theme rain, readable wordmark, `/art` picker, optional MCP |
| **Theme** | `themes/lavender-dark.json` | Dark lavender color scheme |
| **Docs** | `docs/` | Setup guides for font, plugins, model, troubleshooting |

---

## Cover art

![Cover art preview](previews/cover-art.gif)

<sub>Still preview: [cover-art-full.png](previews/cover-art-full.png)</sub>

The home screen gets a full-screen, theme-adaptive digital rain while the real
`opencode` wordmark stays readable. Rain is cut out around the wordmark, prompt,
tab bar, footer, and scrollbar, so nothing ever sits behind text. Only the home
screen changes; conversations are untouched.

| Preset | Look |
| --- | --- |
| `matrix` | Full-screen rain + readable tinted wordmark (default) |
| `matrix-wordmark` | Same rain, with a slow breathing wordmark |
| `wordmark` | Ghost wordmark only, with a slow shimmer |

- `/art` switches presets, wordmark and rain faintness, full-screen or left-panel
  layout, and custom frames.
- Config lives in `~/.config/opencode/cover-art.json`; zero npm dependencies.
- Optional MCP tools let agents change presets and options.

Details: [`plugins/cover-art/README.md`](plugins/cover-art/README.md).

---

## Quick start

Prefer the one-command install above. The manual steps below copy the pack files
over your existing setup, so back up `~/.config/opencode/` first.

### 1. Copy config files

```bash
# Windows (PowerShell)
Copy-Item "config\*" "$env:USERPROFILE\.config\opencode\" -Recurse
Copy-Item "agents\*" "$env:USERPROFILE\.config\opencode\agents\" -Recurse
Copy-Item "commands\*" "$env:USERPROFILE\.config\opencode\commands\" -Recurse
Copy-Item "rules\*" "$env:USERPROFILE\.config\opencode\rules\" -Recurse
Copy-Item "skills\*" "$env:USERPROFILE\.config\opencode\skills\" -Recurse
Copy-Item "themes\*" "$env:USERPROFILE\.config\opencode\themes\" -Recurse
Copy-Item "plugins\*" "$env:USERPROFILE\.config\opencode\plugins\" -Recurse

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
