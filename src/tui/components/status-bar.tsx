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

import { createSignal, createMemo, onCleanup } from "solid-js"
import path from "node:path"
import { useSession } from "../context/session"
import { useAgent } from "../context/agent"
import type { PermissionMode } from "../../protocol/types"

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

function abbreviateModel(name: string): string {
  return name.replace(/^[Cc]laude\s+/, "")
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusBar() {
  const { state } = useSession()
  const agent = useAgent()

  // -- Project name (basename of cwd) --
  const projectName = path.basename(process.cwd())

  // -- Git info (cached once at mount) --
  const [gitInfo] = createSignal<GitInfo | null>(getGitInfo())

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

  const costStr = () => {
    const c = state.cost.totalCostUsd
    if (c === 0) return ""
    // 4 decimal places during streaming, 2 when idle
    const decimals = isRunning() ? 4 : 2
    return `$${c.toFixed(decimals)}`
  }

  const tokenStr = () => {
    const total = state.cost.inputTokens + state.cost.outputTokens
    if (total === 0) return ""
    if (total > 1000) return `${(total / 1000).toFixed(1)}k tok`
    return `${total} tok`
  }

  const tokPerSecStr = () => {
    if (!isRunning()) return ""
    const rate = tokPerSec()
    if (rate <= 0) return ""
    return `${rate} tok/s`
  }

  const timerStr = () => {
    if (!isRunning()) return ""
    const secs = elapsedSeconds()
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    const remSecs = secs % 60
    return `${mins}m ${remSecs}s`
  }

  const gitStr = () => {
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
  }

  const permMode = () => agent.config.permissionMode

  // ---------------------------------------------------------------------------
  // Render — 2 lines
  // ---------------------------------------------------------------------------

  return (
    <box flexDirection="column">
      {/* Line 1: info bar */}
      <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
        {/* Left: project name */}
        <text bold color="yellow">
          {projectName}
        </text>

        <text color="gray">{"  "}</text>

        {/* Model name */}
        <text bold color="white">
          {modelName()}
        </text>

        <text color="gray">{" "}</text>

        {/* State icon */}
        <text color={stateColor()}>
          {stateIcon()}
        </text>

        {/* Cost */}
        {costStr() && (
          <>
            <text color="gray">{"  "}</text>
            <text color="green">{costStr()}</text>
          </>
        )}

        {/* Help hint */}
        <text dimmed color="gray">{"  /h"}</text>

        {/* Git branch + status */}
        {gitStr() && (
          <>
            <text color="gray">{"  "}</text>
            <text color="cyan">{gitStr()}</text>
          </>
        )}

        {/* Spacer pushes right-aligned items */}
        <box flexGrow={1} />

        {/* Tokens */}
        {tokenStr() && (
          <>
            <text color="gray">{"  "}</text>
            <text color="gray">{tokenStr()}</text>
            <text color="gray">{"  "}</text>
          </>
        )}

        {/* Tok/s (only during streaming) */}
        {tokPerSecStr() && (
          <>
            <text color="cyan">{tokPerSecStr()}</text>
            <text color="gray">{"  "}</text>
          </>
        )}

        {/* Timer (only during streaming) */}
        {timerStr() && (
          <text color="yellow">{timerStr()}</text>
        )}
      </box>

      {/* Line 2: permission mode */}
      <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
        <text color="#d787af">{"\u25C6"}</text>
        <text color="#d787af">{` ${permissionModeLabel(permMode())}`}</text>
        <text dimmed color="gray">{" (shift+tab to cycle)"}</text>
      </box>
    </box>
  )
}
