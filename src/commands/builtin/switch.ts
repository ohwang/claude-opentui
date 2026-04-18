/**
 * /switch <backend> [<model>] — hot-swap the active backend mid-conversation.
 *
 * Gates on IDLE state. Preserves the TUI block history. Replays the full
 * history into the new adapter's initial prompt (handled inside
 * SyncContext.switchBackend) so the model has the conversation in-context.
 */

import type { CommandContext, SlashCommand } from "../registry"
import {
  getBackendDescriptor,
  instantiateBackend,
  listBackends,
  type BackendId,
} from "../../protocol/registry"
import { friendlyBackendName } from "../../protocol/models"
import { log } from "../../utils/logger"

function knownBackendIds(): string {
  return listBackends().map((b) => b.id).join(", ")
}

export const switchCommand: SlashCommand = {
  name: "switch",
  description: "Switch backend mid-conversation (optionally with a model)",
  argumentHint: "<backend> [<model>]",
  execute: async (args: string, ctx: CommandContext) => {
    const parts = args.trim().split(/\s+/).filter(Boolean)
    const backendId = parts[0]
    const model = parts[1]

    if (!backendId) {
      ctx.pushEvent({
        type: "system_message",
        text: `Usage: /switch <backend> [<model>]\n\nAvailable: ${knownBackendIds()}\nUse /backend to list descriptions.`,
        ephemeral: true,
      })
      return
    }

    const descriptor = getBackendDescriptor(backendId)
    if (!descriptor) {
      ctx.pushEvent({
        type: "system_message",
        text: `Unknown backend: ${backendId}\n\nAvailable: ${knownBackendIds()}`,
        ephemeral: true,
      })
      return
    }

    if (descriptor.requiresExtraConfig) {
      ctx.pushEvent({
        type: "system_message",
        text: `Backend '${backendId}' requires extra launch config (e.g., --acp-command) and cannot be switched into from a running session.`,
        ephemeral: true,
      })
      return
    }

    const current = ctx.backend.capabilities().name
    if (current === backendId || (current === "claude-v1" && backendId === "claude")) {
      // Same backend, model-only change delegates to the existing setModel path.
      if (model) {
        try {
          await ctx.setModel(model)
          ctx.pushEvent({ type: "model_changed", model })
          ctx.pushEvent({
            type: "system_message",
            text: `Already on ${friendlyBackendName(current)}. Switched model to ${model}.`,
            ephemeral: true,
          })
        } catch (err) {
          ctx.pushEvent({
            type: "system_message",
            text: `Already on ${friendlyBackendName(current)}. Could not switch model to '${model}': ${err instanceof Error ? err.message : String(err)}`,
            ephemeral: true,
          })
        }
      } else {
        ctx.pushEvent({
          type: "system_message",
          text: `Already on ${friendlyBackendName(current)}.`,
          ephemeral: true,
        })
      }
      return
    }

    // IDLE gate — switching mid-turn would leave queued messages and
    // partial streams in an inconsistent state.
    const sessionState = ctx.getSessionState?.()
    // Treat INITIALIZING + IDLE + ERROR as safe; everything else is "running".
    // The reducer already encodes every "should we block input" signal into
    // sessionState, so we only need to inspect that one field.
    const stateName: string = sessionState?.sessionState ?? "IDLE"
    if (stateName !== "IDLE" && stateName !== "INITIALIZING" && stateName !== "ERROR") {
      ctx.pushEvent({
        type: "system_message",
        text: `Cannot switch while ${friendlyBackendName(current)} is ${stateName.toLowerCase().replace(/_/g, " ")}. Wait for the current turn to finish.`,
        ephemeral: true,
      })
      return
    }

    if (!ctx.switchBackend) {
      ctx.pushEvent({
        type: "system_message",
        text: "Backend switching is not available in this environment.",
        ephemeral: true,
      })
      return
    }

    if (!descriptor.isAvailable()) {
      ctx.pushEvent({
        type: "system_message",
        text: `Backend '${backendId}' is not available on this system (${descriptor.description}). Install the required CLI and try again.`,
        ephemeral: true,
      })
      return
    }

    let adapter
    try {
      adapter = instantiateBackend(backendId as BackendId)
    } catch (err) {
      ctx.pushEvent({
        type: "system_message",
        text: `Failed to construct ${backendId} backend: ${err instanceof Error ? err.message : String(err)}`,
        ephemeral: true,
      })
      return
    }

    try {
      await ctx.switchBackend({ backendId, model, adapter })
    } catch (err) {
      log.error("/switch failed", { backendId, model, error: String(err) })
      ctx.pushEvent({
        type: "system_message",
        text: `Switch to ${backendId} failed: ${err instanceof Error ? err.message : String(err)}`,
        ephemeral: true,
      })
      try { adapter.close() } catch {}
      return
    }

    const modelSuffix = model ? ` (${model})` : ""
    ctx.pushEvent({
      type: "system_message",
      text: `Switched to ${friendlyBackendName(backendId)}${modelSuffix}`,
    })
  },
}
