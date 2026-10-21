// @ts-nocheck
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, For, onCleanup, onMount, untrack } from "solid-js"
import { readFileSync, statSync } from "node:fs"
import {
  PRESETS,
  configForPreset,
  configKey,
  describePresets,
  normalizeConfig,
  readConfig,
  readNowPlaying,
  writeConfig,
} from "./shared.mjs"
import { createEngine, renderFrames, renderMatrix, renderWordmark, type ArtFrame } from "./engine"

const MATRIX_ID = "cover-art.matrix"
const ART_ID = "cover-art.art"

const EMPTY: ArtFrame = { rows: [], width: 0, height: 0 }

type PaintGlyph = { x: number; y: number; char: string; color: any }
type PaintCell = { x: number; y: number; color: string }
type ArtImage = { key: string; width: number; height: number; data: Uint8Array }
type Mask = (x: number, y: number) => boolean

// The post-process runs on every UI frame, while the rain itself only changes at
// the configured fps. Flatten the frame once per rain tick so the draw callback
// never walks a full screen of spaces on every repaint.
function collectGlyphs(frame: ArtFrame, offsetX = 0, offsetY = 0): PaintGlyph[] {
  const glyphs: PaintGlyph[] = []
  for (let y = 0; y < frame.rows.length; y += 1) {
    const row = frame.rows[y]!
    let x = 0
    for (const span of row) {
      const text = span?.text ?? ""
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index]!
        if (char !== " ") {
          glyphs.push({ x: offsetX + x + index, y: offsetY + y, char, color: span?.color })
        }
      }
      x += text.length
    }
  }
  return glyphs
}

function byteHex(value: number) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")
}

// The daemon already blur-extends the sleeve to a 16:10 raw RGB frame. Here we
// sample it down to the terminal grid. Two vertical samples are averaged into
// one full block: a half block leaves the cell's bottom half unpainted in the
// host renderer, which showed up as dark scanlines.
function buildMusicCells(
  image: ArtImage,
  width: number,
  height: number,
  mask: Mask,
): PaintCell[] {
  const cells: PaintCell[] = []
  const fw = image.width
  const fh = image.height
  if (fw < 1 || fh < 1 || width < 1 || height < 1) return cells
  const rowBytes = fw * 3
  for (let y = 0; y < height; y += 1) {
    const topRow = Math.min(fh - 1, Math.floor((y * fh) / height))
    const bottomRow = Math.min(fh - 1, Math.floor(((y * 2 + 1) * fh) / (height * 2)))
    const topOffset = topRow * rowBytes
    const bottomOffset = bottomRow * rowBytes
    for (let x = 0; x < width; x += 1) {
      if (mask(x, y)) continue
      const column = Math.min(fw - 1, Math.floor((x * fw) / width)) * 3
      const data = image.data
      cells.push({
        x,
        y,
        color: `#${byteHex((((data[topOffset + column] ?? 0) + (data[bottomOffset + column] ?? 0)) / 2))}${byteHex(
          (((data[topOffset + column + 1] ?? 0) + (data[bottomOffset + column + 1] ?? 0)) / 2),
        )}${byteHex(
          (((data[topOffset + column + 2] ?? 0) + (data[bottomOffset + column + 2] ?? 0)) / 2),
        )}`,
      })
    }
  }
  return cells
}

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

// One mask for both effects. The tab bar, the status line, a halo around the
// wordmark and the prompt panel stay clear; everything else can take rain or
// album art without ever putting a glyph on top of UI text.
function buildMask(
  root: any,
  logo: any,
  promptBox: any,
  width: number,
  height: number,
  logoHalo = true,
): Mask {
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
  return (x: number, y: number) => {
    if (y < 2 || y >= height - 2) return true
    if (x >= width - 1) return true
    if (
      logoHalo &&
      x >= logo.x - 2 &&
      x <= logo.x + logo.width + 2 &&
      y >= logo.y - 1 &&
      y <= logo.y + logo.height + 1
    ) {
      return true
    }
    if (x >= maskLeft && x <= maskRight && y >= maskTop && y <= maskBottom) return true
    return false
  }
}

function loadArtImage(nowPlaying: any): ArtImage | null {
  if (!nowPlaying?.framePath || !nowPlaying.frameWidth || !nowPlaying.frameHeight) return null
  let mtime: number
  try {
    mtime = statSync(nowPlaying.framePath).mtimeMs
  } catch {
    return null
  }
  const key = `${nowPlaying.framePath}:${mtime}:${nowPlaying.frameWidth}x${nowPlaying.frameHeight}`
  try {
    const raw = readFileSync(nowPlaying.framePath)
    const expected = nowPlaying.frameWidth * nowPlaying.frameHeight * 3
    if (raw.length < expected) return null
    return {
      key,
      width: nowPlaying.frameWidth,
      height: nowPlaying.frameHeight,
      data: new Uint8Array(raw.buffer, raw.byteOffset, expected),
    }
  } catch {
    return null
  }
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
  const [matrixGlyphs, setMatrixGlyphs] = createSignal<PaintGlyph[]>([])
  const [artGlyphs, setArtGlyphs] = createSignal<PaintGlyph[]>([])
  const [artFrame, setArtFrame] = createSignal<ArtFrame>(EMPTY)
  const [matrixX, setMatrixX] = createSignal(0)
  const [matrixY, setMatrixY] = createSignal(0)
  const [modalOpen, setModalOpen] = createSignal(false)
  const [artLeft, setArtLeft] = createSignal(-1000)
  const [artTop, setArtTop] = createSignal(-1000)
  const [matrixOn, setMatrixOn] = createSignal(false)
  const [artOn, setArtOn] = createSignal(false)
  const [musicOn, setMusicOn] = createSignal(false)
  const [musicCells, setMusicCells] = createSignal<PaintCell[]>([])
  const [musicAlpha, setMusicAlpha] = createSignal(0)
  const [nowPlaying, setNowPlaying] = createSignal<any>(null)
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
  let lastNowKey = ""
  let musicLayoutKey = ""
  let musicFadeStart = 0
  let musicStopped = false
  let musicCacheAlpha = -1
  let musicColorCache = new Map<string, any>()

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
    const sample = () => {
      const next = readNowPlaying()
      const key = next
        ? `${next.updatedAt}:${next.trackId}:${Number(next.playing)}:${next.framePath}`
        : "none"
      if (key === lastNowKey) return
      lastNowKey = key
      setNowPlaying(next)
    }
    sample()
    const timer = setInterval(sample, 1000)
    onCleanup(() => clearInterval(timer))
  })

  onMount(() => {
    const renderer = plugin.renderer
    // Post-processing paints into the frame buffer after every renderable has
    // been laid out. It therefore has no hit-test node at all: the rain can
    // never steal a tab click, a wheel event, a dialog click, or a selection.
    if (!renderer?.addPostProcessFn) return
    const transparent = packColor(null, 0)
    let rainAlpha = -1
    let rainColors = new Map<any, any>()
    let wordmarkAlpha = -1
    let wordmarkColors = new Map<any, any>()
    const paint = (buffer: any) => {
      const configValue = config()
      if (!active() || !configValue.enabled || modalOpen()) return
      const width = Number(buffer.width)
      const height = Number(buffer.height)
      const draw = (
        glyphs: PaintGlyph[],
        originX: number,
        originY: number,
        alpha: number,
        colors: Map<any, any>,
      ) => {
        for (const glyph of glyphs) {
          const x = originX + glyph.x
          const y = originY + glyph.y
          if (x < 0 || y < 0 || x >= width || y >= height) continue
          let fg = colors.get(glyph.color)
          if (!fg) {
            fg = packColor(glyph.color, alpha)
            colors.set(glyph.color, fg)
          }
          buffer.setCellWithAlphaBlending(x, y, glyph.char, fg, transparent)
        }
      }

      if (configValue.effect === "matrix" && matrixOn() && !musicOn()) {
        const alpha = clamp(Number(configValue.rainOpacity) || 0, 0, 1)
        if (alpha > 0) {
          if (rainAlpha !== alpha) {
            rainAlpha = alpha
            rainColors = new Map()
          }
          draw(matrixGlyphs(), matrixX(), matrixY(), alpha, rainColors)
        }
      }

      // Album art from the now-playing daemon. Half blocks give two sampled
      // pixels per cell; both halves are alpha-blended so the theme background
      // still shows through and the effect stays translucent. Because this is
      // painted in the post-process pass it has no hit-test node either.
      const cells = musicCells()
      const alpha = musicAlpha()
      if (cells.length && alpha > 0) {
        if (musicCacheAlpha !== alpha) {
          musicCacheAlpha = alpha
          musicColorCache = new Map()
        }
        for (const cell of cells) {
          let bg = musicColorCache.get(cell.color)
          if (!bg) {
            bg = packColor(cell.color, alpha)
            musicColorCache.set(cell.color, bg)
          }
          // A space overlay makes OpenTUI blend the art into the cell
          // background and tint the existing character instead of replacing
          // it, so prompt text, tabs and dialogs keep their glyphs.
          buffer.setCellWithAlphaBlending(cell.x, cell.y, " ", transparent, bg)
        }
      }

      // The custom wordmark is painted here, after the rain and after every
      // renderable. That makes it independent of z-index/background painting and
      // still leaves it with no hit-test node of its own.
      const wordmark = artGlyphs()
      if (wordmark.length) {
        const alpha = clamp(Number(configValue.opacity) || 0, 0, 1)
        if (alpha > 0) {
          if (wordmarkAlpha !== alpha) {
            wordmarkAlpha = alpha
            wordmarkColors = new Map()
          }
          draw(wordmark, 0, 0, alpha, wordmarkColors)
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
      setArtGlyphs([])
      setArtOn(false)
      setMusicOn(false)
      setMusicCells([])
      setMusicAlpha(0)
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
    setMusicOn(false)
    setMusicCells([])
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
        setArtGlyphs([])
        setArtOn(false)
        setMusicOn(false)
        setMusicCells([])
        setMusicAlpha(0)
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
      setArtGlyphs([])
      setArtOn(false)
      setMusicOn(false)
      setMusicCells([])
      setMusicAlpha(0)
      return
    }
    if (!promptBox || now - lastPromptScan > 1000) {
      promptBox = findPromptBox(root)
      lastPromptScan = now
    }
    if (now - lastModalScan > 500) {
      setModalOpen(hasModal(root))
      lastModalScan = now
    }

    const theme = plugin.theme
    const isFrames = configValue.effect === "frames"

    // Music artwork takes priority over every preset. The sleeve used to be
    // loaded once per track and the resulting cells are cached per terminal
    // size, so the 12 fps tick only re-blends the same buffer list.
    const rootWidth = Math.max(1, Math.floor(Number(root.width)))
    const rootHeight = Math.max(1, Math.floor(Number(root.height)))
    const np = nowPlaying()
    const image = loadArtImage(np)
    const playing = np?.playing === true
    const wantsMusic = configValue.musicArt && !!image
    let musicVisible = false
    if (wantsMusic) {
      // A pause fades the sleeve back to the theme over two seconds. The rain
      // stays suppressed during the fade, then returns on its own. `musicStopped`
      // keeps the completed fade completed instead of restarting it every tick.
      if (playing) {
        musicFadeStart = 0
        musicStopped = false
      } else if (musicFadeStart === 0 && !musicStopped) {
        musicFadeStart = now
      }
      const base = clamp(Number(configValue.musicOpacity) || 0, 0, 1)
      const alpha = playing
        ? base
        : musicStopped
          ? 0
          : base * Math.max(0, 1 - (now - musicFadeStart) / 2000)
      if (alpha > 0.01) {
        const layout = `${image.key}:${rootWidth}x${rootHeight}`
        if (layout !== musicLayoutKey) {
          musicLayoutKey = layout
          // Only the tab bar and status line stay clean. Everything else is
          // tinted through the background, so no prompt mask is needed.
          const mask: Mask = (_x, y) => y < 2 || y >= rootHeight - 2
          setMusicCells(buildMusicCells(image, rootWidth, rootHeight, mask))
        }
        setMusicAlpha(alpha)
        setMusicOn(true)
        musicVisible = true
      } else if (!playing) {
        musicStopped = true
      }
    }
    if (!musicVisible) {
      if (musicOn() || musicCells().length) {
        setMusicOn(false)
        setMusicCells([])
        setMusicAlpha(0)
        try {
          plugin.renderer?.requestRender?.()
        } catch {}
      }
      musicLayoutKey = ""
      if (!wantsMusic) {
        musicFadeStart = 0
        musicStopped = false
      }
    }
    if (musicVisible) {
      setMatrixGlyphs([])
      setMatrixOn(false)
      // The rain normally drives repaints by changing glyphs. While it is
      // suppressed nothing in the renderable tree changes, so the post-process
      // would otherwise keep painting the first sleeve forever.
      try {
        plugin.renderer?.requestRender?.()
      } catch {}
    }

    if (isFrames && !musicVisible) {
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
      setMatrixGlyphs([])
      setMatrixOn(false)
      setArtGlyphs([])
      setArtFrame(art)

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
      }
      // Keep the canvas laid out even before its first measurement, otherwise
      // `display: none` would leave width 0 forever and the art could never
      // become visible. It is placed on the next rain tick.
      setArtOn(art.width > 0)
      return
    }

    // Presets keep the real wordmark: dimming it preserves its exact glyphs,
    // shadows, and theme colours (no hand-drawn wordmark to misspell).
    const customWordmark = configValue.wordmark
      ? renderWordmark(configValue.wordmark, theme)
      : undefined
    if (customWordmark && customWordmark.width > 0) {
      try {
        if (logo.opacity !== 0) logo.opacity = 0
      } catch {}
      const desiredX = Math.max(
        0,
        Math.round(logo.x + (logo.width - customWordmark.width) / 2),
      )
      const desiredY = Math.max(
        0,
        Math.round(logo.y + (logo.height - customWordmark.height) / 2),
      )
      setArtGlyphs(collectGlyphs(customWordmark, desiredX, desiredY))
      setArtOn(false)
      setArtFrame(EMPTY)
    } else {
      const pulse = configValue.shimmer ? 0.9 + 0.1 * Math.sin((now / 1000) * 1.6) : 1
      const target = clamp(configValue.opacity * pulse, 0.05, 1)
      try {
        if (Math.abs((logo.opacity ?? 1) - target) > 0.01) logo.opacity = target
      } catch {}
      setArtGlyphs([])
      setArtOn(false)
      setArtFrame(EMPTY)
    }

    setMatrixGlyphs([])
    let matrix: ArtFrame | undefined
    if (configValue.effect === "matrix" && !musicVisible) {
      if (configValue.fullscreen) {
        const width = Math.max(8, Math.floor(Number(root.width)))
        const height = Math.max(6, Math.floor(Number(root.height)))
        const mask = buildMask(root, logo, promptBox, width, height)
        matrix = renderMatrix(matrixEngine, configValue, theme, now, width, height, {
          full: true,
          mask,
        })
        setMatrixFrame(matrix)
        setMatrixGlyphs(collectGlyphs(matrix))
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
          setMatrixGlyphs(collectGlyphs(matrix))
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

async function musicArtCommand(plugin: any, input?: string) {
  const argument = String(input ?? "").trim().toLowerCase()
  const current = readConfig()
  const toast = (message: string, variant: "success" | "warning" | "error" = "success") =>
    plugin.ui.toast.show({ title: "Music art", message, variant, duration: 4000 })

  if (argument === "on" || argument === "off") {
    const musicArt = argument === "on"
    // Turning music art on should also re-enable the cover-art effect: the
    // master switch may have been turned off with `/art`, and a command that
    // says "on" must actually paint something.
    writeConfig({ ...current, musicArt, ...(musicArt ? { enabled: true } : {}) })
    const rain = current.effect === "matrix" ? " · matrix rain paused while a track plays" : ""
    toast(musicArt ? `On — album art background${rain}` : `Off — ${current.effect === "matrix" ? "matrix rain active" : "stock background"}`)
    return
  }

  if (argument === "toggle") {
    const musicArt = !current.musicArt
    writeConfig({ ...current, musicArt, ...(musicArt ? { enabled: true } : {}) })
    toast(musicArt ? "On — album art background" : "Off — stock background")
    return
  }

  if (argument === "status" || argument === "") {
    const nowPlaying = readNowPlaying()
    if (!current.musicArt) {
      toast(`Off — ${current.effect === "matrix" ? "matrix rain active" : "stock background"}`, "warning")
      return
    }
    if (!current.enabled) {
      toast("On — but cover art is disabled. Run /music-art on to enable it.", "warning")
      return
    }
    if (!nowPlaying) {
      toast("On — waiting for the now-playing daemon", "warning")
      return
    }
    if (nowPlaying.stale) {
      toast("On — daemon is stale (no update for 2 min) · rain active", "warning")
      return
    }
    if (nowPlaying.playing) {
      const track = [nowPlaying.title, nowPlaying.artist].filter(Boolean).join(" — ")
      toast(`On — ${track || "playing"} (${nowPlaying.source}) · rain paused`)
      return
    }
    const track = [nowPlaying.title, nowPlaying.artist].filter(Boolean).join(" — ")
    toast(`On — paused${track ? `: ${track}` : ""} · rain active`, "warning")
    return
  }

  toast(`Unknown option "${argument}". Use /music-art on, off, or status.`, "error")
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
      title: current.musicArt ? "✓ Album art background" : "Album art background",
      value: "music:toggle",
      description: "Spotify sleeve from the now-playing daemon · pauses the rain",
      category: "Music art",
    },
    ...[
      ["Ghost", 0.18],
      ["Soft", 0.28],
      ["Clear", 0.4],
      ["Bold", 0.55],
    ].map(([label, value]) => ({
      title: `${label} (${value})`,
      value: `music:${value}`,
      description: "How strongly the album art shows through",
      category: "Music art faintness",
    })),
    {
      title: current.wordmark === "OMENCODE" ? "✓ Wordmark: OMENCODE" : "Wordmark: OMENCODE",
      value: "wordmark:OMENCODE",
      description: "Use a custom block wordmark instead of the stock logo",
      category: "Wordmark",
    },
    {
      title: current.wordmark ? "Use stock opencode logo" : "✓ Stock opencode logo",
      value: "wordmark:stock",
      description: "Keep the real OpenCode wordmark and only dim it",
      category: "Wordmark",
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

    if (picked === "music:toggle") {
      const musicArt = !current.musicArt
      writeConfig({ ...current, musicArt, ...(musicArt ? { enabled: true } : {}) })
      plugin.ui.toast.show({
        title: "Music art",
        message: musicArt ? "On · matrix rain paused while playing" : "Off · stock background",
        variant: "success",
      })
      return
    }

    if (picked.startsWith("music:")) {
      const value = Number(picked.slice("music:".length))
      writeConfig({ ...current, musicOpacity: value })
      plugin.ui.toast.show({
        title: "Music art",
        message: `Artwork opacity ${value}`,
        variant: "success",
      })
      return
    }

    if (picked.startsWith("wordmark:")) {
      const value = picked.slice("wordmark:".length)
      writeConfig({ ...current, wordmark: value === "stock" ? null : value })
      plugin.ui.toast.show({
        title: "Cover art",
        message: value === "stock" ? "Stock wordmark" : `Wordmark: ${value}`,
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
        {
          id: "coverart.music",
          title: "Music art (now playing)",
          description: "Album art background · on | off | status",
          group: "Cover art",
          palette: true,
          slash: { name: "music-art", arguments: true },
          run: (input?: string) => musicArtCommand(context, input),
        },
      ],
    }))
  },
})
