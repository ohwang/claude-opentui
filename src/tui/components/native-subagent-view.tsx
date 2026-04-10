/**
 * NativeSubagentView -- Renders native cross-backend subagent progress
 *
 * Distinct from TaskView (which renders backend-native tasks).
 * Uses cyan accent color and shows rich metadata (backend badge,
 * turn count, tool count, recent tools breadcrumb, elapsed time).
 */

import { createSignal, createMemo, onCleanup, Show, For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { TaskInfo } from "../../protocol/types"
import { colors } from "../theme/tokens"

// Cyan accent for native subagents -- visually distinct from backend tasks
const ACCENT = "#00d7d7"
const DIM = "#808080"

/** Format elapsed time as human-readable string */
function formatElapsed(startTime: number, endTime?: number): string {
  const now = endTime ?? Date.now()
  const elapsed = Math.floor((now - startTime) / 1000)
  if (elapsed < 60) return `${elapsed}s`
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return `${mins}m${secs}s`
}

/** Format token count as human-readable (e.g., "45k") */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  return `${Math.round(n / 1000)}k`
}

/** Extract a short agent name from description or taskId */
function agentName(task: TaskInfo): string {
  // Use taskType if available (e.g., "Explore", "general-purpose")
  if (task.taskType) return task.taskType
  // Fall back to first word of description
  const first = task.description.split(/\s+/)[0]
  return first && first.length <= 20 ? first : "Subagent"
}

/** Get the last meaningful line of output (trimmed) */
function lastOutputLine(output: string): string {
  const lines = output.trim().split("\n").filter(l => l.trim().length > 0)
  const last = lines[lines.length - 1]
  if (!last) return ""
  return last.length > 80 ? last.slice(0, 77) + "..." : last
}

export function NativeSubagentView(props: { tasks: [string, TaskInfo][] }) {
  // Tick signal for elapsed time updates
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick(t => t + 1), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <For each={props.tasks}>
      {([_id, task]) => (
        <NativeSubagentItem task={task} tick={tick} />
      )}
    </For>
  )
}

function NativeSubagentItem(props: { task: TaskInfo; tick: () => number }) {
  const isRunning = createMemo(() => props.task.status === "running")
  const hasError = createMemo(() => !!props.task.errorMessage)

  // Status indicator character
  const statusChar = createMemo(() => {
    if (hasError()) return "\u2717" // X mark
    if (!isRunning()) return "\u2713" // check mark
    return "\u25CF" // filled circle
  })

  const statusColor = createMemo(() => {
    if (hasError()) return colors.status.error
    if (!isRunning()) return colors.status.success
    return props.task.thinkingActive ? ACCENT : DIM
  })

  // Progress stats line
  const statsLine = createMemo(() => {
    // Force reactivity on tick for elapsed time
    props.tick()

    const parts: string[] = []
    if (props.task.turnCount !== undefined) {
      parts.push(`Turn ${props.task.turnCount}`)
    }
    if (props.task.toolUseCount !== undefined) {
      parts.push(`${props.task.toolUseCount} tools`)
    }
    if (props.task.tokenUsage) {
      const total = props.task.tokenUsage.totalTokens
        ?? (props.task.tokenUsage.inputTokens + props.task.tokenUsage.outputTokens)
      if (total > 0) parts.push(`${formatTokens(total)} tokens`)
    }
    if (props.task.lastToolName) {
      parts.push(`Running ${props.task.lastToolName}...`)
    }
    parts.push(formatElapsed(props.task.startTime))
    return parts.join(" \u00B7 ")
  })

  // Recent tools breadcrumb (last 5)
  const toolsBreadcrumb = createMemo(() => {
    const tools = props.task.recentTools
    if (!tools || tools.length === 0) return null
    return tools.slice(-5).join(" \u2192 ")
  })

  return (
    <box flexDirection="column" paddingTop={1} paddingLeft={2}>
      {/* Line 1: Header */}
      <box flexDirection="row">
        <text fg={ACCENT}>{"\u27E1 "}</text>
        <text fg={ACCENT} attributes={TextAttributes.BOLD}>
          {agentName(props.task)}
        </text>
        <Show when={props.task.model}>
          <text fg={DIM} attributes={TextAttributes.DIM}>
            {" (" + props.task.model + ")"}
          </text>
        </Show>
        <Show when={props.task.backendName}>
          <text fg={DIM} attributes={TextAttributes.DIM}>
            {" [" + props.task.backendName + "]"}
          </text>
        </Show>
        <text fg={colors.text.primary}>
          {" " + props.task.description}
        </text>
      </box>

      {/* Line 2: Progress (running only) */}
      <Show when={isRunning()}>
        <box flexDirection="row" paddingLeft={2}>
          <text fg={statusColor()}>{statusChar() + " "}</text>
          <text fg={colors.text.secondary}>{statsLine()}</text>
        </box>
      </Show>

      {/* Line 3: Recent tools breadcrumb (running, non-empty) */}
      <Show when={isRunning() && toolsBreadcrumb()}>
        <box flexDirection="row" paddingLeft={2}>
          <text fg={DIM}>{toolsBreadcrumb()}</text>
        </box>
      </Show>

      {/* Completed: summary line with final stats */}
      <Show when={!isRunning() && !hasError()}>
        <box flexDirection="row" paddingLeft={2}>
          <text fg={statusColor()}>{statusChar() + " "}</text>
          <text fg={colors.text.secondary}>
            {(() => {
              const parts: string[] = []
              parts.push("Completed in " + formatElapsed(props.task.startTime, props.task.endTime))
              if (props.task.tokenUsage) {
                const total = props.task.tokenUsage.totalTokens
                  ?? (props.task.tokenUsage.inputTokens + props.task.tokenUsage.outputTokens)
                if (total > 0) parts.push(`${formatTokens(total)} tokens`)
              }
              if (props.task.toolUseCount) parts.push(`${props.task.toolUseCount} tools`)
              return parts.join(" \u00B7 ")
            })()}
          </text>
        </box>
        <Show when={props.task.output}>
          <box flexDirection="row" paddingLeft={4}>
            <text fg={DIM}>{lastOutputLine(props.task.output)}</text>
          </box>
        </Show>
      </Show>

      {/* Error state */}
      <Show when={hasError()}>
        <box flexDirection="row" paddingLeft={2}>
          <text fg={colors.status.error}>{statusChar() + " "}</text>
          <text fg={colors.status.error}>{props.task.errorMessage}</text>
        </box>
      </Show>
    </box>
  )
}
