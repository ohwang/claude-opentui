/**
 * Gemini Event Mapper
 *
 * Maps ServerGeminiStreamEvent (from GeminiCliSession.sendStream()) to
 * the unified AgentEvent type.
 *
 * Key mapping:
 *   Content          → text_delta
 *   Thought          → thinking_delta
 *   ToolCallRequest  → tool_use_start
 *   ToolCallResponse → tool_use_end
 *   Finished         → turn_complete (with usage)
 *   Error            → error
 *   ModelInfo        → session_init (model info)
 *   ChatCompressed   → compact
 */

import { log } from "../../utils/logger"
import type { AgentEvent } from "../../protocol/types"
import { GeminiEventType, type ServerGeminiStreamEvent } from "./types"

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

export function mapGeminiEvent(event: ServerGeminiStreamEvent): AgentEvent[] {
  const events: AgentEvent[] = []

  switch (event.type) {
    case GeminiEventType.Content: {
      if (event.value) {
        events.push({ type: "text_delta", text: event.value })
      }
      break
    }

    case GeminiEventType.Thought: {
      const thought = event.value?.thought
      if (thought) {
        events.push({ type: "thinking_delta", text: thought })
      }
      break
    }

    case GeminiEventType.ToolCallRequest: {
      const info = event.value
      log.info("Gemini tool call request", {
        callId: info.callId,
        name: info.name,
        argKeys: Object.keys(info.args ?? {}).join(","),
      })
      events.push({
        type: "tool_use_start",
        id: info.callId,
        tool: info.name,
        input: info.args ?? {},
      })
      break
    }

    case GeminiEventType.ToolCallResponse: {
      const info = event.value
      const isError = !!info.error
      let output = ""

      // Extract text from response parts
      if (info.responseParts && Array.isArray(info.responseParts)) {
        output = info.responseParts
          .map((part: any) => {
            if (typeof part === "string") return part
            if (part?.text) return part.text
            if (part?.functionResponse?.response) {
              return JSON.stringify(part.functionResponse.response)
            }
            return ""
          })
          .filter(Boolean)
          .join("\n")
      }

      // Fallback to data if no response parts
      if (!output && info.data) {
        output = JSON.stringify(info.data)
      }

      log.info("Gemini tool call response", {
        callId: info.callId,
        isError,
        outputLength: output.length,
      })

      events.push({
        type: "tool_use_end",
        id: info.callId,
        output: output || (isError ? "Tool call failed" : "Tool call completed"),
        error: isError
          ? info.error?.message ?? "Tool execution failed"
          : undefined,
      })
      break
    }

    case GeminiEventType.ToolCallConfirmation: {
      const info = event.value
      log.info("Gemini tool call confirmation", {
        callId: info.callId,
        name: info.name,
        decision: info.decision,
      })
      // Confirmation is an internal SDK event — it means the tool was
      // approved/denied by the policy engine. We pass it through as
      // backend_specific for observability.
      events.push({
        type: "backend_specific",
        backend: "gemini",
        data: { type: "tool_call_confirmation", value: info },
      })
      break
    }

    case GeminiEventType.Finished: {
      const value = event.value
      const usage = value?.usageMetadata

      // Emit cost_update before turn_complete so running token totals accumulate
      if (usage) {
        events.push({
          type: "cost_update",
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
          cacheReadTokens: usage.cachedContentTokenCount ?? 0,
        })
      }

      events.push({
        type: "turn_complete",
        usage: usage
          ? {
              inputTokens: usage.promptTokenCount ?? 0,
              outputTokens: usage.candidatesTokenCount ?? 0,
              cacheReadTokens: usage.cachedContentTokenCount ?? 0,
            }
          : undefined,
      })

      if (value?.reason) {
        log.info("Gemini turn finished", { reason: value.reason })
      }
      break
    }

    case GeminiEventType.Error: {
      const err = event.value?.error
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : JSON.stringify(err)

      log.error("Gemini error event", { error: message })
      events.push({
        type: "error",
        code: "gemini_error",
        message: message || "Unknown Gemini error",
        severity: "recoverable",
      })
      break
    }

    case GeminiEventType.ModelInfo: {
      // Model info arrives early in the stream — use it for session_init
      const modelId = event.value
      log.info("Gemini model info", { model: modelId })
      events.push({
        type: "session_init",
        tools: [], // Gemini doesn't enumerate tools at init
        models: modelId
          ? [{ id: modelId, name: modelId, provider: "google" }]
          : [],
      })
      break
    }

    case GeminiEventType.ChatCompressed:
      events.push({
        type: "compact",
        summary: "Conversation compacted by Gemini.",
      })
      break

    case GeminiEventType.UserCancelled:
      // User cancelled — the adapter handles this via AbortController
      log.info("Gemini user cancelled event")
      break

    case GeminiEventType.MaxSessionTurns:
      events.push({
        type: "error",
        code: "max_turns",
        message: "Maximum session turns reached",
        severity: "fatal",
      })
      break

    case GeminiEventType.LoopDetected:
      events.push({
        type: "error",
        code: "loop_detected",
        message: "Gemini detected a loop in agent execution",
        severity: "recoverable",
      })
      break

    case GeminiEventType.Citation:
      // Citation text — append to response as a system note
      if (event.value) {
        events.push({
          type: "system_message",
          text: event.value,
        })
      }
      break

    case GeminiEventType.Retry:
      log.info("Gemini retrying request")
      break

    case GeminiEventType.ContextWindowWillOverflow: {
      const info = event.value
      log.warn("Gemini context window will overflow", {
        estimated: info.estimatedRequestTokenCount,
        remaining: info.remainingTokenCount,
      })
      events.push({
        type: "backend_specific",
        backend: "gemini",
        data: { type: "context_window_overflow", value: info },
      })
      break
    }

    case GeminiEventType.InvalidStream:
      log.warn("Gemini received invalid stream")
      events.push({
        type: "error",
        code: "invalid_stream",
        message: "Received invalid response stream from Gemini",
        severity: "recoverable",
      })
      break

    case GeminiEventType.AgentExecutionStopped: {
      const info = event.value
      log.warn("Gemini agent execution stopped", { reason: info.reason })
      if (info.systemMessage) {
        events.push({ type: "system_message", text: info.systemMessage })
      }
      events.push({
        type: "error",
        code: "execution_stopped",
        message: info.reason,
        severity: "recoverable",
      })
      break
    }

    case GeminiEventType.AgentExecutionBlocked: {
      const info = event.value
      log.warn("Gemini agent execution blocked", { reason: info.reason })
      if (info.systemMessage) {
        events.push({ type: "system_message", text: info.systemMessage })
      }
      events.push({
        type: "error",
        code: "execution_blocked",
        message: info.reason,
        severity: "recoverable",
      })
      break
    }

    default:
      log.warn("Unhandled Gemini event type", { type: (event as any).type })
      events.push({
        type: "backend_specific",
        backend: "gemini",
        data: event,
      })
  }

  return events
}
