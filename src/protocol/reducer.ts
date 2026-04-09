/**
 * Event-sourced ConversationState reducer.
 *
 * The TUI renders from ConversationState, never raw events.
 * State is reconstructable by replaying events through reduce().
 *
 * Note: eventLog is maintained by the caller, not the reducer.
 * The reducer does not copy events into eventLog to avoid O(n²) allocations.
 */

import type {
  AgentEvent,
  Block,
  ConversationState,
  ToolStatus,
  TurnFileChange,
} from "./types"
import { log } from "../utils/logger"

/** Strip SDK image placeholders that native Claude Code doesn't display */
function stripImagePlaceholders(text: string): string {
  return text
    .replace(/\[Image(?:\s*#?\s*\d+)?\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Strip raw XML tags emitted by the SDK for local command output (e.g. /compact responses) */
function stripSDKXmlTags(text: string): string {
  return text.replace(/<\/?local-command-\w+>/g, "")
}

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
    flushed.push({ type: "assistant", text: stripImagePlaceholders(stripSDKXmlTags(streamingText)), timestamp: Date.now(), model: state.currentModel ?? undefined })
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
  // eventLog maintained by caller if needed; not copied per-event to avoid
  // O(n²) allocation during streaming (eventLog was never consumed by TUI).
  const next: ConversationState = {
    ...state,
    eventLog: state.eventLog,
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
          sessionId: event.sessionId,
        },
        currentModel: event.models?.[0]?.name ?? next.currentModel,
      }

    // ----- Turn lifecycle -----

    case "turn_start": {
      // Guard: allow from IDLE, INITIALIZING, or RUNNING+awaitingTurnStart.
      // The last case handles user_message transitioning to RUNNING before
      // the SDK's turn_start arrives — we still need to increment the turn
      // number and reset buffers. Genuine duplicate turn_starts mid-stream
      // (RUNNING without awaitingTurnStart) are ignored.
      if (
        state.sessionState !== "IDLE" &&
        state.sessionState !== "INITIALIZING" &&
        !(state.sessionState === "RUNNING" && state.awaitingTurnStart)
      ) {
        return next
      }
      return {
        ...next,
        sessionState: "RUNNING",
        awaitingTurnStart: false,
        turnNumber: state.turnNumber + 1,
        streamingText: "",
        streamingThinking: "",
        streamingOutputTokens: 0,
        _contextFromStream: false,
      }
    }

    case "turn_complete": {
      // Guard: ignore if not in RUNNING, INTERRUPTING, or ERROR
      // ERROR is accepted so that a turn_complete after a fatal error can recover to IDLE
      if (state.sessionState !== "RUNNING" && state.sessionState !== "INTERRUPTING" && state.sessionState !== "ERROR") {
        return next
      }

      // Flush any remaining buffers as committed blocks
      const flushed = flushBuffers({ ...next })

      // Unqueue any queued user blocks AND close any running tool blocks
      // (SDK doesn't emit explicit tool_use_end — tools finish internally)
      const blocks = flushed.blocks.map(b =>
        b.type === "user" && b.queued ? { ...b, queued: undefined } : b
      ).map(b =>
        b.type === "tool" && b.status === "running"
          ? { ...b, status: "done" as ToolStatus, duration: Date.now() - b.startTime }
          : b
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

      // Prune completed tasks from activeTasks
      const prunedTasks = new Map(state.activeTasks)
      for (const [id, task] of prunedTasks) {
        if (task.status === "completed") {
          prunedTasks.delete(id)
        }
      }

      // Extract file changes from this turn's tool blocks
      const turnFiles: TurnFileChange[] = []
      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i]
        if (block === undefined) continue
        if (block.type === "user") break // Hit previous user message = end of turn
        if (block.type === "tool" && block.status === "done") {
          const input = block.input as Record<string, unknown> | null
          const filePath = input?.file_path as string | undefined
          if (filePath) {
            const action: TurnFileChange["action"] =
              block.tool === "Write" ? "create"
              : block.tool === "Edit" ? "edit"
              : "read"
            turnFiles.push({ path: filePath, action, tool: block.tool })
          }
        }
      }

      // Merge sessionId from turn_complete into the existing session if present,
      // but never clear a sessionId that was already set by session_init.
      // Priority: existing session preserved; turn_complete's sessionId overlays only if provided.
      const updatedSession = flushed.session
        ? event.sessionId
          ? { ...flushed.session, sessionId: event.sessionId }
          : flushed.session
        : event.sessionId
          ? { tools: [], models: [], sessionId: event.sessionId }
          : null

      return {
        ...flushed,
        blocks,
        sessionState: "IDLE",
        streamingText: "",
        streamingThinking: "",
        pendingPermission: null,
        pendingElicitation: null,
        cost,
        streamingOutputTokens: 0,
        backgrounded: false,
        awaitingTurnStart: false,
        activeTasks: prunedTasks,
        session: updatedSession,
        // Context window fill: prefer per-API-call value from cost_update.contextTokens
        // (set by message_start during streaming) over the cumulative turn usage.
        // The result.usage sums ALL API calls in a multi-step agentic turn,
        // overcounting by num_turns×. Fall back to turn usage for backends
        // (Codex, Gemini) that don't emit per-API-call context tokens.
        lastTurnInputTokens: state._contextFromStream
          ? state.lastTurnInputTokens
          : event.usage && (event.usage.inputTokens > 0 || (event.usage.cacheReadTokens ?? 0) > 0)
            ? (event.usage.inputTokens + (event.usage.cacheReadTokens ?? 0) + (event.usage.cacheWriteTokens ?? 0))
            : state.lastTurnInputTokens,
        _contextFromStream: false,
        lastTurnFiles: turnFiles.length > 0 ? turnFiles : undefined,
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
          blocks: [...state.blocks, { type: "user", text: event.text, queued: true, images: event.images }],
        }
      }
      // ERROR state: auto-recover by clearing error and showing message
      if (state.sessionState === "ERROR") {
        return {
          ...next,
          sessionState: "IDLE",
          lastError: null,
          blocks: [...state.blocks, { type: "user", text: event.text, images: event.images }],
        }
      }
      // IDLE: show immediately + transition to RUNNING so the spinner
      // appears as soon as the user sends a message (before turn_start
      // arrives from the SDK). awaitingTurnStart allows the SDK's
      // turn_start to still process (increment turn, reset buffers).
      return {
        ...next,
        sessionState: "RUNNING",
        awaitingTurnStart: true,
        blocks: [...state.blocks, { type: "user", text: event.text, images: event.images }],
        streamingText: "",
        streamingThinking: "",
        streamingOutputTokens: 0,
      }
    }

    case "interrupt":
      if (
        state.sessionState === "RUNNING" ||
        state.sessionState === "WAITING_FOR_PERM" ||
        state.sessionState === "WAITING_FOR_ELIC"
      ) {
        const flushed = flushBuffers({ ...next })
        // Transition running tools to "canceled" on interrupt
        const blocks = flushed.blocks.map(b =>
          b.type === "tool" && b.status === "running"
            ? { ...b, status: "canceled" as ToolStatus, duration: Date.now() - b.startTime }
            : b
        )
        return {
          ...flushed,
          blocks,
          sessionState: "INTERRUPTING",
          pendingPermission: null,
          pendingElicitation: null,
          backgrounded: false,
        }
      }
      return next

    // ----- Shutdown -----

    case "shutdown": {
      const flushed = flushBuffers({ ...next })
      // Cancel any running tools
      const blocks = flushed.blocks.map(b =>
        b.type === "tool" && b.status === "running"
          ? { ...b, status: "canceled" as ToolStatus, duration: Date.now() - b.startTime }
          : b
      )
      return {
        ...flushed,
        blocks,
        sessionState: "SHUTTING_DOWN",
        pendingPermission: null,
        pendingElicitation: null,
      }
    }

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
      const withFinalText = { ...next, streamingText: stripImagePlaceholders(stripSDKXmlTags(event.text)) }
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
            ? {
                ...b,
                output: (b.output ?? "") + event.output,
                ...(event.input !== undefined ? { input: event.input } : {}),
              }
            : b
        ),
      }

    case "tool_use_end": {
      let targetId = event.id

      // Sentinel: adapter couldn't determine tool_use_id — match the last running tool
      if (targetId === "__last_running__") {
        for (let i = state.blocks.length - 1; i >= 0; i--) {
          const b = state.blocks[i]
          if (b !== undefined && b.type === "tool" && b.status === "running") {
            targetId = b.id
            break
          }
        }
      }

      return {
        ...next,
        blocks: state.blocks.map(b =>
          b.type === "tool" && b.id === targetId
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
    }

    // ----- Permission flow -----

    case "permission_request": {
      // Guard: only transition from RUNNING (permission requests arrive during tool execution)
      if (state.sessionState !== "RUNNING") {
        return next
      }
      // Update the tool block's input with the full input from canUseTool
      const blocks = state.blocks.map(b =>
        b.type === "tool" && b.id === event.id
          ? { ...b, input: event.input }
          : b
      )
      return {
        ...next,
        blocks,
        sessionState: "WAITING_FOR_PERM",
        pendingPermission: event,
      }
    }

    case "permission_response": {
      // Guard: only transition from WAITING_FOR_PERM
      if (state.sessionState !== "WAITING_FOR_PERM") {
        return next
      }
      return {
        ...next,
        sessionState: "RUNNING",
        pendingPermission: null,
      }
    }

    // ----- Elicitation flow -----

    case "elicitation_request": {
      // Guard: only transition from RUNNING (elicitations arrive during tool execution)
      if (state.sessionState !== "RUNNING") {
        return next
      }
      return {
        ...next,
        sessionState: "WAITING_FOR_ELIC",
        pendingElicitation: event,
      }
    }

    case "elicitation_response": {
      // Guard: only transition from WAITING_FOR_ELIC
      if (state.sessionState !== "WAITING_FOR_ELIC") {
        return next
      }
      return {
        ...next,
        sessionState: "RUNNING",
        pendingElicitation: null,
      }
    }

    // ----- Errors -----

    case "error": {
      const severity = event.severity ?? "fatal"

      // During interrupt, errors are expected artifacts (SDK in-flight operations failing).
      // Don't show them to the user — the "Interrupted" system message already displayed.
      if (state.sessionState === "INTERRUPTING") {
        log.info("Suppressing error during interrupt", { code: event.code, message: event.message?.slice(0, 100) })
        return { ...next, lastError: event }
      }

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
      // Authoritative cost is handled by turn_complete usage to prevent
      // double-counting. But we track streaming output tokens separately
      // for real-time display in the spinner.
      // Per-API-call context fill from message_start is more accurate than
      // the cumulative turn_complete usage for multi-step agentic turns.
      return {
        ...next,
        streamingOutputTokens: state.streamingOutputTokens + (event.outputTokens ?? 0),
        ...(event.contextTokens !== undefined && event.contextTokens > 0
          ? { lastTurnInputTokens: event.contextTokens, _contextFromStream: true }
          : {}),
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
        toolUseId: event.toolUseId,
        taskType: event.taskType,
      })
      return { ...next, activeTasks }
    }

    case "task_progress": {
      const activeTasks = new Map(state.activeTasks)
      const task = activeTasks.get(event.taskId)
      if (task) {
        activeTasks.set(event.taskId, {
          ...task,
          output: event.output,
          lastToolName: event.lastToolName ?? task.lastToolName,
          summary: event.summary ?? task.summary,
        })
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
        blocks: [...state.blocks, { type: "compact", summary: stripSDKXmlTags(event.summary) }],
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
        blocks: [...state.blocks, {
          type: "system",
          text: event.text,
          ...(event.ephemeral ? { ephemeral: true } : {}),
        }],
      }

    // ----- Shell commands -----

    case "shell_start": {
      return {
        ...next,
        blocks: [...state.blocks, {
          type: "shell" as const,
          id: event.id,
          command: event.command,
          output: "",
          status: "running" as const,
          startTime: Date.now(),
        }],
      }
    }

    case "shell_end": {
      return {
        ...next,
        blocks: state.blocks.map(b =>
          b.type === "shell" && b.id === event.id
            ? {
                ...b,
                status: event.error ? "error" as const : "done" as const,
                output: event.output,
                error: event.error,
                exitCode: event.exitCode,
                duration: Date.now() - b.startTime,
              }
            : b
        ),
      }
    }

    // ----- Task backgrounding -----

    case "task_background":
      // Only allow backgrounding during RUNNING state
      if (state.sessionState !== "RUNNING") return next
      return { ...next, backgrounded: true }

    case "task_foreground":
      // Only allow foregrounding when backgrounded
      if (!state.backgrounded) return next
      return { ...next, backgrounded: false }

    // ----- Informational / passthrough -----

    case "session_state":
      return next

    case "backend_specific": {
      // Extract rate limit data from claude backend rate_limit_event
      const data = event.data as Record<string, unknown> | null
      if (data && (data as { type?: string }).type === "rate_limit_event") {
        const info = (data as { rate_limit_info?: Record<string, unknown> }).rate_limit_info
        if (info && typeof info.rateLimitType === "string") {
          // utilization comes as 0-1 from SDK when available
          // surpassedThreshold is a fallback hint (e.g., 0.8 means 80% threshold crossed)
          // status "allowed_warning" means approaching limit, "rejected" means at limit
          let usedPct: number | undefined
          if (typeof info.utilization === "number") {
            usedPct = info.utilization * 100
          } else if (typeof info.surpassedThreshold === "number") {
            usedPct = info.surpassedThreshold * 100
          } else if (info.status === "rejected") {
            usedPct = 100
          } else if (info.status === "allowed_warning") {
            usedPct = 80 // conservative estimate
          }

          if (usedPct !== undefined) {
            const entry: import("./types").RateLimitEntry = {
              usedPercentage: usedPct,
              resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : undefined,
              windowDurationMins: typeof info.windowDurationMins === "number" ? info.windowDurationMins : undefined,
            }
            const rl = next.rateLimits ? { ...next.rateLimits } : {}
            if (info.rateLimitType === "five_hour") {
              rl.fiveHour = entry
            } else if (info.rateLimitType === "seven_day" || info.rateLimitType === "seven_day_opus" || info.rateLimitType === "seven_day_sonnet") {
              rl.sevenDay = entry
            } else if (info.rateLimitType === "primary") {
              rl.primary = entry
            } else if (info.rateLimitType === "secondary") {
              rl.secondary = entry
            }
            next.rateLimits = rl
          }
        }
      }
      return next
    }

    default:
      // Unknown event type: record but don't crash
      return next
  }
}
