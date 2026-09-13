// Clipboard text paste workaround for Windows terminals that don't support bracketed paste
// Exposes a `paste_text` tool that reads the Windows clipboard.

import { execSync } from "child_process"
import { tool } from "@opencode-ai/plugin"

function readClipboardText() {
  try {
    const text = execSync("powershell -NoProfile -Command \"Get-Clipboard\"", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim()
    return text || null
  } catch {
    return null
  }
}

export const ClipboardPaste = async () => {
  return {
    tool: {
      paste_text: tool({
        description: "Read text from the Windows clipboard",
        args: {},
        async execute() {
          return readClipboardText() ?? "(clipboard empty)"
        },
      }),
    },
  }
}
