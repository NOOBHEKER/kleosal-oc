// Server-side entry. This plugin is TUI-only; it exists so the directory is a
// well-formed plugin package for both discovery paths. The shape is a plain
// `{ id, setup }` object because the installed `@opencode-ai/plugin` package does
// not export the v2 `Plugin` helper the docs use.

export default {
  id: "user.cover-art.server",
  setup() {},
}
