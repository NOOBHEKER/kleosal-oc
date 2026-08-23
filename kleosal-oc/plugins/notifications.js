// ╌╌╌ ​agastyas shii​ · github.com/agastyas-shii · notifications plugin ╌╌╌
// Notification plugin: pop a desktop MessageBox when the session goes idle
// (i.e. the agent has finished its turn).
export const NotifyPlugin = async ({ $ }) => {
  return {
    "session.idle": async () => {
      try {
        await $`powershell -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.MessageBox]::Show('OpenCode session completed.', 'opencode', 'OK', 'Information')"`
      } catch (e) {
        // Non-fatal: ignore if MessageBox can't be shown (e.g. headless).
      }
    },
  }
}
