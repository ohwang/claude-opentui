/**
 * Diagnostics Panel — Ctrl+Shift+D toggle overlay
 *
 * Renders a scrollable diagnostics view inspired by claude-go's DiagDialog.
 * Shows system info, session state, tokens & cost, context window,
 * activity, conversation summary, git info, and config.
 *
 * Toggled via Ctrl+Shift+D. Pressing again or Esc/q closes it.
 */

import { createSignal, createMemo, Show, For, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useSession } from "../context/session"
import { useAgent } from "../context/agent"
import { useMessages } from "../context/messages"
import { colors } from "../theme/tokens"
import { log } from "../../utils/logger"
import { friendlyModelName, MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from "../models"
import type { Block } from "../../protocol/types"

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

export function DiagnosticsPanel(props: { visible: boolean; onClose: () => void }) {
  const { state: session } = useSession()
  const agent = useAgent()
  const { state: messages } = useMessages()
  const dims = useTerminalDimensions()

  // Track uptime from when session entered IDLE
  const startTime = Date.now()

  // Collect all diagnostic sections as a reactive memo
  const sections = createMemo((): DiagSection[] => {
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

  return (
    <Show when={props.visible}>
      {/* Diagnostics panel — fills the entire terminal, replacing the conversation */}
      <box
        flexGrow={1}
        width="100%"
        bg={colors.bg.overlay}
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        {/* Title bar */}
        <box flexDirection="row" flexShrink={0}>
          <text fg="white" attributes={TextAttributes.BOLD}>
            {"Diagnostics"}
          </text>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {"  (Ctrl+Shift+D or Esc to close)"}
          </text>
        </box>

        {/* Separator line */}
        <box height={1} flexShrink={0}>
          <text fg={colors.border.default}>{"─".repeat(dims()?.width ? dims()!.width - 4 : 70)}</text>
        </box>

        {/* Content in a scrollbox so it doesn't overflow */}
        <scrollbox flexGrow={1} stickyScroll={false} bg={colors.bg.overlay}>
          {/* Sections */}
          <For each={sections()}>
            {(section) => (
              <box flexDirection="column">
                {/* Section title */}
                <box marginTop={1}>
                  <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
                    {"  " + section.title}
                  </text>
                </box>

                {/* Key-value entries */}
                <For each={section.entries}>
                  {(entry) => (
                    <box flexDirection="row" paddingLeft={4}>
                      <text fg={colors.text.muted}>{padRight(entry.key, 22)}</text>
                      <text fg={entry.color ?? "white"}>{" " + entry.value}</text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </scrollbox>
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
    default: return colors.text.muted
  }
}
