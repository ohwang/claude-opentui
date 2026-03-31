/**
 * SDK Message -> AgentEvent mapping
 *
 * Pure functions that convert Claude Agent SDK messages and stream events
 * into the protocol's AgentEvent type. Stateful tool input accumulation
 * is managed by the ToolStreamState class.
 */

import { log } from "../../utils/logger"
import type { AgentEvent, ModelInfo } from "../../protocol/types"

// ---------------------------------------------------------------------------
// Error message cleanup
// ---------------------------------------------------------------------------

/** Strip stack traces and dedup repeated error messages for clean display */
function cleanErrorMessage(errors: string[] | undefined): string | undefined {
  if (!errors || errors.length === 0) return undefined

  const cleaned = errors.map(e => {
    // Strip stack trace lines (lines starting with whitespace + "at ")
    const lines = e.split("\n")
    const meaningful = lines.filter(l => !l.match(/^\s+at\s/))
    return meaningful.join("\n").trim()
  })

  // Dedup identical messages (SDK often repeats the same error 3x)
  const unique = [...new Set(cleaned)].filter(Boolean)

  // Join unique errors, cap at 200 chars
  const joined = unique.join("; ")
  return joined.length > 200 ? joined.slice(0, 197) + "..." : joined
}

// ---------------------------------------------------------------------------
// Tool input JSON accumulation state
// ---------------------------------------------------------------------------

export class ToolStreamState {
  toolInputJsons = new Map<string, string>()
  currentToolIds = new Map<number, string>()
}

// ---------------------------------------------------------------------------
// SDK message -> AgentEvent[]
// ---------------------------------------------------------------------------

export interface MapperOptions {
  /** Map assistant messages to text/tool events. V2 needs this (no stream_events). V1 does not (would double-emit). */
  mapAssistant?: boolean
}

export function mapSDKMessage(msg: any, streamState: ToolStreamState, options?: MapperOptions): AgentEvent[] {
  const events: AgentEvent[] = []

  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        // Extract context window from bracket suffix if present (e.g. "claude-opus-4-6 [1M context]")
        let contextWindow: number | undefined
        const bracketMatch = msg.model?.match(/\[(\d+)([KkMm])\s*(?:context|tokens?)?\]/)
        if (bracketMatch) {
          const num = parseInt(bracketMatch[1])
          const unit = bracketMatch[2].toUpperCase()
          contextWindow = unit === "M" ? num * 1_000_000 : num * 1_000
        }
        const cleanModel = msg.model?.replace(/\s*\[.*\]$/, "")
        const models: ModelInfo[] = cleanModel
          ? [{ id: cleanModel, name: cleanModel, provider: "anthropic", contextWindow }]
          : []
        events.push({
          type: "session_init",
          tools: (msg.tools ?? []).map((t: string) => ({
            name: t,
          })),
          models,
          account: msg.account,
        })
      } else if (msg.subtype === "status") {
        // "compacting" status is transient — skip it to avoid duplicate
        // compact separators. The definitive compact_boundary event below
        // is the one that should produce the separator.
        if (msg.status === "compacting") {
          log.debug("Ignoring transient compacting status event")
        }
      } else if (msg.subtype === "compact_boundary") {
        const meta = msg.compact_metadata ?? {}
        events.push({
          type: "compact",
          summary: `Conversation compacted (${meta.trigger ?? "manual"}, ${meta.pre_tokens ?? "?"} tokens before).`,
        })
      } else if (msg.subtype === "local_command_output") {
        events.push({
          type: "system_message",
          text: msg.content ?? "",
        })
      }
      break

    case "stream_event":
      events.push(...mapStreamEvent(msg.event, msg.parent_tool_use_id, streamState))
      break

    case "assistant":
      // Full assistant message (contains complete content blocks).
      // V1 uses stream_event for real-time deltas — assistant messages are redundant.
      // V2's stream() yields only assistant messages (no stream_events).
      // Only map when mapAssistant is true (V2) to avoid double-emit in V1.
      if (options?.mapAssistant) {
        events.push(...mapAssistantMessage(msg))
      }
      break

    case "result":
      if (msg.subtype === "success" || !msg.is_error) {
        events.push({
          type: "turn_complete",
          usage: {
            inputTokens: msg.usage?.input_tokens ?? 0,
            outputTokens: msg.usage?.output_tokens ?? 0,
            cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0,
            cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
            totalCostUsd: msg.total_cost_usd ?? 0,
          },
        })
      } else {
        events.push({
          type: "error",
          code: msg.subtype ?? "error_during_execution",
          message: cleanErrorMessage(msg.errors) ?? "Unknown error",
          severity: "fatal",
        })
        events.push({
          type: "turn_complete",
          usage: {
            inputTokens: msg.usage?.input_tokens ?? 0,
            outputTokens: msg.usage?.output_tokens ?? 0,
            totalCostUsd: msg.total_cost_usd ?? 0,
          },
        })
      }
      break

    case "tool_progress":
      events.push({
        type: "tool_use_progress",
        id: msg.tool_use_id,
        output: msg.content ?? `[${msg.tool_name}] ${msg.elapsed_time_seconds}s elapsed`,
      })
      break

    case "task_started":
      events.push({
        type: "task_start",
        taskId: msg.task_id ?? msg.uuid,
        description: msg.description ?? "Background task",
      })
      break

    case "task_progress":
      events.push({
        type: "task_progress",
        taskId: msg.task_id ?? msg.uuid,
        output: msg.content ?? "",
      })
      break

    case "task_notification":
      events.push({
        type: "task_complete",
        taskId: msg.task_id ?? msg.uuid,
        output: msg.content ?? msg.result ?? "",
      })
      break

    case "rate_limit":
      events.push({
        type: "error",
        code: "rate_limit",
        message: "Rate limited by API",
        severity: "recoverable",
      })
      break

    case "user": {
      // Tool result message — the SDK sends this when a tool completes.
      // Extract tool output to emit tool_use_end for result summary display.
      if (msg.tool_use_result) {
        // Find the tool_use_id from the message content blocks
        const content = msg.message?.content
        let toolUseId: string | undefined
        let output = ""
        let isError = false

        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              toolUseId = block.tool_use_id
              isError = block.is_error ?? false
              // Extract text from content
              if (typeof block.content === "string") {
                output = block.content
              } else if (Array.isArray(block.content)) {
                output = block.content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("\n")
              }
            }
          }
        }

        // Fallback 1: tool_use_id on the message itself (some SDK versions)
        if (!toolUseId && msg.tool_use_id) {
          toolUseId = msg.tool_use_id
        }

        // Fallback 2: extract output from tool_use_result directly
        if (!toolUseId || !output) {
          if (typeof msg.tool_use_result === "string") {
            output = output || msg.tool_use_result
          } else if (typeof msg.tool_use_result === "object" && msg.tool_use_result !== null) {
            // SDK may wrap result in an object with content/error fields
            const r = msg.tool_use_result as Record<string, unknown>
            if (r.tool_use_id && !toolUseId) toolUseId = String(r.tool_use_id)
            if (r.is_error) isError = true
            if (r.content && !output) output = String(r.content)
            if (r.error) {
              isError = true
              output = output || String(r.error)
            }
          }
        }

        // Fallback 3: check msg-level is_error flag
        if (msg.is_error === true) {
          isError = true
        }

        if (toolUseId) {
          events.push({
            type: "tool_use_end",
            id: toolUseId,
            output,
            error: isError ? output : undefined,
          })
        } else {
          // Last resort: find the most recently started tool that's still
          // running and close it. Without this, the tool block spins forever
          // because we can't match the result to its tool_use_start.
          log.warn("Tool result missing tool_use_id — closing last running tool", {
            keys: Object.keys(msg).join(","),
            resultType: typeof msg.tool_use_result,
            hasMessage: !!msg.message,
            contentLength: Array.isArray(content) ? content.length : 0,
          })
          events.push({
            type: "tool_use_end",
            id: "__last_running__",
            output,
            error: isError ? output : undefined,
          })
        }
      }
      break
    }

    case "rate_limit_event":
      // Informational event showing current usage quota — not an error.
      // Pass through as backend_specific so the TUI can optionally display it.
      log.debug("Rate limit info", { data: msg.rate_limit_info ?? msg })
      events.push({
        type: "backend_specific",
        backend: "claude",
        data: msg,
      })
      break

    default:
      // Log unhandled message types as warnings so we can add handlers
      log.warn("Unhandled SDK message type", { type: msg.type, subtype: msg.subtype, keys: Object.keys(msg).join(",") })
      events.push({
        type: "backend_specific",
        backend: "claude",
        data: msg,
      })
  }

  return events
}

// ---------------------------------------------------------------------------
// Assistant message -> AgentEvent[] (used by V2 adapter)
// ---------------------------------------------------------------------------

/**
 * Extract events from a complete assistant message.
 * V2's stream() yields these instead of stream_event deltas.
 * V1 also yields them but after stream_events — the reducer
 * handles any duplication via text_complete overwriting streamingText.
 */
export function mapAssistantMessage(msg: any): AgentEvent[] {
  const events: AgentEvent[] = []
  const content = msg.message?.content
  if (!Array.isArray(content)) return events

  // Emit turn_start for the assistant response
  events.push({ type: "turn_start" })

  for (const block of content) {
    switch (block.type) {
      case "text":
        if (block.text) {
          events.push({ type: "text_delta", text: block.text })
        }
        break

      case "thinking":
        if (block.thinking) {
          events.push({ type: "thinking_delta", text: block.thinking })
        }
        break

      case "tool_use":
        events.push({
          type: "tool_use_start",
          id: block.id,
          tool: block.name,
          input: block.input ?? {},
        })
        // Emit progress with the full input immediately
        if (block.input) {
          events.push({
            type: "tool_use_progress",
            id: block.id,
            output: "",
            input: block.input,
          })
        }
        break
    }
  }

  return events
}

// ---------------------------------------------------------------------------
// Stream event -> AgentEvent[]
// ---------------------------------------------------------------------------

export function mapStreamEvent(
  event: any,
  parentToolUseId: string | null,
  streamState: ToolStreamState,
): AgentEvent[] {
  const events: AgentEvent[] = []

  switch (event.type) {
    case "message_start":
      events.push({ type: "turn_start" })
      break

    case "content_block_start": {
      const block = event.content_block
      if (block?.type === "tool_use") {
        streamState.currentToolIds.set(event.index, block.id)
        streamState.toolInputJsons.set(block.id, "")
        events.push({
          type: "tool_use_start",
          id: block.id,
          tool: block.name,
          input: {},
        })
      }
      // text and thinking blocks are just markers; content comes via deltas
      break
    }

    case "content_block_delta": {
      const delta = event.delta
      if (delta?.type === "text_delta") {
        events.push({ type: "text_delta", text: delta.text })
      } else if (delta?.type === "thinking_delta") {
        events.push({ type: "thinking_delta", text: delta.thinking })
      } else if (delta?.type === "input_json_delta") {
        // Accumulate tool input JSON fragments
        const toolId = streamState.currentToolIds.get(event.index)
        if (toolId) {
          const prev = streamState.toolInputJsons.get(toolId) ?? ""
          streamState.toolInputJsons.set(toolId, prev + delta.partial_json)
        }
      }
      break
    }

    case "content_block_stop": {
      const toolId = streamState.currentToolIds.get(event.index)
      if (toolId) {
        const jsonStr = streamState.toolInputJsons.get(toolId)
        if (jsonStr) {
          try {
            const parsedInput = JSON.parse(jsonStr)
            events.push({
              type: "tool_use_progress",
              id: toolId,
              output: "",
              input: parsedInput,
            })
          } catch {
            log.warn("Failed to parse tool input JSON", { toolId, json: jsonStr.slice(0, 200) })
            // Still emit progress with the raw JSON string so the user can see inputs
            events.push({
              type: "tool_use_progress",
              id: toolId,
              output: "",
              input: jsonStr,  // Raw string instead of parsed object
            })
          }
        }
        streamState.currentToolIds.delete(event.index)
        streamState.toolInputJsons.delete(toolId)
      }
      break
    }

    case "message_delta":
      // Contains stop_reason and usage delta. Cost update.
      if (event.usage) {
        events.push({
          type: "cost_update",
          inputTokens: 0,
          outputTokens: event.usage.output_tokens ?? 0,
        })
      }
      break

    case "message_stop":
      // Message is complete. The result message follows with full usage.
      break
  }

  return events
}
