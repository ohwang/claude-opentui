/**
 * TUI Command — launches the interactive terminal UI
 *
 * Extracted from index.ts main(). Handles config resolution, backend
 * creation, subagent wiring, theme application, stdin piping, session
 * preloading, and startApp().
 *
 * Called by the default command, backend subcommands (claude/codex/gemini),
 * and session management subcommands (resume/continue).
 */

import type { CLIFlags } from "../options"
import type { AgentBackend } from "../../protocol/types"
import { createBackend } from "../../subagents/backend-factory"
import { startApp } from "../../tui/app"
import { log } from "../../utils/logger"
import { backendTrace } from "../../utils/backend-trace"
import { SubagentManager } from "../../subagents/manager"
import { setSubagentManager } from "../../subagents/mcp-tools"
import { setCommandsManager } from "../../subagents/commands"
import { setupProcessHandlers } from "../lifecycle"

const VERSION = "0.1.0"

/**
 * Launch the interactive TUI with the given CLI flags.
 *
 * This is the main action for `bantai`, `bantai claude`, `bantai codex`,
 * `bantai gemini`, `bantai resume`, and `bantai continue`.
 */
export async function launchTui(flags: CLIFlags): Promise<void> {
  // Capture the actual launch directory before anything (SDK, plugins) can
  // change it. This is the CWD the user sees in their shell.
  const launchCwd = process.cwd()

  // Default config.cwd to the actual launch directory when not overridden
  if (!flags.config.cwd) {
    flags.config.cwd = launchCwd
  }

  // Fill in persisted defaults from the bantai settings loader. CLI flags
  // always win — we only touch values the user didn't provide.
  const { loadConfig } = await import("../../config/settings")
  const resolved = await loadConfig({ cwd: flags.config.cwd })
  if (!flags.theme && resolved.sources.theme && resolved.sources.theme !== "default") {
    flags.theme = resolved.values.theme
  }
  if (flags.config.model === undefined && resolved.values.model) {
    const modelSource = resolved.sources.model
    const isClaudeBackend = !flags.backend || flags.backend === "claude"
    if (modelSource !== "claude-fallback" || isClaudeBackend) {
      flags.config.model = resolved.values.model
    }
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

  // Setup process lifecycle handlers (SIGINT, SIGTERM, etc.)
  setupProcessHandlers({ backend, subagentManager })

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
    const { getTheme } = await import("../../tui/theme/registry")
    const { applyTheme } = await import("../../tui/theme/tokens")
    const theme = getTheme(flags.theme)
    if (theme) {
      applyTheme(theme)
      log.info("Theme applied", { theme: flags.theme })
    } else {
      const { listThemes } = await import("../../tui/theme/registry")
      const available = listThemes().map(t => t.id).join(", ")
      console.error(`Unknown theme: ${flags.theme}. Available: ${available}`)
      process.exit(1)
    }
  }

  // Pass initial prompt through config so the sync provider can handle it
  if (flags.prompt) {
    flags.config.initialPrompt = flags.prompt
  }

  // Set sessionOrigin so cross-backend resume detection works in SyncProvider
  flags.config.sessionOrigin = flags.backend

  // If --resume was used without a session ID, eagerly fetch sessions from
  // ALL backends so the multi-backend picker can render immediately.
  let preloadedSessions: import("../../protocol/types").MultiBackendSessions | undefined
  if (flags.config.resumeInteractive) {
    try {
      const {
        listClaudeSessionsFromDisk,
        listCodexSessionsFromDisk,
        listGeminiSessionsFromDisk,
        enrichSessions,
      } = await import("../../session/cross-backend")
      const cwd = flags.config.cwd ?? process.cwd()
      const backendKey = flags.backend as import("../../protocol/types").SessionOrigin

      // Parallel disk scan for all backends
      const [claudeDisk, codexDisk, geminiDisk] = await Promise.all([
        Promise.resolve(listClaudeSessionsFromDisk(cwd)),
        Promise.resolve(listCodexSessionsFromDisk()),
        Promise.resolve(listGeminiSessionsFromDisk(cwd)),
      ])

      // For the active backend, also try the SDK's listSessions() for richer
      // metadata (custom titles, message counts) and merge with disk results
      let sdkSessions: import("../../protocol/types").SessionInfo[] = []
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
        sdk: import("../../protocol/types").SessionInfo[],
        disk: import("../../protocol/types").SessionInfo[],
      ) => {
        const sdkIds = new Set(sdk.map(s => s.id))
        return [...sdk, ...disk.filter(s => !sdkIds.has(s.id))]
      }

      const raw: import("../../protocol/types").MultiBackendSessions = {
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

  // Cleanup function for startApp's onExit callback
  const { createCleanup } = await import("../lifecycle")
  const cleanup = createCleanup({ backend, subagentManager })

  // Start the TUI — do not await; OpenTUI's native event loop keeps the process alive
  startApp({
    backend,
    config: flags.config,
    onExit: cleanup,
    noDiagnosticsMcp: flags.noDiagnosticsMcp,
    subagentManager,
    preloadedSessions,
    currentBackend: flags.backend as import("../../protocol/types").SessionOrigin,
  })
}
