/**
 * /hotkeys — Show all keyboard shortcuts.
 */

import type { SlashCommand } from "../registry"

export const hotkeysCommand: SlashCommand = {
  name: "hotkeys",
  description: "Show all keyboard shortcuts",
  aliases: ["keys", "shortcuts"],
  execute: (_args, ctx) => {
    const sections: Array<{ title: string; keys: Array<[string, string]> }> = [
      {
        title: "General",
        keys: [
          ["Ctrl+L",         "Clear conversation display"],
          ["Ctrl+D ×2",      "Exit application (double-press)"],
          ["Ctrl+C",         "Interrupt task / clear input / exit (double-press when idle)"],
          ["Ctrl+P",         "Cycle to next model"],
          ["Shift+Ctrl+P",   "Cycle to previous model"],
          ["Ctrl+Shift+D",   "Toggle diagnostics panel (or use /diagnostics)"],
          ["Shift+Tab",      "Cycle permission mode (default → accept edits → YOLO → plan)"],
        ],
      },
      {
        title: "Input",
        keys: [
          ["Return",         "Submit message"],
          ["Shift+Return",   "Insert newline"],
          ["Meta+Return",    "Insert newline"],
          ["Ctrl+A",         "Select all text"],
          ["Ctrl+G",         "Open external editor ($EDITOR)"],
          ["Ctrl+V",         "Paste from system clipboard"],
          ["Ctrl+Z",         "Undo"],
          ["Ctrl+Y",         "Redo"],
          ["Up / Down",      "Browse input history"],
          ["Escape",         "Dismiss autocomplete / clear input"],
          ["Tab",            "Cycle slash command completions"],
        ],
      },
      {
        title: "Conversation View",
        keys: [
          ["Ctrl+O",         "Toggle collapsed / expanded tool view"],
          ["Ctrl+E",         "Toggle show-all / collapsed view"],
          ["Ctrl+T",         "Toggle thinking blocks"],
          ["Ctrl+Up",        "Scroll up"],
          ["Ctrl+Down",      "Scroll down"],
        ],
      },
      {
        title: "Permission Dialog",
        keys: [
          ["y  or  1",       "Allow (once)"],
          ["a  or  2",       "Always allow"],
          ["n  or  3",       "Deny"],
          ["d  or  4",       "Deny for session"],
          ["Escape",         "Deny"],
          ["Up / Down / Tab","Navigate options"],
          ["Return",         "Confirm selected option"],
        ],
      },
    ]

    // Build formatted output
    const nameWidth = 18
    const lines: string[] = ["Keyboard Shortcuts", ""]

    for (const section of sections) {
      lines.push(`  ${section.title}`)
      lines.push(`  ${"—".repeat(48)}`)
      for (const [key, desc] of section.keys) {
        lines.push(`  ${key.padEnd(nameWidth)} ${desc}`)
      }
      lines.push("")
    }

    ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
  },
}
