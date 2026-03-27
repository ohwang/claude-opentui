/**
 * Status Bar — Model, cost, tokens, state indicator
 *
 * Fixed 1-line bar at the bottom of the TUI.
 *
 * During RUNNING state, shows:
 * - Live cost ticker (updates every 300ms based on streaming token counts)
 * - Tokens-per-second throughput
 * - Turn duration timer
 */

import { createSignal, createMemo, onCleanup } from "solid-js"
import { useSession } from "../context/session"

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
// Component
// ---------------------------------------------------------------------------

export function StatusBar() {
  const { state } = useSession()

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

  const modelName = () => state.currentModel || state.session?.models?.[0]?.name || "claude"

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
    if (total > 1000) return `${(total / 1000).toFixed(1)}k tokens`
    return `${total} tokens`
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
      <text bold color="white">
        {modelName()}
      </text>
      <text color="gray">{" "}</text>
      <text color={stateColor()}>
        {stateIcon()}
      </text>
      {costStr() && (
        <>
          <text color="gray">{" "}</text>
          <text color="green">{costStr()}</text>
        </>
      )}
      {tokenStr() && (
        <>
          <text color="gray">{" "}</text>
          <text color="gray">{tokenStr()}</text>
        </>
      )}
      {tokPerSecStr() && (
        <>
          <text color="gray">{" "}</text>
          <text color="cyan">{tokPerSecStr()}</text>
        </>
      )}
      {timerStr() && (
        <>
          <text color="gray">{" "}</text>
          <text color="yellow">{timerStr()}</text>
        </>
      )}
    </box>
  )
}
