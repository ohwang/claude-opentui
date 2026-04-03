/**
 * Status Bar — 2-line Claude Code-style status bar
 *
 * Line 1: project name | model | state | cost | git branch+status | tokens | tok/s
 * Line 2: permission mode indicator (pink, with cycle hint)
 *
 * During RUNNING state, shows live cost ticker and tokens-per-second throughput.
 */

import { createSignal, createEffect, createMemo, onCleanup, on } from "solid-js"
import path from "node:path"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useSession } from "../context/session"
import { useMessages } from "../context/messages"
import { useAgent } from "../context/agent"
import { log } from "../../utils/logger"
import { colors } from "../theme/tokens"
import type { PermissionMode } from "../../protocol/types"
import { friendlyModelName, MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from "../models"
import { toast } from "../context/toast"

// ---------------------------------------------------------------------------
// Permission mode cycle order
// ---------------------------------------------------------------------------

const PERM_MODE_CYCLE: PermissionMode[] = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
]

// ---------------------------------------------------------------------------
// Token-rate tracking ring buffer
// ---------------------------------------------------------------------------

interface TokenSample {
  timestamp: number
  totalTokens: number
}

const SAMPLE_WINDOW_MS = 3_000
const TICK_INTERVAL_MS = 300

// ---------------------------------------------------------------------------
// Git info — cached at startup, no re-run on every render
// ---------------------------------------------------------------------------

interface GitInfo {
  branch: string
  modified: number
  untracked: number
  ahead: number
  hasUpstream: boolean
}

function getGitInfo(): GitInfo | null {
  try {
    const branchResult = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if (branchResult.exitCode !== 0) return null
    const branch = branchResult.stdout.toString().trim()
    if (!branch) return null

    const statusResult = Bun.spawnSync(["git", "status", "--porcelain"])
    const statusLines = statusResult.stdout.toString().trim()
    let modified = 0
    let untracked = 0
    if (statusLines) {
      for (const line of statusLines.split("\n")) {
        if (line.startsWith("??")) {
          untracked++
        } else if (line.trim()) {
          modified++
        }
      }
    }

    // Try to get ahead count (may fail for detached HEAD or no upstream)
    let ahead = 0
    let hasUpstream = false
    try {
      const aheadResult = Bun.spawnSync([
        "git", "rev-list", "--count", "@{upstream}..HEAD",
      ])
      if (aheadResult.exitCode === 0) {
        hasUpstream = true
        ahead = parseInt(aheadResult.stdout.toString().trim(), 10) || 0
      }
    } catch {
      // No upstream configured, that's fine
    }

    return { branch, modified, untracked, ahead, hasUpstream }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Permission mode display
// ---------------------------------------------------------------------------

function permissionModeLabel(mode: PermissionMode | undefined): string {
  switch (mode) {
    case "default":
      return "default"
    case "acceptEdits":
      return "accept edits"
    case "bypassPermissions":
      return "YOLO"
    case "plan":
      return "plan"
    case "dontAsk":
      return "auto"
    default:
      return "default"
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusBar(props: { hint?: string | null }) {
  const { state } = useSession()
  const { state: messagesState } = useMessages()
  const agent = useAgent()
  // -- Permission mode (local signal so it's reactive) --
  const [permMode, setPermMode] = createSignal<PermissionMode>(
    agent.config.permissionMode ?? "default",
  )

  useKeyboard((event) => {
    if (event.shift && event.name === "tab") {
      // Don't cycle permission mode during dialogs
      if (
        state.sessionState === "WAITING_FOR_PERM" ||
        state.sessionState === "WAITING_FOR_ELIC"
      ) {
        return
      }
      const prevMode = permMode()
      const startIdx = PERM_MODE_CYCLE.indexOf(prevMode)

      // Try each subsequent mode; skip modes the backend rejects
      const tryMode = async (attempt: number): Promise<void> => {
        if (attempt >= PERM_MODE_CYCLE.length) {
          // Wrapped all the way around — revert to original
          setPermMode(prevMode)
          return
        }
        const nextIdx = (startIdx + attempt + 1) % PERM_MODE_CYCLE.length
        const nextMode = PERM_MODE_CYCLE[nextIdx] ?? "default"
        setPermMode(nextMode)
        try {
          await agent.backend.setPermissionMode(nextMode)
        } catch (err) {
          log.warn("Failed to set permission mode, skipping", { mode: nextMode, error: String(err) })
          await tryMode(attempt + 1)
        }
      }
      tryMode(0).catch((err) => {
        log.error("Permission mode cycling failed", { error: String(err) })
        setPermMode(prevMode)
      })
    }
  })

  // -- Project name (basename of cwd) --
  const projectName = path.basename(process.cwd())

  // -- Git info (refreshed when a turn completes) --
  const [gitInfo, setGitInfo] = createSignal<GitInfo | null>(getGitInfo())

  // Re-fetch git info on RUNNING → IDLE transition (files may have changed)
  let prevState: string = state.sessionState
  createEffect(() => {
    const current = state.sessionState
    if (current === "IDLE" && prevState === "RUNNING") {
      setGitInfo(getGitInfo())
    }
    prevState = current
  })

  // -- Token-rate tracking --
  const [tokPerSec, setTokPerSec] = createSignal(0)
  let tokenSamples: TokenSample[] = []

  // -- Previous state for edge detection --
  let prevSessionState: string = state.sessionState

  // Ticker interval: drives the turn timer, tok/s, and live cost updates
  const tickerHandle = setInterval(() => {
    const currentState = state.sessionState
    const isRunning = currentState === "RUNNING"

    // Detect IDLE/other -> RUNNING transition
    if (isRunning && prevSessionState !== "RUNNING") {
      tokenSamples = []
      setTokPerSec(0)
    }

    // Detect RUNNING -> non-RUNNING transition (turn ended)
    if (!isRunning && prevSessionState === "RUNNING") {
      tokenSamples = []
      setTokPerSec(0)
    }

    prevSessionState = currentState

    // While running, update tok/s
    if (isRunning) {
      // Sample current token count
      const now = Date.now()
      const totalTokens = state.cost.inputTokens + state.cost.outputTokens
      tokenSamples.push({ timestamp: now, totalTokens })

      // Prune samples older than the window
      const cutoff = now - SAMPLE_WINDOW_MS
      tokenSamples = tokenSamples.filter((s) => s.timestamp >= cutoff)

      // Calculate rate from oldest remaining sample to newest
      if (tokenSamples.length >= 2) {
        const oldest = tokenSamples[0]
        const newest = tokenSamples[tokenSamples.length - 1]
        const dtSec = (newest.timestamp - oldest.timestamp) / 1000
        if (dtSec > 0) {
          const rate = (newest.totalTokens - oldest.totalTokens) / dtSec
          setTokPerSec(Math.round(rate))
        }
      }
    }
  }, TICK_INTERVAL_MS)

  onCleanup(() => clearInterval(tickerHandle))

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const isRunning = createMemo(() => state.sessionState === "RUNNING")

  // -- Responsive width-based hiding --
  const dims = useTerminalDimensions()
  const termWidth = () => dims()?.width ?? 120

  const showCtx = () => termWidth() >= 100
  const showGit = () => termWidth() >= 80
  const showCost = () => termWidth() >= 60

  const permModeColor = () => {
    switch (permMode()) {
      case "default": return colors.state.idle
      case "acceptEdits": return colors.state.waiting
      case "bypassPermissions": return colors.state.error
      case "plan": return colors.state.running
      case "dontAsk": return colors.permission.modeLabel
      default: return colors.state.idle
    }
  }

  const stateIcon = () => {
    if (messagesState.backgrounded) return "\u2B21" // ⬡ hexagon for backgrounded
    switch (state.sessionState) {
      case "INITIALIZING":
        return "\u25CC"
      case "IDLE":
        return "\u25CF"
      case "RUNNING":
        return "\u27F3"
      case "WAITING_FOR_PERM":
        return "\u26A0"
      case "WAITING_FOR_ELIC":
        return "?"
      case "INTERRUPTING":
        return "\u23F8"
      case "ERROR":
        return "\u2717"
      case "SHUTTING_DOWN":
        return "\u25CC"
      default:
        return "\u25CF"
    }
  }

  const stateColor = () => {
    if (messagesState.backgrounded) return colors.status.warning
    switch (state.sessionState) {
      case "IDLE":
        return colors.state.idle
      case "RUNNING":
        return colors.state.running
      case "WAITING_FOR_PERM":
      case "WAITING_FOR_ELIC":
        return colors.state.waiting
      case "INTERRUPTING":
        return colors.state.waiting
      case "ERROR":
        return colors.state.error
      case "SHUTTING_DOWN":
        return colors.state.shuttingDown
      default:
        return colors.state.shuttingDown
    }
  }

  const modelName = () => {
    const model = state.session?.models?.[0]
    const raw = state.currentModel || (model?.name ?? agent.config.model ?? "")
    if (!raw) return ""
    const friendly = friendlyModelName(raw)
    // Prefer dynamic context window from SDK, fall back to hardcoded
    const ctxWindow = model?.contextWindow ?? MODEL_CONTEXT_WINDOWS[raw] ?? DEFAULT_CONTEXT_WINDOW
    const ctxAbbrev = ctxWindow >= 1_000_000
      ? `${ctxWindow / 1_000_000}M`
      : `${ctxWindow / 1_000}K`
    return `${friendly} (${ctxAbbrev})`
  }

  const costStr = createMemo(() => {
    const c = state.cost.totalCostUsd
    if (c === 0) return ""
    // Always use 4 decimal places to prevent width changes when
    // transitioning between RUNNING (was 4) and IDLE (was 2).
    // This eliminates the layout jump at turn boundaries.
    return `$${c.toFixed(4)}`
  })

  const tokenStr = () => {
    const total = state.cost.inputTokens + state.cost.outputTokens
    if (total === 0) return ""
    if (total > 1000) return `${(total / 1000).toFixed(1)}k tok`
    return `${total} tok`
  }

  // -- Context window fill percentage (numeric, 0-100) --
  const ctxPct = createMemo(() => {
    const fill = state.lastTurnInputTokens
    if (fill === 0) return 0
    const model = state.session?.models?.[0]
    const raw = state.currentModel || (model?.name ?? agent.config.model ?? "")
    const ctxWindow = model?.contextWindow ?? MODEL_CONTEXT_WINDOWS[raw] ?? DEFAULT_CONTEXT_WINDOW
    return Math.round((fill / ctxWindow) * 100)
  })

  // -- Context string: "ctx:45%" — show "<1%" when tokens exist but round to 0% --
  const ctxStr = createMemo(() => {
    const pct = ctxPct()
    if (pct === 0) {
      // Show "<1%" if we have any tokens (first turn completed) but they round to 0%
      return state.lastTurnInputTokens > 0 ? "ctx:<1%" : ""
    }
    return `ctx:${pct}%`
  })

  // -- Context color: green < 50%, yellow 50-79%, red >= 80% --
  const ctxColor = createMemo(() => {
    const pct = ctxPct()
    if (pct >= 80) return colors.status.error
    if (pct >= 50) return colors.status.warning
    return colors.status.success
  })

  // -- Context bar: ▰▰▰▰▱▱▱▱▱▱ (10 segments) --
  const ctxBar = createMemo(() => {
    const pct = ctxPct()
    if (pct === 0 && state.lastTurnInputTokens === 0) return ""
    // Show at least 1 filled segment when tokens exist
    const filled = Math.max(pct > 0 ? 1 : (state.lastTurnInputTokens > 0 ? 1 : 0), Math.round(pct / 10))
    const empty = 10 - filled
    return "\u25B0".repeat(filled) + "\u25B1".repeat(empty)
  })

  // -- Toast warnings when context crosses 80% and 95% thresholds --
  let lastWarningLevel = 0
  createEffect(on(ctxPct, (pct) => {
    if (pct >= 95 && lastWarningLevel < 2) {
      lastWarningLevel = 2
      toast.error("Context window 95% full \u2014 /compact recommended")
    } else if (pct >= 80 && lastWarningLevel < 1) {
      lastWarningLevel = 1
      toast.warn("Context window 80% full \u2014 consider using /compact")
    }
  }))

  const tokPerSecStr = createMemo(() => {
    if (!isRunning()) return ""
    const rate = tokPerSec()
    if (rate <= 0) return ""
    return `${rate} tok/s`
  })

  const gitStr = createMemo(() => {
    const info = gitInfo()
    if (!info) return ""
    const parts: string[] = [info.branch]
    if (info.ahead > 0) parts.push(`\u2191${info.ahead}`)
    else if (info.hasUpstream) parts.push("\u2261") // ≡ = in sync with upstream
    const statusParts: string[] = []
    if (info.modified > 0) statusParts.push(`~${info.modified}`)
    if (info.untracked > 0) statusParts.push(`+${info.untracked}`)
    if (statusParts.length > 0) {
      parts.push("| " + statusParts.join(" "))
    }
    return `[${parts.join(" ")}]`
  })

  // ---------------------------------------------------------------------------
  // Render — 2-line status bar (matches Claude Code)
  // Line 1: project, model, state, cost, git, ctx — right side: tok/s or hint
  // Line 2: permission mode indicator (left-aligned)
  // ---------------------------------------------------------------------------

  return (
    <box flexDirection="column">
      {/* Line 1: project, model, state, cost, git, ctx — right side: tok/s or hint */}
      <box height={1} flexDirection="row" paddingLeft={2} paddingRight={1}>
        {/* Left: project name + model (always visible) */}
        <text fg={colors.status.warning} attributes={TextAttributes.BOLD}>
          {projectName}
        </text>

        <text fg={colors.text.muted}>{"  "}</text>

        <text fg={colors.text.white} attributes={TextAttributes.BOLD}>
          {modelName()}
        </text>

        {/* State icon + backgrounded label */}
        <text fg={colors.text.muted}>{"  "}</text>
        <text fg={stateColor()}>{stateIcon()}</text>
        {messagesState.backgrounded && (
          <text fg={colors.status.warning}>{" Backgrounded"}</text>
        )}

        {/* Cost (hidden below 60 cols) */}
        {showCost() && costStr() && (
          <box flexDirection="row">
            <text fg={colors.text.muted}>{"  "}</text>
            <text fg={colors.status.success}>{costStr()}</text>
          </box>
        )}

        {/* Git branch + status (hidden below 80 cols) */}
        {showGit() && gitStr() && (
          <box flexDirection="row">
            <text fg={colors.text.muted}>{"  "}</text>
            <text fg={colors.status.info}>{gitStr()}</text>
          </box>
        )}

        {/* Context window usage (hidden below 100 cols) */}
        {showCtx() && ctxStr() && (
          <box flexDirection="row">
            <text fg={colors.text.muted}>{"  "}</text>
            <text fg={ctxColor()}>{ctxStr()}</text>
            {ctxBar() && (
              <>
                <text fg={colors.text.muted}>{" "}</text>
                <text fg={ctxColor()}>{ctxBar()}</text>
              </>
            )}
          </box>
        )}

        {/* Spacer pushes right-aligned items */}
        <box flexGrow={1} />

        {/* Right side: exit hint (transient) OR normal right-side info */}
        {props.hint ? (
          <text fg={colors.status.warning}>{props.hint}</text>
        ) : (
          <>
            {/* Tok/s — uses visible={false} instead of conditional rendering
                to prevent layout jumps when streaming starts/stops */}
            <box flexDirection="row" visible={!!tokPerSecStr()}>
              <text fg={colors.status.info}>{tokPerSecStr()}</text>
            </box>
          </>
        )}
      </box>

      {/* Line 2: permission mode indicator (left-aligned, matches Claude Code) */}
      <box height={1} flexDirection="row" paddingLeft={2}>
        <text fg={permModeColor()}>{"\u25CF "}</text>
        <text fg={colors.permission.modeLabel}>{permissionModeLabel(permMode())}</text>
        <text fg={colors.text.muted} attributes={TextAttributes.DIM}>{" \u00B7 shift+tab"}</text>
      </box>
    </box>
  )
}
