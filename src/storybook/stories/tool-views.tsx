/**
 * Stories for Footer category — StatusBar.
 */

import type { Story } from "../types"
import { StatusBar } from "../../tui/components/status-bar"
import { idleSession, runningSession } from "../fixtures/state"

export const footerStories: Story[] = [
  {
    id: "status-bar",
    title: "StatusBar",
    description: "Model, cost, tokens, state, context window fill — native or external command",
    category: "Footer",
    context: { session: idleSession() },
    render: () => <StatusBar />,
    variants: [
      { label: "idle", context: { session: idleSession() } },
      { label: "running", context: { session: runningSession() } },
      { label: "with hint", context: { session: idleSession() }, render: () => <StatusBar hint="Shift+Tab to cycle permission mode" /> },
      {
        label: "high ctx%",
        context: {
          session: idleSession({
            lastTurnInputTokens: 170_000,
            cost: { inputTokens: 170_000, outputTokens: 45_000, cacheReadTokens: 80_000, cacheWriteTokens: 10_000, totalCostUsd: 0.285 },
            turnNumber: 12,
          }),
        },
      },
      {
        label: "ext cmd",
        context: {
          session: idleSession({
            cost: { inputTokens: 35_000, outputTokens: 12_000, cacheReadTokens: 8_000, cacheWriteTokens: 2_000, totalCostUsd: 0.042 },
            turnNumber: 3,
            lastTurnInputTokens: 35_000,
          }),
        },
      },
    ],
  },
]
