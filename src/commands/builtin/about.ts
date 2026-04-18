/**
 * /about — open the about panel.
 *
 * Frontend-neutral: emits an `about` panel request. Falls back to a plain
 * system message for frontends without rich panels.
 */

import type { SlashCommand, CommandContext } from "../registry"

export const aboutCommand: SlashCommand = {
  name: "about",
  description: "Show about dialog",
  execute: (_args: string, ctx: CommandContext) => {
    if (ctx.frontend?.openPanel) {
      ctx.frontend.openPanel("about")
      return
    }
    ctx.pushEvent({
      type: "system_message",
      text: [
        "bantai — Open-source terminal UI for agentic coding backends",
        `Runtime: Bun ${typeof Bun !== "undefined" ? Bun.version : "unknown"}`,
        `Platform: ${process.platform}/${process.arch}`,
        "Licensed under MIT",
      ].join("\n"),
    })
  },
}
