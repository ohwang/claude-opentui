#!/usr/bin/env bun
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

  // Process lifecycle management
  const cleanup = () => {
    backend.close()
  }

  process.on("SIGINT", () => {
    backend.interrupt()
    // Second SIGINT = force exit
    process.once("SIGINT", () => {
      cleanup()
      process.exit(130)
    })
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
