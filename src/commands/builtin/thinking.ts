/**
 * /thinking — View or change thinking effort level.
 *
 * Consistent with Claude Code's effort control:
 *   /thinking           — show current effort level
 *   /thinking low       — minimal thinking, fastest responses
 *   /thinking medium    — moderate thinking
 *   /thinking high      — deep reasoning (default)
 */

import type { EffortLevel } from "../../protocol/types"
import type { SlashCommand } from "../registry"

const VALID_LEVELS: EffortLevel[] = ["low", "medium", "high"]
const VALID_LEVELS_WITH_MAX: EffortLevel[] = ["low", "medium", "high", "max"]

export const thinkingCommand: SlashCommand = {
  name: "thinking",
  description: "View or change thinking effort level",
  aliases: ["effort"],
  argumentHint: "<low|medium|high>",
  execute: async (args, ctx) => {
    const current = ctx.getSessionState?.().currentEffort || "high"

    if (!args.trim()) {
      ctx.pushEvent({
        type: "system_message",
        text: `Thinking effort: ${current}\n\nUsage: /thinking <low|medium|high>\n  low    — minimal thinking, fastest responses\n  medium — moderate thinking\n  high   — deep reasoning (default)`,
        ephemeral: true,
      })
      return
    }

    const level = args.trim().toLowerCase()

    if (!VALID_LEVELS_WITH_MAX.includes(level as EffortLevel)) {
      ctx.pushEvent({
        type: "system_message",
        text: `Unknown effort level: ${level}\n\nValid levels: ${VALID_LEVELS.join(", ")}`,
        ephemeral: true,
      })
      return
    }

    if (level === "max") {
      ctx.pushEvent({
        type: "system_message",
        text: "Cannot set effort to 'max' at runtime. Use --effort max at startup.",
        ephemeral: true,
      })
      return
    }

    if (level === current) {
      ctx.pushEvent({
        type: "system_message",
        text: `Thinking effort is already ${level}`,
        ephemeral: true,
      })
      return
    }

    try {
      await ctx.backend.setEffort(level as EffortLevel)
      ctx.pushEvent({
        type: "effort_changed",
        effort: level as EffortLevel,
      })
      ctx.pushEvent({
        type: "system_message",
        text: `Thinking effort set to ${level}`,
        ephemeral: true,
      })
    } catch (error) {
      ctx.pushEvent({
        type: "system_message",
        text: `Error: Could not set effort level. ${error instanceof Error ? error.message : "Unknown error"}`,
        ephemeral: true,
      })
    }
  },
}
