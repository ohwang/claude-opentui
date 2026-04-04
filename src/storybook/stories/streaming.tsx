/**
 * Stories for Input category — ContextualTips, InputArea.
 */

import type { Story } from "../types"
import { ContextualTips } from "../../tui/components/tips"
import { InputArea } from "../../tui/components/input-area"
import { idleSession, runningSession } from "../fixtures/state"

export const inputStories: Story[] = [
  {
    id: "contextual-tips",
    title: "ContextualTips",
    description: "State-aware keyboard hints above input",
    category: "Input",
    context: { session: idleSession({ turnNumber: 0 }) },
    render: () => <ContextualTips />,
    variants: [
      { label: "first turn", context: { session: idleSession({ turnNumber: 0 }) } },
      { label: "later turn", context: { session: idleSession({ turnNumber: 3 }) } },
      { label: "running", context: { session: runningSession() } },
    ],
  },
  {
    id: "input-area",
    title: "InputArea",
    description: "Textarea with message submission, slash commands, file autocomplete",
    category: "Input",
    interactive: true,
    context: { session: idleSession() },
    render: () => <InputArea />,
    variants: [
      { label: "idle", context: { session: idleSession() } },
      { label: "running", context: { session: runningSession() } },
    ],
  },
]
