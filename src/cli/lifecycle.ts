/**
 * CLI Lifecycle — Process signal handlers and cleanup
 *
 * Extracted from index.ts to keep the entry point minimal.
 * Manages SIGINT (double-press safety net), SIGTERM, SIGHUP,
 * unhandled rejections, and uncaught exceptions.
 */

import type { AgentBackend } from "../protocol/types"
import type { SubagentManager } from "../subagents/manager"
import { log } from "../utils/logger"
import { backendTrace } from "../utils/backend-trace"
import { stopMcpHttpServer } from "../mcp/server"

export interface LifecycleOptions {
  backend: AgentBackend
  subagentManager: SubagentManager
}

/**
 * Create a cleanup function that tears down all resources.
 */
export function createCleanup(opts: LifecycleOptions): () => void {
  return () => {
    log.info("Cleanup: closing backend")
    stopMcpHttpServer().catch(() => {})
    opts.subagentManager.closeAll()
    opts.backend.close()
    backendTrace.close()
  }
}

/**
 * Register process lifecycle signal handlers.
 *
 * Replaces the initial no-op SIGINT handler with a double-press safety net
 * and installs handlers for SIGTERM, SIGHUP, unhandled rejections, and
 * uncaught exceptions.
 *
 * Must be called AFTER backend creation so early exits (unknown backend,
 * CLI parse errors) don't register handlers for a session that never started.
 */
export function setupProcessHandlers(opts: LifecycleOptions): void {
  const cleanup = createCleanup(opts)

  // Print session info on exit — fallback for non-TUI exit paths
  // (SIGINT safety-net, SIGTERM, uncaught exceptions, etc.).
  // The logger's internal flag prevents duplicate output.
  process.on("exit", () => {
    const extras: string[] = []
    if (backendTrace.isEnabled()) {
      extras.push(`Backend trace: ${backendTrace.getFilePath()}`)
    }
    log.printSessionInfo(extras)
  })

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
    opts.backend.interrupt()
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
    // AbortErrors are expected during user-initiated interrupt (Ctrl+C).
    if (err instanceof Error && err.name === "AbortError") {
      log.debug("Suppressed AbortError rejection (expected during interrupt)")
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    log.error("Unhandled rejection", { error: message, stack })
  })

  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception", { error: err.message, stack: err.stack })
    cleanup()
    process.exit(1)
  })
}
