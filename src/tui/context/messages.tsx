/**
 * Messages Context — Message list + queue signals
 *
 * Provides reactive access to conversation messages and pending queue.
 * Updated by the sync context when events arrive.
 */

import {
  createContext,
  useContext,
  type ParentProps,
  type Accessor,
} from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import type {
  Message,
  UserMessage,
  ActiveTool,
  ToolResult,
  TaskInfo,
} from "../../protocol/types"

export interface MessagesState {
  messages: Message[]
  streamingText: string
  streamingThinking: string
  activeTools: [string, ActiveTool][]
  completedTools: ToolResult[]
  pendingMessages: UserMessage[]
  activeTasks: [string, TaskInfo][]
}

export interface MessagesContextValue {
  state: MessagesState
  setState: SetStoreFunction<MessagesState>
}

const MessagesContext = createContext<MessagesContextValue>()

export function MessagesProvider(props: ParentProps) {
  const [state, setState] = createStore<MessagesState>({
    messages: [],
    streamingText: "",
    streamingThinking: "",
    activeTools: [],
    completedTools: [],
    pendingMessages: [],
    activeTasks: [],
  })

  return (
    <MessagesContext.Provider value={{ state, setState }}>
      {props.children}
    </MessagesContext.Provider>
  )
}

export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext)
  if (!ctx) throw new Error("useMessages must be used within MessagesProvider")
  return ctx
}
