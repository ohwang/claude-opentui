/**
 * /exit — Exit the application.
 */

import type { SlashCommand } from "../registry"

export const exitCommand: SlashCommand = {
  name: "exit",
  description: "Exit the application",
  aliases: ["quit", "q"],
  execute: (_args, ctx) => {
    if (ctx.exit) {
      ctx.exit()
    } else {
      ctx.backend.close()
      process.exit(0)
    }
  },
}
