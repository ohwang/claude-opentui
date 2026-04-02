/**
 * /diagnostics — Toggle the diagnostics panel.
 */

import type { SlashCommand } from "../registry"

export const diagnosticsCommand: SlashCommand = {
  name: "diagnostics",
  description: "Toggle the diagnostics panel",
  aliases: ["diag", "debug"],
  execute: (_args, ctx) => {
    if (ctx.toggleDiagnostics) {
      ctx.toggleDiagnostics()
    } else {
      ctx.pushEvent({
        type: "system_message",
        text: "Diagnostics panel not available.",
        ephemeral: true,
      })
    }
  },
}
