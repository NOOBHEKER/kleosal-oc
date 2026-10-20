# kleosal-oc and cowork

Turns the barebones opencode CLI into a full productivity machine. Free vision model, research agents, goal tracking, secret protection, a custom theme, desktop notifications, code review workflows, and release automation — plus a full-screen cover-art treatment for the home screen. No 3-hour setup. Copy, install, done.

opencode-cowork-kit gives you the Cowork experience without the subscription. A custom screen-capture MCP lets the AI see your desktop on demand and auto-type responses straight into Gmail, CMD, or any focused window. Bundled memory remembers your preferences across sessions, sequential thinking plans multi-step work, and Crawlbase + Context7 + grep.app cover scraping, docs, and code search. One install.bat deploys it all on any Windows machine — free forever.

![MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![opencode](https://img.shields.io/badge/opencode-2.x-111827)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-4B5563)

## One-command install

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/NOOBHEKER/kleosal-oc/main/install.ps1 | iex
```

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/NOOBHEKER/kleosal-oc/main/install.sh | bash
```

The installer backs up your config, keeps your existing `opencode.jsonc` and `tui.json` (the pack versions are saved as reference copies), and copies the agents, commands, rules, skills, themes, and plugins — including cover art. Restart opencode when it finishes.

This installs the `kleosal-oc` pack. The Cowork kit has its own Windows installer: [`opencode-cowork-kit/install.bat`](opencode-cowork-kit/install.bat).

## Cover art

![Cover art preview](kleosal-oc/previews/cover-art.gif)

<sub>Still preview: [cover-art-full.png](kleosal-oc/previews/cover-art-full.png)</sub>

A full-screen, theme-adaptive digital rain for the home screen. The real `opencode` wordmark stays readable; the rain is masked around the wordmark, prompt, tab bar, footer, and scrollbar, so nothing ever sits behind text. It is painted into the render buffer instead of as an overlay, so it cannot intercept tab clicks, wheel scrolling, or dialog clicks. `/art` switches presets, wordmark/rain faintness, full-screen vs. left-panel layout, and custom frames. Zero npm dependencies.

[Cover-art plugin docs →](kleosal-oc/plugins/cover-art/README.md)

## What's inside

| Pack | What it does |
| --- | --- |
| [`kleosal-oc/`](kleosal-oc/) | Agents, commands, rules, skills, themes, config, and plugins: cover art, notifications, `.env` protection, attribution |
| [`opencode-cowork-kit/`](opencode-cowork-kit/) | Cowork-style screen capture MCP, auto-type, memory, sequential thinking, Crawlbase + Context7 + grep.app |

## Quick links

- [kleosal-oc setup](kleosal-oc/docs/SETUP.md)
- [Plugin setup](kleosal-oc/docs/PLUGIN-SETUP.md)
- [Cover art](kleosal-oc/plugins/cover-art/README.md)
- [Cowork kit](opencode-cowork-kit/README.md)

## License

MIT. See [kleosal-oc/LICENSE](kleosal-oc/LICENSE). The attribution watermark is included as a courtesy; removing it does not void the license, but we ask you keep it when redistributing.
