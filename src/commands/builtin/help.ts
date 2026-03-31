/**
 * /help — Show available commands.
 */

import type { SlashCommand, CommandContext } from "../registry"

export const helpCommand: SlashCommand = {
  name: "help",
  description: "Show available commands",
  aliases: ["?"],
  execute: (_args: string, ctx: CommandContext) => {
    const commands = ctx.registry?.all() ?? []
    const text = commands
      .map((cmd) => {
        const aliasText =
          cmd.aliases && cmd.aliases.length > 0
            ? ` (aliases: ${cmd.aliases.join(", ")})`
            : ""
        return `  /${cmd.name}${aliasText} — ${cmd.description}`
      })
      .join("\n")

    ctx.pushEvent({
      type: "system_message",
      text: `Available commands:\n${text}`,
    })
  },
}
