/**
 * Codex App-Server Event Mapper
 *
 * Maps Codex app-server notifications to the unified AgentEvent type.
 *
 * Codex's model:
 *   Thread → Turn → Item (agentMessage, commandExecution, fileChange, reasoning, etc.)
 *
 * Key mapping:
 *   thread/started       → session_init
 *   turn/started         → turn_start
 *   item/agentMessage/delta    → text_delta
 *   item/reasoning/summaryTextDelta → thinking_delta
 *   item/started (commandExecution)  → tool_use_start
 *   item/commandExecution/outputDelta → tool_use_progress
 *   item/completed (commandExecution) → tool_use_end
 *   item/started (fileChange)  → tool_use_start
 *   item/fileChange/outputDelta → tool_use_progress
 *   item/completed (fileChange) → tool_use_end
 *   item/started (mcpToolCall) → tool_use_start
 *   item/completed (mcpToolCall) → tool_use_end
 *   turn/completed       → turn_complete
 *   thread/tokenUsage/updated → cost_update
 *   thread/compacted     → compact
 *   error                → error
 */

import { log } from "../../utils/logger"
import type { AgentEvent, ModelInfo, ToolInfo } from "../../protocol/types"

// ---------------------------------------------------------------------------
// Codex item types (subset of the full ThreadItem union)
// ---------------------------------------------------------------------------

export interface CodexItem {
  type: string
  id: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Notification → AgentEvent mapping
// ---------------------------------------------------------------------------

export function mapCodexNotification(
  method: string,
  params: any,
): AgentEvent[] {
  const events: AgentEvent[] = []

  switch (method) {
    // ----- Thread lifecycle -----

    case "thread/started": {
      const thread = params?.thread
      const models: ModelInfo[] = []
      if (thread?.modelProvider) {
        models.push({
          id: thread.modelProvider,
          name: thread.modelProvider,
          provider: "openai",
        })
      }
      events.push({
        type: "session_init",
        tools: [],  // Codex doesn't enumerate tools at init; they appear as items
        models,
        account: undefined,
      })
      break
    }

    case "thread/status/changed": {
      const status = params?.status
      if (status === "idle") {
        events.push({ type: "session_state", state: "idle" })
      } else if (status === "active") {
        events.push({ type: "session_state", state: "running" })
      }
      break
    }

    case "thread/name/updated":
      // Informational — no AgentEvent equivalent needed
      break

    case "thread/tokenUsage/updated": {
      const usage = params?.usage
      if (usage) {
        events.push({
          type: "cost_update",
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.cachedInputTokens ?? 0,
        })
      }
      break
    }

    case "thread/compacted":
      events.push({
        type: "compact",
        summary: "Conversation compacted by Codex.",
      })
      break

    // ----- Turn lifecycle -----

    case "turn/started":
      events.push({ type: "turn_start" })
      break

    case "turn/completed": {
      const turn = params?.turn
      const usage = turn?.usage
      events.push({
        type: "turn_complete",
        usage: usage
          ? {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              cacheReadTokens: usage.cachedInputTokens ?? 0,
            }
          : undefined,
      })
      // If the turn failed, also emit an error
      if (turn?.status === "failed" && turn.error) {
        events.push({
          type: "error",
          code: turn.error.codexErrorInfo ?? "codex_turn_failed",
          message: turn.error.message ?? "Turn failed",
          severity: "recoverable",
        })
      }
      break
    }

    // ----- Item lifecycle -----

    case "item/started": {
      const item = params?.item as CodexItem | undefined
      if (!item) break
      events.push(...mapItemStarted(item))
      break
    }

    case "item/completed": {
      const item = params?.item as CodexItem | undefined
      if (!item) break
      events.push(...mapItemCompleted(item))
      break
    }

    // ----- Streaming deltas -----

    case "item/agentMessage/delta":
      if (params?.delta) {
        events.push({ type: "text_delta", text: params.delta })
      }
      break

    case "item/reasoning/summaryTextDelta":
      if (params?.delta) {
        events.push({ type: "thinking_delta", text: params.delta })
      }
      break

    case "item/reasoning/textDelta":
      // Raw reasoning content — also map to thinking_delta
      if (params?.delta) {
        events.push({ type: "thinking_delta", text: params.delta })
      }
      break

    case "item/commandExecution/outputDelta":
      if (params?.itemId && params?.delta) {
        events.push({
          type: "tool_use_progress",
          id: params.itemId,
          output: params.delta,
        })
      }
      break

    case "item/fileChange/outputDelta":
      if (params?.itemId && params?.delta) {
        events.push({
          type: "tool_use_progress",
          id: params.itemId,
          output: params.delta,
        })
      }
      break

    case "item/plan/delta":
      // Plan text — surface as thinking since it's the agent's planning
      if (params?.delta) {
        events.push({ type: "thinking_delta", text: params.delta })
      }
      break

    // ----- Turn plan/diff updates -----

    case "turn/diff/updated":
    case "turn/plan/updated":
      // Informational — backend_specific passthrough
      events.push({
        type: "backend_specific",
        backend: "codex",
        data: { method, params },
      })
      break

    // ----- Guardian/auto-approval review -----

    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
    case "item/guardianApprovalReview/started":
    case "item/guardianApprovalReview/completed":
      // Informational — passthrough
      events.push({
        type: "backend_specific",
        backend: "codex",
        data: { method, params },
      })
      break

    // ----- Server request resolved (after approval response) -----

    case "serverRequest/resolved":
      // The approval was processed — no AgentEvent needed
      break

    // ----- Account/model/skills updates -----

    case "account/updated":
    case "model/rerouted":
    case "skills/changed":
    case "mcpServer/startupStatus/updated":
      events.push({
        type: "backend_specific",
        backend: "codex",
        data: { method, params },
      })
      break

    // ----- Errors -----

    case "error":
      events.push({
        type: "error",
        code: params?.code ?? "codex_error",
        message: params?.message ?? "Unknown Codex error",
        severity: "recoverable",
      })
      break

    default:
      log.warn("Unhandled Codex notification", { method })
      events.push({
        type: "backend_specific",
        backend: "codex",
        data: { method, params },
      })
  }

  return events
}

// ---------------------------------------------------------------------------
// Item started → AgentEvent
// ---------------------------------------------------------------------------

function mapItemStarted(item: CodexItem): AgentEvent[] {
  const events: AgentEvent[] = []

  switch (item.type) {
    case "agentMessage":
      // Agent text will stream via item/agentMessage/delta — no start event needed
      break

    case "reasoning":
      // Reasoning will stream via delta events — no start event needed
      break

    case "plan":
      // Plan will stream via item/plan/delta — no start event needed
      break

    case "commandExecution":
      events.push({
        type: "tool_use_start",
        id: item.id,
        tool: "Bash",
        input: {
          command: item.command ?? "",
          cwd: item.cwd ?? "",
        },
      })
      break

    case "fileChange":
      events.push({
        type: "tool_use_start",
        id: item.id,
        tool: "Edit",
        input: {
          changes: item.changes ?? [],
        },
      })
      break

    case "mcpToolCall":
      events.push({
        type: "tool_use_start",
        id: item.id,
        tool: `mcp:${item.server ?? "unknown"}/${item.tool ?? "unknown"}`,
        input: item.arguments ?? {},
      })
      break

    case "webSearch":
      events.push({
        type: "tool_use_start",
        id: item.id,
        tool: "WebSearch",
        input: { query: item.query ?? "" },
      })
      break

    case "userMessage":
      // User's own message echoed back — no event needed
      break

    case "todoList":
      // Pass through as backend_specific
      events.push({
        type: "backend_specific",
        backend: "codex",
        data: { type: "todoList", item },
      })
      break

    case "contextCompaction":
      events.push({
        type: "compact",
        summary: "Codex compacted conversation context.",
      })
      break

    default:
      log.debug("Unhandled item type in item/started", { type: item.type })
  }

  return events
}

// ---------------------------------------------------------------------------
// Item completed → AgentEvent
// ---------------------------------------------------------------------------

function mapItemCompleted(item: CodexItem): AgentEvent[] {
  const events: AgentEvent[] = []

  switch (item.type) {
    case "agentMessage": {
      // Full agent message — emit text_complete with final text
      const text = (item.text as string) ?? ""
      if (text) {
        events.push({ type: "text_complete", text })
      }
      break
    }

    case "commandExecution": {
      const status = item.status as string
      const output = (item.aggregatedOutput as string) ?? ""
      const exitCode = item.exitCode as number | undefined
      const isError =
        status === "failed" || (exitCode !== undefined && exitCode !== 0)

      events.push({
        type: "tool_use_end",
        id: item.id,
        output: output || `Exit code: ${exitCode ?? "unknown"}`,
        error: isError
          ? output || `Command failed (exit ${exitCode ?? "unknown"})`
          : undefined,
      })
      break
    }

    case "fileChange": {
      const status = item.status as string
      const changes = (item.changes as any[]) ?? []
      const summary = changes
        .map(
          (c: any) =>
            `${c.kind ?? "update"}: ${c.path ?? "unknown"}`,
        )
        .join(", ")

      events.push({
        type: "tool_use_end",
        id: item.id,
        output: summary || "File change completed",
        error: status === "failed" ? "File change failed" : undefined,
      })
      break
    }

    case "mcpToolCall": {
      const status = item.status as string
      const result = item.result as any
      const error = item.error as any
      let output = ""

      if (result?.content) {
        const contentBlocks = Array.isArray(result.content)
          ? result.content
          : [result.content]
        output = contentBlocks
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n")
      }

      events.push({
        type: "tool_use_end",
        id: item.id,
        output: output || "MCP tool call completed",
        error:
          status === "failed" ? error?.message ?? "MCP tool call failed" : undefined,
      })
      break
    }

    case "webSearch":
      events.push({
        type: "tool_use_end",
        id: item.id,
        output: "Web search completed",
      })
      break

    case "reasoning":
    case "plan":
    case "userMessage":
    case "todoList":
    case "contextCompaction":
      // No end event needed for these types
      break

    default:
      log.debug("Unhandled item type in item/completed", { type: item.type })
  }

  return events
}
