// Shared between the TUI plugin (Bun) and the MCP server (Node).
// Pure ESM, no external dependencies.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")

export const CONFIG_PATH =
  process.env.COVERART_CONFIG || path.join(configHome, "opencode", "cover-art.json")

const BLOCKS = "█▀▄░▒▓▁▂▃▅▆▇■□▪▫◆◇●○◎"
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export const PRESETS = {
  matrix: {
    title: "Rain",
    description: "Full-screen theme rain with a readable wordmark",
    config: {
      effect: "matrix",
      fullscreen: true,
      shimmer: false,
      fps: 6,
      size: { width: 60, height: 20 },
      opacity: 0.55,
      rainOpacity: 0.2,
    },
  },
  "matrix-wordmark": {
    title: "Rain + shimmer",
    description: "Full-screen rain with a slow breathing wordmark",
    config: {
      effect: "matrix",
      fullscreen: true,
      shimmer: true,
      fps: 6,
      size: { width: 60, height: 20 },
      opacity: 0.55,
      rainOpacity: 0.2,
    },
  },
  wordmark: {
    title: "Ghost wordmark",
    description: "Just the faint, theme-coloured wordmark with a slow shimmer",
    config: {
      effect: "wordmark",
      fullscreen: true,
      shimmer: true,
      fps: 10,
      size: { width: 39, height: 4 },
      opacity: 0.6,
      rainOpacity: 0.2,
    },
  },
}

export const DEFAULT_CONFIG = {
  enabled: true,
  preset: "matrix",
  effect: "matrix",
  fullscreen: true,
  shimmer: false,
  fps: 6,
  size: { width: 60, height: 20 },
  opacity: 0.55,
  rainOpacity: 0.2,
  palette: ["#6B7280", "#9CA3AF", "#D1D5DB", "#E5E7EB"],
  frames: null,
  colorMap: null,
  background: null,
  wordmark: null,
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function normalizePalette(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const colors = value.filter((item) => typeof item === "string" && HEX.test(item)).slice(0, 8)
  return colors.length > 0 ? colors : [...fallback]
}

function normalizeColorMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const out = {}
  for (const [key, color] of Object.entries(value)) {
    if (typeof key !== "string" || [...key].length !== 1) continue
    if (typeof color !== "string" || !HEX.test(color)) continue
    out[key] = color.toLowerCase()
  }
  return Object.keys(out).length > 0 ? out : null
}

export function allowedChar(char) {
  const code = char.codePointAt(0)
  if (code === undefined) return false
  if (code >= 0x20 && code <= 0x7e) return true
  return BLOCKS.includes(char)
}

export function normalizeFrames(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("frames must be a non-empty array of frames")
  }
  if (input.length > 64) {
    throw new Error("frames: at most 64 frames are allowed")
  }

  const frames = input.map((frame, frameIndex) => {
    if (!Array.isArray(frame) || frame.length === 0) {
      throw new Error(`frames[${frameIndex}] must be a non-empty array of rows`)
    }
    if (frame.length > 8) {
      throw new Error(`frames[${frameIndex}]: at most 8 rows are allowed`)
    }
    return frame.map((row, rowIndex) => {
      if (typeof row !== "string") {
        throw new Error(`frames[${frameIndex}][${rowIndex}] must be a string`)
      }
      for (const char of row) {
        if (!allowedChar(char)) {
          throw new Error(
            `frames[${frameIndex}][${rowIndex}]: unsupported character ${JSON.stringify(char)}`,
          )
        }
      }
      return [...row]
    })
  })

  const width = Math.max(...frames.flatMap((frame) => frame.map((row) => row.length)))
  const height = Math.max(...frames.map((frame) => frame.length))
  if (width > 80) throw new Error("frames: at most 80 columns are allowed")
  if (height < 1) throw new Error("frames: at least one row is required")

  return frames.map((frame) => {
    const rows = frame.map((row) => {
      const padded = row.concat(Array(width - row.length).fill(" "))
      return padded.join("")
    })
    while (rows.length < height) rows.push(" ".repeat(width))
    return rows
  })
}

export function normalizeConfig(input) {
  const source = input && typeof input === "object" ? input : {}
  const frames = source.frames ? normalizeFrames(source.frames) : null
  const fallback = DEFAULT_CONFIG
  const effect = frames
    ? "frames"
    : ["matrix", "wordmark"].includes(source.effect)
      ? source.effect
      : fallback.effect
  const preset = frames
    ? "custom"
    : PRESETS[source.preset]
      ? source.preset
      : effect === "wordmark"
        ? "wordmark"
        : "matrix"

  return {
    enabled: source.enabled !== false,
    preset,
    effect,
    fullscreen: source.fullscreen !== false,
    shimmer: source.shimmer === true,
    fps: clamp(source.fps, 1, 30, fallback.fps),
    size: {
      width: clamp(source.size?.width, 8, 80, fallback.size.width),
      height: clamp(source.size?.height, 2, 24, fallback.size.height),
    },
    opacity: clamp(source.opacity, 0.05, 1, fallback.opacity),
    rainOpacity: clamp(source.rainOpacity, 0.05, 1, fallback.rainOpacity),
    palette: normalizePalette(source.palette, fallback.palette),
    frames,
    colorMap: normalizeColorMap(source.colorMap),
    background:
      typeof source.background === "string" && HEX.test(source.background)
        ? source.background.toLowerCase()
        : null,
    wordmark:
      typeof source.wordmark === "string" && source.wordmark.trim()
        ? source.wordmark.trim().replace(/[^\w .-]/g, "").slice(0, 16) || null
        : null,
  }
}

export function readConfig() {
  try {
    // Editors on Windows (Notepad, PowerShell 5's Set-Content -Encoding UTF8)
    // often prepend a UTF-8 BOM. JSON.parse rejects it, which used to make the
    // plugin silently fall back to defaults and ignore every user setting.
    const raw = readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, "")
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return normalizeConfig(DEFAULT_CONFIG)
  }
}

export function writeConfig(input) {
  const config = normalizeConfig(input)
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  const temporary = `${CONFIG_PATH}.tmp`
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  renameSync(temporary, CONFIG_PATH)
  return config
}

export function configKey(config) {
  return JSON.stringify(config)
}

export function configForPreset(name, base = DEFAULT_CONFIG) {
  const preset = PRESETS[name]
  if (!preset) {
    throw new Error(`unknown preset ${JSON.stringify(name)}; use ${Object.keys(PRESETS).join(", ")}`)
  }
  return normalizeConfig({
    ...base,
    ...preset.config,
    enabled: true,
    preset: name,
    frames: null,
    colorMap: null,
  })
}

export function describePresets() {
  return Object.entries(PRESETS).map(([name, preset]) => ({
    name,
    title: preset.title,
    description: preset.description,
    fps: preset.config.fps,
    size: preset.config.size,
    opacity: preset.config.opacity,
    rainOpacity: preset.config.rainOpacity,
    fullscreen: preset.config.fullscreen,
    effect: preset.config.effect,
    shimmer: preset.config.shimmer,
  }))
}

export function framesPreview(frames, index = 0) {
  const normalized = normalizeFrames(frames)
  const frame = normalized[Math.max(0, Math.min(normalized.length - 1, index))]
  return frame.join("\n")
}
