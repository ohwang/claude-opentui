/**
 * Event-sourced ConversationState reducer.
 *
 * Invariant: state is always reconstructable from the event log.
 *   reduce(events) === state
 *
 * The TUI renders from ConversationState, never raw events.
 */

import type {
  AgentEvent,
  Block,
  ConversationState,
  ToolStatus,
} from "./types"

/**
 * Commit streaming buffers to blocks. Called on tool_use_start, text_complete,
 * turn_complete, and interrupt to ensure chronological ordering.
 * Thinking is flushed before text (thinking precedes text chronologically).
 */
function flushBuffers(state: ConversationState): ConversationState {
  let streamingThinking = state.streamingThinking
  let streamingText = state.streamingText

  const flushed: Block[] = []
  if (streamingThinking) {
    flushed.push({ type: "thinking", text: streamingThinking })
    streamingThinking = ""
  }
  if (streamingText) {
    flushed.push({ type: "assistant", text: streamingText })
    streamingText = ""
  }

  if (flushed.length === 0) return state // no changes

  // Insert flushed blocks before any queued user blocks so that the
  // assistant's streaming content (which was produced during the turn)
  // appears chronologically before messages the user queued mid-turn.
  const firstQueuedIdx = state.blocks.findIndex(
    b => b.type === "user" && b.queued,
  )
  let blocks: Block[]
  if (firstQueuedIdx === -1) {
    blocks = [...state.blocks, ...flushed]
  } else {
    blocks = [
      ...state.blocks.slice(0, firstQueuedIdx),
      ...flushed,
      ...state.blocks.slice(firstQueuedIdx),
    ]
  }

  return { ...state, blocks, streamingThinking, streamingText }
}

export function reduce(
  state: ConversationState,
  event: AgentEvent,
): ConversationState {
  // Always record in event log (source of truth)
  const next: ConversationState = {
    ...state,
    eventLog: [...state.eventLog, event],
  }

  switch (event.type) {
    // ----- Session lifecycle -----

    case "session_init":
      return {
        ...next,
        sessionState: "IDLE",
        session: {
          tools: event.tools,
          models: event.models,
          account: event.account,
        },
      }

    // ----- Turn lifecycle -----

    case "turn_start":
      return {
        ...next,
        sessionState: "RUNNING",
        turnNumber: state.turnNumber + 1,
        streamingText: "",
        streamingThinking: "",
      }

    case "turn_complete": {
      // Guard: ignore if not in RUNNING or INTERRUPTING
      if (state.sessionState !== "RUNNING" && state.sessionState !== "INTERRUPTING") {
        return next
      }

      // Flush any remaining buffers as committed blocks
      const flushed = flushBuffers({ ...next })

      // Unqueue any queued user blocks
      const blocks = flushed.blocks.map(b =>
        b.type === "user" && b.queued ? { ...b, queued: undefined } : b
      )

      // Update cost totals
      const cost = { ...state.cost }
      if (event.usage) {
        cost.inputTokens += event.usage.inputTokens
        cost.outputTokens += event.usage.outputTokens
        cost.cacheReadTokens += event.usage.cacheReadTokens ?? 0
        cost.cacheWriteTokens += event.usage.cacheWriteTokens ?? 0
        cost.totalCostUsd += event.usage.totalCostUsd ?? 0
      }

      return {
        ...flushed,
        blocks,
        sessionState: "IDLE",
        streamingText: "",
        streamingThinking: "",
        pendingPermission: null,
        pendingElicitation: null,
        cost,
      }
    }

    // ----- User messages -----

    case "user_message": {
      // During active turns, show as queued
      if (
        state.sessionState === "RUNNING" ||
        state.sessionState === "WAITING_FOR_PERM" ||
        state.sessionState === "WAITING_FOR_ELIC" ||
        state.sessionState === "INTERRUPTING"
      ) {
        return {
          ...next,
          blocks: [...state.blocks, { type: "user", text: event.text, queued: true }],
        }
      }
      // IDLE: show immediately
      return {
        ...next,
        blocks: [...state.blocks, { type: "user", text: event.text }],
      }
    }

    case "interrupt":
      if (
        state.sessionState === "RUNNING" ||
        state.sessionState === "WAITING_FOR_PERM" ||
        state.sessionState === "WAITING_FOR_ELIC"
      ) {
        const flushed = flushBuffers({ ...next })
        return {
          ...flushed,
          sessionState: "INTERRUPTING",
          pendingPermission: null,
          pendingElicitation: null,
        }
      }
      return next

    // ----- Text streaming -----

    case "text_delta":
      return {
        ...next,
        streamingText: state.streamingText + event.text,
      }

    case "thinking_delta":
      return {
        ...next,
        streamingThinking: state.streamingThinking + event.text,
      }

    case "text_complete": {
      // Flush buffers with the finalized text — commits as an assistant block
      const withFinalText = { ...next, streamingText: event.text }
      return flushBuffers(withFinalText)
    }

    // ----- Tool lifecycle -----

    case "tool_use_start": {
      // CRITICAL: flush buffers FIRST so text/thinking appear before this tool
      const flushedState = flushBuffers({ ...next })
      return {
        ...flushedState,
        blocks: [...flushedState.blocks, {
          type: "tool" as const,
          id: event.id,
          tool: event.tool,
          input: event.input,
          status: "running" as ToolStatus,
          output: "",
          startTime: Date.now(),
        }],
      }
    }

    case "tool_use_progress":
      return {
        ...next,
        blocks: state.blocks.map(b =>
          b.type === "tool" && b.id === event.id
            ? { ...b, output: (b.output ?? "") + event.output }
            : b
        ),
      }

    case "tool_use_end":
      return {
        ...next,
        blocks: state.blocks.map(b =>
          b.type === "tool" && b.id === event.id
            ? {
                ...b,
                status: (event.error ? "error" : "done") as ToolStatus,
                output: event.output,
                error: event.error,
                duration: Date.now() - b.startTime,
              }
            : b
        ),
      }

    // ----- Permission flow -----

    case "permission_request":
      return {
        ...next,
        sessionState: "WAITING_FOR_PERM",
        pendingPermission: event,
      }

    case "permission_response":
      return {
        ...next,
        sessionState: "RUNNING",
        pendingPermission: null,
      }

    // ----- Elicitation flow -----

    case "elicitation_request":
      return {
        ...next,
        sessionState: "WAITING_FOR_ELIC",
        pendingElicitation: event,
      }

    case "elicitation_response":
      return {
        ...next,
        sessionState: "RUNNING",
        pendingElicitation: null,
      }

    // ----- Errors -----

    case "error": {
      const severity = event.severity ?? "fatal"
      if (severity === "fatal") {
        return {
          ...next,
          sessionState: "ERROR",
          lastError: event,
          blocks: [...state.blocks, { type: "error", code: event.code, message: event.message }],
        }
      }
      // Recoverable: stay in current state, just record
      return { ...next, lastError: event }
    }

    // ----- Cost tracking -----

    case "cost_update":
      return {
        ...next,
        cost: {
          inputTokens: state.cost.inputTokens + event.inputTokens,
          outputTokens: state.cost.outputTokens + event.outputTokens,
          cacheReadTokens:
            state.cost.cacheReadTokens + (event.cacheReadTokens ?? 0),
          cacheWriteTokens:
            state.cost.cacheWriteTokens + (event.cacheWriteTokens ?? 0),
          totalCostUsd: state.cost.totalCostUsd + (event.cost ?? 0),
        },
      }

    // ----- Tasks / subagents -----

    case "task_start": {
      const activeTasks = new Map(state.activeTasks)
      activeTasks.set(event.taskId, {
        taskId: event.taskId,
        description: event.description,
        output: "",
        status: "running",
        startTime: Date.now(),
      })
      return { ...next, activeTasks }
    }

    case "task_progress": {
      const activeTasks = new Map(state.activeTasks)
      const task = activeTasks.get(event.taskId)
      if (task) {
        activeTasks.set(event.taskId, { ...task, output: event.output })
      }
      return { ...next, activeTasks }
    }

    case "task_complete": {
      const activeTasks = new Map(state.activeTasks)
      const task = activeTasks.get(event.taskId)
      if (task) {
        activeTasks.set(event.taskId, {
          ...task,
          output: event.output,
          status: "completed",
        })
      }
      return { ...next, activeTasks }
    }

    // ----- Compact -----

    case "compact":
      return {
        ...next,
        blocks: [...state.blocks, { type: "compact", summary: event.summary }],
      }

    // ----- Model changed -----

    case "model_changed":
      return {
        ...next,
        currentModel: event.model,
      }

    // ----- System messages -----

    case "system_message":
      return {
        ...next,
        blocks: [...state.blocks, { type: "system", text: event.text }],
      }

    // ----- Informational / passthrough -----

    case "session_state":
    case "backend_specific":
      // Recorded in eventLog but don't change reducer state
      return next

    default:
      // Unknown event type: record but don't crash
      return next
  }
}
