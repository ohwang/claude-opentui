/**
 * Session Picker -- Interactive session selection for --resume without ID
 *
 * Shows a scrollable list of recent sessions sorted by most recent first.
 * Each entry displays: timestamp, truncated first user message / title, model.
 * Up/Down to navigate, Enter to select, Escape/Ctrl+C to exit.
 *
 * Rendered as a standalone view (replaces the main app layout) rather than
 * a modal overlay, since the main app hasn't started yet when the picker
 * is shown.
 */

import { createSignal, createMemo, Show, Index } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/solid"
import type { SessionInfo } from "../../protocol/types"
import { colors } from "../theme/tokens"
import { log } from "../../utils/logger"

/** Maximum number of sessions visible without scrolling */
const MAX_VISIBLE = 16

export interface SessionPickerProps {
  sessions: SessionInfo[]
  onSelect: (sessionId: string) => void
  onCancel: () => void
}

/** Format a Unix timestamp (ms) into a relative or absolute date string */
function formatTimestamp(ts: number): string {
  const now = Date.now()
  const diffMs = now - ts
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  const d = new Date(ts)
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${month}-${day}`
}

/** Truncate a session title to fit within the available width */
function truncateTitle(title: string, maxWidth: number): string {
  // Take only the first line
  const firstLine = title.split("\n")[0] ?? title
  if (firstLine.length <= maxWidth) return firstLine
  return firstLine.slice(0, maxWidth - 1) + "\u2026"
}

export function SessionPicker(props: SessionPickerProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const dims = useTerminalDimensions()
  const renderer = useRenderer()

  // Sessions are already sorted by most recent first from the backend
  const sessions = createMemo(() => props.sessions)

  /** Destroy the renderer to restore the terminal, then call the cancel callback */
  const cancelWithCleanup = () => {
    try {
      renderer.destroy()
    } catch (e) {
      log.error("renderer.destroy() failed during picker cancel", { error: String(e) })
    }
    props.onCancel()
  }

  // Compute the visible window offset for scrolling
  const visibleCount = () => Math.min(MAX_VISIBLE, sessions().length)
  const scrollOffset = createMemo(() => {
    const idx = selectedIndex()
    const visible = visibleCount()
    // Keep selected item visible with 2-line margin at edges
    const maxOffset = Math.max(0, sessions().length - visible)
    const idealStart = idx - Math.floor(visible / 2)
    return Math.max(0, Math.min(maxOffset, idealStart))
  })

  const visibleSessions = createMemo(() => {
    const offset = scrollOffset()
    return sessions().slice(offset, offset + visibleCount())
  })

  // Column widths for alignment
  const timestampCol = 12 // "2025-01-15" or "3h ago     "
  const contentWidth = () => Math.min((dims()?.width ?? 80) - 8, 120)

  useKeyboard((event) => {
    if (event.name === "escape" || (event.ctrl && event.name === "c")) {
      event.preventDefault()
      cancelWithCleanup()
      return
    }

    if (event.name === "up" || event.name === "k") {
      event.preventDefault()
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }

    if (event.name === "down" || event.name === "j") {
      event.preventDefault()
      setSelectedIndex((i) => Math.min(sessions().length - 1, i + 1))
      return
    }

    if (event.name === "return") {
      event.preventDefault()
      const session = sessions()[selectedIndex()]
      if (session) {
        props.onSelect(session.id)
      }
      return
    }

    // Page up/down for fast scrolling
    if (event.name === "pageup") {
      event.preventDefault()
      setSelectedIndex((i) => Math.max(0, i - visibleCount()))
      return
    }
    if (event.name === "pagedown") {
      event.preventDefault()
      setSelectedIndex((i) => Math.min(sessions().length - 1, i + visibleCount()))
      return
    }

    // Home/End
    if (event.name === "home") {
      event.preventDefault()
      setSelectedIndex(0)
      return
    }
    if (event.name === "end") {
      event.preventDefault()
      setSelectedIndex(sessions().length - 1)
      return
    }

    // Block all other keys from propagating
    event.preventDefault()
  })

  return (
    <box flexDirection="column" padding={2} width="100%" height="100%">
      {/* Title */}
      <text
        fg={colors.accent.primary}
        attributes={TextAttributes.BOLD}
      >
        {"Resume Session"}
      </text>

      <text fg={colors.text.secondary} marginTop={1}>
        {"Select a session to resume:"}
      </text>

      {/* Session list */}
      <box marginTop={1} flexDirection="column" flexGrow={1}>
        <Show
          when={sessions().length > 0}
          fallback={
            <text fg={colors.text.muted}>
              {"No sessions found. Start a new conversation instead."}
            </text>
          }
        >
          <Index each={visibleSessions()}>
            {(session, localIndex) => {
              const globalIndex = () => localIndex + scrollOffset()
              const isSelected = createMemo(() => globalIndex() === selectedIndex())
              const titleWidth = () => contentWidth() - timestampCol - 6 // 6 = prefix + spacing

              return (
                <box flexDirection="row" height={1}>
                  {/* Selection indicator */}
                  <text
                    fg={isSelected() ? colors.accent.highlight : colors.text.muted}
                    attributes={isSelected() ? TextAttributes.BOLD : 0}
                  >
                    {isSelected() ? "> " : "  "}
                  </text>

                  {/* Timestamp */}
                  <text
                    fg={isSelected() ? colors.text.primary : colors.text.secondary}
                  >
                    {formatTimestamp(session().updatedAt).padEnd(timestampCol)}
                  </text>

                  {/* Session title / first message */}
                  <text
                    fg={isSelected() ? colors.accent.highlight : colors.text.primary}
                    attributes={isSelected() ? TextAttributes.BOLD : 0}
                  >
                    {truncateTitle(session().title, titleWidth())}
                  </text>
                </box>
              )
            }}
          </Index>

          {/* Scroll indicator */}
          <Show when={sessions().length > visibleCount()}>
            <text fg={colors.text.muted} marginTop={1}>
              {`  ${selectedIndex() + 1}/${sessions().length} sessions`}
            </text>
          </Show>
        </Show>
      </box>

      {/* Footer hints */}
      <box marginTop={1}>
        <text fg={colors.text.muted}>
          {"\u2191/\u2193 navigate  Enter select  Esc cancel"}
        </text>
      </box>
    </box>
  )
}
