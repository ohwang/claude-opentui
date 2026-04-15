#!/usr/bin/env bun
// Suppress SIGINT immediately — Ctrl+C is handled by the TUI's useKeyboard().
// This must be the first statement before any imports to prevent the default
// handler from killing the process before the TUI can capture the keypress.
process.on("SIGINT", () => {})

// Make this file a module so top-level await is allowed.
export {}

// Dynamic import so the SIGINT handler above registers before any module
// side effects from commander, SolidJS, or backend SDKs.
const { runCli } = await import("./cli/program")

runCli(process.argv).catch(async (err) => {
  // Log to file if logger is already initialized, plus stderr for user visibility.
  try {
    const { log } = await import("./utils/logger")
    log.error("Fatal error in main()", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
  } catch {}
  console.error("Fatal:", err)
  process.exit(1)
})
