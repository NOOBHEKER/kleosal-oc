// Notification plugin: Windows toast notifications (Action Centre)
// Handles: session.idle, permission.ask
// Uses child_process.execSync to avoid Bun shell escaping issues on Windows.
import { execSync } from "child_process"
import { join } from "path"

function notify(title, message) {
  const ps1 = join(import.meta.dir, "notify.ps1")
  const safeTitle = title.replace(/"/g, '""')
  const safeMsg = message.replace(/"/g, '""')
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}" -Title "${safeTitle}" -Message "${safeMsg}"`, { stdio: "ignore" })
  } catch (e) {
    // Non-fatal: ignore if toast API is unavailable.
  }
}

export const NotifyPlugin = async () => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        notify("opencode", "Session idle — task complete.")
      }

      if (event.type === "permission.ask") {
        const tool = event.properties?.tool || "unknown"
        const reason = event.properties?.reason || "needs permission"
        notify("Permission Needed", `${tool}: ${reason}`)
      }
    },
  }
}
