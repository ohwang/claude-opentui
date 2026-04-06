#!/usr/bin/env bun
// Suppress SIGINT immediately — Ctrl+C is handled by the TUI's useKeyboard().
// This must be the first statement before any imports to prevent the default
// handler from killing the process before the TUI can capture the keypress.
process.on("SIGINT", () => {})

/**
 * CLI Entry Point
 *
 * Parses flags, creates the backend adapter, and starts the TUI.
 * Process lifecycle management: SIGINT/SIGTERM/SIGHUP cleanup.
 */

import { parseFlags, printHelp } from "./cli/flags"
import { ClaudeAdapter } from "./backends/claude/adapter"
import { ClaudeV2Adapter } from "./backends/claude/adapter-v2"
import { CodexAdapter } from "./backends/codex/adapter"
import { CodexSdkAdapter } from "./backends/codex-sdk/adapter"
import { GeminiAdapter } from "./backends/gemini/adapter"
import { MockAdapter } from "./backends/mock/adapter"
import { startApp } from "./tui/app"
import { log } from "./utils/logger"
import { backendTrace } from "./utils/backend-trace"
import type { AgentBackend } from "./protocol/types"

const VERSION = "0.0.1"

async function main() {
  // Capture the actual launch directory before anything (SDK, plugins) can
  // change it.  This is the CWD the user sees in their shell when they run
  // the command — it must be preserved for the header bar display and for
  // the backend so file operations target the correct directory.
  const launchCwd = process.cwd()

  const flags = parseFlags(process.argv)

  if (flags.help) {
    printHelp()
    process.exit(0)
  }

  if (flags.version) {
    console.log(`claude-opentui v${VERSION}`)
    process.exit(0)
  }

  // Default config.cwd to the actual launch directory when not overridden
  // by --cwd.  Without this, config.cwd is undefined and the SDK resolves
  // the git repo root instead, which is wrong for worktrees and subdirs.
  if (!flags.config.cwd) {
    flags.config.cwd = launchCwd
  }

  // Configure logging
  if (flags.debug) {
    log.setLevel("debug")
  }
  backendTrace.setEnabled(flags.debugBackend)
  log.info("Starting claude-opentui", { version: VERSION, backend: flags.backend, debug: flags.debug, cwd: flags.config.cwd })
  log.debug("Session config", flags.config)

  // Print session info on exit so users can correlate with log files.
  // cleanExit() in app.tsx calls log.printSessionInfo() directly — this
  // handler is a fallback for non-TUI exit paths (SIGINT safety-net,
  // SIGTERM, uncaught exceptions, etc.).  The logger's internal flag
  // prevents duplicate output.
  process.on("exit", () => {
    const extras: string[] = []
    if (backendTrace.isEnabled()) {
      extras.push(`Backend trace: ${backendTrace.getFilePath()}`)
    }
    log.printSessionInfo(extras)
  })

  // Create backend
  let backend: AgentBackend

  switch (flags.backend) {
    case "claude":
    case "claude-v1":
      backend = new ClaudeAdapter()
      break
    case "claude-v2":
      backend = new ClaudeV2Adapter()
      break
    case "codex":
      backend = new CodexAdapter()
      break
    case "codex-sdk":
      backend = new CodexSdkAdapter()
      break
    case "gemini":
      backend = new GeminiAdapter()
      break
    case "mock":
      backend = new MockAdapter()
      break
    default:
      log.error("Unknown backend", { backend: flags.backend })
      console.error(`Unknown backend: ${flags.backend}`)
      process.exit(1)
  }

  log.info("Backend created", { backend: flags.backend })

  // Process lifecycle management
  const cleanup = () => {
    log.info("Cleanup: closing backend")
    backend.close()
    backendTrace.close()
  }

  // Replace the early no-op SIGINT handler with a safety-net that only fires
  // if the TUI fails to capture Ctrl+C (e.g., crash, raw mode lost).
  // Two rapid SIGINTs = force exit as a last resort.
  let sigintCount = 0
  let sigintTimer: ReturnType<typeof setTimeout> | undefined
  process.removeAllListeners("SIGINT")
  process.on("SIGINT", () => {
    sigintCount++
    if (sigintCount >= 2) {
      cleanup()
      process.exit(130)
    }
    // Try to interrupt the backend gracefully
    backend.interrupt()
    // Reset counter after 2 seconds — isolated presses don't accumulate
    clearTimeout(sigintTimer)
    sigintTimer = setTimeout(() => { sigintCount = 0 }, 2000)
  })

  process.on("SIGTERM", () => {
    cleanup()
    process.exit(0)
  })

  process.on("SIGHUP", () => {
    cleanup()
    process.exit(0)
  })

  process.on("unhandledRejection", (err) => {
    // Log but don't crash — many rejections are non-fatal (e.g., backend API
    // calls that fail after the user already moved on). Fatal errors should
    // be caught and handled explicitly at their call sites.
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    log.error("Unhandled rejection", { error: message, stack })
  })

  process.on("uncaughtException", (err) => {
    // Uncaught exceptions are always fatal — log details and exit cleanly.
    log.error("Uncaught exception", { error: err.message, stack: err.stack })
    cleanup()
    process.exit(1)
  })

  // Check for piped stdin (non-TTY input)
  if (!process.stdin.isTTY && !flags.prompt) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk)
    }
    const piped = Buffer.concat(chunks).toString().trim()
    if (piped) {
      flags.prompt = piped
    }
  }

  // Pass initial prompt through config so the sync provider can handle it
  if (flags.prompt) {
    flags.config.initialPrompt = flags.prompt
  }

  // Start the TUI — do not await; OpenTUI's native event loop keeps the process alive
  startApp({
    backend,
    config: flags.config,
    onExit: cleanup,
  })
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
