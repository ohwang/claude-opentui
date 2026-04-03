/**
 * History Search Modal -- Ctrl+R fuzzy history search dialog
 *
 * Opens as a modal overlay. Captures keystrokes via the modal key handler
 * system to build a search query. Lists matching history entries with
 * Up/Down navigation, Enter to select, Escape to cancel.
 */

import { createSignal, createMemo, Show, For, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { KeyEvent } from "@opentui/core"
import { colors } from "../theme/tokens"
import { setModalKeyHandler } from "../context/modal"

/** Maximum number of history entries visible in the list */
const MAX_VISIBLE = 12

export interface HistorySearchProps {
  history: string[]
  onSelect: (entry: string) => void
  onCancel: () => void
}

/**
 * Truncate a history entry to a single line for display.
 * Multi-line entries show the first line with an ellipsis indicator.
 */
function formatEntry(text: string, maxWidth: number): string {
  const firstLine = text.split("\n")[0] ?? text
  const hasMore = text.includes("\n")
  const suffix = hasMore ? " ..." : ""
  const available = maxWidth - suffix.length
  if (firstLine.length > available) {
    return firstLine.slice(0, available - 3) + "..." + suffix
  }
  return firstLine + suffix
}

export function HistorySearchModal(props: HistorySearchProps) {
  const [query, setQuery] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const dims = useTerminalDimensions()

  // Most recent first, filtered by substring match
  const filtered = createMemo(() => {
    const q = query().toLowerCase()
    const reversed = props.history.slice().reverse()
    if (!q) return reversed
    return reversed.filter((h) => h.toLowerCase().includes(q))
  })

  // Key handler registered with the modal system
  const handleKey = (event: KeyEvent): boolean => {
    if (event.name === "escape") {
      props.onCancel()
      return true
    }

    if (event.name === "up") {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return true
    }

    if (event.name === "down") {
      setSelectedIndex((i) => Math.min(filtered().length - 1, i + 1))
      return true
    }

    if (event.name === "return") {
      const selected = filtered()[selectedIndex()]
      if (selected) {
        props.onSelect(selected)
      } else {
        props.onCancel()
      }
      return true
    }

    if (event.name === "backspace") {
      setQuery((q) => q.slice(0, -1))
      setSelectedIndex(0)
      return true
    }

    // Regular character input (single printable chars, no modifiers)
    if (event.char && event.char.length === 1 && !event.ctrl && !event.meta) {
      setQuery((q) => q + event.char)
      setSelectedIndex(0)
      return true
    }

    return false
  }

  // Register / unregister modal key handler
  setModalKeyHandler(handleKey)
  onCleanup(() => setModalKeyHandler(null))

  const contentWidth = () => Math.min((dims()?.width ?? 80) - 8, 100)

  return (
    <box flexDirection="column" padding={2}>
      <box
        borderStyle="single"
        borderColor={colors.border.default}
        flexDirection="column"
        padding={2}
      >
        {/* Title */}
        <text
          fg={colors.accent.primary}
          attributes={TextAttributes.BOLD}
        >
          {"History Search"}
        </text>

        {/* Search input display */}
        <box marginTop={1} flexDirection="row">
          <text fg={colors.text.muted}>{"Search: "}</text>
          <text fg={colors.text.white} attributes={TextAttributes.BOLD}>
            {query() || ""}
          </text>
          <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>{"_"}</text>
        </box>

        {/* Results list */}
        <box marginTop={1} flexDirection="column">
          <Show
            when={filtered().length > 0}
            fallback={
              <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
                {props.history.length === 0 ? "(empty -- no history yet)" : "No matches"}
              </text>
            }
          >
            <For each={filtered().slice(0, MAX_VISIBLE)}>
              {(entry, index) => {
                const isSelected = () => index() === selectedIndex()
                return (
                  <box flexDirection="row" height={1}>
                    <text
                      fg={isSelected() ? colors.accent.cyan : colors.text.muted}
                      attributes={isSelected() ? TextAttributes.BOLD : 0}
                    >
                      {isSelected() ? "> " : "  "}
                    </text>
                    <text
                      fg={isSelected() ? colors.accent.cyan : colors.text.primary}
                      attributes={isSelected() ? TextAttributes.BOLD : 0}
                    >
                      {formatEntry(entry, contentWidth())}
                    </text>
                  </box>
                )
              }}
            </For>
            <Show when={filtered().length > MAX_VISIBLE}>
              <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
                {`  ${filtered().length - MAX_VISIBLE} more...`}
              </text>
            </Show>
          </Show>
        </box>

        {/* Footer hints */}
        <box marginTop={1}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {"  \u2191/\u2193 navigate  Enter select  Esc cancel"}
          </text>
        </box>
      </box>
    </box>
  )
}
