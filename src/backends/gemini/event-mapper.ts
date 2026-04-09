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
 *   Finished         → cost_update (turn_complete emitted by adapter)
 *   Error            → error
 *   ModelInfo        → model_changed
 *   ChatCompressed   → compact
 */

import { log } from "../../utils/logger"
import type { AgentEvent } from "../../protocol/types"
import { GeminiEventType, type ServerGeminiStreamEvent } from "./types"

// ---------------------------------------------------------------------------
// Stateful event mapper
// ---------------------------------------------------------------------------

/**
 * Stateful mapper that converts SDK events to AgentEvents.
 *
 * The Gemini SDK's sendStream() drives an internal while-loop for tool
 * execution.  Each iteration makes a fresh sendMessageStream() API call
 * which yields Content events for genuinely new model output — it does
 * NOT replay Content from prior iterations.  So no cross-turn text
 * deduplication is needed; every Content event.value is new text.
 *
 * On `Finished` we do NOT emit `text_complete` — the text was already
 * streamed via `text_delta`, and the reducer's turn_complete /
 * tool_use_start handlers flush streaming buffers into blocks.
 *
 * Create one per session; call `reset()` at the start of each user turn.
 */
export class GeminiEventMapper {
  private accumulatedText = ""

  /** Map a single SDK event to zero or more AgentEvents. */
  map(event: ServerGeminiStreamEvent): AgentEvent[] {
    return mapGeminiEventStateful(event, this)
  }

  /** Append text and return it (every Content chunk is new model output). */
  appendText(text: string): string {
    this.accumulatedText += text
    return text
  }

  /** Clear the text accumulator (called on Finished between SDK internal turns). */
  clearAccumulatedText(): void {
    this.accumulatedText = ""
  }

  /** Reset state between user turns. */
  reset(): void {
    this.accumulatedText = ""
  }
}

// ---------------------------------------------------------------------------
// Event mapping (stateful — receives mapper instance for text accumulation)
// ---------------------------------------------------------------------------

function mapGeminiEventStateful(
  event: ServerGeminiStreamEvent,
  mapper: GeminiEventMapper,
): AgentEvent[] {
  const events: AgentEvent[] = []

  switch (event.type) {
    case GeminiEventType.Content: {
      if (event.value) {
        const newText = mapper.appendText(event.value)
        events.push({ type: "text_delta", text: newText })
      }
      break
    }

    case GeminiEventType.Thought: {
      const value = event.value
      if (value) {
        // ThoughtSummary has { subject, description } — subject is bold header,
        // description is the thought content. Combine for display.
        let text = value.subject
          ? `**${value.subject}** ${value.description}`
          : value.description
        if (text) {
          // Ensure each thought chunk ends with a newline so successive
          // ThoughtSummary events don't concatenate into run-on text
          // when the reducer accumulates streamingThinking (WI-17).
          if (!text.endsWith("\n")) text += "\n"
          events.push({ type: "thinking_delta", text })
        }
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
      log.info("Gemini Finished event", {
        hasUsage: !!usage,
        promptTokens: usage?.promptTokenCount,
        candidateTokens: usage?.candidatesTokenCount,
        rawKeys: usage ? Object.keys(usage) : "no usage",
      })

      // Do NOT emit text_complete here. The text was already streamed via
      // text_delta events, and the reducer's turn_complete/tool_use_start
      // handlers call flushBuffers() to commit streaming text into blocks.
      // Emitting text_complete would duplicate text that was already flushed
      // (especially around tool calls where tool_use_start triggers a flush).
      // Clear the accumulator so it doesn't leak into the next SDK internal turn.
      mapper.clearAccumulatedText()

      // Emit cost_update so running token totals accumulate.
      // For Gemini, promptTokenCount already INCLUDES cachedContentTokenCount.
      // We emit inputTokens as the non-cached portion and cacheReadTokens as
      // the cached portion so they are disjoint and can be summed correctly.
      if (usage) {
        const cachedTokens = usage.cachedContentTokenCount ?? 0
        const totalInputTokens = usage.promptTokenCount ?? 0
        events.push({
          type: "cost_update",
          inputTokens: Math.max(0, totalInputTokens - cachedTokens),
          outputTokens: usage.candidatesTokenCount ?? 0,
          cacheReadTokens: cachedTokens,
          contextTokens: totalInputTokens || undefined,
        })
      }

      // NOTE: turn_complete is NOT emitted here. The Gemini SDK emits multiple
      // Finished events per user message during multi-turn tool-use loops (one
      // per internal sendStream cycle). Emitting turn_complete on each Finished
      // would transition the state machine to IDLE mid-turn, making Ctrl+C
      // interrupt checks fail (they require RUNNING state). The adapter emits
      // a single turn_complete after the for-await loop over sendStream() ends.
      // See adapter.ts runTurn().

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
      // Model info arrives after the adapter's synthetic session_init.
      // Emit model_changed so the status bar updates without
      // overwriting the session (which already has the correct sessionId).
      // No system_message — the SDK sends this on every first turn,
      // and a visible "Model switched" message is confusing when the
      // user didn't request a switch (WI-18).
      const modelId = event.value
      log.info("Gemini model info", { model: modelId })
      if (modelId) {
        events.push({ type: "model_changed", model: modelId })
      }
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

// ---------------------------------------------------------------------------
// Stateless convenience wrapper (backward-compatible, used by tests)
// ---------------------------------------------------------------------------

/**
 * Stateless convenience wrapper — maps a single event without cross-event
 * text accumulation. Resets internal state on each call so it never leaks
 * between independent invocations. Prefer `GeminiEventMapper` for production
 * use where text accumulation across a turn matters.
 */
const _defaultMapper = new GeminiEventMapper()

export function mapGeminiEvent(event: ServerGeminiStreamEvent): AgentEvent[] {
  _defaultMapper.reset()
  return _defaultMapper.map(event)
}
