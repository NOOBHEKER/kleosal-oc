// Security plugin: prevent opencode from reading .env files (they contain secrets).
export const EnvProtection = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" && output.args && output.args.filePath && output.args.filePath.includes(".env")) {
        throw new Error("Refused to read .env file — it contains secrets. Use a safer source or ask the user to expose specific values.")
      }
    },
  }
}
