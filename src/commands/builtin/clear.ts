/**
 * /clear — Clear the conversation display.
 */

import type { SlashCommand } from "../registry"

export const clearCommand: SlashCommand = {
  name: "clear",
  description: "Clear the conversation display",
  execute: (_args, ctx) => {
    ctx.clearConversation()
  },
}
