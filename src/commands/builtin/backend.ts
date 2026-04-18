/**
 * /backend — show the active backend and list registered backends.
 *
 * No-arg form only. Switching is handled by `/switch <backend> [<model>]`
 * because the wiring (close old adapter, replay history, restart event loop)
 * lives in the sync layer, not in a leaf command.
 */

import type { SlashCommand } from "../registry"
import { listBackends } from "../../protocol/registry"
import { friendlyBackendName } from "../../protocol/models"

export const backendCommand: SlashCommand = {
  name: "backend",
  description: "Show current backend and list available backends",
  execute: (_args, ctx) => {
    const current = ctx.backend.capabilities().name
    const currentModel = ctx.getSessionState?.().currentModel ?? ""

    const lines: string[] = []
    lines.push(
      `Current: ${friendlyBackendName(current)} (${current})${currentModel ? ` \u2014 ${currentModel}` : ""}`,
    )
    lines.push("")
    lines.push("Available backends (use `/switch <backend>` to change):")
    for (const b of listBackends()) {
      const marker = b.id === current ? "*" : " "
      const status = b.isAvailable() ? "" : " (unavailable)"
      lines.push(`  ${marker} ${b.id.padEnd(8)} ${b.description}${status}`)
    }

    ctx.pushEvent({
      type: "system_message",
      text: lines.join("\n"),
      ephemeral: true,
    })
  },
}
