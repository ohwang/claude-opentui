/**
 * /hotkeys — Show all keyboard shortcuts as a rich modal overlay.
 *
 * Groups shortcuts by category with aligned columns.
 * Uses the modal overlay system (showModal) instead of system_message.
 */

import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { showModal } from "../../tui/context/modal"
import { colors } from "../../tui/theme/tokens"
import type { SlashCommand } from "../registry"

// ---------------------------------------------------------------------------
// Shortcut data
// ---------------------------------------------------------------------------

interface ShortcutEntry {
  key: string
  desc: string
}

interface ShortcutGroup {
  title: string
  entries: ShortcutEntry[]
}

const groups: ShortcutGroup[] = [
  {
    title: "View Controls",
    entries: [
      { key: "Ctrl+O",    desc: "Toggle collapsed / expanded tool view" },
      { key: "Ctrl+E",    desc: "Toggle show-all / collapsed view" },
      { key: "Ctrl+T",    desc: "Toggle thinking blocks" },
    ],
  },
  {
    title: "Model & Mode",
    entries: [
      { key: "Ctrl+P",    desc: "Cycle to next model" },
      { key: "Shift+Tab", desc: "Cycle permission mode" },
    ],
  },
  {
    title: "Navigation",
    entries: [
      { key: "Ctrl+Up",   desc: "Scroll up" },
      { key: "Ctrl+Down", desc: "Scroll down" },
      { key: "Ctrl+L",    desc: "Clear conversation display" },
    ],
  },
  {
    title: "Editing",
    entries: [
      { key: "Ctrl+G",    desc: "Open external editor ($EDITOR)" },
      { key: "Ctrl+V",    desc: "Paste from system clipboard" },
      { key: "Ctrl+A",    desc: "Select all text" },
      { key: "Ctrl+U",    desc: "Delete to start of line" },
      { key: "Ctrl+K",    desc: "Delete to end of line" },
      { key: "Ctrl+W",    desc: "Delete word backward" },
    ],
  },
  {
    title: "Session",
    entries: [
      { key: "Ctrl+C",    desc: "Interrupt task / clear input" },
      { key: "Ctrl+D x2", desc: "Exit application (double-press)" },
      { key: "Ctrl+R",    desc: "History search" },
    ],
  },
]

// Fixed width for the key column to ensure alignment.
// Keep narrow enough to fit at 100-col terminals (border+padding = ~12 cols overhead).
const KEY_COL_WIDTH = 12

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ShortcutGroupView(props: { group: ShortcutGroup }) {
  return (
    <box flexDirection="column" marginTop={1}>
      <text
        fg={colors.accent.primary}
        attributes={TextAttributes.BOLD}
      >
        {"  "}{props.group.title}
      </text>
      <box marginTop={0} flexDirection="column">
        <For each={props.group.entries}>
          {(entry) => (
            <box flexDirection="row">
              <box width={KEY_COL_WIDTH + 4} flexShrink={0}>
                <text fg={colors.accent.cyan} attributes={TextAttributes.BOLD}>
                  {"    "}{entry.key}
                </text>
              </box>
              <text fg={colors.text.muted}>{entry.desc}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

function HotkeysModal() {
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
          {"Keyboard Shortcuts"}
        </text>

        {/* Shortcut groups */}
        <For each={groups}>
          {(group) => <ShortcutGroupView group={group} />}
        </For>

        {/* Footer */}
        <box marginTop={1}>
          <text
            fg={colors.text.muted}
            attributes={TextAttributes.DIM}
          >
            {"  Press Escape to close"}
          </text>
        </box>
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Slash command export
// ---------------------------------------------------------------------------

export const hotkeysCommand: SlashCommand = {
  name: "hotkeys",
  description: "Show keyboard shortcuts",
  aliases: ["keys", "shortcuts"],
  execute: () => {
    showModal(HotkeysModal)
  },
}
