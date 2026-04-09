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
 *   plan                          → plan_update
 *   available_commands_update     → backend_specific
 *   unknown                       → backend_specific
 */

import { log } from "../../utils/logger"
import type { AgentEvent, PlanEntry } from "../../protocol/types"
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

  switch (content.type) {
    case "text": {
      if (content.text == null) return []
      if (content.text === "") {
        log.debug("ACP agent_message_chunk with empty text (keep-alive), skipping")
        return []
      }
      return [{ type: "text_delta", text: content.text }]
    }

    case "resource_link": {
      // Render resource links as markdown-style links
      // Terminal emulators with OSC 8 support will make these clickable
      const link = content as { type: "resource_link"; uri: string; name: string; mimeType?: string }
      const label = link.name || link.uri
      const text = `[${label}](${link.uri})`
      return [{ type: "text_delta", text }]
    }

    case "image": {
      // Render images as descriptive placeholder text
      // Full image rendering needs TUI infrastructure that doesn't exist yet
      const img = content as { type: "image"; mimeType: string; data: string; uri?: string }
      const desc = img.uri
        ? `\n[Image: ${img.uri.split("/").pop() ?? "image"}](${img.uri})\n`
        : `\n[Image: ${img.mimeType}]\n`
      return [{ type: "text_delta", text: desc }]
    }

    default: {
      // Unknown content type — pass through
      const unknown = content as { type: string }
      log.debug("ACP agent_message_chunk with unhandled content type", { type: unknown.type })
      return [{
        type: "backend_specific",
        backend: "acp",
        data: { method: "session/update", update },
      }]
    }
  }
}

// ---------------------------------------------------------------------------
// Tool call (initial)
// ---------------------------------------------------------------------------

function mapToolCall(update: AcpToolCall): AgentEvent[] {
  const toolName = deriveToolName(update.kind, update.title)

  // Normalize input to include fields tool-view.tsx expects
  const input: Record<string, unknown> = {
    // Preserve ACP metadata
    title: update.title,
    kind: update.kind,
    locations: update.locations,
    rawInput: update.rawInput,
  }

  // Extract standard fields from rawInput (may be string or object)
  const raw = update.rawInput
  if (raw && typeof raw === "object") {
    const rawObj = raw as Record<string, unknown>
    // Pass through any standard fields from rawInput
    if (rawObj.file_path) input.file_path = rawObj.file_path
    if (rawObj.command) input.command = rawObj.command
    if (rawObj.pattern) input.pattern = rawObj.pattern
    if (rawObj.query) input.query = rawObj.query
    if (rawObj.path) input.file_path = input.file_path ?? rawObj.path
  } else if (raw && typeof raw === "string") {
    // rawInput is a string — likely a command or file path
    if (toolName === "Bash") input.command = raw
    else if (toolName === "Read" || toolName === "Edit" || toolName === "Delete" || toolName === "Move") input.file_path = raw
    else if (toolName === "Search") input.pattern = raw
  }

  // Extract file_path from locations if not already set
  if (!input.file_path && update.locations && update.locations.length > 0) {
    const loc = update.locations[0]
    if (loc?.path) input.file_path = loc.path
  }

  return [{
    type: "tool_use_start",
    id: update.toolCallId,
    tool: toolName,
    input,
  }]
}

// ---------------------------------------------------------------------------
// Tool call update (progress / completion)
// ---------------------------------------------------------------------------

function mapToolCallUpdate(update: AcpToolCallUpdate): AgentEvent[] {
  const events: AgentEvent[] = []

  // Extract text + diff content
  const textOutput = extractToolContentText(update.content)
  const diffOutput = extractDiffContent(update.content)
  const combinedOutput = [textOutput, diffOutput].filter(Boolean).join("\n")

  // Completed or failed → tool_use_end
  if (update.status === "completed" || update.status === "failed") {
    events.push({
      type: "tool_use_end",
      id: update.toolCallId,
      output: combinedOutput || `Tool ${update.status}`,
      error: update.status === "failed" ? (combinedOutput || "Tool call failed") : undefined,
    })
    return events
  }

  // In-progress → tool_use_progress
  if (combinedOutput) {
    events.push({
      type: "tool_use_progress",
      id: update.toolCallId,
      output: combinedOutput,
    })
  }

  // Terminal content still passes through as backend_specific
  if (update.content?.some(c => c.type === "terminal")) {
    events.push({
      type: "backend_specific",
      backend: "acp",
      data: {
        type: "tool_call_rich_content",
        toolCallId: update.toolCallId,
        content: update.content?.filter(c => c.type === "terminal"),
      },
    })
  }

  return events
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function mapPlan(update: AcpPlanUpdate): AgentEvent[] {
  if (!update.entries || update.entries.length === 0) return []

  const entries: PlanEntry[] = update.entries.map((e) => ({
    content: e.content ?? e.text ?? e.title ?? JSON.stringify(e),
    priority: e.priority,
    status: e.status,
  }))

  return [{ type: "plan_update", entries }]
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
export function deriveToolName(kind?: string, title?: string): string {
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

/**
 * Extract diff content from ACP tool content array and format as unified diff.
 * The unified diff format is recognized by tool-view.tsx for color-coded rendering.
 */
function extractDiffContent(content?: AcpToolContent[]): string {
  if (!content || content.length === 0) return ""

  return content
    .filter((c): c is { type: "diff"; path: string; oldText: string; newText: string } =>
      c.type === "diff",
    )
    .map(c => formatDiffContent(c))
    .join("\n\n")
}

/**
 * Convert an ACP diff content block to unified diff text format.
 * Produces `--- a/path` + `+++ b/path` + `@@ ` hunk headers that
 * tool-view.tsx detects for rendering with the `<diff>` component.
 */
function formatDiffContent(diff: { path: string; oldText: string; newText: string }): string {
  const oldLines = diff.oldText.split("\n")
  const newLines = diff.newText.split("\n")

  const lines: string[] = []
  lines.push(`--- a/${diff.path}`)
  lines.push(`+++ b/${diff.path}`)

  // Simple unified diff: show full file as one hunk
  lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`)

  for (const line of oldLines) {
    lines.push(`-${line}`)
  }
  for (const line of newLines) {
    lines.push(`+${line}`)
  }

  return lines.join("\n")
}
