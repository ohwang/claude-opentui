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
 *
 * Frontend-neutral: delegates to `ctx.frontend`. Non-TUI frontends surface
 * an explanatory message.
 */

import type { SlashCommand } from "../registry"

export const statusBarCommand: SlashCommand = {
  name: "status-bar",
  description: "List or switch native status bar presets",
  argumentHint: "[preset-id]",
  aliases: ["statusbar"],
  execute: (args, ctx) => {
    const presetId = args.trim()
    const { frontend } = ctx

    if (!frontend?.listStatusBars || !frontend?.applyStatusBar) {
      ctx.pushEvent({
        type: "system_message",
        text: "Status bar switching is not supported by this frontend.",
        ephemeral: true,
      })
      return
    }

    // No args or "list" — show available presets
    if (!presetId || presetId === "list") {
      const presets = frontend.listStatusBars()
      const currentId = frontend.currentStatusBarId?.()

      const lines = [
        "Available status bar presets:",
        "",
        ...presets.map((p) => {
          const marker = p.id === currentId ? " (active)" : ""
          const desc = p.description ? `\n    ${p.description}` : ""
          return `  ${p.id} — ${p.name}${marker}${desc}`
        }),
        "",
        "Switch: /status-bar <id>",
      ]

      ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
      return
    }

    // No-op if already active (don't flash the screen)
    const currentId = frontend.currentStatusBarId?.()
    if (presetId === currentId) {
      const preset = frontend.listStatusBars().find((p) => p.id === presetId)
      ctx.pushEvent({
        type: "system_message",
        text: `Already using status bar: ${preset?.name ?? presetId}`,
      })
      return
    }

    // Soft-fail for unknown ids: applyStatusBar falls back to default, and
    // we surface the available list so the user can correct.
    const result = frontend.applyStatusBar(presetId)
    if (result.fellBack) {
      const available = frontend.listStatusBars().map((p) => p.id).join(", ")
      ctx.pushEvent({
        type: "system_message",
        text: `Unknown status bar preset: "${presetId}". Falling back to "${result.id}".\nAvailable: ${available}`,
      })
      return
    }

    ctx.pushEvent({
      type: "system_message",
      text: `Switched to status bar: ${result.appliedName ?? result.id}`,
    })
  },
}
