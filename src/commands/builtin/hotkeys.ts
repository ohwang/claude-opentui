/**
 * /hotkeys — open the keyboard-shortcuts panel.
 *
 * Frontend-neutral: emits a `hotkeys` panel request. Non-TUI frontends
 * that don't support shortcut panels surface a brief system message.
 */

import type { SlashCommand, CommandContext } from "../registry"

export const hotkeysCommand: SlashCommand = {
  name: "hotkeys",
  description: "Show keyboard shortcuts",
  aliases: ["keys", "shortcuts"],
  execute: (_args: string, ctx: CommandContext) => {
    if (ctx.frontend?.openPanel) {
      ctx.frontend.openPanel("hotkeys")
      return
    }
    ctx.pushEvent({
      type: "system_message",
      ephemeral: true,
      text: "Keyboard shortcuts are only available in the terminal UI.",
    })
  },
}
