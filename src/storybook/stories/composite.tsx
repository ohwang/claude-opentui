/**
 * Stories for Overlays category — DiagnosticsPanel.
 */

import type { Story } from "../types"
import { DiagnosticsPanel } from "../../tui/components/diagnostics"
import { idleSession, conversationMessages } from "../fixtures/state"
import { userBlock, assistantBlock, toolBlock } from "../fixtures/blocks"

export const overlaysStories: Story[] = [
  {
    id: "diagnostics-panel",
    title: "DiagnosticsPanel",
    description: "Full diagnostics overlay (system, session, tokens, context, git)",
    category: "Overlays",
    context: {
      session: idleSession({
        turnNumber: 8,
        lastTurnInputTokens: 95_000,
        cost: { inputTokens: 95_000, outputTokens: 32_000, cacheReadTokens: 60_000, cacheWriteTokens: 8_000, totalCostUsd: 0.178 },
      }),
      messages: conversationMessages([
        userBlock("test"),
        assistantBlock("response"),
        toolBlock("Read", { file_path: "/src/index.ts" }, { duration: 40 }),
        toolBlock("Edit", { file_path: "/src/index.ts" }, { duration: 100 }),
        assistantBlock("Done."),
      ]),
    },
    render: () => <DiagnosticsPanel visible onClose={() => {}} />,
  },
]
