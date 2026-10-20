export type Span = { text: string; color?: any }
export type ArtFrame = { rows: Span[][]; width: number; height: number }

type MatrixColumn = {
  y: number
  speed: number
  length: number
  glyphs: string[]
  change: number
  offset: number
}

export type Engine = {
  key: string
  width: number
  height: number
  last: number
  columns: MatrixColumn[]
}

export type MatrixOptions = {
  full?: boolean
  mask?: (x: number, y: number) => boolean
}

const HEAD_GLYPHS = ["▓", "▒", "░", "*", "+", ":"]
const TRAIL_GLYPHS = ["░", "▒", "░", "▒", "▓", ".", ":", "*"]

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

function themeText(theme: any, key: "base" | "muted", fallback: string) {
  // The TUI has shipped both `theme.text.base` (older payloads) and a flat
  // `theme.text` RGBA colour (current). Accept either shape so the rain follows
  // the active theme instead of silently falling back to a fixed grey.
  const current = theme?.current ?? theme
  if (key === "base") return current?.text?.base ?? current?.text ?? fallback
  return current?.textMuted?.base ?? current?.textMuted ?? current?.text?.muted ?? fallback
}

function makeColumn(height: number, full: boolean): MatrixColumn {
  const span = full ? Math.min(18, Math.max(6, Math.floor(height / 2))) : height
  const length = clamp(3 + Math.floor(Math.random() * span), 3, full ? height : height + 1)
  return {
    y: Math.random() * (height + length) - length * 0.5,
    speed: full ? 1.4 + Math.random() * 2.4 : 2.2 + Math.random() * 3.3,
    length,
    glyphs: Array.from({ length: 24 }, () => pick(TRAIL_GLYPHS)),
    change: 2 + Math.floor(Math.random() * 4),
    offset: Math.floor(Math.random() * TRAIL_GLYPHS.length),
  }
}

function resetColumn(column: MatrixColumn, height: number, full: boolean) {
  const next = makeColumn(height, full)
  column.y = -next.length - Math.random() * 2
  column.speed = next.speed
  column.length = next.length
  column.glyphs = next.glyphs
  column.change = next.change
  column.offset = next.offset
}

function blank(height: number, width: number) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => undefined as { char: string; color?: any } | undefined),
  )
}

function toFrame(cells: Array<Array<{ char: string; color?: any } | undefined>>, width: number): ArtFrame {
  const rows: Span[][] = cells.map((row) => {
    const spans: Span[] = []
    for (let x = 0; x < width; x += 1) {
      const cell = row[x]
      const text = cell?.char ?? " "
      const color = cell?.color
      const last = spans[spans.length - 1]
      if (last && last.color === color) last.text += text
      else spans.push({ text, color })
    }
    return spans
  })
  return { rows, width, height: rows.length }
}

export function createEngine(): Engine {
  return { key: "", width: 0, height: 0, last: 0, columns: [] }
}

// A soft, sparse rain strip. It is deliberately dim: the overlay opacity does
// most of the fading, and the glyph mix keeps it from looking like solid text.
export function renderMatrix(
  engine: Engine,
  config: any,
  theme: any,
  now: number,
  width: number,
  height: number,
  options: MatrixOptions = {},
): ArtFrame {
  const full = options.full === true
  const key = `${width}x${height}:${full ? "full" : "panel"}`
  if (engine.key !== key) {
    engine.key = key
    engine.width = width
    engine.height = height
    engine.columns = []
    engine.last = now
  }

  if (engine.columns.length !== width) {
    engine.columns = Array.from({ length: width }, () => makeColumn(height, full))
  }

  const dt = engine.last === 0 ? 0.1 : clamp((now - engine.last) / 1000, 0, 0.25)
  engine.last = now

  const muted = themeText(theme, "muted", "#6B7280")
  const base = themeText(theme, "base", "#E5E7EB")
  // Full-screen rows are character strings plus a head mask. Only the leading
  // glyphs are bright; the trails fade into the theme's muted text colour. This
  // keeps a screen-sized animation much cheaper than a span per cell.
  const rows = full
    ? Array.from({ length: height }, () => Array<string>(width).fill(" "))
    : undefined
  const heads = full
    ? Array.from({ length: height }, () => Array<boolean>(width).fill(false))
    : undefined
  const cells = full ? undefined : blank(height, width)

  for (let x = 0; x < width; x += 1) {
    const column = engine.columns[x]!
    column.y += column.speed * dt
    if (column.y - column.length > height) resetColumn(column, height, full)

    column.change -= 1
    if (column.change <= 0) {
      column.glyphs = Array.from({ length: 24 }, () => pick(TRAIL_GLYPHS))
      column.change = 2 + Math.floor(Math.random() * 4)
    }

    const fade = full ? 0.25 : width <= 1 ? 0 : x / (width - 1)
    const head = Math.floor(column.y)
    for (let trail = 0; trail < column.length; trail += 1) {
      const y = head - trail
      if (y < 0 || y >= height) continue
      // Keep text and chrome completely clear. The mask covers the wordmark,
      // prompt box, tab bar, footer, and scrollbar.
      if (options.mask?.(x, y)) continue
      if (
        options.mask &&
        (options.mask(x - 1, y) ||
          options.mask(x + 1, y) ||
          options.mask(x, y - 1) ||
          options.mask(x, y + 1)) &&
        Math.random() < 0.65
      ) {
        continue
      }
      // Thin out the right edge so the strip dissolves instead of ending in a wall.
      if (!full && fade > 0.6 && trail > 0 && Math.random() < (fade - 0.6) * 1.2) continue
      // Soften the top and bottom edges of the canvas so it blends into the page.
      const edge = Math.min(y, height - 1 - y)
      if (edge === 0 && Math.random() < 0.65) continue
      if (edge === 1 && Math.random() < 0.3) continue

      const glyph =
        trail === 0
          ? pick(HEAD_GLYPHS)
          : column.glyphs[(trail + column.offset) % column.glyphs.length]!
      if (full) {
        rows![y]![x] = glyph
        heads![y]![x] = trail <= 1
      } else {
        const color =
          trail === 0
            ? fade < 0.55
              ? base
              : muted
            : trail <= 1 && fade < 0.3
              ? base
              : muted
        cells![y]![x] = { char: glyph, color }
      }
    }
  }

  if (rows && heads) {
    return {
      rows: rows.map((row, y) => {
        const spans: Span[] = []
        let start = 0
        let color = heads[y]![0] ? base : muted
        for (let x = 1; x < width; x += 1) {
          const nextColor = heads[y]![x] ? base : muted
          if (nextColor !== color) {
            spans.push({ text: row.slice(start, x).join(""), color })
            start = x
            color = nextColor
          }
        }
        spans.push({ text: row.slice(start).join(""), color })
        return spans
      }),
      width,
      height,
    }
  }
  return toFrame(cells!, width)
}

export function renderFrames(config: any, theme: any, now: number): ArtFrame {
  const frames = config.frames as string[][]
  const fps = clamp(Number(config.fps) || 10, 1, 30)
  const index = Math.floor((now / 1000) * fps) % frames.length
  const rows = frames[index]!
  const colorMap = config.colorMap as Record<string, string> | null
  const fallback = config.palette?.[0] ?? themeText(theme, "base", "#E5E7EB")
  const cells = rows.map((row) =>
    [...row].map((char) => {
      if (char === " ") return undefined
      return { char, color: colorMap?.[char] ?? fallback }
    }),
  )
  return toFrame(cells, rows[0]?.length ?? 0)
}
