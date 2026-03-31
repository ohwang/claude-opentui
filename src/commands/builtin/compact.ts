/**
 * /compact — Triggers real backend compaction via the SDK's built-in /compact handler.
 */

import type { SlashCommand } from "../registry"

export const compactCommand: SlashCommand = {
  name: "compact",
  description: "Compact conversation context",
  execute: (args, ctx) => {
    // Build the /compact message with optional custom instructions
    const compactText = args.trim()
      ? `/compact ${args.trim()}`
      : "/compact"

    // Send as a user message — the SDK's CLI subprocess recognizes /compact
    // and triggers real context compaction (summarization, token reduction).
    // The SDK will emit status: 'compacting' and compact_boundary messages
    // which the adapter already maps to AgentEvents.
    ctx.backend.sendMessage({ text: compactText })

    // Immediate UI feedback while the backend compacts
    ctx.pushEvent({
      type: "system_message",
      text: "Compacting conversation...",
    })
  },
}
