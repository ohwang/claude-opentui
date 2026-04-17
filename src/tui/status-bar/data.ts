/**
 * useStatusBarData — Shared reactive data consumed by every status bar preset.
 *
 * Presets are pure components of this data. Extracting it here means:
 *   - Token-rate sampling, git refresh, and context-pct memos are singletons
 *     (computed once, shared across all presets).
 *   - Swapping the active preset doesn't re-run expensive setup (git spawn).
 *   - Preset authors don't have to re-wire into session/agent/messages
 *     contexts — they just read fields off `StatusBarData`.
 *
 * The data hook is called once by the outer `StatusBar` component and passed
 * down to the active preset via `props.data`.
 */
import { createEffect, createMemo, createSignal, onCleanup, on, type Accessor } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import path from "node:path"
import { useAgent } from "../context/agent"
import { useMessages } from "../context/messages"
import { useSession } from "../context/session"
import type { PermissionMode, SandboxInfo, RateLimitEntry } from "../../protocol/types"
import { DEFAULT_CONTEXT_WINDOW, MODEL_CONTEXT_WINDOWS, friendlyModelName } from "../models"
import { setTerminalProgress } from "../../utils/terminal-notify"
import { toast } from "../context/toast"
import { colors } from "../theme/tokens"

// ---------------------------------------------------------------------------
// Token-rate tracking constants
// ---------------------------------------------------------------------------

const SAMPLE_WINDOW_MS = 3_000
const TICK_INTERVAL_MS = 300

interface TokenSample {
  timestamp: number
  totalTokens: number
}

// ---------------------------------------------------------------------------
// Git info
// ---------------------------------------------------------------------------

export interface GitInfo {
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
// Rate-limit display helpers (exported so presets can reuse)
// ---------------------------------------------------------------------------

export interface RateLimitDisplay {
  label: string
  usedPercentage: number
}

export function formatRateLimitWindowLabel(
  windowDurationMins: number | undefined,
  fallback: string,
): string {
  if (typeof windowDurationMins !== "number") return fallback
  if (windowDurationMins < 60) return `${windowDurationMins}m`
  if (windowDurationMins < 1440) return `${Math.round(windowDurationMins / 60)}h`
  const days = Math.round(windowDurationMins / 1440)
  return `${days}d`
}

export function rateLimitColor(usedPercentage: number): string {
  if (usedPercentage >= 80) return colors.status.error
  if (usedPercentage >= 50) return colors.status.warning
  return colors.status.success
}

// ---------------------------------------------------------------------------
// StatusBarData — the shape passed to presets
// ---------------------------------------------------------------------------

export interface StatusBarData {
  // Static (no change mid-session)
  projectName: string

  // Direct pass-through accessors (reactive, but no derivation needed)
  permMode: Accessor<PermissionMode>
  sessionState: Accessor<string>
  backgrounded: Accessor<boolean>
  termWidth: Accessor<number>
  sandboxHint: Accessor<string>
  sandboxInfo: Accessor<SandboxInfo | undefined>
  backendName: Accessor<string>

  // Derived scalars
  isRunning: Accessor<boolean>
  modelDisplay: Accessor<string>
  effortBadge: Accessor<string>
  costStr: Accessor<string>
  gitInfo: Accessor<GitInfo | null>
  gitStr: Accessor<string>
  ctxPct: Accessor<number>
  ctxStr: Accessor<string>
  ctxBar: Accessor<string>
  ctxColor: Accessor<string>
  tokPerSecStr: Accessor<string>
  turnNumber: Accessor<number>
  rateLimits: Accessor<RateLimitDisplay[]>
  rawRateLimits: Accessor<{
    fiveHour?: RateLimitEntry
    sevenDay?: RateLimitEntry
    primary?: RateLimitEntry
    secondary?: RateLimitEntry
  } | undefined>

  // Responsive breakpoint helpers (consistent across presets)
  showCtx: Accessor<boolean>
  showGit: Accessor<boolean>
  showCost: Accessor<boolean>

  // Computed state color / icon (for state dot across presets)
  stateIcon: Accessor<string>
  stateColor: Accessor<string>
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * Build the reactive data bundle consumed by status bar presets.
 *
 * Call once from the outer `StatusBar` component. The returned object's
 * accessors are live — read them inside JSX / memos / effects of the preset.
 */
export function useStatusBarData(permMode: Accessor<PermissionMode>): StatusBarData {
  const { state } = useSession()
  const { state: messagesState } = useMessages()
  const agent = useAgent()

  const dims = useTerminalDimensions()
  const projectName = path.basename(process.cwd())

  // -- Git info (refreshed on RUNNING -> IDLE edge) --
  const [gitInfo, setGitInfo] = createSignal<GitInfo | null>(getGitInfo())
  let prevStateForGit: string = state.sessionState
  createEffect(() => {
    const current = state.sessionState
    if (current === "IDLE" && prevStateForGit === "RUNNING") {
      setGitInfo(getGitInfo())
    }
    prevStateForGit = current
  })

  // -- Token-rate tracking + terminal progress --
  const [tokPerSec, setTokPerSec] = createSignal(0)
  let tokenSamples: TokenSample[] = []
  let prevSessionState: string = state.sessionState

  const tickerHandle = setInterval(() => {
    const currentState = state.sessionState
    const isRunning = currentState === "RUNNING"

    if (isRunning && prevSessionState !== "RUNNING") {
      tokenSamples = []
      setTokPerSec(0)
    }
    if (!isRunning && prevSessionState === "RUNNING") {
      tokenSamples = []
      setTokPerSec(0)
    }

    prevSessionState = currentState

    if (isRunning) {
      const now = Date.now()
      const totalTokens = state.cost.inputTokens + state.cost.outputTokens
      tokenSamples.push({ timestamp: now, totalTokens })
      const cutoff = now - SAMPLE_WINDOW_MS
      tokenSamples = tokenSamples.filter((s) => s.timestamp >= cutoff)

      if (tokenSamples.length >= 2) {
        const oldest = tokenSamples[0]
        const newest = tokenSamples[tokenSamples.length - 1]
        if (oldest && newest) {
          const dtSec = (newest.timestamp - oldest.timestamp) / 1000
          if (dtSec > 0) {
            const rate = (newest.totalTokens - oldest.totalTokens) / dtSec
            setTokPerSec(Math.round(rate))
          }
        }
      }

      // Update terminal progress (context window fill)
      const fill = state.lastTurnInputTokens
      if (fill > 0) {
        const model = state.session?.models?.[0]
        const raw = state.currentModel || model?.name || ""
        const ctxWindow = model?.contextWindow ?? MODEL_CONTEXT_WINDOWS[raw] ?? DEFAULT_CONTEXT_WINDOW
        const pct = Math.min(100, Math.round((fill / ctxWindow) * 100))
        setTerminalProgress("running", pct)
      }
    }
  }, TICK_INTERVAL_MS)
  onCleanup(() => clearInterval(tickerHandle))

  // ---------------------------------------------------------------------------
  // Accessors / memos
  // ---------------------------------------------------------------------------

  const sessionState = () => state.sessionState
  const backgrounded = () => messagesState.backgrounded
  const termWidth = () => dims()?.width ?? 120
  const backendName = () => agent.backend.capabilities().name

  const isRunning = createMemo(() => state.sessionState === "RUNNING")

  const showCost = () => termWidth() >= 60
  const showGit = () => termWidth() >= 80
  const showCtx = () => termWidth() >= 100

  // Model display — friendly name + context abbrev
  const modelDisplay = () => {
    const model = state.session?.models?.[0]
    const raw = state.currentModel || model?.name || ""
    if (!raw) return `unknown model (${backendName()})`
    const friendly = friendlyModelName(raw)
    const ctxWindow = model?.contextWindow ?? MODEL_CONTEXT_WINDOWS[raw] ?? DEFAULT_CONTEXT_WINDOW
    const ctxAbbrev = ctxWindow >= 1_000_000
      ? `${ctxWindow / 1_000_000}M`
      : `${ctxWindow / 1_000}K`
    return `${friendly} (${ctxAbbrev})`
  }

  const effortBadge = createMemo(() => {
    const e = state.currentEffort
    if (!e || e === "high") return ""
    return e === "medium" ? "med" : e
  })

  const costStr = createMemo(() => {
    const c = state.cost.totalCostUsd
    if (c === 0) return ""
    return `$${c.toFixed(4)}`
  })

  const gitStr = createMemo(() => {
    const info = gitInfo()
    if (!info) return ""
    const parts: string[] = [info.branch]
    if (info.ahead > 0) parts.push(`\u2191${info.ahead}`)
    else if (info.hasUpstream) parts.push("\u2261")
    const statusParts: string[] = []
    if (info.modified > 0) statusParts.push(`~${info.modified}`)
    if (info.untracked > 0) statusParts.push(`+${info.untracked}`)
    if (statusParts.length > 0) parts.push("| " + statusParts.join(" "))
    return `[${parts.join(" ")}]`
  })

  const ctxPct = createMemo(() => {
    const fill = state.lastTurnInputTokens
    if (fill === 0) return 0
    const model = state.session?.models?.[0]
    const raw = state.currentModel || model?.name || ""
    const ctxWindow = model?.contextWindow ?? MODEL_CONTEXT_WINDOWS[raw] ?? DEFAULT_CONTEXT_WINDOW
    return Math.round((fill / ctxWindow) * 100)
  })

  const ctxStr = createMemo(() => {
    const pct = ctxPct()
    if (pct === 0) {
      return state.lastTurnInputTokens > 0 ? "ctx:<1%" : ""
    }
    return `ctx:${pct}%`
  })

  const ctxColor = createMemo(() => {
    const pct = ctxPct()
    if (pct >= 80) return colors.status.error
    if (pct >= 50) return colors.status.warning
    return colors.status.success
  })

  const ctxBar = createMemo(() => {
    const pct = ctxPct()
    if (pct === 0 && state.lastTurnInputTokens === 0) return ""
    const filled = Math.min(
      10,
      Math.max(pct > 0 ? 1 : (state.lastTurnInputTokens > 0 ? 1 : 0), Math.round(pct / 10)),
    )
    const empty = 10 - filled
    return "\u25B0".repeat(filled) + "\u25B1".repeat(empty)
  })

  // Toast warnings on 80% / 95% thresholds (once per reset)
  let lastWarningLevel = 0
  createEffect(on(ctxPct, (pct) => {
    if (pct === 0) {
      lastWarningLevel = 0
    } else if (pct >= 95 && lastWarningLevel < 2) {
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

  const turnNumber = () => state.turnNumber

  const rawRateLimits = () => state.rateLimits ?? undefined

  const rateLimits = createMemo<RateLimitDisplay[]>(() => {
    const rl = state.rateLimits
    if (!rl) return []
    const displays: RateLimitDisplay[] = []
    if (rl.fiveHour) displays.push({ label: "5h", usedPercentage: rl.fiveHour.usedPercentage })
    if (rl.sevenDay) displays.push({ label: "7d", usedPercentage: rl.sevenDay.usedPercentage })
    if (rl.primary) {
      displays.push({
        label: formatRateLimitWindowLabel(rl.primary.windowDurationMins, "primary"),
        usedPercentage: rl.primary.usedPercentage,
      })
    }
    if (rl.secondary) {
      displays.push({
        label: formatRateLimitWindowLabel(rl.secondary.windowDurationMins, "secondary"),
        usedPercentage: rl.secondary.usedPercentage,
      })
    }
    return displays
  })

  const sandboxInfo = (): SandboxInfo | undefined => agent.backend.capabilities().sandboxInfo

  const sandboxHint = createMemo((): string => {
    const info = sandboxInfo()
    if (!info) return ""
    const modeDetail = info.modeDetails[permMode()]
    if (modeDetail?.separateSandbox) return info.statusHint
    if (backendName() !== "claude") return info.statusHint
    return ""
  })

  const stateIcon = () => {
    if (messagesState.backgrounded) return "\u2B21"
    switch (state.sessionState) {
      case "INITIALIZING": return "\u25CC"
      case "IDLE": return "\u25CF"
      case "RUNNING": return "\u27F3"
      case "WAITING_FOR_PERM": return "\u26A0"
      case "WAITING_FOR_ELIC": return "?"
      case "INTERRUPTING": return "\u23F8"
      case "ERROR": return "\u2717"
      case "SHUTTING_DOWN": return "\u25CC"
      default: return "\u25CF"
    }
  }

  const stateColor = () => {
    if (messagesState.backgrounded) return colors.status.warning
    switch (state.sessionState) {
      case "IDLE": return colors.state.idle
      case "RUNNING": return colors.state.running
      case "WAITING_FOR_PERM":
      case "WAITING_FOR_ELIC":
      case "INTERRUPTING":
        return colors.state.waiting
      case "ERROR": return colors.state.error
      case "SHUTTING_DOWN": return colors.state.shuttingDown
      default: return colors.state.shuttingDown
    }
  }

  return {
    projectName,
    permMode,
    sessionState,
    backgrounded,
    termWidth,
    sandboxHint,
    sandboxInfo,
    backendName,
    isRunning,
    modelDisplay,
    effortBadge,
    costStr,
    gitInfo,
    gitStr,
    ctxPct,
    ctxStr,
    ctxBar,
    ctxColor,
    tokPerSecStr,
    turnNumber,
    rateLimits,
    rawRateLimits,
    showCtx,
    showGit,
    showCost,
    stateIcon,
    stateColor,
  }
}
