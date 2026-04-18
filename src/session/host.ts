/**
 * SessionHost — the frontend-neutral unit of "one active conversation."
 *
 * A `SessionHost` owns the backend instance, the subagent manager, the
 * resolved session config, any pre-fetched session metadata, and the
 * teardown function. Frontends (TUI today; Slack/GUI/headless tomorrow)
 * attach to a host instead of receiving a grab-bag of props.
 *
 * Concretely this replaces the ad-hoc `{ backend, config, subagentManager,
 * preloadedSessions, currentBackend, onExit }` bundle that `startApp` used
 * to accept. The rename is intentional — a host is a *thing that owns a
 * session*, not a bag of parameters.
 *
 * For the current single-process, single-conversation model one host lives
 * for the lifetime of the process. A future multi-session frontend (e.g. a
 * Slack gateway with one host per thread) will create and destroy hosts
 * dynamically, which is why `close()` is an explicit member rather than a
 * global `cleanup()` function.
 */

import type {
  AgentBackend,
  MultiBackendSessions,
  SessionConfig,
  SessionOrigin,
} from "../protocol/types"
import type { SubagentManager } from "../subagents/manager"

/** Construction inputs. All fields are required except preloadedSessions. */
export interface SessionHostOptions {
  backend: AgentBackend
  config: SessionConfig
  subagentManager: SubagentManager
  currentBackend: SessionOrigin
  /** Optional pre-fetched cross-backend session list for resume pickers. */
  preloadedSessions?: MultiBackendSessions
  /**
   * Teardown for all resources the host owns. Will be called at most once
   * by `host.close()` regardless of how many callers invoke it.
   */
  close: () => void
}

/** The public surface consumed by frontends. */
export interface SessionHost {
  readonly backend: AgentBackend
  readonly config: SessionConfig
  readonly subagentManager: SubagentManager
  readonly currentBackend: SessionOrigin
  readonly preloadedSessions?: MultiBackendSessions
  /** Tear down the session. Idempotent. */
  close(): void
}

/**
 * Construct a SessionHost from fully-assembled inputs. Callers are
 * responsible for creating the backend, subagent manager, and close
 * function — this factory only encodes the invariants (single-close,
 * property exposure). See `src/frontends/tui/launcher.ts` for a representative
 * bootstrap sequence.
 */
export function createSessionHost(opts: SessionHostOptions): SessionHost {
  let closed = false

  return {
    backend: opts.backend,
    config: opts.config,
    subagentManager: opts.subagentManager,
    currentBackend: opts.currentBackend,
    preloadedSessions: opts.preloadedSessions,
    close() {
      if (closed) return
      closed = true
      opts.close()
    },
  }
}
