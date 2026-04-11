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
import { reconcile } from "solid-js/store"
import { reduce } from "../../protocol/reducer"
import {
  createInitialState,
  type AgentEvent,
} from "../../protocol/types"
import { EventBatcher } from "../../utils/event-batcher"
import { log } from "../../utils/logger"
import { useAgent } from "./agent"
import { useMessages } from "./messages"
import { useSession } from "./session"
import { usePermissions } from "./permissions"
import { readSessionHistory, findMostRecentSession } from "../../backends/claude/session-reader"
import { setConversationState, getSubagentManagerBridge } from "../../mcp/state-bridge"
import {
  detectSessionOrigin,
  readForeignSession,
  formatHistoryAsContext,
} from "../../session/cross-backend"

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

export const SyncContext = createContext<SyncContextValue>()

export function SyncProvider(props: ParentProps) {
  const agent = useAgent()
  const messages = useMessages()
  const session = useSession()
  const permissions = usePermissions()

  // Reducer state (mutable, not reactive — stores are the reactive layer)
  let conversationState = createInitialState()
  let aborted = false
  let initTimeoutId: ReturnType<typeof setTimeout> | null = null
  let firstMessageSent = false

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
    setConversationState(conversationState)

    batch(() => {
      // Use reconcile() for arrays/objects so unchanged items keep stable
      // proxy references. This lets <For> efficiently track identity and
      // prevents mass element recreation on every event batch.
      // Matches OpenCode's reconcile() + produce() update pattern.
      messages.setState("blocks", reconcile(conversationState.blocks))
      messages.setState("streamingText", conversationState.streamingText)
      messages.setState("streamingThinking", conversationState.streamingThinking)
      messages.setState("activeTasks", reconcile(Array.from(conversationState.activeTasks.entries())))
      messages.setState("backgrounded", conversationState.backgrounded)
      messages.setState("streamingOutputTokens", conversationState.streamingOutputTokens)
      messages.setState("lastTurnFiles", reconcile(conversationState.lastTurnFiles ?? undefined as any))

      session.setState("sessionState", conversationState.sessionState)
      session.setState("session", reconcile(conversationState.session))
      session.setState("cost", reconcile(conversationState.cost))
      session.setState("lastError", reconcile(conversationState.lastError))
      session.setState("turnNumber", conversationState.turnNumber)
      session.setState("lastTurnInputTokens", conversationState.lastTurnInputTokens)
      session.setState("currentModel", conversationState.currentModel ?? "")
      session.setState("currentEffort", conversationState.currentEffort ?? "")
      session.setState("rateLimits", reconcile(conversationState.rateLimits))
      session.setState("agentCommands", reconcile(conversationState.agentCommands))
      session.setState("configOptions", reconcile(conversationState.configOptions))

      permissions.setState("pendingPermission", reconcile(conversationState.pendingPermission))
      permissions.setState("pendingElicitation", reconcile(conversationState.pendingElicitation))
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
    // Start init timeout on first user message, not on mount.
    // With the query() API, session_init doesn't arrive until the first message is sent,
    // so starting the timeout earlier would cause false positives.
    if (!firstMessageSent && event.type === "user_message") {
      firstMessageSent = true
      if (session.state.sessionState === "INITIALIZING") {
        log.info("First user message sent — starting 30s init timeout")
        initTimeoutId = setTimeout(() => {
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
      }
    }
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
      currentModel: conversationState.currentModel,
      currentEffort: conversationState.currentEffort,
    }

    // Clear the SolidJS stores to match
    batch(() => {
      messages.setState("blocks", reconcile([]))
      messages.setState("streamingText", "")
      messages.setState("streamingThinking", "")
      messages.setState("activeTasks", reconcile([]))
      messages.setState("backgrounded", false)
      messages.setState("streamingOutputTokens", 0)
      messages.setState("lastTurnFiles", undefined)
      session.setState("lastTurnInputTokens", 0)
      session.setState("turnNumber", 0)
      session.setState("rateLimits", null)
    })
  }

  // Reset session cost counters to zero (also resets context fill + turn number)
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
      lastTurnInputTokens: 0,
      _contextFromStream: false,
      turnNumber: 0,
    }
    batch(() => {
      session.setState("cost", reconcile(zeroCost))
      session.setState("lastTurnInputTokens", 0)
      session.setState("turnNumber", 0)
    })
  }

  // Start the backend and iterate its event generator
  const startEventLoop = async () => {
    if (aborted) return

    const mode = agent.config.resume ? "resume" : agent.config.continue ? "continue" : "start"
    log.info(`Event loop starting (${mode})`, agent.config.resume ? { sessionId: agent.config.resume } : undefined)

    // Validate that the backend supports the requested mode.
    // Skip for cross-backend resume — it uses start() with context injection, not native resume.
    const caps = agent.backend.capabilities()
    const isCrossBackendResume = agent.config.resume && agent.config._crossBackendActive
    if (agent.config.resume && !caps.supportsResume && !isCrossBackendResume) {
      batcher.push({
        type: "error",
        code: "unsupported_resume",
        message: `The ${caps.name} backend does not support --resume.`,
        severity: "fatal",
      })
      batcher.flush()
      return
    }
    if (agent.config.continue && !caps.supportsContinue) {
      batcher.push({
        type: "error",
        code: "unsupported_continue",
        message: `The ${caps.name} backend does not support --continue.`,
        severity: "fatal",
      })
      batcher.flush()
      return
    }

    try {
      // Always use start() — it handles resume/continue via config.resume
      // and config.continue in buildOptions() and createMessageIterable().
      // The separate resume() method creates a bare config missing cwd,
      // permissionMode, etc., which causes the SDK subprocess to fail.
      const generator = agent.backend.start(agent.config)

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
    // Wire SubagentManager's pushEvent so subagent events flow into the main stream
    const mgr = getSubagentManagerBridge()
    if (mgr) {
      mgr.setPushEvent(pushEvent)
    }

    // Pre-populate conversation history for resume/continue.
    // For same-backend Claude resume: read JSONL history directly (SDK loads context
    // but doesn't replay messages). For cross-backend resume (any target): detect
    // session origin, read foreign history, and inject as context into the target backend.
    const backendName = agent.backend.capabilities().name
    const resumeId = agent.config.resume
    const continueMode = agent.config.continue
    if ((resumeId || continueMode) && agent.config.cwd) {
      const sessionId = resumeId || findMostRecentSession(agent.config.cwd)
      if (sessionId) {
        // Detect cross-backend resume: session origin differs from target backend
        const origin = detectSessionOrigin(sessionId, agent.config.cwd)
        const targetBackend = agent.config.sessionOrigin
        const isCrossBackend = origin !== null && targetBackend !== undefined && origin !== targetBackend

        let historyBlocks: import("../../protocol/types").Block[]
        if (isCrossBackend && origin) {
          // Cross-backend: read from the foreign backend's storage
          historyBlocks = readForeignSession(sessionId, origin, agent.config.cwd)
          log.info("Cross-backend resume detected", {
            origin,
            targetBackend: agent.config.sessionOrigin,
            blocks: historyBlocks.length,
          })

          if (historyBlocks.length > 0) {
            // Format history as context text for the target backend
            const { contextText, toolCallCount, warningCount } = formatHistoryAsContext(historyBlocks)

            // Inject a system message informing the user about the cross-backend transition
            const infoBlock: import("../../protocol/types").Block = {
              type: "system",
              text: `Resuming ${origin} session in ${agent.config.sessionOrigin} backend`,
            }
            historyBlocks = [infoBlock, ...historyBlocks]

            if (toolCallCount > 0) {
              historyBlocks.push({
                type: "system",
                text: `${toolCallCount} tool call(s) from the original session are shown for context but may not be available in the target backend`,
                ephemeral: true,
              })
            }
            if (warningCount > 0) {
              historyBlocks.push({
                type: "system",
                text: `${warningCount} block(s) could not be fully converted`,
                ephemeral: true,
              })
            }

            // Store the context text so the first user message can include it.
            // We prepend it as the initial prompt so the new backend has full context.
            if (!agent.config.initialPrompt) {
              agent.config.initialPrompt =
                "I'm continuing a previous conversation. Here's the context from our prior session:\n\n" +
                contextText +
                "\n\nPlease acknowledge that you have this context and are ready to continue."
            } else {
              // User provided their own initial prompt — prepend context
              agent.config.initialPrompt =
                "I'm continuing a previous conversation. Here's the context from our prior session:\n\n" +
                contextText +
                "\n\n---\n\n" +
                agent.config.initialPrompt
            }

            // Clear config.resume so the target backend uses start() instead of
            // native resume(). Set _crossBackendActive so the supportsResume
            // check in startEventLoop is skipped.
            agent.config._crossBackendActive = true
            agent.config.resume = undefined
          }
        } else if (backendName === "claude") {
          // Same-backend Claude resume: read JSONL directly (SDK loads context
          // but doesn't replay messages). Other backends handle replay server-side.
          historyBlocks = readSessionHistory(sessionId, agent.config.cwd)
        } else {
          historyBlocks = []
        }

        if (historyBlocks.length > 0) {
          conversationState = {
            ...conversationState,
            blocks: historyBlocks,
          }
          batch(() => {
            messages.setState("blocks", reconcile(historyBlocks))
          })
        }
      }
    }

    startEventLoop()

    // Clear the init timeout once we leave INITIALIZING
    createEffect(() => {
      if (session.state.sessionState !== "INITIALIZING" && initTimeoutId !== null) {
        clearTimeout(initTimeoutId)
        initTimeoutId = null
      }
    })

    onCleanup(() => {
      if (initTimeoutId !== null) clearTimeout(initTimeoutId)
    })

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
    // Nullify SubagentManager's pushEvent to prevent events into a destroyed tree
    const mgr = getSubagentManagerBridge()
    if (mgr) {
      mgr.setPushEvent(() => {})
    }
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
