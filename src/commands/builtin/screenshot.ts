/**
 * /screenshot — Capture the current terminal screen and save to a file.
 *
 * Frontend-neutral: delegates to `ctx.frontend.screenshot()`. The TUI
 * frontend implements it by writing two files (plain text + ANSI) under
 * `~/.bantai/screenshots/`. Non-TUI frontends return `null` and the
 * command surfaces an ephemeral "not supported" message.
 */

import type { SlashCommand, CommandContext } from "../registry"

export const screenshotCommand: SlashCommand = {
  name: "screenshot",
  description: "Capture current screen to file",
  aliases: ["ss"],
  argumentHint: "[filename]",
  execute: async (args: string, ctx: CommandContext) => {
    const baseName = args.trim() || undefined

    const capture = ctx.frontend?.screenshot
    if (!capture) {
      ctx.pushEvent({
        type: "system_message",
        ephemeral: true,
        text: "Screenshot is not supported by this frontend.",
      })
      return
    }

    const result = await capture({ baseName })
    if (!result) {
      ctx.pushEvent({
        type: "system_message",
        ephemeral: true,
        text: "Screenshot could not be captured.",
      })
      return
    }

    ctx.pushEvent({
      type: "system_message",
      ephemeral: true,
      text: `Screenshot saved:\n  ${result.txtPath}\n  ${result.ansPath}`,
    })
  },
}
