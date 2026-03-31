/**
 * /model — Switch model (e.g., /model claude-sonnet-4-6).
 */

import type { SlashCommand } from "../registry"
import { MODEL_NAMES } from "../../tui/models"

export const modelCommand: SlashCommand = {
  name: "model",
  description: "Switch model (e.g., /model claude-sonnet-4-6)",
  aliases: ["m"],
  execute: async (args, ctx) => {
    if (!args.trim()) {
      ctx.pushEvent({
        type: "system_message",
        text: "Usage: /model <model-name>",
      })
      return
    }
    const modelName = args.trim()
    // Check if model name is valid
    if (!MODEL_NAMES[modelName]) {
      const available = Object.entries(MODEL_NAMES)
        .map(([id, name]) => `  ${id} (${name})`)
        .join("\n")
      ctx.pushEvent({
        type: "system_message",
        text: `Unknown model: ${modelName}\n\nAvailable models:\n${available}`,
      })
      return
    }
    try {
      await ctx.setModel(modelName)
      ctx.pushEvent({
        type: "model_changed",
        model: modelName,
      })
      ctx.pushEvent({
        type: "system_message",
        text: `Switched to ${modelName}`,
      })
    } catch (error) {
      ctx.pushEvent({
        type: "system_message",
        text: `Error: Could not switch to model '${modelName}'. ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
    }
  },
}
