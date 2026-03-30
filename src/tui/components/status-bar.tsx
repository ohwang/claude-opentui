/**
 * Status Bar — 2-line Claude Code-style status bar
 *
 * Line 1: project name | model | state | cost | git branch+status | tokens | tok/s | timer
 * Line 2: permission mode indicator (pink, with cycle hint)
 *
 * During RUNNING state, shows:
 * - Live cost ticker (updates every 300ms based on streaming token counts)
 * - Tokens-per-second throughput
 * - Turn duration timer
 */

import { createSignal, createEffect, createMemo, onCleanup } from "solid-js"
import path from "node:path"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useSession } from "../context/session"
import { useAgent } from "../context/agent"
import type { PermissionMode } from "../../protocol/types"

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
    try {
      const aheadResult = Bun.spawnSync([
        "git", "rev-list", "--count", "@{upstream}..HEAD",
      ])
      if (aheadResult.exitCode === 0) {
        ahead = parseInt(aheadResult.stdout.toString().trim(), 10) || 0
      }
    } catch {
      // No upstream configured, that's fine
    }

    return { branch, modified, untracked, ahead }
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
      return "default permissions"
    case "acceptEdits":
      return "accept edits"
    case "bypassPermissions":
      return "bypass permissions"
    case "plan":
      return "plan mode"
    case "dontAsk":
      return "don't ask"
    default:
      return "default permissions"
  }
}

// ---------------------------------------------------------------------------
// Model name abbreviation — drop "Claude " prefix
// ---------------------------------------------------------------------------

/** Model context window sizes (in tokens) for context usage calculation */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-sonnet-4-5-20250514": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
}
const DEFAULT_CONTEXT_WINDOW = 200_000

/** Convert raw model IDs to friendly display names */
function abbreviateModel(name: string): string {
  // Map raw API model IDs to friendly names
  const MODEL_NAMES: Record<string, string> = {
    "claude-opus-4-6": "Opus 4.6",
    "claude-sonnet-4-6": "Sonnet 4.6",
    "claude-haiku-4-5-20251001": "Haiku 4.5",
    "claude-sonnet-4-5-20250514": "Sonnet 4.5",
    "claude-3-5-sonnet-20241022": "Sonnet 3.5",
    "claude-3-5-haiku-20241022": "Haiku 3.5",
  }
  // Exact match on raw ID
  if (MODEL_NAMES[name]) return MODEL_NAMES[name]
  // Strip "Claude " prefix from friendly names like "Claude Opus 4.6"
  return name.replace(/^[Cc]laude\s+/, "")
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusBar() {
  const { state } = useSession()
  const agent = useAgent()

  // -- Permission mode (local signal so it's reactive) --
  const [permMode, setPermMode] = createSignal<PermissionMode>(
    agent.config.permissionMode ?? "default",
  )

  useKeyboard((event) => {
    if (event.shift && event.name === "tab") {
      const current = permMode()
      const idx = PERM_MODE_CYCLE.indexOf(current)
      const nextIdx = (idx + 1) % PERM_MODE_CYCLE.length
      const nextMode = PERM_MODE_CYCLE[nextIdx] ?? "default"
      setPermMode(nextMode)
      void agent.backend.setPermissionMode(nextMode)
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

  // -- Turn timer state --
  const [turnStartTime, setTurnStartTime] = createSignal<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = createSignal(0)

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
      setTurnStartTime(Date.now())
      setElapsedSeconds(0)
      tokenSamples = []
      setTokPerSec(0)
    }

    // Detect RUNNING -> non-RUNNING transition (turn ended)
    if (!isRunning && prevSessionState === "RUNNING") {
      setTurnStartTime(null)
      setElapsedSeconds(0)
      tokenSamples = []
      setTokPerSec(0)
    }

    prevSessionState = currentState

    // While running, update elapsed time and tok/s
    if (isRunning) {
      const start = turnStartTime()
      if (start !== null) {
        setElapsedSeconds(Math.floor((Date.now() - start) / 1000))
      }

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

  const permModeColor = () => {
    switch (permMode()) {
      case "default": return "green"
      case "acceptEdits": return "yellow"
      case "bypassPermissions": return "red"
      case "plan": return "cyan"
      case "dontAsk": return "#d787af"
      default: return "green"
    }
  }

  const stateIcon = () => {
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
    switch (state.sessionState) {
      case "IDLE":
        return "green"
      case "RUNNING":
        return "cyan"
      case "WAITING_FOR_PERM":
      case "WAITING_FOR_ELIC":
        return "yellow"
      case "INTERRUPTING":
        return "yellow"
      case "ERROR":
        return "red"
      default:
        return "gray"
    }
  }

  const modelName = () => {
    const raw = state.currentModel || state.session?.models?.[0]?.name || "claude"
    return abbreviateModel(raw)
  }

  const costStr = createMemo(() => {
    const c = state.cost.totalCostUsd
    if (c === 0) return ""
    // 4 decimal places during streaming, 2 when idle
    const decimals = isRunning() ? 4 : 2
    return `$${c.toFixed(decimals)}`
  })

  const tokenStr = () => {
    const total = state.cost.inputTokens + state.cost.outputTokens
    if (total === 0) return ""
    if (total > 1000) return `${(total / 1000).toFixed(1)}k tok`
    return `${total} tok`
  }

  const ctxStr = createMemo(() => {
    // Use last turn's input tokens — these represent the actual context window fill
    // (system prompt + conversation history + current turn input)
    const fill = state.lastTurnInputTokens
    if (fill === 0) return ""
    const raw = state.currentModel || state.session?.models?.[0]?.name || ""
    const ctxWindow = MODEL_CONTEXT_WINDOWS[raw] ?? DEFAULT_CONTEXT_WINDOW
    const pct = Math.round((fill / ctxWindow) * 100)
    return `ctx:${pct}%`
  })

  const tokPerSecStr = createMemo(() => {
    if (!isRunning()) return ""
    const rate = tokPerSec()
    if (rate <= 0) return ""
    return `${rate} tok/s`
  })

  const timerStr = createMemo(() => {
    if (!isRunning()) return ""
    const secs = elapsedSeconds()
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    const remSecs = secs % 60
    return `${mins}m ${remSecs}s`
  })

  const gitStr = createMemo(() => {
    const info = gitInfo()
    if (!info) return ""
    const parts: string[] = [info.branch]
    if (info.ahead > 0) parts.push(`\u2191${info.ahead}`)
    const statusParts: string[] = []
    if (info.modified > 0) statusParts.push(`~${info.modified}`)
    if (info.untracked > 0) statusParts.push(`+${info.untracked}`)
    if (statusParts.length > 0) {
      parts.push("| " + statusParts.join(" "))
    }
    return `[${parts.join(" ")}]`
  })

  // ---------------------------------------------------------------------------
  // Render — single status line (matches Claude Code)
  // ---------------------------------------------------------------------------

  return (
    <box height={1} flexDirection="row" paddingLeft={2} paddingRight={1}>
      {/* Left: project name */}
      <text fg="yellow" attributes={TextAttributes.BOLD}>
        {projectName}
      </text>

      <text fg="gray">{"  "}</text>

      {/* Model name */}
      <text fg="white" attributes={TextAttributes.BOLD}>
        {modelName()}
      </text>

      <text fg="gray">{" "}</text>

      {/* Help hint */}
      <text fg="#d787af">{"/h"}</text>

      {/* Cost */}
      {costStr() && (
        <box flexDirection="row">
          <text fg="gray">{"  "}</text>
          <text fg="green">{costStr()}</text>
        </box>
      )}

      {/* Git branch + status */}
      {gitStr() && (
        <box flexDirection="row">
          <text fg="gray">{"  "}</text>
          <text fg="cyan">{gitStr()}</text>
        </box>
      )}

      {/* Context window usage */}
      {ctxStr() && (
        <box flexDirection="row">
          <text fg="gray">{"  "}</text>
          <text fg="gray">{ctxStr()}</text>
        </box>
      )}

      {/* Spacer pushes right-aligned items */}
      <box flexGrow={1} />

      {/* Tok/s (only during streaming) */}
      {tokPerSecStr() && (
        <box flexDirection="row">
          <text fg="cyan">{tokPerSecStr()}</text>
          <text fg="gray">{" "}</text>
        </box>
      )}

      {/* Timer (only during streaming) */}
      {timerStr() && (
        <box flexDirection="row">
          <text fg="yellow">{timerStr()}</text>
          <text fg="gray">{"  "}</text>
        </box>
      )}

      {/* Permission mode indicator (right-aligned) */}
      <text fg={permModeColor()}>{"\u25CF "}</text>
      <text fg="#d787af">{permissionModeLabel(permMode())}</text>
      <text fg="gray" attributes={TextAttributes.DIM}>{" · shift+tab"}</text>
    </box>
  )
}
