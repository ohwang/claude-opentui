/**
 * /clear — Clear the conversation display.
 */

import type { SlashCommand } from "../registry"

export const clearCommand: SlashCommand = {
  name: "clear",
  description: "Clear conversation display (costs preserved)",
  execute: (_args, ctx) => {
    ctx.clearConversation()
  },
}
