/**
 * /copy — Copy the last assistant message to the clipboard.
 */

import type { SlashCommand, CommandContext } from "../registry"
import { copyToClipboard } from "../../utils/clipboard"

export const copyCommand: SlashCommand = {
  name: "copy",
  description: "Copy last assistant message to clipboard",
  aliases: ["cp"],
  execute: async (_args: string, ctx: CommandContext) => {
    const blocks = ctx.getBlocks?.()
    if (!blocks) {
      ctx.pushEvent({ type: "system_message", ephemeral: true, text: "Cannot access conversation history." })
      return
    }

    // Walk backwards to find the last assistant block
    let lastAssistantText: string | undefined
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i]!
      if (block.type === "assistant" && block.text) {
        lastAssistantText = block.text
        break
      }
    }

    if (!lastAssistantText) {
      ctx.pushEvent({ type: "system_message", ephemeral: true, text: "No assistant message to copy." })
      return
    }

    try {
      await copyToClipboard(lastAssistantText)
      const preview = lastAssistantText.length > 80
        ? lastAssistantText.slice(0, 77) + "..."
        : lastAssistantText
      ctx.pushEvent({ type: "system_message", ephemeral: true, text: `Copied to clipboard (${lastAssistantText.length} chars): ${preview}` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.pushEvent({ type: "system_message", ephemeral: true, text: `Failed to copy: ${msg}` })
    }
  },
}
