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
import { createBackend } from "./subagents/backend-factory"
import { startApp } from "./tui/app"
import { log } from "./utils/logger"
import { backendTrace } from "./utils/backend-trace"
import type { AgentBackend } from "./protocol/types"
import { stopMcpHttpServer } from "./mcp/server"
import { SubagentManager } from "./subagents/manager"
import { setSubagentManager } from "./subagents/mcp-tools"
import { setCommandsManager } from "./subagents/commands"

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
    console.log(`bantai v${VERSION}`)
    process.exit(0)
  }

  // Default config.cwd to the actual launch directory when not overridden
  // by --cwd.  Without this, config.cwd is undefined and the SDK resolves
  // the git repo root instead, which is wrong for worktrees and subdirs.
  if (!flags.config.cwd) {
    flags.config.cwd = launchCwd
  }

  // Fill in persisted defaults from the bantai settings loader. CLI flags
  // always win — we only touch values the user didn't provide on the
  // command line. Reads `.bantai/settings.json`, `~/.bantai/settings.json`,
  // and falls back to `~/.claude/settings.json` for statusLine compatibility.
  const { loadConfig } = await import("./config/settings")
  const resolved = await loadConfig({ cwd: flags.config.cwd })
  if (!flags.theme && resolved.sources.theme && resolved.sources.theme !== "default") {
    flags.theme = resolved.values.theme
  }
  if (flags.config.model === undefined && resolved.values.model) {
    flags.config.model = resolved.values.model
  }
  if (flags.config.permissionMode === undefined && resolved.values.permissionMode) {
    flags.config.permissionMode = resolved.values.permissionMode
  }
  if (!flags.debug && resolved.values.debug) {
    flags.debug = true
  }

  // Configure logging
  if (flags.debug) {
    log.setLevel("debug")
  }
  backendTrace.setEnabled(flags.debugBackend)
  log.info("Starting bantai", { version: VERSION, backend: flags.backend, debug: flags.debug, cwd: flags.config.cwd })
  log.debug("Session config", flags.config)

  // Create backend
  let backend: AgentBackend
  try {
    backend = createBackend({
      backend: flags.backend,
      acpCommand: flags.acpCommand,
      acpArgs: flags.acpArgs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error("Failed to create backend", { error: msg })
    console.error(`Error: ${msg}`)
    process.exit(1)
  }

  log.info("Backend created", { backend: flags.backend })
  log.setBackendName(flags.backend)

  // Create SubagentManager and wire module-level setters
  const subagentManager = new SubagentManager()
  setSubagentManager(subagentManager)
  setCommandsManager(subagentManager)

  // Print session info on exit so users can correlate with log files.
  // Registered AFTER backend creation so early exits (unknown backend,
  // CLI parse errors) don't print session info for a session that never
  // started.  cleanExit() in app.tsx calls log.printSessionInfo()
  // directly — this handler is a fallback for non-TUI exit paths
  // (SIGINT safety-net, SIGTERM, uncaught exceptions, etc.).  The
  // logger's internal flag prevents duplicate output.
  process.on("exit", () => {
    const extras: string[] = []
    if (backendTrace.isEnabled()) {
      extras.push(`Backend trace: ${backendTrace.getFilePath()}`)
    }
    log.printSessionInfo(extras)
  })

  // Process lifecycle management
  const cleanup = () => {
    log.info("Cleanup: closing backend")
    stopMcpHttpServer().catch(() => {})
    subagentManager.closeAll()
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
    // AbortErrors are expected during user-initiated interrupt (Ctrl+C).
    // Backend SDK promises reject when the AbortController fires,
    // producing many simultaneous unhandled rejections. Swallow silently.
    if (err instanceof Error && err.name === "AbortError") {
      log.debug("Suppressed AbortError rejection (expected during interrupt)")
      return
    }
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

  // Apply theme if specified (must happen before render)
  if (flags.theme) {
    const { getTheme } = await import("./tui/theme/registry")
    const { applyTheme } = await import("./tui/theme/tokens")
    const theme = getTheme(flags.theme)
    if (theme) {
      applyTheme(theme)
      log.info("Theme applied", { theme: flags.theme })
    } else {
      const { listThemes } = await import("./tui/theme/registry")
      const available = listThemes().map(t => t.id).join(", ")
      console.error(`Unknown theme: ${flags.theme}. Available: ${available}`)
      process.exit(1)
    }
  }

  // Pass initial prompt through config so the sync provider can handle it
  if (flags.prompt) {
    flags.config.initialPrompt = flags.prompt
  }

  // Set sessionOrigin so cross-backend resume detection works in SyncProvider.
  // The backend name tells the sync layer what the *target* backend is, so it
  // can compare against the session's detected origin.
  flags.config.sessionOrigin = flags.backend

  // If --resume was used without a session ID, eagerly fetch sessions from
  // ALL backends so the multi-backend picker can render immediately.
  let preloadedSessions: import("./protocol/types").MultiBackendSessions | undefined
  if (flags.config.resumeInteractive) {
    try {
      const {
        listClaudeSessionsFromDisk,
        listCodexSessionsFromDisk,
        listGeminiSessionsFromDisk,
        enrichSessions,
      } = await import("./session/cross-backend")
      const cwd = flags.config.cwd ?? process.cwd()
      const backendKey = flags.backend as import("./protocol/types").SessionOrigin

      // Parallel disk scan for all backends
      const [claudeDisk, codexDisk, geminiDisk] = await Promise.all([
        Promise.resolve(listClaudeSessionsFromDisk(cwd)),
        Promise.resolve(listCodexSessionsFromDisk()),
        Promise.resolve(listGeminiSessionsFromDisk(cwd)),
      ])

      // For the active backend, also try the SDK's listSessions() for richer
      // metadata (custom titles, message counts) and merge with disk results
      let sdkSessions: import("./protocol/types").SessionInfo[] = []
      try {
        sdkSessions = await backend.listSessions()
        for (const s of sdkSessions) {
          ;(s as any).origin = backendKey
        }
      } catch {
        // SDK not ready — disk results are fine
      }

      // Merge: prefer SDK sessions (richer metadata), fall back to disk
      const merge = (
        sdk: import("./protocol/types").SessionInfo[],
        disk: import("./protocol/types").SessionInfo[],
      ) => {
        const sdkIds = new Set(sdk.map(s => s.id))
        return [...sdk, ...disk.filter(s => !sdkIds.has(s.id))]
      }

      const raw: import("./protocol/types").MultiBackendSessions = {
        claude: backendKey === "claude" ? merge(sdkSessions, claudeDisk) : claudeDisk,
        codex: backendKey === "codex" ? merge(sdkSessions, codexDisk) : codexDisk,
        gemini: backendKey === "gemini" ? merge(sdkSessions, geminiDisk) : geminiDisk,
      }

      // Enrich top-20 per backend with deep-parsed metadata
      preloadedSessions = {
        claude: enrichSessions(raw.claude, cwd, 20),
        codex: enrichSessions(raw.codex, cwd, 20),
        gemini: enrichSessions(raw.gemini, cwd, 20),
      }

      log.info("Preloaded multi-backend sessions", {
        claude: preloadedSessions.claude.length,
        codex: preloadedSessions.codex.length,
        gemini: preloadedSessions.gemini.length,
      })
    } catch (err) {
      log.warn("Failed to preload sessions", { error: String(err) })
      preloadedSessions = { claude: [], codex: [], gemini: [] }
    }
  }

  // Start the TUI — do not await; OpenTUI's native event loop keeps the process alive
  startApp({
    backend,
    config: flags.config,
    onExit: cleanup,
    noDiagnosticsMcp: flags.noDiagnosticsMcp,
    subagentManager,
    preloadedSessions,
    currentBackend: flags.backend as import("./protocol/types").SessionOrigin,
  })
}

main().catch((err) => {
  // Log to file if logger is already initialized, plus stderr for user visibility.
  // Logger may not be initialized if main() fails during early bootstrap.
  try { log.error("Fatal error in main()", { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }) } catch {}
  console.error("Fatal:", err)
  process.exit(1)
})
