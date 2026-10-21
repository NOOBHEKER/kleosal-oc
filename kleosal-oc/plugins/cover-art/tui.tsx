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
type PaintCell = { x: number; y: number; color: string; alpha?: number }
type PaintSleeveCell = {
  x: number
  y: number
  top: string
  bottom: string
  avg: string
  // Prompt panels keep their own background; the card only tints those cells
  // instead of dropping a block glyph on top of the input.
  tint?: boolean
}
type ArtSleeve = { size: number; data: Uint8Array }
type ArtImage = { key: string; width: number; height: number; data: Uint8Array; sleeve: ArtSleeve }
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

function bilinear(
  data: Uint8Array,
  fw: number,
  fh: number,
  fx: number,
  fy: number,
): [number, number, number] {
  const x = clamp(fx, 0, fw - 1)
  const y = clamp(fy, 0, fh - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(fw - 1, x0 + 1)
  const y1 = Math.min(fh - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const i00 = (y0 * fw + x0) * 3
  const i10 = (y0 * fw + x1) * 3
  const i01 = (y1 * fw + x0) * 3
  const i11 = (y1 * fw + x1) * 3
  const r0 = (data[i00] ?? 0) * (1 - tx) + (data[i10] ?? 0) * tx
  const g0 = (data[i00 + 1] ?? 0) * (1 - tx) + (data[i10 + 1] ?? 0) * tx
  const b0 = (data[i00 + 2] ?? 0) * (1 - tx) + (data[i10 + 2] ?? 0) * tx
  const r1 = (data[i01] ?? 0) * (1 - tx) + (data[i11] ?? 0) * tx
  const g1 = (data[i01 + 1] ?? 0) * (1 - tx) + (data[i11 + 1] ?? 0) * tx
  const b1 = (data[i01 + 2] ?? 0) * (1 - tx) + (data[i11 + 2] ?? 0) * tx
  return [r0 * (1 - ty) + r1 * ty, g0 * (1 - ty) + g1 * ty, b0 * (1 - ty) + b1 * ty]
}

// The daemon already blur-extends the cover to a 16:10 raw RGB frame. The
// ambient layer samples that frame bilinearly at cell centres and applies a
// soft vignette. No glyphs, no hard card edge: just a smooth, quiet wash of the
// album's colours behind everything else.
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
  const data = image.data

  // The centre of the daemon frame is the sharp sleeve; the ambient wants it
  // as soft as the edges, so box-blur that region before sampling it.
  const fg = Math.max(16, Math.round(fh * 0.72))
  const sleeveLeft = Math.max(0, Math.floor((fw - fg) / 2))
  const sleeveTop = Math.max(0, Math.floor((fh - fg) / 2))
  const sleeveRight = Math.min(fw, sleeveLeft + fg)
  const sleeveBottom = Math.min(fh, sleeveTop + fg)
  const cellLeft = (sleeveLeft / fw) * width
  const cellRight = (sleeveRight / fw) * width
  const cellTop = (sleeveTop / fh) * height
  const cellBottom = (sleeveBottom / fh) * height
  const blur = Math.max(2, Math.round(fg / 10))
  // A gentle saturation lift keeps the wash from turning into grey mud on a
  // dark theme without making it loud. The paint alpha still keeps it quiet.
  const enrich = (red: number, green: number, blue: number) => {
    const gray = (red + green + blue) / 3
    return [
      clamp(gray + (red - gray) * 1.12, 0, 255),
      clamp(gray + (green - gray) * 1.12, 0, 255),
      clamp(gray + (blue - gray) * 1.12, 0, 255),
    ]
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask(x, y)) continue
      const nx = ((x + 0.5) / width) * 2 - 1
      const ny = ((y + 0.5) / height) * 2 - 1
      const vignette = 0.72 + 0.28 * (1 - Math.min(1, (nx * nx + ny * ny) / 2))
      const inSleeve = x >= cellLeft && x < cellRight && y >= cellTop && y < cellBottom
      if (inSleeve) {
        const sx = clamp(Math.floor(((x + 0.5) / width) * fw), sleeveLeft, sleeveRight - 1)
        const sy = clamp(Math.floor(((y + 0.5) / height) * fh), sleeveTop, sleeveBottom - 1)
        let red = 0
        let green = 0
        let blue = 0
        let count = 0
        for (let by = -blur; by <= blur; by += 1) {
          const yy = clamp(sy + by, sleeveTop, sleeveBottom - 1)
          const row = yy * rowBytes
          for (let bx = -blur; bx <= blur; bx += 1) {
            const xx = clamp(sx + bx, sleeveLeft, sleeveRight - 1)
            const offset = row + xx * 3
            red += data[offset] ?? 0
            green += data[offset + 1] ?? 0
            blue += data[offset + 2] ?? 0
            count += 1
          }
        }
        const [er, eg, eb] = enrich(
          (red / count) * vignette,
          (green / count) * vignette,
          (blue / count) * vignette,
        )
        cells.push({
          x,
          y,
          color: `#${byteHex(er)}${byteHex(eg)}${byteHex(eb)}`,
        })
        continue
      }
      const [red, green, blue] = bilinear(
        data,
        fw,
        fh,
        ((x + 0.5) / width) * fw - 0.5,
        ((y + 0.5) / height) * fh - 0.5,
      )
      const [er, eg, eb] = enrich(red * vignette, green * vignette, blue * vignette)
      cells.push({
        x,
        y,
        color: `#${byteHex(er)}${byteHex(eg)}${byteHex(eb)}`,
      })
    }
  }
  return cells
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

// The compact now-playing widget is a deliberate piece of chrome, not a
// full-screen photo. It lives in the empty top-right corner on home, shows a
// tiny cover thumbnail, the track text and a progress line, and fades away when
// a session opens. The ambient wash behind it is what carries the album's mood.
function cardOpacity(alpha: number) {
  return clamp(alpha * 3.2, 0, 1)
}

type CardLayout = {
  x0: number
  y0: number
  w: number
  h: number
  thumbX: number
  thumbY: number
  thumbW: number
  thumbH: number
  textX: number
  titleY: number
  artistY: number
  albumY: number
  barX: number
  barY: number
  barW: number
  maxChars: number
}

// Shared by the cell builder and the text/progress painter so the widget can
// never drift out of alignment.
function cardLayout(width: number, height: number): CardLayout | undefined {
  if (width < 40 || height < 12) return undefined
  const w = clamp(Math.round(width * 0.22), 26, 32)
  const h = 6
  const x0 = width - 2 - w
  const y0 = 3
  if (x0 < 2) return undefined
  return {
    x0,
    y0,
    w,
    h,
    thumbX: x0 + 1,
    thumbY: y0 + 1,
    thumbW: 7,
    thumbH: 4,
    textX: x0 + 9,
    titleY: y0 + 2,
    artistY: y0 + 3,
    albumY: y0 + 4,
    barX: x0 + 2,
    barY: y0 + h - 1,
    barW: w - 4,
    maxChars: w - 10,
  }
}

function buildSleeveCells(
  image: ArtImage,
  width: number,
  height: number,
  mask: Mask,
  time: number,
  tiltX: number,
  tiltY: number,
  cardAlpha: number,
): { card: PaintSleeveCell[]; shadow: PaintCell[] } {
  const card: PaintSleeveCell[] = []
  const shadow: PaintCell[] = []
  const sleeve = image.sleeve
  const layout = cardLayout(width, height)
  if (!sleeve || sleeve.size < 4 || !layout) return { card, shadow }
  const size = sleeve.size
  const data = sleeve.data
  const { x0, y0, w, h, thumbX, thumbY, thumbW, thumbH } = layout
  const pulse = 0.5 + 0.5 * Math.sin(time * 0.8)

  const inCard = (x: number, y: number) =>
    x >= x0 &&
    x < x0 + w &&
    y >= y0 &&
    y < y0 + h &&
    !((x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1))
  const inShadow = (x: number, y: number, left: number, top: number, sw: number, sh: number) =>
    x >= left &&
    x < left + sw &&
    y >= top &&
    y < top + sh &&
    !((x === left || x === left + sw - 1) && (y === top || y === top + sh - 1))

  // Two offset layers, the wide faint one first. The card edge stays crisp.
  const layers = [
    { dx: 0.7, dy: 0.9, grow: 0.5, alpha: cardAlpha * 0.22 },
    { dx: 1.3, dy: 1.6, grow: 1.0, alpha: cardAlpha * 0.1 },
  ]
  for (const layer of layers) {
    const alpha = clamp(layer.alpha, 0, 0.5)
    if (alpha <= 0.01) continue
    const left = Math.round(x0 + layer.dx - layer.grow + tiltX * 0.3)
    const top = Math.round(y0 + layer.dy - layer.grow + tiltY * 0.2)
    const sw = Math.round(w + layer.grow * 2)
    const sh = Math.round(h + layer.grow * 2)
    for (let y = top; y < top + sh; y += 1) {
      for (let x = left; x < left + sw; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        if (mask(x, y) || inCard(x, y)) continue
        if (!inShadow(x, y, left, top, sw, sh)) continue
        shadow.push({ x, y, color: "#000000", alpha })
      }
    }
  }

  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      if (mask(x, y) || !inCard(x, y)) continue
      const inThumb =
        x >= thumbX && x < thumbX + thumbW && y >= thumbY && y < thumbY + thumbH
      let red: number
      let green: number
      let blue: number
      if (inThumb) {
        const u = (x - thumbX + 0.5) / thumbW
        const v = (y - thumbY + 0.5) / thumbH
        const [sr, sg, sb] = bilinear(
          data,
          size,
          size,
          u * (size - 1),
          v * (size - 1),
        )
        // The thumbnail is the only part of the widget that shows the cover
        // literally, so keep it a little brighter than the surrounding glass.
        red = sr * 1.08 + 6
        green = sg * 1.08 + 6
        blue = sb * 1.08 + 8
      } else {
        const u = (x - x0 + 0.5) / w
        const [sr, sg, sb] = bilinear(data, size, size, u * (size - 1), size * 0.5)
        const shade = y === y0 ? 0.34 : 0.2
        red = 10 + sr * shade
        green = 12 + sg * shade
        blue = 18 + sb * shade
        if (y === y0) {
          red += 5 + pulse * 3
          green += 5 + pulse * 3
          blue += 7 + pulse * 4
        }
      }
      card.push({
        x,
        y,
        top: "",
        bottom: "",
        avg: `#${byteHex(red)}${byteHex(green)}${byteHex(blue)}`,
      })
    }
  }

  return { card, shadow }
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

let artImageCache: { key: string; image: ArtImage } | undefined

// The cover is usually a fairly muted photograph. A little extra contrast and
// saturation survives the cell quantisation and keeps the sleeve legible at
// terminal resolution; the blurred backdrop is left muted on purpose.
function boostChannel(value: number, luma: number) {
  const saturated = luma + (value - luma) * 1.22
  const contrasted = (saturated - 128) * 1.1 + 128
  return clamp(Math.round(contrasted + 2), 0, 255)
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
  if (artImageCache?.key === key) return artImageCache.image
  try {
    const raw = readFileSync(nowPlaying.framePath)
    const expected = nowPlaying.frameWidth * nowPlaying.frameHeight * 3
    if (raw.length < expected) return null
    const data = new Uint8Array(raw.buffer, raw.byteOffset, expected)
    const fw = nowPlaying.frameWidth
    const fh = nowPlaying.frameHeight
    // Extract and pre-tone the sharp square once per frame instead of doing it
    // for every cell on every animation tick.
    const size = Math.max(16, Math.round(fh * 0.72))
    const left = Math.max(0, Math.floor((fw - size) / 2))
    const top = Math.max(0, Math.floor((fh - size) / 2))
    const sleeveData = new Uint8Array(size * size * 3)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const source = ((top + y) * fw + left + x) * 3
        const target = (y * size + x) * 3
        const red = data[source] ?? 0
        const green = data[source + 1] ?? 0
        const blue = data[source + 2] ?? 0
        const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
        sleeveData[target] = boostChannel(red, luma)
        sleeveData[target + 1] = boostChannel(green, luma)
        sleeveData[target + 2] = boostChannel(blue, luma)
      }
    }
    const image: ArtImage = {
      key,
      width: fw,
      height: fh,
      data,
      sleeve: { size, data: sleeveData },
    }
    artImageCache = { key, image }
    return image
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
  const [musicCard, setMusicCard] = createSignal<PaintSleeveCell[]>([])
  const [musicShadow, setMusicShadow] = createSignal<PaintCell[]>([])
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
  let cardCacheAlpha = -1
  let cardColorCache = new Map<string, any>()
  let shadowCacheAlpha = -1
  let shadowColorCache = new Map<string, any>()
  // Smoothed pointer tilt. Keeping it outside draw() lets the easing continue
  // between ticks instead of snapping to the latest mouse event.
  let tiltX = 0
  let tiltY = 0
  // The concertina card is only shown on home. It eases out when a session
  // opens instead of vanishing between two frames, while the ambient wash stays.
  let cardFade = 0
  // Plain (non-reactive) track text for the widget; draw() refreshes it every
  // tick and paint() reads the current values.
  let cardMeta = { title: "", artist: "", album: "", progress: 0 }
  // Glyph cells the widget wrote last frame. The app does not repaint the empty
  // top-right corner, so these have to be erased explicitly when the widget
  // fades out or the track stops, otherwise the text would ghost on screen.
  let lastCardCells = new Set<number>()

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

  const clearMusic = () => {
    setMusicOn(false)
    setMusicCells([])
    setMusicCard([])
    setMusicShadow([])
    setMusicAlpha(0)
    tiltX = 0
    tiltY = 0
    cardFade = 0
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
      const width = Number(buffer.width)
      const height = Number(buffer.height)
      const wipe = (x: number, y: number, bg: any) => {
        try {
          if (typeof buffer.setCell === "function") buffer.setCell(x, y, " ", transparent, bg)
        } catch {}
      }
      // The app does not repaint the empty top-right corner, so widget glyphs
      // have to be erased explicitly when the widget goes away. Restore the
      // ambient colour where the wash is still running, otherwise use the dark
      // home background.
      const clearCardText = () => {
        if (!lastCardCells.size) return
        const cellsNow = musicCells()
        const alphaNow = musicAlpha()
        const ambient = alphaNow > 0 ? clamp(alphaNow, 0, 0.34) : 0
        const remaining = new Set(lastCardCells)
        if (ambient > 0) {
          for (const cell of cellsNow) {
            const key = cell.y * width + cell.x
            if (!remaining.has(key)) continue
            remaining.delete(key)
            wipe(cell.x, cell.y, packColor(cell.color, ambient))
          }
        }
        for (const key of remaining) {
          const x = key % width
          const y = Math.floor(key / width)
          if (x >= 0 && y >= 0 && x < width && y < height) wipe(x, y, packColor("#101218", 1))
        }
        lastCardCells.clear()
      }
      if (!configValue.enabled) {
        clearCardText()
        return
      }
      if (modalOpen()) return
      // Nothing to paint when the rain, wordmark and music are all idle. This
      // keeps session pages with no track playing completely untouched.
      if (!musicOn() && !matrixOn() && artGlyphs().length === 0) {
        clearCardText()
        return
      }
      // Snapshot which cells already hold a glyph before painting anything. The
      // card is a backdrop: on a text cell it is only a very light wash so the
      // response and the prompt keep their contrast, and the glyph itself is
      // never replaced (every art cell is written with a space background).
      let textMask: Uint8Array | undefined
      try {
        const chars = buffer.buffers.char
        const count = width * height
        const mask = new Uint8Array(count)
        for (let i = 0; i < count; i += 1) {
          const char = chars[i] ?? 32
          mask[i] = char !== 32 && char !== 0 ? 1 : 0
        }
        for (let i = 1; i < count; i += 1) {
          if ((chars[i] ?? 32) === 0 && (chars[i - 1] ?? 32) !== 32) mask[i] = 1
        }
        textMask = mask
      } catch {}
      const hasText = (x: number, y: number) => !!textMask && textMask[y * width + x] === 1
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

      if (active() && configValue.effect === "matrix" && matrixOn() && !musicOn()) {
        const alpha = clamp(Number(configValue.rainOpacity) || 0, 0, 1)
        if (alpha > 0) {
          if (rainAlpha !== alpha) {
            rainAlpha = alpha
            rainColors = new Map()
          }
          draw(matrixGlyphs(), matrixX(), matrixY(), alpha, rainColors)
        }
      }

      // Album art from the now-playing daemon. The ambient wash is sampled from
      // the daemon's already-blurred frame and painted as tinted space cells, so
      // glyphs are never replaced. It stays on every route, including sessions.
      const cells = musicCells()
      const alpha = musicAlpha()
      const ambientAlpha = clamp(alpha, 0, 0.34)
      if (cells.length && ambientAlpha > 0) {
        if (musicCacheAlpha !== ambientAlpha) {
          musicCacheAlpha = ambientAlpha
          musicColorCache = new Map()
        }
        const textAlpha = ambientAlpha * 0.5
        for (const cell of cells) {
          const overText = hasText(cell.x, cell.y)
          const key = overText ? `${cell.color}~text` : cell.color
          let bg = musicColorCache.get(key)
          if (!bg) {
            bg = packColor(cell.color, overText ? textAlpha : ambientAlpha)
            musicColorCache.set(key, bg)
          }
          // A space overlay makes OpenTUI blend the art into the cell
          // background and tint the existing character instead of replacing
          // it, so prompt text, tabs and dialogs keep their glyphs. Over a
          // glyph the wash is halved so contrast is preserved.
          buffer.setCellWithAlphaBlending(cell.x, cell.y, " ", transparent, bg)
        }
      }

      // The compact card is the one deliberate focal point. It lives in the
      // empty top-right corner on the home screen and eases out (while the
      // ambient stays behind the session) as soon as a session opens.
      const cardAlpha = cardOpacity(alpha) * cardFade
      const shadow = musicShadow()
      if (shadow.length && cardAlpha > 0) {
        if (shadowCacheAlpha !== cardAlpha) {
          shadowCacheAlpha = cardAlpha
          shadowColorCache = new Map()
        }
        for (const cell of shadow) {
          const overText = hasText(cell.x, cell.y)
          const shaded = (cell.alpha ?? 0) * (overText ? 0.35 : 1) * cardFade
          if (shaded <= 0.005) continue
          const key = `${cell.color}:${shaded.toFixed(3)}`
          let bg = shadowColorCache.get(key)
          if (!bg) {
            bg = packColor(cell.color, shaded)
            shadowColorCache.set(key, bg)
          }
          buffer.setCellWithAlphaBlending(cell.x, cell.y, " ", transparent, bg)
        }
      }

      const sleeve = musicCard()
      if (sleeve.length && cardAlpha > 0) {
        if (cardCacheAlpha !== cardAlpha) {
          cardCacheAlpha = cardAlpha
          cardColorCache = new Map()
        }
        for (const cell of sleeve) {
          // The card sits in empty chrome, so it can be nearly opaque. If a
          // glyph does end up underneath it, keep that cell readable instead of
          // stamping over the character.
          const overText = hasText(cell.x, cell.y)
          const cellAlpha = overText ? cardAlpha * 0.35 : cardAlpha
          if (cellAlpha <= 0.005) continue
          const key = `${cell.avg}:${cellAlpha.toFixed(3)}`
          let bg = cardColorCache.get(key)
          if (!bg) {
            bg = packColor(cell.avg, cellAlpha)
            cardColorCache.set(key, bg)
          }
          buffer.setCellWithAlphaBlending(cell.x, cell.y, " ", transparent, bg)
        }

        // Text and progress line for the widget. They are ordinary glyphs, but
        // only painted in the empty top-right chrome; a cell that already holds
        // app text is left alone so no UI character can be overwritten.
        const painted = new Set<number>()
        const layout = cardLayout(width, height)
        if (layout) {
          const textAlpha = clamp(cardAlpha, 0, 1)
          const putText = (x: number, y: number, text: string, color: string) => {
            const chars = Array.from(text).slice(0, layout.maxChars)
            for (let i = 0; i < chars.length; i += 1) {
              const cx = x + i
              if (cx >= width || cx > layout.x0 + layout.w - 2 || y < 0 || y >= height) break
              if (hasText(cx, y)) continue
              buffer.setCellWithAlphaBlending(
                cx,
                y,
                chars[i],
                packColor(color, textAlpha),
                transparent,
              )
              painted.add(y * width + cx)
            }
          }
          putText(layout.textX, layout.titleY, cardMeta.title, "#f4f7fb")
          putText(layout.textX, layout.artistY, cardMeta.artist, "#aeb8c8")
          putText(layout.textX, layout.albumY, cardMeta.album, "#7f8b9e")

          const filled = Math.round(layout.barW * clamp(cardMeta.progress, 0, 1))
          for (let i = 0; i < layout.barW; i += 1) {
            const x = layout.barX + i
            if (x >= width || hasText(x, layout.barY)) continue
            const on = i < filled
            const color = on ? "#e6edf8" : "#2a3140"
            const alpha = (on ? 0.95 : 0.7) * textAlpha
            buffer.setCellWithAlphaBlending(x, layout.barY, " ", transparent, packColor(color, alpha))
            painted.add(layout.barY * width + x)
          }
        }

        // A changing title can leave glyphs on cells the new title no longer
        // covers. Wipe just the difference back to the card's own colour.
        const stale = new Set(lastCardCells)
        for (const key of painted) stale.delete(key)
        if (stale.size) {
          const cardColors = new Map<number, string>()
          for (const cell of sleeve) cardColors.set(cell.y * width + cell.x, cell.avg)
          for (const key of stale) {
            const x = key % width
            const y = Math.floor(key / width)
            if (x < 0 || y < 0 || x >= width || y >= height || hasText(x, y)) continue
            const color = cardColors.get(key)
            wipe(x, y, packColor(color ?? "#101218", color ? cardAlpha : 1))
          }
        }
        lastCardCells = painted
      } else {
        clearCardText()
      }

      // The custom wordmark is painted here, after the rain and after every
      // renderable. That makes it independent of z-index/background painting and
      // still leaves it with no hit-test node of its own. It belongs to the home
      // screen only; session pages keep just the ambient wash.
      const wordmark = artGlyphs()
      if (active() && wordmark.length) {
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
    setBackground(configValue.background ?? undefined)
    if (!configValue.enabled) {
      restore()
      setMatrixOn(false)
      setArtGlyphs([])
      setArtOn(false)
      clearMusic()
      try {
        plugin.renderer?.requestRender?.()
      } catch {}
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
    clearMusic()
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
        clearMusic()
      }
    }
  }

  function draw() {
    const configValue = config()
    const root = plugin.renderer?.root
    if (!root) return

    const now = Date.now()
    const home = active()
    if (!logo || !logo.parent || now - lastScan > 500) {
      logo = findLogo(root)
      lastScan = now
      promptBox = undefined
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
    const duration = Number(np?.durationMs) || 0
    cardMeta = {
      title: String(np?.title ?? ""),
      artist: String(np?.artist ?? ""),
      album: String(np?.album ?? ""),
      progress: duration > 0 ? clamp((Number(np?.progressMs) || 0) / duration, 0, 1) : 0,
    }
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
        // Same fallback rectangle as buildMask(): once the user types, the
        // \"Ask anything\" placeholder is gone and findPromptBox() returns
        // nothing, but the input is still in the same place under the logo.
        const fallbackPromptWidth = Math.min(76, Math.max(20, rootWidth - 44))
        const prompt =
          home && promptBox && Number(promptBox.width) > 0
            ? {
                x: Number(promptBox.x),
                y: Number(promptBox.y),
                width: Number(promptBox.width),
                height: Number(promptBox.height),
              }
            : home && logo
              ? {
                  x: Math.max(2, Math.round((rootWidth - fallbackPromptWidth) / 2)),
                  y: Math.round(Number(logo.y) || 0) + 5,
                  width: fallbackPromptWidth,
                  height: 9,
                }
              : undefined

        // The prompt panel is never painted: it keeps its own background and
        // the question stays exactly as readable as it is without the art.
        const promptOnly: Mask =
          prompt
            ? (x, y) =>
                x >= prompt.x - 2 &&
                x <= prompt.x + prompt.width + 2 &&
                y >= prompt.y - 1 &&
                y <= prompt.y + prompt.height + 3
            : () => false
        const mask: Mask = (x, y) => y < 2 || y >= rootHeight - 2 || promptOnly(x, y)

        const layout = `${image.key}:${rootWidth}x${rootHeight}:${prompt?.x ?? -1}:${prompt?.y ?? -1}:${
          prompt?.width ?? 0
        }:${prompt?.height ?? 0}`
        if (layout !== musicLayoutKey) {
          musicLayoutKey = layout
          setMusicCells(buildMusicCells(image, rootWidth, rootHeight, mask))
        }

        const host: any = plugin.renderer
        let targetX = 0
        let targetY = 0
        if (host?._hasPointer) {
          const px = Number(host._latestPointer?.x)
          const py = Number(host._latestPointer?.y)
          if (Number.isFinite(px) && Number.isFinite(py)) {
            targetX = clamp((px - rootWidth / 2) / Math.max(1, rootWidth / 2), -1, 1)
            targetY = clamp((py - rootHeight / 2) / Math.max(1, rootHeight / 2), -1, 1)
          }
        }
        tiltX += (targetX - tiltX) * 0.16
        tiltY += (targetY - tiltY) * 0.16

        // The card is home-only. It eases out when a session opens while the
        // ambient wash above stays behind the session.
        cardFade += ((home ? 1 : 0) - cardFade) * 0.18
        if (home) {
          const sleeve = buildSleeveCells(
            image,
            rootWidth,
            rootHeight,
            mask,
            now / 1000,
            tiltX,
            tiltY,
            cardOpacity(alpha),
          )
          setMusicShadow(sleeve.shadow)
          setMusicCard(sleeve.card)
        } else if (cardFade < 0.01) {
          cardFade = 0
          if (musicCard().length || musicShadow().length) {
            setMusicCard([])
            setMusicShadow([])
          }
        }
        setMusicAlpha(alpha)
        setMusicOn(true)
        musicVisible = true
      } else if (!playing) {
        musicStopped = true
      }
    }
    if (!musicVisible) {
      if (musicOn() || musicCells().length || musicCard().length) {
        clearMusic()
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

    // From here on the code drives home-only art: the stock logo, frames, the
    // custom wordmark and the matrix rain. The ambient wash is already running
    // on every route, so a session keeps the music atmosphere without any of
    // these home-screen decorations.
    const artEl = findById(root, ART_ID)
    if (!home || !logo) {
      setMatrixOn(false)
      setArtGlyphs([])
      setArtOn(false)
      setArtFrame(EMPTY)
      return
    }
    if (!artEl) return

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
