/**
 * /status-bar command — list and switch native status bar presets at runtime.
 *
 * Mirrors `/theme`. Unknown ids soft-fail (fall back to `default`), and the
 * list is printed so the user can discover valid ids.
 *
 * Usage:
 *   /status-bar           — list available presets with current marked
 *   /status-bar <id>      — switch to a preset
 *   /status-bar list      — same as /status-bar
 */

import type { SlashCommand } from "../registry"
import { getStatusBar, listStatusBars } from "../../tui/status-bar/registry"
import { applyStatusBar, getCurrentStatusBarId } from "../../tui/status-bar/active"

export const statusBarCommand: SlashCommand = {
  name: "status-bar",
  description: "List or switch native status bar presets",
  argumentHint: "[preset-id]",
  aliases: ["statusbar"],
  execute: (args, ctx) => {
    const presetId = args.trim()

    // No args or "list" — show available presets
    if (!presetId || presetId === "list") {
      const presets = listStatusBars()
      const currentId = getCurrentStatusBarId()

      const lines = [
        "Available status bar presets:",
        "",
        ...presets.map(p => {
          const marker = p.id === currentId ? " (active)" : ""
          return `  ${p.id} — ${p.name}${marker}\n    ${p.description}`
        }),
        "",
        "Switch: /status-bar <id>",
      ]

      ctx.pushEvent({
        type: "system_message",
        text: lines.join("\n"),
      })
      return
    }

    // No-op if already active (don't flash the screen)
    if (presetId === getCurrentStatusBarId()) {
      const preset = getStatusBar(presetId)
      ctx.pushEvent({
        type: "system_message",
        text: `Already using status bar: ${preset?.name ?? presetId}`,
      })
      return
    }

    // Soft-fail for unknown ids: applyStatusBar falls back to default, and
    // we surface the available list so the user can correct.
    const result = applyStatusBar(presetId)
    if (result.fellBack) {
      const available = listStatusBars().map(p => p.id).join(", ")
      ctx.pushEvent({
        type: "system_message",
        text: `Unknown status bar preset: "${presetId}". Falling back to "${result.id}".\nAvailable: ${available}`,
      })
      return
    }

    const preset = getStatusBar(result.id)
    ctx.pushEvent({
      type: "system_message",
      text: `Switched to status bar: ${preset?.name ?? result.id}`,
    })
  },
}
