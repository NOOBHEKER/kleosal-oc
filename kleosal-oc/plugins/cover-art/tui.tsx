// @ts-nocheck
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, For, onCleanup, onMount, untrack } from "solid-js"
import { readFileSync } from "node:fs"
import {
  PRESETS,
  configForPreset,
  configKey,
  describePresets,
  normalizeConfig,
  readConfig,
  writeConfig,
} from "./shared.mjs"
import { createEngine, renderFrames, renderMatrix, type ArtFrame } from "./engine"

const MATRIX_ID = "cover-art.matrix"
const ART_ID = "cover-art.art"

const EMPTY: ArtFrame = { rows: [], width: 0, height: 0 }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function children(node: any): any[] {
  try {
    return node?.getChildren?.() ?? []
  } catch {
    return []
  }
}

function collectText(node: any): string {
  if (!node) return ""
  const kids = children(node)
  if (kids.length === 0) {
    try {
      if (typeof node.plainText === "string") return node.plainText
      if (typeof node.content === "string") return node.content
    } catch {
      return ""
    }
    return ""
  }
  let text = ""
  for (const kid of kids) text += collectText(kid)
  return text
}

function findById(node: any, id: string): any {
  if (!node) return undefined
  if (node.id === id) return node
  for (const kid of children(node)) {
    const found = findById(kid, id)
    if (found) return found
  }
  return undefined
}

// The stock logo is the only four-row box on the home screen whose text
// contains the opencode block glyphs. Skip our canvases so custom frames are
// never mistaken for the title.
function findLogo(root: any): any {
  let found: any
  const walk = (node: any, depth: number) => {
    if (found || !node || depth > 80) return
    if (node.id === MATRIX_ID || node.id === ART_ID) return
    const kids = children(node)
    if (kids.length === 4) {
      const rows = kids.map(collectText)
      if (rows.every((row) => row.length >= 20)) {
        const text = rows.join("")
        if (text.includes("█▀▀█") && text.includes("█▀▀▀")) {
          found = node
          return
        }
      }
    }
    for (const kid of kids) walk(kid, depth + 1)
  }
  walk(root, 0)
  return found
}



// The home prompt is the smallest box above the prompt text that is wide
// enough to be the input container. Its rectangle becomes a no-rain zone so
// the question stays perfectly readable.
function findPromptBox(root: any): any {
  const deepest = (node: any): any => {
    if (!node) return undefined
    for (const kid of children(node)) {
      const found = deepest(kid)
      if (found) return found
    }
    return collectText(node).includes("Ask anything") ? node : undefined
  }
  const match = deepest(root)
  if (!match) return undefined
  let best: any
  let node = match
  for (let i = 0; i < 10 && node; i += 1) {
    const width = Number(node.width)
    const height = Number(node.height)
    if (width >= 30 && height >= 3 && width <= Number(root.width) - 4) {
      if (!best || width < Number(best.width)) best = node
    }
    node = node.parent
  }
  return best
}

function ArtCanvas(props: any) {
  return (
    <box
      id={props.id}
      position="absolute"
      left={props.left}
      top={props.top}
      // Only ever painted on the home route (see `active()` below), where no tab
      // strip or sidebar exists, so this overlay cannot steal clicks from them.
      // A negative z-index here paints the art underneath the app background and
      // makes it invisible, so keep it above the app but below the prompt (1000).
      zIndex={900}
      flexDirection="column"
      opacity={props.opacity}
      backgroundColor={props.background}
    >
      <For each={props.frame.rows}>
        {(row: any) => (
          <text selectable={false}>
            <For each={row}>
              {(span: any) => <span style={{ fg: span.color }}>{span.text}</span>}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}

function CoverArt() {
  const plugin: any = usePlugin()
  const [config, setConfig] = createSignal(readConfig())
  const [matrixFrame, setMatrixFrame] = createSignal<ArtFrame>(EMPTY)
  const [artFrame, setArtFrame] = createSignal<ArtFrame>(EMPTY)
  const [matrixLeft, setMatrixLeft] = createSignal(-1000)
  const [matrixTop, setMatrixTop] = createSignal(-1000)
  const [artLeft, setArtLeft] = createSignal(-1000)
  const [artTop, setArtTop] = createSignal(-1000)
  const [matrixOn, setMatrixOn] = createSignal(false)
  const [artOn, setArtOn] = createSignal(false)
  const [active, setActive] = createSignal(false)
  const [background, setBackground] = createSignal<string | undefined>(undefined)

  const matrixEngine = createEngine()
  let logo: any
  let matrixPos = { left: -1000, top: -1000 }
  let artPos = { left: -1000, top: -1000 }
  let lastScan = 0
  let lastKey = configKey(config())
  let failures = 0
  let promptBox: any
  let lastPromptScan = 0

  const restore = () => {
    if (!logo) return
    try {
      if (logo.parent) {
        logo.opacity = 1
        logo.visible = true
      }
    } catch {}
    logo = undefined
  }

  const place = (el: any, current: { left: number; top: number }, x: number, y: number) => {
    const originX = el.x - current.left
    const originY = el.y - current.top
    return {
      left: Math.round(x - originX),
      top: Math.round(y - originY),
    }
  }

  createEffect(() => {
    const route = plugin.ui.router.current()
    setActive(route?.type === "home")
  })

  onMount(() => {
    const timer = setInterval(() => {
      const next = readConfig()
      const key = configKey(next)
      if (key === lastKey) return
      lastKey = key
      setConfig(next)
    }, 400)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const configValue = config()
    const home = active()
    setBackground(configValue.background ?? undefined)
    if (!home || !configValue.enabled) {
      restore()
      setMatrixOn(false)
      setArtOn(false)
      return
    }
    const rate = Math.max(33, Math.round(1000 / Math.max(1, configValue.fps)))
    const timer = setInterval(tick, rate)
    onCleanup(() => clearInterval(timer))
    untrack(() => tick())
  })

  onCleanup(() => {
    restore()
    setMatrixOn(false)
    setArtOn(false)
  })

  function tick() {
    try {
      draw()
      failures = 0
    } catch {
      failures += 1
      if (failures >= 3) {
        restore()
        setMatrixOn(false)
        setArtOn(false)
      }
    }
  }

  function draw() {
    const configValue = config()
    const root = plugin.renderer?.root
    if (!root) return
    const matrixEl = findById(root, MATRIX_ID)
    const artEl = findById(root, ART_ID)
    if (!matrixEl || !artEl) return

    const now = Date.now()
    if (!logo || !logo.parent || now - lastScan > 500) {
      logo = findLogo(root)
      lastScan = now
      promptBox = undefined
    }
    if (!logo) {
      setMatrixOn(false)
      setArtOn(false)
      return
    }
    if (!promptBox || now - lastPromptScan > 1000) {
      promptBox = findPromptBox(root)
      lastPromptScan = now
    }

    const theme = plugin.theme
    const isFrames = configValue.effect === "frames"

    if (isFrames) {
      const art = renderFrames(configValue, theme, now)
      // Never cover the UI with art wider than the terminal. Leave the stock
      // logo alone in that case and wait for a resize or a new config.
      if (art.width > 0 && art.width > Number(root.width) - 2) {
        try {
          logo.opacity = 1
        } catch {}
        setMatrixOn(false)
        setArtOn(false)
        return
      }
      try {
        if (logo.opacity !== 0) logo.opacity = 0
      } catch {}
      setMatrixFrame(EMPTY)
      setMatrixOn(false)
      setArtFrame(art)

      let artReady = false
      if (art.width > 0 && artEl.width > 0 && artEl.height > 0) {
        const desiredX = logo.x + (logo.width - art.width) / 2
        const desiredY = logo.y + (logo.height - art.height) / 2
        const next = place(artEl, artPos, desiredX, desiredY)
        if (next.left !== artPos.left) {
          artPos.left = next.left
          setArtLeft(next.left)
        }
        if (next.top !== artPos.top) {
          artPos.top = next.top
          setArtTop(next.top)
        }
        artReady = true
      }
      setArtOn(artReady)
      return
    }

    // Presets keep the real wordmark: dimming it preserves its exact glyphs,
    // shadows, and theme colours (no hand-drawn wordmark to misspell).
    const pulse = configValue.shimmer ? 0.9 + 0.1 * Math.sin((now / 1000) * 1.6) : 1
    const target = clamp(configValue.opacity * pulse, 0.05, 1)
    try {
      if (Math.abs((logo.opacity ?? 1) - target) > 0.01) logo.opacity = target
    } catch {}

    setArtOn(false)
    setArtFrame(EMPTY)

    let matrix: ArtFrame | undefined
    if (configValue.effect === "matrix") {
      if (configValue.fullscreen) {
        const width = Math.max(8, Math.floor(Number(root.width)))
        const height = Math.max(6, Math.floor(Number(root.height)))
        const prompt =
          promptBox && Number(promptBox.width) > 0
            ? {
                x: Number(promptBox.x),
                y: Number(promptBox.y),
                width: Number(promptBox.width),
                height: Number(promptBox.height),
              }
            : {
                x: Math.max(2, Math.round((width - Math.min(76, Math.max(20, width - 44))) / 2)),
                y: Math.round(logo.y) + 5,
                width: Math.min(76, Math.max(20, width - 44)),
                height: 9,
              }
        const maskLeft = Math.max(0, Math.round(prompt.x) - 2)
        const maskRight = Math.min(width - 1, Math.round(prompt.x + prompt.width) + 2)
        const maskTop = Math.max(0, Math.round(prompt.y) - 1)
        const maskBottom = Math.min(height - 1, Math.round(prompt.y + prompt.height) + 3)
        const mask = (x: number, y: number) => {
          // Keep the top tab bar and bottom status line completely clear.
          if (y < 2 || y >= height - 2) return true
          if (x >= width - 1) return true
          // A clean halo around the real wordmark.
          if (
            x >= logo.x - 2 &&
            x <= logo.x + logo.width + 2 &&
            y >= logo.y - 1 &&
            y <= logo.y + logo.height + 1
          ) {
            return true
          }
          // The prompt, model line, and help line.
          if (x >= maskLeft && x <= maskRight && y >= maskTop && y <= maskBottom) return true
          return false
        }
        matrix = renderMatrix(matrixEngine, configValue, theme, now, width, height, {
          full: true,
          mask,
        })
        setMatrixFrame(matrix)
      } else {
        const bottom = Math.round(logo.y) + 5
        const height = Math.max(
          4,
          Math.min(configValue.size.height, bottom - 1, Number(root.height) - 6),
        )
        const width = Math.min(configValue.size.width, Math.floor(logo.x) - 6)
        if (width >= 8 && height >= 4) {
          matrix = renderMatrix(matrixEngine, configValue, theme, now, width, height)
          setMatrixFrame(matrix)
        }
      }
    }

    let matrixReady = false
    if (matrix && matrixEl.width > 0 && matrixEl.height > 0) {
      const desiredX = configValue.fullscreen ? 0 : 2
      const desiredY = configValue.fullscreen
        ? 0
        : Math.max(1, Math.round(logo.y) + 5 - matrix.height)
      const next = place(matrixEl, matrixPos, desiredX, desiredY)
      if (next.left !== matrixPos.left) {
        matrixPos.left = next.left
        setMatrixLeft(next.left)
      }
      if (next.top !== matrixPos.top) {
        matrixPos.top = next.top
        setMatrixTop(next.top)
      }
      matrixReady = true
    }
    setMatrixOn(matrixReady)
  }

  return (
    <>
      <ArtCanvas
        id={MATRIX_ID}
        left={matrixLeft()}
        top={matrixTop()}
        frame={matrixFrame()}
        opacity={matrixOn() ? config().rainOpacity : 0}
      />
      <ArtCanvas
        id={ART_ID}
        left={artLeft()}
        top={artTop()}
        frame={artFrame()}
        opacity={artOn() ? config().opacity : 0}
        background={background()}
      />
    </>
  )
}

async function openMenu(plugin: any) {
  const current = readConfig()
  const options: any[] = [
    ...describePresets().map((preset: any) => ({
      title: preset.name === current.preset ? `✓ ${preset.title}` : preset.title,
      value: `preset:${preset.name}`,
      description: `${preset.description} · ${preset.opacity} wordmark / ${preset.rainOpacity} rain`,
      category: "Presets",
    })),
    ...[
      ["Ghost", 0.4],
      ["Soft", 0.55],
      ["Clear", 0.7],
      ["Bold", 0.85],
    ].map(([label, value]) => ({
      title: `${label} (${value})`,
      value: `opacity:${value}`,
      description: "Wordmark translucency; stays readable",
      category: "Wordmark faintness",
    })),
    ...[
      ["Whisper", 0.12],
      ["Soft", 0.2],
      ["Clear", 0.3],
      ["Bold", 0.4],
    ].map(([label, value]) => ({
      title: `${label} (${value})`,
      value: `rain:${value}`,
      description: "How visible the background rain is",
      category: "Rain faintness",
    })),
    {
      title: current.fullscreen ? "✓ Full-screen background" : "Full-screen background",
      value: "layout:full",
      description: "Rain across the screen, with clean text areas",
      category: "Layout",
    },
    {
      title: current.fullscreen ? "Left-side panel" : "✓ Left-side panel",
      value: "layout:panel",
      description: "Compact rain panel on the left",
      category: "Layout",
    },
    {
      title: "Custom frames from file…",
      value: "custom",
      description: "Load a JSON file with an animated frame sequence",
      category: "Custom",
    },
    {
      title: current.enabled ? "Disable cover art (stock logo)" : "Enable cover art",
      value: "toggle",
      category: "Custom",
    },
    {
      title: "Reset to full-screen rain",
      value: "reset",
      category: "Custom",
    },
  ]

  const picked = await plugin.ui.dialog.select({
    title: "Cover art",
    placeholder: "Search presets…",
    options,
  })
  if (!picked) return

  try {
    if (picked.startsWith("preset:")) {
      const name = picked.slice("preset:".length)
      writeConfig(configForPreset(name, current))
      plugin.ui.toast.show({
        title: "Cover art",
        message: `Preset: ${PRESETS[name].title}`,
        variant: "success",
      })
      return
    }

    if (picked.startsWith("opacity:")) {
      const value = Number(picked.slice("opacity:".length))
      writeConfig({ ...current, opacity: value })
      plugin.ui.toast.show({
        title: "Cover art",
        message: `Wordmark opacity ${value}`,
        variant: "success",
      })
      return
    }

    if (picked.startsWith("rain:")) {
      const value = Number(picked.slice("rain:".length))
      writeConfig({ ...current, rainOpacity: value })
      plugin.ui.toast.show({
        title: "Cover art",
        message: `Rain opacity ${value}`,
        variant: "success",
      })
      return
    }

    if (picked.startsWith("layout:")) {
      const fullscreen = picked.slice("layout:".length) === "full"
      writeConfig({ ...current, fullscreen })
      plugin.ui.toast.show({
        title: "Cover art",
        message: fullscreen ? "Full-screen background" : "Left-side panel",
        variant: "success",
      })
      return
    }

    if (picked === "toggle") {
      writeConfig({ ...current, enabled: !current.enabled })
      plugin.ui.toast.show({
        title: "Cover art",
        message: current.enabled ? "Disabled · stock logo restored" : "Enabled",
        variant: "success",
      })
      return
    }

    if (picked === "reset") {
      writeConfig(configForPreset("matrix", current))
      plugin.ui.toast.show({ title: "Cover art", message: "Reset to full-screen rain", variant: "success" })
      return
    }

    if (picked === "custom") {
      const file = await plugin.ui.dialog.prompt({
        title: "Frames JSON",
        placeholder: "C:\\path\\to\\frames.json",
        description: "Array of frames, or { frames, fps, palette, colorMap }",
      })
      if (!file) return
      const parsed = JSON.parse(readFileSync(file, "utf8"))
      const frames = Array.isArray(parsed) ? parsed : parsed.frames
      if (!frames) throw new Error("file must contain a frames array")
      const next = normalizeConfig({
        ...current,
        preset: "custom",
        effect: "frames",
        frames,
        fps: parsed.fps ?? current.fps,
        palette: parsed.palette ?? current.palette,
        colorMap: parsed.colorMap ?? null,
      })
      writeConfig(next)
      plugin.ui.toast.show({
        title: "Cover art",
        message: `Loaded ${next.frames.length} frame(s)`,
        variant: "success",
      })
    }
  } catch (error: any) {
    plugin.ui.toast.show({
      title: "Cover art",
      message: String(error?.message ?? error),
      variant: "error",
    })
  }
}

export default Plugin.define({
  id: "user.cover-art",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <CoverArt /> })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "coverart.menu",
          title: "Cover art",
          group: "Cover art",
          palette: true,
          slash: { name: "art" },
          run: () => openMenu(context),
        },
      ],
    }))
  },
})
