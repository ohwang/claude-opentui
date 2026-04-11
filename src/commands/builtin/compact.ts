/**
 * /compact — Triggers real backend compaction via the SDK's built-in /compact handler.
 *
 * Checks the backend's supportsCompact capability before sending. For backends
 * that support it, sends "/compact [instructions]" as a user message which the
 * SDK intercepts and triggers real context compaction (summarization, token reduction).
 */

import type { SlashCommand } from "../registry"

export const compactCommand: SlashCommand = {
  name: "compact",
  description: "Compact conversation context",
  argumentHint: "[instructions]",
  execute: (args, ctx) => {
    // Check capability before attempting
    const caps = ctx.backend.capabilities()
    if (!caps.supportsCompact) {
      ctx.pushEvent({
        type: "system_message",
        text: `Compact is not supported by the ${caps.name} backend.`,
        ephemeral: true,
      })
      return
    }

    // Build the /compact message with optional custom instructions
    const compactText = args.trim()
      ? `/compact ${args.trim()}`
      : "/compact"

    // Send as a user message — the SDK's CLI subprocess recognizes /compact
    // and triggers real context compaction (summarization, token reduction).
    // The SDK will emit status: 'compacting' and compact_boundary messages
    // which the adapter already maps to AgentEvents.
    ctx.backend.sendMessage({ text: compactText })
  },
}
