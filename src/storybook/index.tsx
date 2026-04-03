#!/usr/bin/env bun
/**
 * Storybook CLI entry point.
 *
 * Launches a TUI component catalog for browsing and previewing
 * all visual components in isolation with mock data.
 */

// Suppress default SIGINT (same pattern as main app — lets useKeyboard capture Ctrl+C)
process.on("SIGINT", () => {})

import { render } from "@opentui/solid"
import { StorybookApp } from "./app"

render(() => <StorybookApp />, {
  targetFps: 60,
  exitOnCtrlC: false,
  useMouse: true,
}).catch((err: unknown) => {
  console.error("Storybook render error:", err)
  process.exit(1)
})
