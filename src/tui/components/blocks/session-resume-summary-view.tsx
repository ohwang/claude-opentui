/**
 * SessionResumeSummaryView — boundary marker between loaded-from-disk
 * history and new turns in a resumed conversation.
 *
 * Rendered once per resume, immediately after the historical blocks in the
 * scrollback. Shows the user:
 *
 *   - which session they're resuming (origin backend, short sessionId)
 *   - how much history is there (message + tool counts, last-active time)
 *   - token usage and context-window fill percentage — the "is this session
 *     worth continuing?" signal. Heavy context sessions (80%+) often
 *     benefit from a fresh start or /compact instead of resume.
 *   - cross-backend caveats when the original session came from a
 *     different backend than the one we're resuming into.
 *
 * The component is intentionally heavier than a one-line system_message:
 * having a dedicated component lets us evolve the UX over time (relative
 * time that updates, keybinds for fork/export/view metadata, richer
 * cross-backend warnings) without having to change every emission site.
 */

import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { colors } from "../../theme/tokens"
import { formatTokens, formatRelativeTimeAgo } from "../../../utils/format"
import type { Block } from "../../../protocol/types"

type SessionResumeSummaryBlock = Extract<Block, { type: "session_resume_summary" }>

function formatCost(usd: number): string {
  if (!usd || !Number.isFinite(usd)) return "$0"
  if (usd < 0.01) return "<$0.01"
  if (usd < 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

function formatContextPercent(used: number, window: number): string {
  if (!window) return ""
  const pct = Math.round((used / window) * 100)
  return `${pct}% context`
}

export function SessionResumeSummaryView(props: { block: SessionResumeSummaryBlock }) {
  const dims = useTerminalDimensions()
  const b = () => props.block
  const isCrossBackend = () => b().origin !== b().target

  const separator = () => {
    const width = (dims()?.width ?? 80) - 4
    return "\u2500".repeat(Math.max(width, 20))
  }

  const icon = () => (isCrossBackend() ? "\u21C4" : "\u21BB")

  const headerText = () =>
    isCrossBackend()
      ? `Resumed ${b().origin} session in ${b().target} backend`
      : `Resumed ${b().origin} session`

  const countsLine = () => {
    const parts: string[] = []
    parts.push(`${b().messageCount} message${b().messageCount === 1 ? "" : "s"}`)
    if (b().toolCallCount > 0) {
      parts.push(`${b().toolCallCount} tool call${b().toolCallCount === 1 ? "" : "s"}`)
    }
    if (b().lastActiveAt) {
      parts.push(`last active ${formatRelativeTimeAgo(new Date(b().lastActiveAt!))}`)
    }
    return parts.join(" \u00B7 ")
  }

  const usageLine = () => {
    const usage = b().usage
    if (!usage) return null
    const parts: string[] = []
    const contextTokens = usage.contextTokens
    const window = b().contextWindowTokens
    if (contextTokens && window) {
      parts.push(`${formatTokens(contextTokens)} / ${formatTokens(window)} tokens`)
      parts.push(formatContextPercent(contextTokens, window))
    } else if (contextTokens) {
      parts.push(`${formatTokens(contextTokens)} tokens`)
    }
    if (usage.totalCostUsd && usage.totalCostUsd > 0) {
      parts.push(`${formatCost(usage.totalCostUsd)} spent`)
    }
    return parts.length > 0 ? parts.join(" \u00B7 ") : null
  }

  const sessionIdLine = () => {
    const id = b().sessionId
    if (!id) return null
    return `Session ${id}`
  }

  // Warn when context is nearly full — at this point the user is usually
  // better served by /compact or a fresh session than by piling on more
  // turns. Threshold matches Claude Code's compaction trigger (80%).
  const contextWarning = () => {
    const usage = b().usage
    const window = b().contextWindowTokens
    if (!usage?.contextTokens || !window) return null
    const pct = usage.contextTokens / window
    if (pct >= 0.8) {
      return "Context is nearly full — consider /compact before continuing"
    }
    return null
  }

  return (
    <box flexDirection="column" paddingLeft={2} marginTop={1}>
      <text fg={colors.text.subtle}>{separator()}</text>

      <box flexDirection="row" marginTop={0}>
        <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
          {icon() + " " + headerText()}
        </text>
      </box>

      <box paddingLeft={2} marginTop={0}>
        <text fg={colors.text.secondary}>{countsLine()}</text>
      </box>

      <Show when={usageLine()}>
        <box paddingLeft={2} marginTop={0}>
          <text fg={colors.text.muted}>{usageLine()}</text>
        </box>
      </Show>

      <Show when={contextWarning()}>
        <box paddingLeft={2} marginTop={0}>
          <text fg={colors.status.warning} attributes={TextAttributes.DIM}>
            {"\u26A0 " + contextWarning()}
          </text>
        </box>
      </Show>

      <Show when={b().crossBackendCaveat}>
        <box paddingLeft={2} marginTop={0}>
          <text fg={colors.status.warning} attributes={TextAttributes.DIM}>
            {"\u26A0 " + b().crossBackendCaveat}
          </text>
        </box>
      </Show>

      <Show when={sessionIdLine()}>
        <box paddingLeft={2} marginTop={0}>
          <text fg={colors.text.subtle}>{sessionIdLine()}</text>
        </box>
      </Show>

      <text fg={colors.text.subtle}>{separator()}</text>
    </box>
  )
}
