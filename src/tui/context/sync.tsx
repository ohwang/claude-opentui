/**
 * Sync Context — Event stream → signal updates
 *
 * Owns the event loop:
 * 1. Starts the backend generator on mount
 * 2. Iterates events through the EventBatcher (16ms coalescing)
 * 3. Batcher flushes → reducer → batch update all SolidJS stores
 *
 * Pattern follows OpenCode's sdk.tsx.
 */

import {
  createContext,
  useContext,
  onMount,
  onCleanup,
  createEffect,
  batch,
  type ParentProps,
} from "solid-js"
import { reduce } from "../../protocol/reducer"
import {
  createInitialState,
  type AgentEvent,
  type ConversationState,
} from "../../protocol/types"
import { EventBatcher } from "../../utils/event-batcher"
import { log } from "../../utils/logger"
import { useAgent } from "./agent"
import { useMessages } from "./messages"
import { useSession } from "./session"
import { usePermissions } from "./permissions"

export interface SyncContextValue {
  /** Manually push an event (for slash commands, synthetic events, etc.) */
  pushEvent: (event: AgentEvent) => void
  /** Start consuming the backend event stream */
  startEventLoop: () => void
  /** Reset conversation state (messages, streaming, tools) while preserving session/cost */
  clearConversation: () => void
  /** Reset session cost counters to zero */
  resetCost: () => void
}

const SyncContext = createContext<SyncContextValue>()

export function SyncProvider(props: ParentProps) {
  const agent = useAgent()
  const messages = useMessages()
  const session = useSession()
  const permissions = usePermissions()

  // Reducer state (mutable, not reactive — stores are the reactive layer)
  let conversationState = createInitialState()
  let aborted = false

  // Apply a batch of events through the reducer, then update all stores
  const applyEvents = (events: AgentEvent[]) => {
    for (const event of events) {
      // Log lifecycle events at info, streaming deltas at debug
      if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "tool_use_progress") {
        log.debug(`Event: ${event.type}`)
      } else {
        log.info(`Event: ${event.type}`, event.type === "error" ? { code: event.code, message: event.message } : undefined)
      }
      conversationState = reduce(conversationState, event)
    }

    batch(() => {
      messages.setState({
        blocks: conversationState.blocks,
        streamingText: conversationState.streamingText,
        streamingThinking: conversationState.streamingThinking,
        activeTasks: Array.from(conversationState.activeTasks.entries()),
      })

      session.setState({
        sessionState: conversationState.sessionState,
        session: conversationState.session,
        cost: { ...conversationState.cost },
        lastError: conversationState.lastError,
        turnNumber: conversationState.turnNumber,
        lastTurnInputTokens: conversationState.lastTurnInputTokens,
        currentModel: conversationState.currentModel ?? "",
      })

      permissions.setState({
        pendingPermission: conversationState.pendingPermission,
        pendingElicitation: conversationState.pendingElicitation,
      })
    })
  }

  // Create the batcher with applyEvents as the flush handler
  const batcher = new EventBatcher(
    applyEvents,
    16,
    (error) => {
      log.error("Event processing error in batcher", { error: error.message })
    },
  )

  const pushEvent = (event: AgentEvent) => {
    batcher.push(event)
  }

  // Reset conversation state (messages, streaming, tools) while preserving session/cost
  const clearConversation = () => {
    // Flush any pending events first so we don't lose them
    batcher.flush()

    // Reset conversationState but preserve session metadata, cost, and session state
    conversationState = {
      ...createInitialState(),
      sessionState: conversationState.sessionState,
      session: conversationState.session,
      cost: { ...conversationState.cost },
      turnNumber: conversationState.turnNumber,
      currentModel: conversationState.currentModel,
    }

    // Clear the SolidJS stores to match
    batch(() => {
      messages.setState({
        blocks: [],
        streamingText: "",
        streamingThinking: "",
        activeTasks: [],
      })
    })
  }

  // Reset session cost counters to zero
  const resetCost = () => {
    const zeroCost = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: 0,
    }
    conversationState = {
      ...conversationState,
      cost: zeroCost,
    }
    batch(() => {
      session.setState({ cost: { ...zeroCost } })
    })
  }

  // Start the backend and iterate its event generator
  const startEventLoop = async () => {
    if (aborted) return

    const mode = agent.config.resume ? "resume" : "start"
    log.info(`Event loop starting (${mode})`, agent.config.resume ? { sessionId: agent.config.resume } : undefined)

    try {
      const generator = agent.config.resume
        ? agent.backend.resume(agent.config.resume)
        : agent.backend.start(agent.config)

      for await (const event of generator) {
        if (aborted) break
        try {
          batcher.push(event)
        } catch (e) {
          if (!aborted) log.warn("Failed to push event to batcher", { error: String(e) })
          break
        }
      }

      log.info("Event loop ended (generator exhausted)")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error("Event loop error", { error: message })
      if (!aborted) {
        batcher.push({
          type: "error",
          code: "stream_error",
          message,
          severity: "fatal",
        })
      }
    }

    // Flush any remaining events
    batcher.flush()
  }

  onMount(() => {
    startEventLoop()

    // Session initialization timeout — recover if session_init never arrives
    const initTimeout = setTimeout(() => {
      if (session.state.sessionState === "INITIALIZING") {
        log.error("Session initialization timed out after 30s")
        pushEvent({
          type: "error",
          code: "init_timeout",
          message: "Session initialization timed out. Check that your API key is valid and the backend is reachable.",
          severity: "fatal",
        })
      }
    }, 30_000)

    // Clear the timeout once we leave INITIALIZING
    createEffect(() => {
      if (session.state.sessionState !== "INITIALIZING") {
        clearTimeout(initTimeout)
      }
    })

    onCleanup(() => clearTimeout(initTimeout))

    // Send initial prompt after backend is ready (session_init received)
    if (agent.config.initialPrompt) {
      const text = agent.config.initialPrompt
      let sent = false
      createEffect(() => {
        if (!sent && session.state.sessionState === "IDLE") {
          sent = true
          pushEvent({ type: "user_message", text })
          agent.backend.sendMessage({ text })
        }
      })
    }
  })

  onCleanup(() => {
    log.info("SyncProvider cleanup")
    aborted = true
    batcher.destroy()
    agent.backend.close()
  })

  return (
    <SyncContext.Provider value={{ pushEvent, startEventLoop, clearConversation, resetCost }}>
      {props.children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error("useSync must be used within SyncProvider")
  return ctx
}
