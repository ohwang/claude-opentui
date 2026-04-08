/**
 * /model — Switch model (e.g., /model claude-sonnet-4-6).
 */

import type { ModelInfo } from "../../protocol/types"
import type { CommandContext, SlashCommand } from "../registry"
import { MODEL_NAMES } from "../../tui/models"

function staticClaudeModels(): ModelInfo[] {
  return Object.entries(MODEL_NAMES).map(([id, name]) => ({ id, name, provider: "anthropic" }))
}

function dedupeModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>()
  const deduped: ModelInfo[] = []

  for (const model of models) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    deduped.push(model)
  }

  return deduped
}

function formatModels(models: ModelInfo[]): string {
  return models
    .map((model) => {
      const displayName = model.name || MODEL_NAMES[model.id] || model.id
      return displayName === model.id
        ? `  ${model.id}`
        : `  ${model.id} (${displayName})`
    })
    .join("\n")
}

async function resolveAvailableModels(ctx: CommandContext): Promise<ModelInfo[]> {
  const sessionModels = ctx.getSessionState?.().session?.models ?? []
  let backendModels: ModelInfo[] = []

  try {
    backendModels = await ctx.backend.availableModels()
  } catch {
    backendModels = []
  }

  const backendName = ctx.backend.capabilities().name
  const merged = dedupeModels([...backendModels, ...sessionModels])

  if (backendName === "claude" || backendName === "claude-v2") {
    if (backendModels.length === 0) {
      return dedupeModels([...merged, ...staticClaudeModels()])
    }
  }

  return merged
}

export const modelCommand: SlashCommand = {
  name: "model",
  description: "Switch model or list available models",
  aliases: ["m"],
  execute: async (args, ctx) => {
    if (!args.trim()) {
      ctx.pushEvent({
        type: "system_message",
        text: "Usage: /model <model-name>|list",
        ephemeral: true,
      })
      return
    }

    const modelName = args.trim()
    const availableModels = await resolveAvailableModels(ctx)
    const available = formatModels(availableModels)

    if (modelName === "list") {
      ctx.pushEvent({
        type: "system_message",
        text: `Available models:\n${available}`,
        ephemeral: true,
      })
      return
    }

    // Check if model name is valid
    if (!availableModels.some((model) => model.id === modelName)) {
      ctx.pushEvent({
        type: "system_message",
        text: `Unknown model: ${modelName}\n\nAvailable models:\n${available}`,
        ephemeral: true,
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
        ephemeral: true,
      })
    } catch (error) {
      ctx.pushEvent({
        type: "system_message",
        text: `Error: Could not switch to model '${modelName}'. ${error instanceof Error ? error.message : 'Unknown error'}`,
        ephemeral: true,
      })
    }
  },
}
