/**
 * Crossagent Slash Commands — TUI interface for native subagent control.
 *
 * All subcommands are under /crossagent:
 *   /crossagent spawn <name> [prompt]
 *   /crossagent list
 *   /crossagent status <id>
 *   /crossagent send <id> <message>
 *   /crossagent stop <id>
 *   /crossagent definitions
 */

import type { SlashCommand } from "../commands/registry"
import type { SubagentManager } from "./manager"
import { loadAllDefinitions } from "./definitions"

// Module-level reference — set during bootstrap wiring
let _manager: SubagentManager | null = null

export function setCommandsManager(mgr: SubagentManager): void {
  _manager = mgr
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return `${mins}m${secs % 60}s`
}

export const crossagentCommand: SlashCommand = {
  name: "crossagent",
  description: "Manage cross-backend subagents",
  argumentHint: "<spawn|list|status|send|stop|definitions> [args]",
  execute: (args, ctx) => {
    if (!_manager) {
      ctx.pushEvent({ type: "system_message", text: "Error: SubagentManager not initialized" })
      return
    }

    const parts = args.trim().split(/\s+/)
    const subcommand = parts[0]?.toLowerCase() ?? ""

    switch (subcommand) {
      case "spawn": {
        const defName = parts[1]
        if (!defName) {
          ctx.pushEvent({ type: "system_message", text: "Usage: /crossagent spawn <definition-name> [prompt]" })
          return
        }
        const definitions = loadAllDefinitions()
        const def = definitions.find(d => d.name === defName)
        if (!def) {
          const available = definitions.map(d => d.name).join(", ")
          ctx.pushEvent({ type: "system_message", text: `No agent definition "${defName}". Available: ${available || "none (create .md files in ~/.claude/agents/ or .claude/agents/)"}` })
          return
        }
        const prompt = parts.slice(2).join(" ") || `You are ${def.name}. Begin your task.`
        const id = _manager.spawn({ definition: def, prompt })
        ctx.pushEvent({ type: "system_message", text: `Spawned ${def.name} → ${id} (backend: ${def.backend ?? "claude"})` })
        break
      }

      case "list": {
        const statuses = _manager.listAll()
        if (statuses.length === 0) {
          ctx.pushEvent({ type: "system_message", text: "No subagents." })
          return
        }
        const lines = statuses.map(s => {
          const elapsed = s.endTime
            ? formatElapsed(s.endTime - s.startTime)
            : formatElapsed(Date.now() - s.startTime)
          const stateIcon = s.state === "running" ? "●" : s.state === "completed" ? "✓" : "✗"
          return `  ${stateIcon} ${s.subagentId} [${s.backendName}] ${s.definitionName} — ${s.state} (${elapsed})`
        })
        ctx.pushEvent({ type: "system_message", text: "Subagents:\n" + lines.join("\n") })
        break
      }

      case "status": {
        const id = parts[1]
        if (!id) {
          ctx.pushEvent({ type: "system_message", text: "Usage: /crossagent status <subagent-id>" })
          return
        }
        const status = _manager.getStatus(id)
        if (!status) {
          ctx.pushEvent({ type: "system_message", text: `No subagent with ID "${id}"` })
          return
        }
        const elapsed = status.endTime
          ? formatElapsed(status.endTime - status.startTime)
          : formatElapsed(Date.now() - status.startTime)
        const lines = [
          `Subagent: ${status.subagentId}`,
          `  Definition: ${status.definitionName}`,
          `  Backend: ${status.backendName}`,
          `  State: ${status.state}`,
          `  Elapsed: ${elapsed}`,
          `  Turns: ${status.turnCount}`,
          `  Tools used: ${status.toolUseCount}`,
        ]
        if (status.sessionId) lines.push(`  Session: ${status.sessionId}`)
        if (status.lastToolName) lines.push(`  Last tool: ${status.lastToolName}`)
        if (status.tokenUsage) lines.push(`  Tokens: ${status.tokenUsage.inputTokens} in / ${status.tokenUsage.outputTokens} out`)
        if (status.recentTools.length > 0) lines.push(`  Recent: ${status.recentTools.join(" → ")}`)
        if (status.errorMessage) lines.push(`  Error: ${status.errorMessage}`)
        if (status.output) {
          const lastLine = status.output.trim().split("\n").pop() ?? ""
          if (lastLine) lines.push(`  Output: ${lastLine.slice(0, 100)}`)
        }
        ctx.pushEvent({ type: "system_message", text: lines.join("\n") })
        break
      }

      case "send": {
        const id = parts[1]
        const message = parts.slice(2).join(" ")
        if (!id || !message) {
          ctx.pushEvent({ type: "system_message", text: "Usage: /crossagent send <subagent-id> <message>" })
          return
        }
        const status = _manager.getStatus(id)
        if (!status) {
          ctx.pushEvent({ type: "system_message", text: `No subagent with ID "${id}"` })
          return
        }
        if (status.state !== "running") {
          ctx.pushEvent({ type: "system_message", text: `Subagent "${id}" is not running (${status.state})` })
          return
        }
        _manager.sendMessage(id, message)
        ctx.pushEvent({ type: "system_message", text: `Message queued for ${id}` })
        break
      }

      case "stop": {
        const id = parts[1]
        if (!id) {
          ctx.pushEvent({ type: "system_message", text: "Usage: /crossagent stop <subagent-id>" })
          return
        }
        const status = _manager.getStatus(id)
        if (!status) {
          ctx.pushEvent({ type: "system_message", text: `No subagent with ID "${id}"` })
          return
        }
        if (status.state !== "running") {
          ctx.pushEvent({ type: "system_message", text: `Subagent "${id}" is not running (${status.state})` })
          return
        }
        _manager.stop(id)
        ctx.pushEvent({ type: "system_message", text: `Stopped ${id}` })
        break
      }

      case "definitions": {
        const definitions = loadAllDefinitions()
        if (definitions.length === 0) {
          ctx.pushEvent({ type: "system_message", text: "No agent definitions found.\nCreate .md files in ~/.claude/agents/ or .claude/agents/" })
          return
        }
        const lines = definitions.map(d => {
          const backend = d.backend ? ` [${d.backend}]` : ""
          const desc = d.description ? ` — ${d.description}` : ""
          return `  ${d.name}${backend}${desc}`
        })
        ctx.pushEvent({ type: "system_message", text: "Agent definitions:\n" + lines.join("\n") })
        break
      }

      default:
        ctx.pushEvent({ type: "system_message", text: "Usage: /crossagent <spawn|list|status|send|stop|definitions>" })
    }
  },
}
