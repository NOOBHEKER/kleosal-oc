#!/usr/bin/env node
// Minimal, dependency-free MCP stdio server for the cover-art plugin.
// It owns the shared JSON config; the TUI plugin polls that file and redraws.

import readline from "node:readline"
import {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  PRESETS,
  configForPreset,
  describePresets,
  framesPreview,
  normalizeConfig,
  readConfig,
  writeConfig,
} from "../shared.mjs"

const SERVER_INFO = { name: "coverart", version: "1.0.0" }
const DEFAULT_PROTOCOL = "2025-06-18"

const INSTRUCTIONS = [
  "Use these tools to change the OpenCode home-screen cover art.",
  "The art is a translucent, theme-coloured character canvas drawn behind the home screen.",
  "Changes apply to the running TUI within about half a second; no restart is needed.",
  "Presets: matrix (full-screen rain with a readable wordmark), matrix-wordmark (same with a slow shimmer), wordmark (ghost wordmark only).",
  "The rain is masked around the wordmark, prompt, tab bar, and footer so text stays perfectly readable.",
  "For custom animation, call set_frames with an array of frames; each frame is an array of equal-length rows.",
  "Rows may contain printable ASCII and block glyphs (█ ▀ ▄ ░ ▒ ▓ ▁ ▂ ▃ ▅ ▆ ▇ ■ □ ▪ ▫). Maximum 8 rows, 80 columns, 64 frames.",
  "Use colorMap to give characters hex colors, e.g. {\"█\":\"#7DD3FC\"}; unmapped characters use palette[0].",
  "Call set_options with enabled:false to restore the stock opencode wordmark, or reset to go back to the default full-screen rain.",
].join(" ")

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function ok(id, result) {
  send({ jsonrpc: "2.0", id, result })
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } })
}

function text(value) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: "text", text: body }] }
}

const TOOLS = [
  {
    name: "list_presets",
    description: "List the built-in cover-art presets with their effect, size, wordmark opacity, rain opacity, and frame rate.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_config",
    description: "Read the current cover-art configuration and the shared config file path.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "set_preset",
    description:
      "Switch to a built-in preset. matrix = full-screen theme rain with a readable wordmark; matrix-wordmark = same with a slow shimmer; wordmark = ghost wordmark only.",
    inputSchema: {
      type: "object",
      properties: { preset: { type: "string", enum: Object.keys(PRESETS) } },
      required: ["preset"],
      additionalProperties: false,
    },
  },
  {
    name: "set_frames",
    description:
      "Animate custom frames in the title area. frames is an array of frames; each frame is an array of rows (strings). " +
      "All rows are padded to the longest row and all frames to the largest frame. Max 8 rows, 80 columns, 64 frames. " +
      "Use colorMap to map single characters to hex colors. Example: " +
      '{"frames":[["  ▄▀▄  "," █   █ ","  ▀▄▀  "],["  ▄▀▄  "," █   █ "," ▀   ▀ "]],"fps":6,"colorMap":{"█":"#7DD3FC"}}.',
    inputSchema: {
      type: "object",
      properties: {
        frames: {
          type: "array",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string" },
          },
        },
        fps: { type: "integer", minimum: 1, maximum: 30 },
        palette: { type: "array", maxItems: 8, items: { type: "string" } },
        colorMap: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["frames"],
      additionalProperties: false,
    },
  },
  {
    name: "set_options",
    description:
      "Change options without switching source: enabled, fps, fullscreen, size, opacity, rainOpacity, palette, or background. " +
      "fullscreen draws rain across the whole screen with clean cutouts around text; size is the left-panel size when fullscreen is false (width 8-80, height 2-24). " +
      "opacity controls wordmark clarity (0.05-1) and rainOpacity controls the background rain (0.05-1). " +
      "The rain and wordmark use theme colours automatically; palette only affects custom frames.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        fullscreen: { type: "boolean" },
        fps: { type: "integer", minimum: 1, maximum: 30 },
        size: {
          type: "object",
          properties: {
            width: { type: "integer", minimum: 8, maximum: 80 },
            height: { type: "integer", minimum: 2, maximum: 24 },
          },
          additionalProperties: false,
        },
        opacity: { type: "number", minimum: 0.05, maximum: 1 },
        rainOpacity: { type: "number", minimum: 0.05, maximum: 1 },
        palette: { type: "array", maxItems: 8, items: { type: "string" } },
        background: {
          type: "string",
          description: "Hex background colour for the canvas, or omit for transparent.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "preview_frames",
    description:
      "Validate custom frames and return one frame as plain text without changing the live cover art. " +
      "Use it to check dimensions and characters before calling set_frames.",
    inputSchema: {
      type: "object",
      properties: {
        frames: {
          type: "array",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string" },
          },
        },
        index: { type: "integer", minimum: 0 },
      },
      required: ["frames"],
      additionalProperties: false,
    },
  },
  {
    name: "reset",
    description: "Restore the default configuration (full-screen rain, 0.55 wordmark / 0.2 rain, 8 fps, enabled).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
]

function callTool(name, args) {
  switch (name) {
    case "list_presets":
      return text(describePresets())

    case "get_config":
      return text({ path: CONFIG_PATH, config: readConfig() })

    case "set_preset": {
      const current = readConfig()
      const next = configForPreset(args.preset, current)
      writeConfig(next)
      return text({ applied: next })
    }

    case "set_frames": {
      const current = readConfig()
      const next = normalizeConfig({
        ...current,
        preset: "custom",
        effect: "frames",
        fps: args.fps ?? current.fps,
        palette: args.palette ?? current.palette,
        colorMap: args.colorMap ?? null,
        frames: args.frames,
      })
      writeConfig(next)
      return text({
        applied: next,
        size: { width: next.frames[0].length, height: next.frames.length },
      })
    }

    case "set_options": {
      const current = readConfig()
      const next = normalizeConfig({
        ...current,
        ...args,
        size: args.size ? { ...current.size, ...args.size } : current.size,
      })
      writeConfig(next)
      return text({ applied: next })
    }

    case "preview_frames": {
      const preview = framesPreview(args.frames, args.index ?? 0)
      return text(preview)
    }

    case "reset": {
      const next = writeConfig(normalizeConfig(DEFAULT_CONFIG))
      return text({ applied: next })
    }

    default:
      throw new Error(`unknown tool ${JSON.stringify(name)}`)
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on("line", (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let message
  try {
    message = JSON.parse(trimmed)
  } catch (error) {
    process.stderr.write(`coverart: invalid JSON: ${error.message}\n`)
    return
  }

  if (!message || typeof message !== "object") return
  const { id, method, params } = message

  if (method === "initialize") {
    ok(id, {
      protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    })
    return
  }

  if (method === "notifications/initialized") return
  if (method === "notifications/cancelled") return

  if (method === "ping") {
    ok(id, {})
    return
  }

  if (method === "tools/list") {
    ok(id, { tools: TOOLS })
    return
  }

  if (method === "resources/list") {
    ok(id, { resources: [] })
    return
  }

  if (method === "prompts/list") {
    ok(id, { prompts: [] })
    return
  }

  if (method === "tools/call") {
    const name = params?.name
    if (typeof name !== "string") {
      fail(id, -32602, "tools/call requires params.name")
      return
    }
    try {
      const result = callTool(name, params.arguments ?? {})
      ok(id, result)
    } catch (error) {
      process.stderr.write(`coverart: ${name} failed: ${error?.message ?? error}\n`)
      ok(id, { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true })
    }
    return
  }

  if (method === "shutdown") {
    ok(id, null)
    return
  }

  if (method === "exit") {
    process.exit(0)
  }

  fail(id, -32601, `method not found: ${method}`)
})

process.stderr.write(`coverart: MCP ready (${CONFIG_PATH})\n`)
