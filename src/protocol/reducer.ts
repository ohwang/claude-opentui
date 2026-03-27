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
  ConversationState,
  Message,
  ActiveTool,
  ToolResult,
} from "./types"

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
        completedTools: [],
      }

    case "turn_complete": {
      // Ignore duplicate turn_complete
      if (state.sessionState !== "RUNNING" && state.sessionState !== "INTERRUPTING") {
        return next
      }

      // Finalize any accumulated streaming text into a message
      const newMessages = [...state.messages]
      const content: Message["content"] = []

      if (state.streamingThinking) {
        content.push({ type: "thinking", text: state.streamingThinking })
      }
      if (state.streamingText) {
        content.push({ type: "text", text: state.streamingText })
      }
      // Add completed tool results as message content
      for (const tool of state.completedTools) {
        content.push({
          type: "tool_use",
          id: tool.id,
          tool: tool.tool,
          input: tool.input,
        })
        content.push({
          type: "tool_result",
          id: tool.id,
          output: tool.output,
          error: tool.error,
        })
      }

      if (content.length > 0) {
        newMessages.push({
          role: "assistant",
          content,
          timestamp: Date.now(),
          turnNumber: state.turnNumber,
        })
      }

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
        ...next,
        sessionState: "IDLE",
        messages: newMessages,
        streamingText: "",
        streamingThinking: "",
        activeTools: new Map(),
        completedTools: [],
        pendingPermission: null,
        pendingElicitation: null,
        cost,
      }
    }

    // ----- User messages -----

    case "user_message": {
      const messages = [...state.messages]
      messages.push({
        role: "user",
        content: [{ type: "text", text: event.text }],
        timestamp: Date.now(),
        turnNumber: state.turnNumber,
      })
      return { ...next, messages }
    }

    case "interrupt":
      if (
        state.sessionState === "RUNNING" ||
        state.sessionState === "WAITING_FOR_PERM" ||
        state.sessionState === "WAITING_FOR_ELIC"
      ) {
        return { ...next, sessionState: "INTERRUPTING" }
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
      // Finalize accumulated text into a message
      const messages = [...state.messages]
      const content: Message["content"] = []

      if (state.streamingThinking) {
        content.push({ type: "thinking", text: state.streamingThinking })
      }
      content.push({ type: "text", text: event.text })

      messages.push({
        role: "assistant",
        content,
        timestamp: Date.now(),
        turnNumber: state.turnNumber,
      })

      return {
        ...next,
        messages,
        streamingText: "",
        streamingThinking: "",
      }
    }

    // ----- Tool lifecycle -----

    case "tool_use_start": {
      const activeTools = new Map(state.activeTools)
      activeTools.set(event.id, {
        id: event.id,
        tool: event.tool,
        input: event.input,
        output: "",
        startTime: Date.now(),
      })
      return { ...next, activeTools }
    }

    case "tool_use_progress": {
      const activeTools = new Map(state.activeTools)
      const tool = activeTools.get(event.id)
      if (tool) {
        activeTools.set(event.id, {
          ...tool,
          output: tool.output + event.output,
        })
      }
      return { ...next, activeTools }
    }

    case "tool_use_end": {
      const activeTools = new Map(state.activeTools)
      const tool = activeTools.get(event.id)
      const duration = tool ? Date.now() - tool.startTime : 0
      activeTools.delete(event.id)

      const result: ToolResult = {
        id: event.id,
        tool: tool?.tool ?? "unknown",
        input: tool?.input ?? {},
        output: event.output,
        error: event.error,
        duration,
      }

      return {
        ...next,
        activeTools,
        completedTools: [...state.completedTools, result],
      }
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

    case "compact": {
      const messages = [...state.messages]
      messages.push({
        role: "system",
        content: [{ type: "compact", summary: event.summary }],
        timestamp: Date.now(),
        turnNumber: state.turnNumber,
      })
      return { ...next, messages }
    }

    // ----- System messages -----

    case "system_message": {
      const messages = [...state.messages]
      messages.push({
        role: "system",
        content: [{ type: "text", text: event.text }],
        timestamp: Date.now(),
        turnNumber: state.turnNumber,
      })
      return { ...next, messages }
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
