/**
 * Codex SDK Event Mapper
 *
 * Maps ThreadEvent (from @openai/codex-sdk Thread.runStreamed()) to
 * the unified AgentEvent type.
 *
 * Stateful: the SDK's item.updated events contain full accumulated text,
 * not incremental deltas. This mapper tracks per-item text offsets to
 * emit only the new characters as text_delta / thinking_delta events.
 *
 * Key mapping:
 *   thread.started     → session_init
 *   turn.started       → (suppressed — adapter emits synthetic turn_start)
 *   turn.completed     → turn_complete (with usage)
 *   turn.failed        → error + turn_complete
 *   item.started       → tool_use_start (for tool items)
 *   item.updated       → text_delta / thinking_delta / tool_use_progress
 *   item.completed     → text_complete / tool_use_end
 *   error              → error (fatal)
 */

import { log } from "../../utils/logger"
import type { AgentEvent } from "../../protocol/types"
import type {
  ThreadEvent,
  ThreadItem,
  CommandExecutionItem,
  FileChangeItem,
  McpToolCallItem,
} from "./types"

// ---------------------------------------------------------------------------
// Stateful event mapper
// ---------------------------------------------------------------------------

export class CodexSdkEventMapper {
  /** Track text offsets for incremental deltas from full-text item.updated events */
  private textOffsets = new Map<string, number>()

  /** Model name injected by the adapter — included in session_init */
  private modelName: string | null = null

  /** Set the model name to include in session_init events */
  setModel(name: string): void {
    this.modelName = name
  }

  /** Reset per-turn state (text offsets). Model name persists across turns. */
  reset(): void {
    this.textOffsets.clear()
  }

  map(event: ThreadEvent): AgentEvent[] {
    switch (event.type) {
      case "thread.started":
        return [{
          type: "session_init",
          tools: [],
          models: this.modelName
            ? [{ id: this.modelName, name: this.modelName, provider: "openai" }]
            : [],
        }]

      case "turn.started":
        // Suppressed — the adapter emits a synthetic turn_start before
        // calling runStreamed() to avoid a gap where the TUI doesn't
        // know a turn has begun.
        return []

      case "turn.completed":
        return [{
          type: "turn_complete",
          usage: {
            inputTokens: event.usage.input_tokens,
            outputTokens: event.usage.output_tokens,
            cacheReadTokens: event.usage.cached_input_tokens,
          },
        }]

      case "turn.failed":
        return [
          {
            type: "error",
            code: "codex_turn_failed",
            message: event.error.message,
            severity: "recoverable",
          },
          { type: "turn_complete" },
        ]

      case "item.started":
        return this.mapItemStarted(event.item)

      case "item.updated":
        return this.mapItemUpdated(event.item)

      case "item.completed":
        return this.mapItemCompleted(event.item)

      case "error":
        log.error("Codex SDK stream error", { message: event.message })
        return [{
          type: "error",
          code: "codex_stream_error",
          message: event.message,
          severity: "fatal",
        }]

      default:
        log.warn("Unhandled Codex SDK event type", { type: (event as any).type })
        return [{
          type: "backend_specific",
          backend: "codex-sdk",
          data: event,
        }]
    }
  }

  // -----------------------------------------------------------------------
  // item.started
  // -----------------------------------------------------------------------

  private mapItemStarted(item: ThreadItem): AgentEvent[] {
    switch (item.type) {
      case "agent_message":
        // Text arrives via item.updated — no start event
        return []

      case "reasoning":
        // Reasoning text arrives via item.updated — no start event
        return []

      case "command_execution":
        return [{
          type: "tool_use_start",
          id: item.id,
          tool: "Bash",
          input: { command: item.command },
        }]

      case "file_change":
        return [{
          type: "tool_use_start",
          id: item.id,
          tool: "Edit",
          input: { changes: item.changes },
        }]

      case "mcp_tool_call":
        return [{
          type: "tool_use_start",
          id: item.id,
          tool: `mcp:${item.server}/${item.tool}`,
          input: item.arguments ?? {},
        }]

      case "web_search":
        return [{
          type: "tool_use_start",
          id: item.id,
          tool: "WebSearch",
          input: { query: item.query },
        }]

      case "todo_list":
        return [{
          type: "backend_specific",
          backend: "codex-sdk",
          data: { type: "todo_list", item },
        }]

      case "error":
        return [{
          type: "error",
          code: "codex_item_error",
          message: item.message,
          severity: "recoverable",
        }]

      default:
        log.warn("Unhandled Codex SDK item type in item.started", { type: (item as any).type })
        return []
    }
  }

  // -----------------------------------------------------------------------
  // item.updated — extract incremental deltas from full-text snapshots
  // -----------------------------------------------------------------------

  private mapItemUpdated(item: ThreadItem): AgentEvent[] {
    switch (item.type) {
      case "agent_message": {
        const delta = this.extractDelta(item.id, item.text)
        return delta ? [{ type: "text_delta", text: delta }] : []
      }

      case "reasoning": {
        const delta = this.extractDelta(item.id, item.text)
        return delta ? [{ type: "thinking_delta", text: delta }] : []
      }

      case "command_execution": {
        const delta = this.extractDelta(item.id, item.aggregated_output)
        return delta ? [{ type: "tool_use_progress", id: item.id, output: delta }] : []
      }

      case "todo_list":
        return [{
          type: "backend_specific",
          backend: "codex-sdk",
          data: { type: "todo_list_updated", item },
        }]

      default:
        return []
    }
  }

  // -----------------------------------------------------------------------
  // item.completed
  // -----------------------------------------------------------------------

  private mapItemCompleted(item: ThreadItem): AgentEvent[] {
    // Clean up offset tracking for completed items
    this.textOffsets.delete(item.id)

    switch (item.type) {
      case "agent_message":
        return item.text ? [{ type: "text_complete", text: item.text }] : []

      case "reasoning":
        // Reasoning already streamed via deltas — no end event needed
        return []

      case "command_execution":
        return [this.mapCommandCompleted(item)]

      case "file_change":
        return [this.mapFileChangeCompleted(item)]

      case "mcp_tool_call":
        return [this.mapMcpCompleted(item)]

      case "web_search":
        return [{
          type: "tool_use_end",
          id: item.id,
          output: "Web search completed",
        }]

      case "todo_list":
        return [{
          type: "backend_specific",
          backend: "codex-sdk",
          data: { type: "todo_list_completed", item },
        }]

      case "error":
        return [{
          type: "error",
          code: "codex_item_error",
          message: item.message,
          severity: "recoverable",
        }]

      default:
        return []
    }
  }

  // -----------------------------------------------------------------------
  // Tool completion helpers
  // -----------------------------------------------------------------------

  private mapCommandCompleted(item: CommandExecutionItem): AgentEvent {
    const isError = item.status === "failed" || (item.exit_code !== undefined && item.exit_code !== 0)
    return {
      type: "tool_use_end",
      id: item.id,
      output: item.aggregated_output || `Exit code: ${item.exit_code ?? "unknown"}`,
      error: isError
        ? item.aggregated_output || `Command failed (exit ${item.exit_code ?? "unknown"})`
        : undefined,
    }
  }

  private mapFileChangeCompleted(item: FileChangeItem): AgentEvent {
    const summary = item.changes
      .map(c => `${c.kind}: ${c.path}`)
      .join(", ")
    return {
      type: "tool_use_end",
      id: item.id,
      output: summary || "File change completed",
      error: item.status === "failed" ? "File change failed" : undefined,
    }
  }

  private mapMcpCompleted(item: McpToolCallItem): AgentEvent {
    let output = ""
    if (item.result?.content) {
      const blocks = Array.isArray(item.result.content) ? item.result.content : [item.result.content]
      output = blocks
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
    }
    return {
      type: "tool_use_end",
      id: item.id,
      output: output || "MCP tool call completed",
      error: item.status === "failed"
        ? item.error?.message ?? "MCP tool call failed"
        : undefined,
    }
  }

  // -----------------------------------------------------------------------
  // Delta extraction
  // -----------------------------------------------------------------------

  /** Extract the new text since the last update for a given item */
  private extractDelta(itemId: string, fullText: string): string | null {
    const prev = this.textOffsets.get(itemId) ?? 0
    if (fullText.length <= prev) return null
    this.textOffsets.set(itemId, fullText.length)
    return fullText.slice(prev)
  }
}
