/**
 * /usage — Plan-level usage info.
 */

import type { SlashCommand } from "../registry"

export const usageCommand: SlashCommand = {
  name: "usage",
  description: "Show plan usage and account info",
  execute: (_args, ctx) => {
    const state = ctx.getSessionState?.()
    if (!state) {
      ctx.pushEvent({ type: "system_message", ephemeral: true, text: "Usage data not available." })
      return
    }

    const { session, cost, turnNumber } = state
    const account = session?.account

    if (!account?.plan) {
      const lines = [
        "Plan usage info not available. Use /cost for session costs.",
      ]
      ctx.pushEvent({ type: "system_message", ephemeral: true, text: lines.join("\n") })
      return
    }

    const lines = [
      `Plan Usage`,
      ``,
      `  Plan:     ${account.plan}`,
    ]

    if (account.email) {
      lines.push(`  Account:  ${account.email}`)
    }

    lines.push(``)
    lines.push(`  Session cost: $${cost.totalCostUsd.toFixed(4)} (${turnNumber} turn${turnNumber !== 1 ? "s" : ""})`)

    ctx.pushEvent({ type: "system_message", ephemeral: true, text: lines.join("\n") })
  },
}
