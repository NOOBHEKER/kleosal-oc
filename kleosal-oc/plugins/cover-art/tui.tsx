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

// The renderer's native draw bridge expects an RGBA-shaped `{ buffer:
// Uint16Array }`. Theme colours arrive as plain RGBA objects and matrix spans
// may still carry hex strings, so normalise both here. Returning a fresh object
// also lets us apply the rain opacity without mutating a theme colour.
function packColor(source: any, alpha = 1) {
  const buffer = new Uint16Array(4)
  let r = 0
  let g = 0
  let b = 0
  let a = 1
  if (source?.buffer instanceof Uint16Array) {
    buffer.set(source.buffer.subarray(0, 4))
    r = (buffer[0]! & 0xff) / 255
    g = (buffer[1]! & 0xff) / 255
    b = (buffer[2]! & 0xff) / 255
    a = (buffer[3]! & 0xff) / 255
  } else if (typeof source === "string") {
    const hex = source.trim().replace(/^#/, "")
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      r = parseInt(hex[0]! + hex[0]!, 16) / 255
      g = parseInt(hex[1]! + hex[1]!, 16) / 255
      b = parseInt(hex[2]! + hex[2]!, 16) / 255
    } else if (/^[0-9a-f]{6}$/i.test(hex)) {
      r = parseInt(hex.slice(0, 2), 16) / 255
      g = parseInt(hex.slice(2, 4), 16) / 255
      b = parseInt(hex.slice(4, 6), 16) / 255
    }
  } else if (source && typeof source === "object") {
    r = Number(source.r) || 0
    g = Number(source.g) || 0
    b = Number(source.b) || 0
    a = source.a === undefined ? 1 : Number(source.a)
  }
  buffer[0] = Math.round(clamp(r, 0, 1) * 255)
  buffer[1] = Math.round(clamp(g, 0, 1) * 255)
  buffer[2] = Math.round(clamp(b, 0, 1) * 255)
  buffer[3] = Math.round(clamp(a * alpha, 0, 1) * 255)
  return { buffer }
}

function children(node: any): any[] {
  try {
    return node?.getChildren?.() ?? []
  } catch {
    return []
  }
}

// Dialogs, menus, and permission prompts paint above the home screen. The
// post-process layer paints above *everything*, so skip the rain while one of
// those is open instead of drawing over its text. Session tabs also use a high
// z-index, but they live in the top two rows and are already masked.
function hasModal(root: any): boolean {
  let found = false
  const visit = (node: any) => {
    if (!node || found) return
    try {
      if (
        node.visible !== false &&
        Number(node.zIndex ?? 0) >= 1500 &&
        Number(node.y ?? 0) > 2 &&
        Number(node.width ?? 0) > 4 &&
        Number(node.height ?? 0) > 1
      ) {
        found = true
        return
      }
    } catch {}
    for (const child of children(node)) visit(child)
  }
  visit(root)
  return found
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
      // Painted only on the home route and only while it has content. A z-index
      // of 0 keeps the art above the app background but below every interactive
      // sibling (session tabs are z=1, the prompt z=1000, dialogs higher), so
      // the overlay can never swallow a tab click, a wheel event, or a dialog
      // click. `visible` removes it from OpenTUI's hit grid entirely when the
      // route changes or the config is disabled.
      zIndex={0}
      visible={props.visible}
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
  const [matrixX, setMatrixX] = createSignal(0)
  const [matrixY, setMatrixY] = createSignal(0)
  const [modalOpen, setModalOpen] = createSignal(false)
  const [artLeft, setArtLeft] = createSignal(-1000)
  const [artTop, setArtTop] = createSignal(-1000)
  const [matrixOn, setMatrixOn] = createSignal(false)
  const [artOn, setArtOn] = createSignal(false)
  const [active, setActive] = createSignal(false)
  const [background, setBackground] = createSignal<string | undefined>(undefined)

  const matrixEngine = createEngine()
  let logo: any
  let artPos = { left: -1000, top: -1000 }
  let lastScan = 0
  let lastKey = configKey(config())
  let failures = 0
  let promptBox: any
  let lastPromptScan = 0
  let lastModalScan = 0

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
    // Current hosts expose `name`; older previews used `type`. Accept both so
    // a route rename can never leave the overlay mounted over a session.
    setActive((route?.type ?? route?.name) === "home")
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

  onMount(() => {
    const renderer = plugin.renderer
    // Post-processing paints into the frame buffer after every renderable has
    // been laid out. It therefore has no hit-test node at all: the rain can
    // never steal a tab click, a wheel event, a dialog click, or a selection.
    if (!renderer?.addPostProcessFn) return
    const transparent = packColor(null, 0)
    const paint = (buffer: any) => {
      const configValue = config()
      if (!active() || !configValue.enabled || configValue.effect !== "matrix") return
      if (modalOpen() || !matrixOn()) return
      const alpha = clamp(Number(configValue.rainOpacity) || 0, 0, 1)
      if (alpha <= 0) return
      const frame = matrixFrame()
      if (!frame.rows.length) return
      const originX = matrixX()
      const originY = matrixY()
      for (let y = 0; y < frame.rows.length; y += 1) {
        const row = frame.rows[y]!
        let column = 0
        for (const span of row) {
          const text = span?.text ?? ""
          const fg = packColor(span?.color, alpha)
          for (let i = 0; i < text.length; i += 1) {
            const char = text[i]!
            const x = originX + column
            const py = originY + y
            column += 1
            if (char === " " || x < 0 || py < 0) continue
            buffer.setCellWithAlphaBlending(x, py, char, fg, transparent)
          }
        }
      }
    }
    renderer.addPostProcessFn(paint)
    onCleanup(() => renderer.removePostProcessFn(paint))
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
    const artEl = findById(root, ART_ID)
    if (!artEl) return

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
    if (now - lastModalScan > 250) {
      setModalOpen(hasModal(root))
      lastModalScan = now
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
    if (matrix) {
      const desiredX = configValue.fullscreen ? 0 : 2
      const desiredY = configValue.fullscreen
        ? 0
        : Math.max(1, Math.round(logo.y) + 5 - matrix.height)
      setMatrixX(desiredX)
      setMatrixY(desiredY)
      matrixReady = true
    }
    setMatrixOn(matrixReady)
  }

  return (
    <>
      <ArtCanvas
        id={ART_ID}
        left={artLeft()}
        top={artTop()}
        frame={artFrame()}
        opacity={artOn() ? config().opacity : 0}
        visible={artOn()}
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
