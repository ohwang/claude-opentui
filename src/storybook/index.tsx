#!/usr/bin/env bun
/**
 * Storybook CLI entry point.
 *
 * Launches a TUI component catalog for browsing and previewing
 * all visual components in isolation with mock data.
 *
 * Usage:
 *   bun run storybook
 *   bun run storybook -- --theme one-light
 *
 * Flags:
 *   --theme <id>   Apply a theme preset before render (any id from the
 *                  theme registry, e.g. "dark", "light", "one-light").
 */

// Suppress default SIGINT (same pattern as main app — lets useKeyboard capture Ctrl+C)
process.on("SIGINT", () => {})

import { render } from "@opentui/solid"
import { StorybookApp } from "./app"
import { getTheme, listThemes } from "../tui/theme/registry"
import { applyTheme } from "../tui/theme/tokens"

// Tiny flag parser — the storybook binary only understands --theme.
const argv = process.argv.slice(2)
const themeIdx = argv.indexOf("--theme")
if (themeIdx !== -1) {
  const id = argv[themeIdx + 1]
  if (!id) {
    console.error("Error: --theme requires an argument")
    process.exit(1)
  }
  const theme = getTheme(id)
  if (!theme) {
    const available = listThemes().map(t => t.id).join(", ")
    console.error(`Unknown theme: "${id}". Available: ${available}`)
    process.exit(1)
  }
  applyTheme(theme)
}

render(() => <StorybookApp />, {
  targetFps: 60,
  exitOnCtrlC: false,
  useMouse: true,
}).catch((err: unknown) => {
  console.error("Storybook render error:", err)
  process.exit(1)
})
