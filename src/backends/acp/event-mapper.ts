/**
 * ACP Event Mapper
 *
 * Maps ACP session/update notifications to the unified AgentEvent type.
 *
 * ACP model:
 *   Session → Prompt turn → Streaming updates (agent_message_chunk, tool_call, etc.)
 *
 * Key mapping:
 *   agent_message_chunk (text)    → text_delta
 *   tool_call                     → tool_use_start
 *   tool_call_update (in_progress) → tool_use_progress
 *   tool_call_update (completed)  → tool_use_end
 *   tool_call_update (failed)     → tool_use_end (with error)
 *   plan                          → thinking_delta
 *   available_commands_update     → backend_specific
 *   unknown                       → backend_specific
 */

import { log } from "../../utils/logger"
import type { AgentEvent } from "../../protocol/types"
import type {
  AcpSessionUpdateParams,
  AcpAgentMessageChunk,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpPlanUpdate,
  AcpAvailableCommandsUpdate,
  AcpToolContent,
} from "./types"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map an ACP session/update notification to AgentEvents.
 */
export function mapAcpUpdate(params: AcpSessionUpdateParams): AgentEvent[] {
  const update = params.update
  if (!update?.sessionUpdate) {
    log.warn("ACP session/update missing sessionUpdate type", { params })
    return []
  }

  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return mapAgentMessageChunk(update as AcpAgentMessageChunk)

    case "tool_call":
      return mapToolCall(update as AcpToolCall)

    case "tool_call_update":
      return mapToolCallUpdate(update as AcpToolCallUpdate)

    case "plan":
      return mapPlan(update as AcpPlanUpdate)

    case "available_commands_update":
      return mapAvailableCommands(update as AcpAvailableCommandsUpdate)

    default:
      log.warn("Unhandled ACP update type", { sessionUpdate: update.sessionUpdate })
      return [{
        type: "backend_specific",
        backend: "acp",
        data: { method: "session/update", update },
      }]
  }
}

// ---------------------------------------------------------------------------
// Agent message chunk
// ---------------------------------------------------------------------------

function mapAgentMessageChunk(update: AcpAgentMessageChunk): AgentEvent[] {
  const content = update.content
  if (!content) return []

  if (content.type === "text" && content.text) {
    return [{ type: "text_delta", text: content.text }]
  }

  // Non-text content in message chunk — pass through
  log.debug("ACP agent_message_chunk with non-text content", { type: content.type })
  return [{
    type: "backend_specific",
    backend: "acp",
    data: { method: "session/update", update },
  }]
}

// ---------------------------------------------------------------------------
// Tool call (initial)
// ---------------------------------------------------------------------------

function mapToolCall(update: AcpToolCall): AgentEvent[] {
  const toolName = deriveToolName(update.kind, update.title)

  return [{
    type: "tool_use_start",
    id: update.toolCallId,
    tool: toolName,
    input: {
      title: update.title,
      kind: update.kind,
      locations: update.locations,
      rawInput: update.rawInput,
    },
  }]
}

// ---------------------------------------------------------------------------
// Tool call update (progress / completion)
// ---------------------------------------------------------------------------

function mapToolCallUpdate(update: AcpToolCallUpdate): AgentEvent[] {
  const events: AgentEvent[] = []

  // Completed or failed → tool_use_end
  if (update.status === "completed" || update.status === "failed") {
    const output = extractToolContentText(update.content)
    events.push({
      type: "tool_use_end",
      id: update.toolCallId,
      output: output || `Tool ${update.status}`,
      error: update.status === "failed" ? (output || "Tool call failed") : undefined,
    })
    return events
  }

  // In-progress → tool_use_progress
  if (update.content && update.content.length > 0) {
    const output = extractToolContentText(update.content)
    if (output) {
      events.push({
        type: "tool_use_progress",
        id: update.toolCallId,
        output,
      })
    }
  }

  // If there's rich content (diffs, terminals) not captured in text,
  // pass through as backend_specific
  if (update.content?.some(c => c.type === "diff" || c.type === "terminal")) {
    events.push({
      type: "backend_specific",
      backend: "acp",
      data: {
        type: "tool_call_rich_content",
        toolCallId: update.toolCallId,
        content: update.content,
      },
    })
  }

  return events
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function mapPlan(update: AcpPlanUpdate): AgentEvent[] {
  // Plan entries — surface as thinking since it's the agent's reasoning
  if (update.entries && update.entries.length > 0) {
    const text = update.entries
      .map((e: any) => e.text ?? e.title ?? JSON.stringify(e))
      .join("\n")
    if (text) {
      return [{ type: "thinking_delta", text }]
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// Available commands (slash commands advertised by the agent)
// ---------------------------------------------------------------------------

function mapAvailableCommands(update: AcpAvailableCommandsUpdate): AgentEvent[] {
  return [{
    type: "backend_specific",
    backend: "acp",
    data: {
      type: "available_commands",
      commands: update.availableCommands,
    },
  }]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable tool name from ACP kind + title.
 */
function deriveToolName(kind?: string, title?: string): string {
  // Map ACP kind to a tool name similar to Claude/Codex naming
  switch (kind) {
    case "read":
      return "Read"
    case "edit":
      return "Edit"
    case "execute":
      return "Bash"
    case "search":
      return "Search"
    case "fetch":
      return "WebFetch"
    case "think":
      return "Think"
    case "delete":
      return "Delete"
    case "move":
      return "Move"
    default:
      return title ?? kind ?? "Tool"
  }
}

/**
 * Extract plain text from ACP tool content array.
 */
function extractToolContentText(content?: AcpToolContent[]): string {
  if (!content || content.length === 0) return ""

  return content
    .filter((c): c is { type: "content"; content: { type: "text"; text: string } } =>
      c.type === "content" && c.content?.type === "text",
    )
    .map(c => c.content.text)
    .join("\n")
}
