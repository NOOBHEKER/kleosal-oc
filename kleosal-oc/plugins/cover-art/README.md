# Cover art

A translucent, theme-aware home-screen treatment for OpenCode: the real `opencode`
wordmark stays readable, while a soft digital-rain background drifts across the
home screen. The rain is masked around the wordmark, prompt, tab bar, and footer,
so text is never covered.

![Cover art in action](../../previews/cover-art.gif)

Part of **Kleosal OC**. Zero npm dependencies, theme-adaptive, and only active on
the home screen.

## Install

This plugin ships with the Kleosal OC pack:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/NOOBHEKER/kleosal-oc/main/install.sh | bash
```

```powershell
# Windows
irm https://raw.githubusercontent.com/NOOBHEKER/kleosal-oc/main/install.ps1 | iex
```

Or copy this `cover-art/` folder into `~/.config/opencode/plugins/` and restart
OpenCode (on Windows: `C:\Users\<you>\.config\opencode\plugins\`). The `/art`
picker appears automatically; the MCP server is optional.

Everything is driven by the same small JSON config, so the TUI, the `/art` picker,
and the MCP server stay in sync.

## Presets

| Preset | What it does |
| --- | --- |
| `matrix` | Full-screen rain + readable tinted wordmark (default) |
| `matrix-wordmark` | Same rain with a slow breathing/shimmer on the wordmark |
| `wordmark` | Ghost wordmark only, with a slow shimmer |

The wordmark in every preset is the **stock OpenCode logo**, not a redrawn copy. It
keeps its exact glyphs, shadows, and theme colours, so it always reads `opencode`
and follows theme changes. Only its opacity is reduced.

The rain uses `theme.text` tokens, so it adapts to light/dark themes automatically.
Its canvas is drawn at `zIndex` 900, below the prompt (`zIndex` 1000), and the
mask keeps it out of every text area.

## Using it

- `/art` (or the "Cover art" command palette entry) opens a picker with presets,
  wordmark and rain faintness, full-screen vs. left-panel layout, custom frames,
  enable/disable, and reset.
- Changes apply within about half a second; no TUI restart is needed.

Config file:

```
~/.config/opencode/cover-art.json
```

On Windows: `C:\Users\<you>\.config\opencode\cover-art.json`.

## Configuration

```json
{
  "enabled": true,
  "preset": "matrix",
  "effect": "matrix",
  "fullscreen": true,
  "shimmer": false,
  "fps": 6,
  "size": { "width": 60, "height": 20 },
  "opacity": 0.55,
  "rainOpacity": 0.2,
  "palette": ["#6B7280", "#9CA3AF", "#D1D5DB", "#E5E7EB"],
  "frames": null,
  "colorMap": null,
  "background": null
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | `false` restores the stock wordmark at full opacity and hides all art |
| `effect` | `matrix`, `wordmark`, or `frames` |
| `fullscreen` | `true` (default) covers the screen with text-safe cutouts; `false` uses the compact left panel |
| `shimmer` | Slow opacity pulse on the wordmark (`matrix`/`wordmark`) |
| `fps` | Animation rate, 1–30 (default **6**) |
| `size` | Left-panel size when `fullscreen` is false: width 8–80, height 2–24 |
| `opacity` | Wordmark opacity, 0.05–1 (default **0.55** — faint but readable) |
| `rainOpacity` | Rain opacity, 0.05–1 (default **0.2**) |
| `palette` | Colours for custom frames only; the presets use theme colours |
| `frames` | Custom frame sequence (see below) |
| `colorMap` | Per-character hex colours for custom frames |
| `background` | Optional hex background behind custom frames |

### Readability

In full-screen mode the rain is removed from:

- the wordmark box (plus a small halo),
- the prompt box, model line, and help line,
- the top two rows (tab bar),
- the bottom two rows (status/footer),
- the rightmost column (scrollbar).

Rain remains in the surrounding space — above the wordmark, beside the prompt,
and below it above the footer — so the screen feels covered without ever putting
glyphs behind text. Custom frames still replace the wordmark area and hide the
stock logo.

## Custom frames

`set_frames` (or `/art` → "Custom frames from file…") replaces the wordmark area
with your own animation and hides the stock logo. Limits:

- up to **64 frames**
- each frame up to **8 rows** and **80 columns**
- printable ASCII plus block glyphs: `█ ▀ ▄ ░ ▒ ▓ ▁ ▂ ▃ ▅ ▆ ▇ ■ □ ▪ ▫`
- rows are padded to the longest row, frames to the largest frame
- unmapped characters use `palette[0]`; `colorMap` can override single characters

Example:

```json
{
  "frames": [
    ["  ▄▀▄  ", " █   █ ", "  ▀▄▀  "],
    ["  ▄▀▄  ", " █   █ ", " ▀   ▀ "]
  ],
  "fps": 6,
  "colorMap": { "█": "#7DD3FC" }
}
```

If custom art is wider than the terminal, the plugin leaves the stock wordmark
visible instead of clipping the art.

## MCP server

Configured as `mcp.servers.coverart` and started with `node mcp/server.mjs`
(zero dependencies, stdio JSON-RPC).

```jsonc
"mcp": {
  "servers": {
    "coverart": {
      "type": "local",
      "command": ["node", "/home/you/.config/opencode/plugins/cover-art/mcp/server.mjs"]
    }
  }
}
```

On Windows use a path like `C:/Users/you/.config/opencode/plugins/cover-art/mcp/server.mjs`.
The Kleosal OC installer prints the exact entry with your path.

| Tool | Purpose |
| --- | --- |
| `list_presets` | List presets with effect, size, opacity, rain opacity, fps |
| `get_config` | Current config plus the shared config path |
| `set_preset` | Switch preset (`matrix`, `matrix-wordmark`, `wordmark`) |
| `set_frames` | Apply custom frames (`frames`, optional `fps`, `palette`, `colorMap`) |
| `set_options` | Change `enabled`, `fullscreen`, `fps`, `size`, `opacity`, `rainOpacity`, `palette`, `background` |
| `preview_frames` | Validate frames and print one as text without applying |
| `reset` | Restore the default full-screen rain |

## How it works

- `tui.tsx` mounts a small `app`-slot overlay, locates the stock logo in the
  render tree, and dims it with `opacity` (setting `visible = false` would collapse
  its wrapper and shift the layout).
- In full-screen mode the rain canvas covers the terminal. A mask excludes the
  wordmark, the prompt container (found from the "Ask anything…" placeholder,
  with a geometric fallback), the top tab bar, the footer, and the scrollbar.
- The rain canvas and custom-frame canvas are absolutely positioned overlays with
  self-calibrating origins; they are repositioned when the logo or terminal size
  changes.
- `engine.ts` draws the rain and frame art as coloured spans, using theme tokens
  for presets and `palette`/`colorMap` for custom frames. Full-screen columns use
  short, slow trails so the background stays calm.
- `shared.mjs` owns defaults, validation, and atomic reads/writes of the JSON
  config. `mcp/server.mjs` exposes it over MCP.
- `index.ts` is a no-op server-side entry so the plugin directory is valid for
  both discovery paths.

Only the home screen is affected; session and conversation views are untouched.
