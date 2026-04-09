/**
 * /new — Start a fresh conversation (clear + reset cost + reset backend session).
 */

import type { SlashCommand } from "../registry"

export const newCommand: SlashCommand = {
  name: "new",
  aliases: ["n"],
  description: "Start a fresh conversation",
  execute: async (_args, ctx) => {
    ctx.clearConversation()
    ctx.resetCost()
    await ctx.resetSession()
  },
}
