#!/usr/bin/env bun
// Prevent the default SIGINT behavior (immediate process exit) BEFORE any
// other code runs. Without this, Ctrl+C kills the bun process before
// OpenTUI's useKeyboard() handler has a chance to capture it as a keypress.
// The real SIGINT handler with counter logic is registered further below.
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
import { MockAdapter } from "./backends/mock/adapter"
import { startApp } from "./tui/app"
import type { AgentBackend } from "./protocol/types"

const VERSION = "0.0.1"

async function main() {
  const flags = parseFlags(process.argv)

  if (flags.help) {
    printHelp()
    process.exit(0)
  }

  if (flags.version) {
    console.log(`claude-opentui v${VERSION}`)
    process.exit(0)
  }

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
    case "mock":
      backend = new MockAdapter()
      break
    default:
      console.error(`Unknown backend: ${flags.backend}`)
      process.exit(1)
  }

  // Process lifecycle management — always write a trailing newline so the
  // shell prompt doesn't land on the same line as TUI output (avoids the
  // zsh PROMPT_EOL_MARK '%' character after exit).
  const cleanup = () => {
    backend.close()
    process.stdout.write("\n")
  }

  // Replace the early no-op SIGINT handler with the real counter-based one.
  // SIGINT is a last-resort fallback. During normal operation, Ctrl+C is
  // captured by OpenTUI's useKeyboard() as a keypress and never becomes
  // SIGINT. This handler only fires if the TUI fails to capture the key
  // (e.g., crash, raw mode lost). Two SIGINTs in quick succession = force exit.
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
    console.error("Unhandled rejection:", err)
    cleanup()
    process.exit(1)
  })

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err)
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

  // Start the TUI
  await startApp({
    backend,
    config: flags.config,
    onExit: cleanup,
  })
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
