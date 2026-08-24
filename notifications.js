// Notification plugin: Windows toast notification (Action Centre) on session idle.
// Uses child_process.execSync to avoid Bun shell escaping issues on Windows.
import { execSync } from "child_process"
import { join } from "path"

export const NotifyPlugin = async () => {
  const ps1 = join(import.meta.dir, "notify.ps1")
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        try {
          execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, { stdio: "ignore" })
        } catch (e) {
          // Non-fatal: ignore if toast API is unavailable.
        }
      }
    },
  }
}
