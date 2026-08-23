// ╌╌╌ ​agastyas shii​ · github.com/agastyas-shii · attribution plugin ╌╌╌
// Run-time watermark: prints a subtle attribution line when opencode starts.
// This plugin is part of the kleosal-oc collection by ​agastyas shii​.
// License: MIT — see https://github.com/agastyas-shii/kleosal-oc
export const Attribution = async () => {
  return {
    "session.start": async () => {
      // Print once per session, non-intrusive.
      console.log("\n  ~ kleosal-oc by ​agastyas shii​ · github.com/agastyas-shii\n")
    },
  }
}
