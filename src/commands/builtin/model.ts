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

/**
 * Resolve a partial model name (e.g., "opus", "sonnet", "haiku") to a full model ID.
 * Returns the matched model, or undefined if no match.
 *
 * Matching priority:
 *   1. Exact model.id match (already handled before this is called)
 *   2. Case-insensitive substring match on model.id or display name
 *   3. Among matches, prefer: shorter id (more specific/latest), then alphabetical
 */
function resolvePartialModel(query: string, models: ModelInfo[]): ModelInfo | undefined {
  const q = query.toLowerCase()

  const matches = models.filter((m) => {
    const displayName = (m.name || MODEL_NAMES[m.id] || "").toLowerCase()
    return m.id.toLowerCase().includes(q) || displayName.includes(q)
  })

  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]

  // Multiple matches — pick shortest ID (more specific/latest), then alphabetical
  matches.sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id))
  return matches[0]
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

  if (backendName === "claude") {
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

    // Check if model name is valid — try exact match first, then partial
    let resolvedModel = modelName
    if (!availableModels.some((model) => model.id === modelName)) {
      const partial = resolvePartialModel(modelName, availableModels)
      if (!partial) {
        ctx.pushEvent({
          type: "system_message",
          text: `Unknown model: ${modelName}\n\nAvailable models:\n${available}`,
          ephemeral: true,
        })
        return
      }
      resolvedModel = partial.id
    }
    try {
      await ctx.setModel(resolvedModel)
      ctx.pushEvent({
        type: "model_changed",
        model: resolvedModel,
      })
      ctx.pushEvent({
        type: "system_message",
        text: `Switched to ${resolvedModel}`,
        ephemeral: true,
      })
    } catch (error) {
      ctx.pushEvent({
        type: "system_message",
        text: `Error: Could not switch to model '${resolvedModel}'. ${error instanceof Error ? error.message : 'Unknown error'}`,
        ephemeral: true,
      })
    }
  },
}
