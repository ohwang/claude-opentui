/**
 * A/B Session Runner — drive one adapter to completion in its own worktree.
 *
 * Given a Target (backend id + optional model) and a prompt, this instantiates
 * the backend, pipes its event stream into a `SessionStats` accumulator, and
 * resolves once the backend goes IDLE after the prompt completes. The
 * orchestrator runs two of these in parallel.
 *
 * Why not reuse the main SyncProvider?
 *   - The main provider is tied to AppContext and the visible conversation.
 *   - A/B sessions need independent state (separate blocks, cost, stats) and
 *     separate lifecycle control (interrupt just one side).
 *   - The adapter interface is sufficient on its own — we don't need the
 *     full reducer for the comparison view, which wants aggregate stats
 *     rather than a blow-by-blow block list.
 */

import type { BackendId } from "../protocol/registry"
import { instantiateBackend } from "../protocol/registry"
import type {
  AgentBackend,
  ConversationEvent,
  SessionConfig,
} from "../protocol/types"
import { log } from "../utils/logger"
import type { Label, SessionStats, Target } from "./types"

export interface SessionRunnerOptions {
  label: Label
  target: Target
  prompt: string
  /** Working directory the backend should run in (i.e. the worktree path). */
  cwd: string
  /** Pre-seeded additional directories the backend may read (rare). */
  additionalDirectories?: string[]
  /** Callback fired whenever stats change — at most one call per event. */
  onUpdate: (stats: SessionStats) => void
  /** Optional callback invoked when the session hits a fatal error. */
  onError?: (err: Error) => void
}

export interface SessionHandle {
  readonly label: Label
  readonly stats: SessionStats
  readonly backend: AgentBackend
  /** Resolves once the session completes (cleanly, by interrupt, or by error). */
  readonly done: Promise<SessionStats>
  /** Ask the backend to interrupt the current turn. */
  interrupt: () => void
  /** Tear the backend down (called by the orchestrator on cleanup). */
  close: () => void
}

/**
 * Start an A/B session. Returns a handle immediately; the backend is already
 * running in the background. The handle's `done` promise resolves when the
 * session reports complete.
 */
export function runSession(opts: SessionRunnerOptions): SessionHandle {
  const now = Date.now()
  const stats: SessionStats = {
    label: opts.label,
    backendId: opts.target.backendId,
    model: opts.target.model,
    output: "",
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
    toolUseCount: 0,
    startTime: now,
    filesTouched: [],
    complete: false,
    interrupted: false,
  }

  let backend: AgentBackend
  try {
    backend = instantiateBackend(opts.target.backendId as BackendId)
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    stats.error = e.message
    stats.complete = true
    stats.endTime = Date.now()
    opts.onUpdate({ ...stats })
    opts.onError?.(e)
    return {
      label: opts.label,
      stats,
      // Dummy backend so the caller's interface stays uniform.
      backend: {
        close: () => {},
        interrupt: () => {},
      } as AgentBackend,
      done: Promise.resolve(stats),
      interrupt: () => {},
      close: () => {},
    }
  }

  const config: SessionConfig = {
    model: opts.target.model,
    cwd: opts.cwd,
    initialPrompt: opts.prompt,
    additionalDirectories: opts.additionalDirectories,
    // A/B comparisons should not auto-persist — we clean up the worktree
    // after adoption. Backends that ignore this flag still work.
    persistSession: false,
  }

  log.info("A/B session starting", {
    label: opts.label,
    backend: opts.target.backendId,
    model: opts.target.model,
    cwd: opts.cwd,
  })

  let resolveDone!: (stats: SessionStats) => void
  const done = new Promise<SessionStats>((r) => {
    resolveDone = r
  })

  let sawIdle = false
  let finishTimer: ReturnType<typeof setTimeout> | null = null
  let ended = false
  let promptSent = false

  const finish = (reason: string) => {
    if (ended) return
    ended = true
    if (finishTimer) {
      clearTimeout(finishTimer)
      finishTimer = null
    }
    stats.complete = true
    stats.endTime = Date.now()
    log.info("A/B session finished", { label: opts.label, reason })
    opts.onUpdate({ ...stats })
    resolveDone({ ...stats })
  }

  // Consume the event generator
  ;(async () => {
    let gen: AsyncGenerator<ConversationEvent> | null = null
    try {
      gen = backend.start(config)
      for await (const event of gen) {
        if (ended) break
        processEvent(event, stats, opts.prompt)

        // The Claude adapter wires initialPrompt itself; other adapters
        // (Mock, ACP) expect a sendMessage after session_init. Fire once.
        if (event.type === "session_init" && !promptSent) {
          promptSent = true
          try {
            backend.sendMessage({ text: opts.prompt })
          } catch (e) {
            log.warn("A/B sendMessage failed", { label: opts.label, error: String(e) })
          }
        }

        // Once we've seen session_init and the backend reports back to IDLE
        // after a turn, we can consider the session complete.
        if (event.type === "session_state" && event.state === "idle") {
          sawIdle = true
          // Give the backend a short grace window to emit trailing events
          // (final cost_update, etc.) before we declare completion.
          if (finishTimer) clearTimeout(finishTimer)
          finishTimer = setTimeout(() => finish("idle"), 400)
        } else if (event.type === "turn_complete") {
          if (finishTimer) clearTimeout(finishTimer)
          // If the backend doesn't emit session_state, fall back to
          // closing the session on turn_complete.
          finishTimer = setTimeout(() => finish("turn_complete"), 800)
        } else if (event.type === "session_state" && event.state === "running") {
          // Reset the finish timer: we're still working.
          if (finishTimer) clearTimeout(finishTimer)
          finishTimer = null
          sawIdle = false
        } else if (event.type === "error" && event.severity === "fatal") {
          stats.error = event.message
          finish("fatal_error")
          break
        }

        opts.onUpdate({ ...stats })
      }
      if (!ended) finish("stream_end")
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      stats.error = e.message
      opts.onError?.(e)
      finish("exception")
    }
  })()

  const handle: SessionHandle = {
    label: opts.label,
    stats,
    backend,
    done,
    interrupt: () => {
      if (ended) return
      stats.interrupted = true
      try {
        backend.interrupt()
      } catch (e) {
        log.warn("A/B interrupt failed", { label: opts.label, error: String(e) })
      }
    },
    close: () => {
      if (!ended) finish("external_close")
      try {
        backend.close()
      } catch (e) {
        log.warn("A/B close failed", { label: opts.label, error: String(e) })
      }
    },
  }

  // Mark `sawIdle` as used in the runtime control flow (set above) so TS
  // keeps the variable rather than optimizing it away — it's the signal
  // backends emit for "turn done, nothing running".
  void sawIdle

  return handle
}

/**
 * Pure helper — mutate `stats` in place based on a single event.
 * Split out of the runner body so tests can exercise event → stats mapping
 * without spinning up a real backend.
 */
export function processEvent(
  event: ConversationEvent,
  stats: SessionStats,
  _prompt: string,
): void {
  switch (event.type) {
    case "text_delta": {
      stats.output += event.text
      return
    }
    case "text_complete": {
      // Don't append — text_complete contains the full text already covered
      // by accumulated deltas. Mock backends do emit both; guard by only
      // appending if we haven't been streaming.
      if (stats.output.length === 0) stats.output = event.text
      return
    }
    case "turn_start": {
      // Nothing to bump here — we count turn_complete instead so partial
      // turns don't inflate the count.
      return
    }
    case "turn_complete": {
      stats.turns += 1
      if (event.usage) {
        stats.inputTokens = event.usage.inputTokens
        stats.outputTokens = event.usage.outputTokens
        if (event.usage.totalCostUsd != null) {
          stats.totalCostUsd = event.usage.totalCostUsd
        }
      }
      return
    }
    case "cost_update": {
      if (event.inputTokens != null) stats.inputTokens = event.inputTokens
      if (event.outputTokens != null) stats.outputTokens = event.outputTokens
      if (event.cost != null) stats.totalCostUsd += event.cost
      return
    }
    case "tool_use_start": {
      stats.toolUseCount += 1
      // Heuristic file-tracking from common tool inputs.
      const input = (event.input ?? {}) as { file_path?: string; path?: string; filename?: string }
      const path = input.file_path ?? input.path ?? input.filename
      if (path && typeof path === "string" && !stats.filesTouched.includes(path)) {
        stats.filesTouched.push(path)
      }
      return
    }
    case "error": {
      if (event.severity === "fatal") {
        stats.error = event.message
      }
      return
    }
    default:
      return
  }
}
