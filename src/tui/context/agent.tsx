/**
 * Agent Context — AppContext provider
 *
 * Central DI container for the TUI. Created at startup via factory functions.
 * Components access via useAgent().
 */

import { createContext, useContext, type ParentProps } from "solid-js"
import type { AgentBackend, SessionConfig } from "../../protocol/types"

export interface AgentContextValue {
  backend: AgentBackend
  config: SessionConfig
}

const AgentContext = createContext<AgentContextValue>()

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
