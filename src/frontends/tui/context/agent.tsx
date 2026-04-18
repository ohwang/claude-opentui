/**
 * Agent Context — AppContext provider
 *
 * Central DI container for the TUI. Created at startup via factory functions.
 * Components access via useAgent().
 *
 * The `backend` field is a live reference that can be swapped at runtime by
 * `/switch`. Consumers read `agent.backend` through a property getter backed
 * by a SolidJS signal, so every call site automatically picks up the current
 * adapter without needing explicit re-subscription.
 */

import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import type { AgentBackend, SessionConfig } from "../../../protocol/types"

/**
 * The context value exposes `backend` as a live getter (not a snapshot).
 * Call sites written as `agent.backend.capabilities()` keep working; they
 * re-read the current backend on every invocation. Reactive consumers that
 * want to track swaps explicitly can use `backendAccessor`.
 */
export interface AgentContextValue {
  /** Live reference to the current adapter. Re-read on every access. */
  readonly backend: AgentBackend
  /** SolidJS accessor form — use inside createEffect/createMemo to re-run on swap. */
  readonly backendAccessor: Accessor<AgentBackend>
  /** Swap in a new adapter. Callers are responsible for closing the old one. */
  setBackend: (next: AgentBackend) => void
  /** Mutable session config — the same object is reused across backend swaps. */
  config: SessionConfig
}

const AgentContext = createContext<AgentContextValue>()

/** Factory for the context value. Call once at app start. */
export function createAgentContextValue(
  initialBackend: AgentBackend,
  config: SessionConfig,
): AgentContextValue {
  const [backend, setBackend] = createSignal<AgentBackend>(initialBackend)
  return {
    get backend() {
      return backend()
    },
    backendAccessor: backend,
    setBackend,
    config,
  }
}

export function AgentProvider(
  props: ParentProps<{ value: AgentContextValue }>,
) {
  return (
    <AgentContext.Provider value={props.value}>
      {props.children}
    </AgentContext.Provider>
  )
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error("useAgent must be used within AgentProvider")
  return ctx
}
