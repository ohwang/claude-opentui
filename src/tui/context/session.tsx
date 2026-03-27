/**
 * Session Context — Session state + cost tracking
 *
 * Tracks the session lifecycle state, cost totals, and session metadata.
 */

import {
  createContext,
  useContext,
  type ParentProps,
} from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import type {
  SessionState,
  SessionMetadata,
  CostTotals,
  ErrorEvent,
} from "../../protocol/types"

export interface SessionContextState {
  sessionState: SessionState
  session: SessionMetadata | null
  cost: CostTotals
  lastError: ErrorEvent | null
  turnNumber: number
}

export interface SessionContextValue {
  state: SessionContextState
  setState: SetStoreFunction<SessionContextState>
}

const SessionContext = createContext<SessionContextValue>()

export function SessionProvider(props: ParentProps) {
  const [state, setState] = createStore<SessionContextState>({
    sessionState: "INITIALIZING",
    session: null,
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: 0,
    },
    lastError: null,
    turnNumber: 0,
  })

  return (
    <SessionContext.Provider value={{ state, setState }}>
      {props.children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used within SessionProvider")
  return ctx
}
