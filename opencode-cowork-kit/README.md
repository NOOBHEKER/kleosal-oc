# opencode-cowork-kit

A free, Claude Cowork-style setup for [opencode](https://opencode.ai) on Windows:
on-demand screen sharing, auto-type into any window, cross-session memory,
step-by-step reasoning, web scraping, docs lookup, and code search. No paid
services required (Crawlbase key optional — everything else is keyless).

## What's inside

| Piece | What it does | Key? |
|---|---|---|
| `mcp/screenshot-server/` | Custom MCP: `capture_screen`, `capture_screen_to_file`, `type_text`, `press_key` (Python + `mss` + `pyautogui`) | No |
| `opencode.jsonc.example` | Full config: model + 6 MCPs (`context7`, `gh_grep`, `crawlbase`, `screenshot`, `memory`, `thinking`) | Crawlbase only |
| `plugins/clipboard-paste.js` | `paste_text` tool — reads Windows clipboard (image paste included) | No |
| `plugins/env-protection.js` | Blocks agents from reading `.env` files | No |
| `plugins/notifications.js` + `notify.ps1` | Windows toast on task-complete and permission-ask | No |
| `plugins/nodeterm-status.js` | Only if you run inside a nodeterm canvas session — skip otherwise | No |

Default model: `opencode/muse-spark-1.3-contributor-free` (free tier, 1M context,
native image/video/audio/PDF input — ideal for screen captures and summaries).

## Requirements

- Windows 10/11, Python 3.12+ on `PATH`, Node.js 20+ (`npx`), opencode installed

## Deploy (2 minutes)

```bat
install.bat
```

This copies the MCP server + plugins into `%USERPROFILE%\.config\opencode`,
`pip`-installs the server deps, and creates `opencode.jsonc` from the example
(it never overwrites your existing config). Then:

1. `setx CRAWLBASE_TOKEN "your-key"` (and `CRAWLBASE_JS_TOKEN`) — skip if you
   don't use Crawlbase; or grab a key at [crawlbase.com](https://crawlbase.com).
2. Restart opencode.
3. `/mcp list` → expect `context7, gh_grep, crawlbase, screenshot, memory, thinking`.

## Usage

```
cowork            → captures your screen, AI analyzes it and suggests a response
type it           → types the suggestion into your focused window (Gmail, CMD, …)
remember that …   → persists a fact to memory across sessions
summarize <link>  → video / article summary (model takes video+audio attachments)
```

Safety: click into the target window before `type it`. Slam the mouse into a
screen corner to abort typing (pyautogui failsafe).

## Push this to GitHub

```bash
git init -b main
git add .
git commit -m "opencode cowork kit"
gh repo create opencode-cowork-kit --public --source=. --push
# without gh: create an empty repo on github.com, then:
# git remote add origin https://github.com/<you>/opencode-cowork-kit.git
# git push -u origin main
```

`.gitignore` blocks the live `opencode.jsonc` so keys can't leak. The committed
`opencode.jsonc.example` uses `{env:...}` placeholders only.

## License

MIT — see [LICENSE](LICENSE).
