/**
 * /cost — Detailed cost and token breakdown.
 */

import type { SlashCommand } from "../registry"
import { friendlyModelName } from "../../protocol/models"

/** Format token counts for human-readable display */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export const costCommand: SlashCommand = {
  name: "cost",
  description: "Show session cost and token breakdown",
  execute: (_args, ctx) => {
    const state = ctx.getSessionState?.()
    if (!state) {
      ctx.pushEvent({ type: "system_message", text: "Cost data not available.", ephemeral: true })
      return
    }

    const { cost, turnNumber, currentModel } = state
    const totalTokens = cost.inputTokens + cost.outputTokens
    const cacheTokens = cost.cacheReadTokens + cost.cacheWriteTokens

    // If no cost data has been received after at least one turn, show a helpful message
    const hasCostData = totalTokens > 0 || cost.totalCostUsd > 0
    if (!hasCostData && turnNumber > 0) {
      ctx.pushEvent({
        type: "system_message",
        text: `Session Usage (${turnNumber} turn${turnNumber !== 1 ? "s" : ""})\n\n  Model: ${currentModel ? friendlyModelName(currentModel) : "unknown"}\n\n  Token and cost data is not available for this backend.`,
        ephemeral: true,
      })
      return
    }

    const lines = [
      `Session Usage (${turnNumber} turn${turnNumber !== 1 ? "s" : ""})`,
      ``,
      `  Model:    ${currentModel ? friendlyModelName(currentModel) : "unknown"}`,
      `  Cost:     $${cost.totalCostUsd.toFixed(4)}`,
      ``,
      `  Tokens:   ${formatTokens(totalTokens)} total`,
      `    Input:  ${formatTokens(cost.inputTokens)}`,
      `    Output: ${formatTokens(cost.outputTokens)}`,
      `    Cache:  ${formatTokens(cacheTokens)} (${formatTokens(cost.cacheReadTokens)} read, ${formatTokens(cost.cacheWriteTokens)} write)`,
    ]

    if (turnNumber > 0) {
      lines.push(``)
      lines.push(`  Avg/turn: $${(cost.totalCostUsd / turnNumber).toFixed(4)} · ${formatTokens(Math.round(totalTokens / turnNumber))} tokens`)
    }

    ctx.pushEvent({ type: "system_message", text: lines.join("\n"), ephemeral: true })
  },
}
