/**
 * /cost — Detailed cost and token breakdown.
 */

import type { SlashCommand } from "../registry"
import { friendlyModelName } from "../../tui/models"

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
      ctx.pushEvent({ type: "system_message", text: "Cost data not available." })
      return
    }

    const { cost, turnNumber, currentModel } = state
    const totalTokens = cost.inputTokens + cost.outputTokens
    const cacheTokens = cost.cacheReadTokens + cost.cacheWriteTokens

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

    ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
  },
}
