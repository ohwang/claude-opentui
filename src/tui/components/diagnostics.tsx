/**
 * Diagnostics Panel — Ctrl+Shift+D toggle overlay
 *
 * Two-tab diagnostics view:
 *   [1] Info  — system, session, tokens, context, git, backend, config
 *   [2] Logs  — real-time streaming log viewer (current session)
 *
 * Toggled via Ctrl+Shift+D. Pressing again or Esc/q closes it.
 * Switch tabs with 1/2 or Tab.
 */

import { createSignal, createMemo, Show, For, Index, onCleanup, batch } from "solid-js"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useSession } from "../context/session"
import { useAgent } from "../context/agent"
import { useMessages } from "../context/messages"
import { colors } from "../theme/tokens"
import { log } from "../../utils/logger"
import { friendlyModelName, MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from "../models"
import type { Block } from "../../protocol/types"

// ---------------------------------------------------------------------------
// Module-level callbacks — called from app.tsx keyboard handler
// ---------------------------------------------------------------------------
let _scrollDiagnostics: ((amount: number) => void) | undefined
let _scrollDiagnosticsToTop: (() => void) | undefined
let _scrollDiagnosticsToBottom: (() => void) | undefined
let _switchDiagnosticsTab: ((tab?: number) => void) | undefined

/**
 * Scroll the diagnostics panel by the given amount.
 * Positive = down, negative = up.
 */
export function scrollDiagnostics(amount: number): void {
  _scrollDiagnostics?.(amount)
}

/** Scroll the diagnostics panel to the very top (vim `gg`). */
export function scrollDiagnosticsToTop(): void {
  _scrollDiagnosticsToTop?.()
}

/** Scroll the diagnostics panel to the very bottom (vim `G`). */
export function scrollDiagnosticsToBottom(): void {
  _scrollDiagnosticsToBottom?.()
}

/**
 * Switch the diagnostics tab.
 * If no tab index given, cycles to the next tab.
 */
export function switchDiagnosticsTab(tab?: number): void {
  _switchDiagnosticsTab?.(tab)
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

interface DiagSection {
  title: string
  entries: DiagEntry[]
}

interface DiagEntry {
  key: string
  value: string
  color?: string
}

function formatTokenCount(n: number): string {
  if (n === 0) return "0"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s"
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  if (mins < 60) return `${mins}m ${secs}s`
  const hrs = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hrs}h ${remMins}m ${secs}s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getGitBranch(): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if (result.exitCode === 0) return result.stdout.toString().trim()
  } catch { /* ignore */ }
  return ""
}

function getGitDirtyCount(): number {
  try {
    const result = Bun.spawnSync(["git", "status", "--porcelain"])
    if (result.exitCode === 0) {
      const lines = result.stdout.toString().trim()
      if (!lines) return 0
      return lines.split("\n").filter(l => l.trim()).length
    }
  } catch { /* ignore */ }
  return 0
}

// ---------------------------------------------------------------------------
// Diagnostics Panel Component
// ---------------------------------------------------------------------------

const TAB_COUNT = 2
const TAB_NAMES = ["Info", "Logs"] as const

export function DiagnosticsPanel(props: { visible: boolean; onClose: () => void }) {
  const { state: session } = useSession()
  const agent = useAgent()
  const { state: messages } = useMessages()
  const dims = useTerminalDimensions()

  // Track app uptime from component mount (≈ app start)
  const startTime = Date.now()

  // Tick signal — forces the uptime (and memory stats) to refresh every second
  const [tick, setTick] = createSignal(0)
  const tickInterval = setInterval(() => setTick(t => t + 1), 1_000)
  onCleanup(() => clearInterval(tickInterval))

  // ---------------------------------------------------------------------------
  // Tab state
  // ---------------------------------------------------------------------------
  const [activeTab, setActiveTab] = createSignal(0)

  // Expose tab switching to app.tsx keyboard handler
  _switchDiagnosticsTab = (tab?: number) => {
    if (tab !== undefined) {
      setActiveTab(Math.max(0, Math.min(tab, TAB_COUNT - 1)))
    } else {
      setActiveTab(prev => (prev + 1) % TAB_COUNT)
    }
  }

  // ---------------------------------------------------------------------------
  // Log lines (real-time)
  // ---------------------------------------------------------------------------
  const [logLines, setLogLines] = createSignal<string[]>(log.getLines().slice())
  const hasLogLines = createMemo(() => logLines().length > 0)

  const unsubscribe = log.subscribe((line: string) => {
    setLogLines(prev => [...prev, line])
  })
  onCleanup(() => unsubscribe())

  // Scroll refs — one per tab, only the active one is connected
  let infoScrollRef: ScrollBoxRenderable | undefined
  let logsScrollRef: ScrollBoxRenderable | undefined

  // Update the module-level scroll callbacks to route to the active tab
  const updateScrollRef = () => {
    _scrollDiagnostics = (n: number) => {
      if (activeTab() === 0) {
        infoScrollRef?.scrollBy(n)
      } else {
        logsScrollRef?.scrollBy(n)
      }
    }
    _scrollDiagnosticsToTop = () => {
      if (activeTab() === 0) {
        infoScrollRef?.scrollTo(0)
      } else {
        logsScrollRef?.scrollTo(0)
      }
    }
    _scrollDiagnosticsToBottom = () => {
      // scrollTo a very large value — the scrollbox clamps to max
      if (activeTab() === 0) {
        infoScrollRef?.scrollTo(999_999)
      } else {
        logsScrollRef?.scrollTo(999_999)
      }
    }
  }

  // Clean up module-level refs when component unmounts
  onCleanup(() => {
    _scrollDiagnostics = undefined
    _scrollDiagnosticsToTop = undefined
    _scrollDiagnosticsToBottom = undefined
    _switchDiagnosticsTab = undefined
  })

  // Collect all diagnostic sections as a reactive memo
  const sections = createMemo((): DiagSection[] => {
    // Subscribe to tick so uptime and memory stats refresh every second
    tick()

    const result: DiagSection[] = []

    // -- SYSTEM --
    const mem = process.memoryUsage()
    result.push({
      title: "SYSTEM",
      entries: [
        { key: "Version:", value: "v0.0.1" },
        { key: "Runtime:", value: `Bun ${Bun.version}` },
        { key: "Platform:", value: `${process.platform}/${process.arch}` },
        { key: "Terminal:", value: `${dims()?.width ?? 0}x${dims()?.height ?? 0}` },
        { key: "Heap used:", value: formatBytes(mem.heapUsed) },
        { key: "RSS:", value: formatBytes(mem.rss) },
      ],
    })

    // -- SESSION --
    const sessionId = session.session?.sessionId ?? "(none)"
    const uptime = Date.now() - startTime
    result.push({
      title: "SESSION",
      entries: [
        { key: "Session ID:", value: sessionId },
        { key: "State:", value: session.sessionState, color: stateColor(session.sessionState) },
        { key: "Uptime:", value: formatDuration(uptime) },
        { key: "Permission mode:", value: agent.config.permissionMode ?? "default" },
      ],
    })

    // -- MODEL --
    const rawModel = session.currentModel || session.session?.models?.[0]?.name || ""
    const modelDisplay = rawModel ? friendlyModelName(rawModel) : "(none)"
    result.push({
      title: "MODEL",
      entries: [
        { key: "Model:", value: modelDisplay },
        { key: "Model ID:", value: rawModel || "(none)" },
      ],
    })

    // -- TOKENS & COST --
    const cost = session.cost
    const tokenEntries: DiagEntry[] = [
      { key: "Input tokens:", value: formatTokenCount(cost.inputTokens) },
      { key: "Output tokens:", value: formatTokenCount(cost.outputTokens) },
    ]
    if (cost.cacheReadTokens > 0) {
      tokenEntries.push({ key: "Cache read:", value: formatTokenCount(cost.cacheReadTokens) })
    }
    if (cost.cacheWriteTokens > 0) {
      tokenEntries.push({ key: "Cache create:", value: formatTokenCount(cost.cacheWriteTokens) })
    }
    tokenEntries.push({ key: "Total cost:", value: `$${cost.totalCostUsd.toFixed(4)}`, color: "green" })
    result.push({ title: "TOKENS & COST", entries: tokenEntries })

    // -- CONTEXT WINDOW --
    const ctxModel = session.session?.models?.[0]
    const ctxWindow = ctxModel?.contextWindow ?? MODEL_CONTEXT_WINDOWS[rawModel] ?? DEFAULT_CONTEXT_WINDOW
    const ctxFill = session.lastTurnInputTokens
    const ctxPct = ctxWindow > 0 && ctxFill > 0 ? ((ctxFill / ctxWindow) * 100).toFixed(1) : "0.0"
    result.push({
      title: "CONTEXT WINDOW",
      entries: [
        { key: "Current tokens:", value: formatTokenCount(ctxFill) },
        { key: "Max tokens:", value: formatTokenCount(ctxWindow) },
        { key: "Utilization:", value: `${ctxPct}%` },
      ],
    })

    // -- ACTIVITY --
    result.push({
      title: "ACTIVITY",
      entries: [
        { key: "Turns:", value: String(session.turnNumber) },
      ],
    })

    // -- CONVERSATION --
    const blocks = messages.blocks
    const blockCounts: Record<string, number> = {}
    for (const b of blocks) {
      blockCounts[b.type] = (blockCounts[b.type] || 0) + 1
    }
    const convEntries: DiagEntry[] = [
      { key: "Total blocks:", value: String(blocks.length) },
    ]
    for (const [kind, count] of Object.entries(blockCounts).sort(([a], [b]) => a.localeCompare(b))) {
      convEntries.push({ key: `  ${kind}:`, value: String(count) })
    }
    const isStreaming = !!(messages.streamingText || messages.streamingThinking)
    convEntries.push({ key: "Streaming:", value: isStreaming ? "yes" : "no", color: isStreaming ? "cyan" : undefined })
    if (messages.streamingText) {
      convEntries.push({ key: "  text buffer:", value: `${messages.streamingText.length} chars` })
    }
    if (messages.streamingThinking) {
      convEntries.push({ key: "  thinking buf:", value: `${messages.streamingThinking.length} chars` })
    }
    convEntries.push({ key: "Active tasks:", value: String(messages.activeTasks.length) })
    result.push({ title: "CONVERSATION", entries: convEntries })

    // -- GIT --
    const branch = getGitBranch()
    if (branch) {
      result.push({
        title: "GIT",
        entries: [
          { key: "Branch:", value: branch },
          { key: "Dirty files:", value: String(getGitDirtyCount()) },
        ],
      })
    }

    // -- BACKEND --
    const caps = agent.backend.capabilities()
    result.push({
      title: "BACKEND",
      entries: [
        { key: "Name:", value: caps.name },
        { key: "Streaming:", value: caps.supportsStreaming ? "yes" : "no" },
        { key: "Thinking:", value: caps.supportsThinking ? "yes" : "no" },
        { key: "Resume:", value: caps.supportsResume ? "yes" : "no" },
        { key: "Subagents:", value: caps.supportsSubagents ? "yes" : "no" },
      ],
    })

    // -- CONFIG --
    result.push({
      title: "CONFIG",
      entries: [
        { key: "CWD:", value: process.cwd() },
        { key: "Log file:", value: log.getLogFile() },
      ],
    })

    // -- ERROR (if any) --
    if (session.lastError) {
      result.push({
        title: "LAST ERROR",
        entries: [
          { key: "Code:", value: session.lastError.code, color: "red" },
          { key: "Message:", value: session.lastError.message, color: "red" },
        ],
      })
    }

    return result
  })

  const separatorWidth = () => dims()?.width ? dims()!.width - 4 : 70

  return (
    <Show when={props.visible}>
      {/* Diagnostics panel — fills the entire terminal, replacing the conversation */}
      <box
        flexGrow={1}
        width="100%"
        backgroundColor={colors.bg.overlay}
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        {/* Title bar with tabs */}
        <box flexDirection="row" flexShrink={0}>
          <text fg={colors.text.primary} attributes={TextAttributes.BOLD}>
            {"Diagnostics"}
          </text>
          <text fg={colors.text.inactive}>{"  "}</text>
          <For each={TAB_NAMES as unknown as string[]}>
            {(name, i) => (
              <box flexDirection="row">
                <text fg={activeTab() === i() ? colors.accent.primary : colors.text.inactive} attributes={activeTab() === i() ? TextAttributes.BOLD : 0}>
                  {`[${i() + 1}] ${name}`}
                </text>
                <text fg={colors.text.inactive}>{i() < TAB_COUNT - 1 ? "  " : ""}</text>
              </box>
            )}
          </For>
        </box>

        {/* Separator line */}
        <box height={1} flexShrink={0}>
          <text fg={colors.border.default}>{"─".repeat(separatorWidth())}</text>
        </box>

        {/* Tab: Info */}
        <Show when={activeTab() === 0}>
          <scrollbox
            ref={(el: ScrollBoxRenderable) => { infoScrollRef = el; updateScrollRef() }}
            flexGrow={1}
            stickyScroll={false}
            backgroundColor={colors.bg.overlay}
          >
            <For each={sections()}>
              {(section) => (
                <box flexDirection="column">
                  <box marginTop={1}>
                    <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
                      {section.title}
                    </text>
                  </box>
                  <box height={1} />
                  <For each={section.entries}>
                    {(entry) => (
                      <box flexDirection="row">
                        <text fg={colors.text.inactive}>{padRight(entry.key, 22)}</text>
                        <text fg={entry.color ?? "white"}>{" " + entry.value}</text>
                      </box>
                    )}
                  </For>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>

        {/* Tab: Logs */}
        <Show when={activeTab() === 1}>
          <scrollbox
            ref={(el: ScrollBoxRenderable) => { logsScrollRef = el; updateScrollRef() }}
            flexGrow={1}
            stickyScroll={true}
            backgroundColor={colors.bg.overlay}
          >
            <Show when={hasLogLines()} fallback={
              <box marginTop={1}>
                <text fg={colors.text.inactive}>{"(no log entries yet)"}</text>
              </box>
            }>
              <Index each={logLines()}>
                {(line) => {
                  const parsed = createMemo(() => parseLogLine(line()))
                  return (
                    <box flexDirection="row">
                      <text fg={colors.text.inactive}>{parsed().timestamp + " "}</text>
                      <text fg={logLevelColor(parsed().level)} attributes={TextAttributes.BOLD}>{padRight(parsed().level, 6)}</text>
                      <text fg={logLevelColor(parsed().level)}>{parsed().message}</text>
                    </box>
                  )
                }}
              </Index>
            </Show>
          </scrollbox>
        </Show>

        {/* Footer — keyboard hints */}
        <box height={1} flexShrink={0}>
          <text fg={colors.border.default}>{"─".repeat(separatorWidth())}</text>
        </box>
        <box flexShrink={0}>
          <text fg={colors.text.inactive} attributes={TextAttributes.DIM}>
            {"j/k scroll, d/u page, gg/G top/bottom, 1/2 or Tab switch tab, Esc to close"}
          </text>
        </box>
      </box>
    </Show>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length)
}

function stateColor(state: string): string {
  switch (state) {
    case "IDLE": return colors.state.idle
    case "RUNNING": return colors.state.running
    case "WAITING_FOR_PERM":
    case "WAITING_FOR_ELIC":
    case "INTERRUPTING": return colors.state.waiting
    case "ERROR": return colors.state.error
    default: return colors.text.inactive
  }
}

// ---------------------------------------------------------------------------
// Log line parsing
// ---------------------------------------------------------------------------

interface ParsedLogLine {
  timestamp: string
  level: string
  message: string
}

/**
 * Parse a structured log line: `[ISO_TIMESTAMP] [LEVEL] message [data]`
 * Falls back gracefully for malformed lines.
 */
function parseLogLine(line: string): ParsedLogLine {
  // Match: [2026-04-08T10:30:45.123Z] [INFO ] rest of message
  const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/)
  if (match && match[1] && match[2] && match[3]) {
    const ts = match[1]
    // Show only HH:MM:SS.mmm for compactness
    const short = ts.includes("T") ? ts.slice(11, 23) : ts
    return { timestamp: short, level: match[2].trim(), message: match[3] }
  }
  // Unparseable — show raw
  return { timestamp: "", level: "???", message: line }
}

/** Map log level to a semantic color. */
function logLevelColor(level: string): string {
  switch (level) {
    case "DEBUG": return colors.text.thinking
    case "INFO":  return colors.text.primary
    case "WARN":  return colors.status.warning
    case "ERROR": return colors.status.error
    default:      return colors.text.inactive
  }
}
