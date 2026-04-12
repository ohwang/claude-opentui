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
  type ConversationEvent,
} from "../../protocol/types"
import { EventBatcher } from "../../utils/event-batcher"
import { log } from "../../utils/logger"
import { useAgent } from "./agent"
import { useMessages } from "./messages"
import { useSession } from "./session"
import { usePermissions } from "./permissions"
import { readSessionHistory, findMostRecentSession, getSessionFilePath } from "../../backends/claude/session-reader"
import { setConversationState, getSubagentManagerBridge } from "../../mcp/state-bridge"
import {
  detectSessionOrigin,
  findCodexSessionFile,
  findGeminiSessionFile,
  formatFullHistory,
  parseCodexSessionWithSummary,
  parseGeminiSessionWithSummary,
} from "../../session/cross-backend"
import type { ParsedSession } from "../../protocol/types"

export interface SyncContextValue {
  /** Manually push an event (for slash commands, synthetic events, etc.) */
  pushEvent: (event: ConversationEvent) => void
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
  const applyEvents = (events: ConversationEvent[]) => {
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

  const pushEvent = (event: ConversationEvent) => {
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

    // Resume/continue support is validated by each adapter inside runSession().
    // We don't pre-flight via capabilities() here because ACP-based backends only
    // learn their agent capabilities after the initialize handshake — a pre-flight
    // check would falsely block same-backend resume for gemini/copilot/acp.
    // Adapters emit a fatal `unsupported_resume`/`unsupported_continue` error if
    // the requested mode isn't supported once the handshake completes.

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
    //
    // Unified flow across all backends (Claude / Codex / Gemini):
    //   1. Detect the session's origin backend from its on-disk location.
    //   2. Parse the native session file into { blocks, summary }.
    //   3. Seed conversationState.blocks *before* starting the event loop.
    //   4. Emit history_load_started → history_loaded (or history_load_failed)
    //      so the UI shows a spinner, then appends a resume summary and
    //      scrolls to the bottom.
    //
    // For cross-backend resume (origin !== target), the parsed blocks are
    // rendered as-is AND a formatted-text version is injected as the initial
    // prompt so the target backend actually has the history in-context.
    //
    // Special case: for native-replay backends (Gemini) the history_loaded
    // event is emitted by the adapter after it finishes draining the
    // backend's replay stream — not here.
    const backendName = agent.backend.capabilities().name
    const resumeId = agent.config.resume
    const continueMode = agent.config.continue
    if ((resumeId || continueMode) && agent.config.cwd) {
      const cwd = agent.config.cwd
      const sessionId = resumeId || findMostRecentSession(cwd)
      if (sessionId) {
        const origin = detectSessionOrigin(sessionId, cwd)
        const target = agent.config.sessionOrigin ?? backendName
        const isCrossBackend = origin !== null && origin !== target

        // Resolve the file path we'll be reading, purely for telemetry and
        // error surfacing. Null means the origin couldn't be detected.
        let filePath: string | null = null
        if (origin === "claude") {
          filePath = getSessionFilePath(sessionId, cwd)
        } else if (origin === "codex") {
          filePath = findCodexSessionFile(sessionId)
        } else if (origin === "gemini") {
          filePath = findGeminiSessionFile(sessionId)
        }

        // Signal resume-in-progress so the UI can show a spinner and block input.
        pushEvent({
          type: "history_load_started",
          sessionId,
          filePath: filePath ?? "(unknown)",
          origin: origin ?? "unknown",
        })

        try {
          let parsed: ParsedSession
          if (origin === "claude") {
            parsed = readSessionHistory(sessionId, cwd)
          } else if (origin === "codex" && filePath) {
            parsed = parseCodexSessionWithSummary(filePath)
          } else if (origin === "gemini" && filePath) {
            parsed = parseGeminiSessionWithSummary(filePath)
          } else {
            throw new Error(
              origin === null
                ? `Session "${sessionId}" could not be located in any known backend's storage.`
                : `Session file for origin "${origin}" was not found.`,
            )
          }

          const { blocks, summary } = parsed
          // Parser always stamps target=origin; the sync layer overrides it
          // to reflect which backend is actually rendering the resume.
          summary.target = target

          if (isCrossBackend && origin) {
            // Cross-backend: also format the history as an injected prompt so
            // the target backend has the full conversation in its context
            // window. The rendered blocks above are the user-visible copy;
            // the prompt is the model-visible copy.
            const { contextText, toolCallCount } = formatFullHistory(blocks, origin)
            if (toolCallCount > 0) {
              summary.crossBackendCaveat = `${toolCallCount} tool call(s) from the original session are shown for context but may not be available in ${target}`
            }

            agent.config.initialPrompt = agent.config.initialPrompt
              ? contextText + "\n\n---\n\n" + agent.config.initialPrompt
              : contextText

            // Clear config.resume so the target backend uses start() with
            // the injected context instead of a native resume of a session
            // ID that doesn't belong to its storage.
            agent.config.resume = undefined
          }

          // Seed blocks synchronously so they're visible before the backend
          // session spins up. Matches the pre-existing Claude-resume fast path.
          if (blocks.length > 0) {
            conversationState = { ...conversationState, blocks: [...blocks] }
            batch(() => {
              messages.setState("blocks", reconcile([...blocks]))
            })
          }

          // Emit history_loaded now for backends that don't stream a replay
          // stream of their own (Claude and Codex both silently load context
          // inside the backend — we already have the full history on disk).
          //
          // For Gemini same-backend, AcpAdapter emits history_loaded itself
          // after it finishes draining the backend's replay window. Stash
          // the parsed summary on config so the adapter knows what to emit.
          const emitNow = isCrossBackend || target !== "gemini"
          if (emitNow) {
            pushEvent({
              type: "history_loaded",
              sessionId: summary.sessionId,
              origin: summary.origin,
              target: summary.target,
              summary,
            })
          } else {
            agent.config._pendingResumeSummary = summary
          }

          log.info("Resume history loaded", {
            sessionId,
            origin,
            target,
            blocks: blocks.length,
            crossBackend: isCrossBackend,
            emittedNow: emitNow,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const stack = err instanceof Error ? err.stack : undefined
          log.error("Failed to load session history", {
            sessionId,
            filePath,
            origin,
            error: message,
          })
          pushEvent({
            type: "history_load_failed",
            sessionId,
            filePath: filePath ?? undefined,
            origin: origin ?? undefined,
            error: message,
            details: stack,
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
