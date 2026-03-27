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
import { useAgent } from "./agent"
import { useMessages } from "./messages"
import { useSession } from "./session"
import { usePermissions } from "./permissions"

export interface SyncContextValue {
  /** Manually push an event (for slash commands, synthetic events, etc.) */
  pushEvent: (event: AgentEvent) => void
  /** Start consuming the backend event stream */
  startEventLoop: () => void
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
      conversationState = reduce(conversationState, event)
    }

    batch(() => {
      messages.setState({
        messages: conversationState.messages,
        streamingText: conversationState.streamingText,
        streamingThinking: conversationState.streamingThinking,
        activeTools: Array.from(conversationState.activeTools.entries()),
        completedTools: conversationState.completedTools,
        pendingMessages: conversationState.pendingMessages,
        activeTasks: Array.from(conversationState.activeTasks.entries()),
      })

      session.setState({
        sessionState: conversationState.sessionState,
        session: conversationState.session,
        cost: { ...conversationState.cost },
        lastError: conversationState.lastError,
        turnNumber: conversationState.turnNumber,
      })

      permissions.setState({
        pendingPermission: conversationState.pendingPermission,
        pendingElicitation: conversationState.pendingElicitation,
      })
    })
  }

  // Create the batcher with applyEvents as the flush handler
  const batcher = new EventBatcher(applyEvents)

  const pushEvent = (event: AgentEvent) => {
    batcher.push(event)
  }

  // Start the backend and iterate its event generator
  const startEventLoop = async () => {
    if (aborted) return

    try {
      const generator = agent.config.resume
        ? agent.backend.resume(agent.config.resume)
        : agent.backend.start(agent.config)

      for await (const event of generator) {
        if (aborted) break
        batcher.push(event)

        // Fatal errors during init should flush immediately so the UI
        // reflects the error state without waiting for the batcher timer
        if (
          event.type === "error" &&
          event.severity === "fatal" &&
          conversationState.sessionState === "INITIALIZING"
        ) {
          batcher.flush()
        }
      }
    } catch (err) {
      if (!aborted) {
        batcher.push({
          type: "error",
          code: "stream_error",
          message: err instanceof Error ? err.message : String(err),
          severity: "fatal",
        })
      }
    }

    // Flush any remaining events
    batcher.flush()
  }

  onMount(() => {
    startEventLoop()

    // Send initial prompt from CLI flags (--prompt or positional arg)
    if (agent.config.initialPrompt) {
      const text = agent.config.initialPrompt
      setTimeout(() => {
        pushEvent({ type: "user_message", text })
        agent.backend.sendMessage({ text })
      }, 100)
    }
  })

  onCleanup(() => {
    aborted = true
    batcher.destroy()
    agent.backend.close()
  })

  return (
    <SyncContext.Provider value={{ pushEvent, startEventLoop }}>
      {props.children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error("useSync must be used within SyncProvider")
  return ctx
}
