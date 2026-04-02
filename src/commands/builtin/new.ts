/**
 * /new — Start a fresh conversation (clear + reset cost).
 */

import type { SlashCommand } from "../registry"

export const newCommand: SlashCommand = {
  name: "new",
  aliases: ["n"],
  description: "Start a fresh conversation",
  execute: (_args, ctx) => {
    ctx.clearConversation()
    ctx.resetCost()
    ctx.pushEvent({
      type: "system_message",
      text: "New conversation started",
      ephemeral: true,
    })
  },
}
