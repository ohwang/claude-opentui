/**
 * Storybook type definitions
 */

import type { JSX } from "solid-js"
import type { SessionContextState } from "../tui/context/session"
import type { MessagesState } from "../tui/context/messages"
import type { PermissionsState } from "../tui/context/permissions"
import type { AgentContextValue } from "../tui/context/agent"

/** Mock values a story can provide to the context tree */
export interface StoryContext {
  session?: Partial<SessionContextState>
  messages?: Partial<MessagesState>
  permissions?: Partial<PermissionsState>
  agent?: Partial<AgentContextValue>
}

export interface Story {
  /** Unique ID (kebab-case), used as catalog key */
  id: string
  /** Human-readable title displayed in sidebar */
  title: string
  /** One-line description shown in the info bar */
  description: string
  /** Category for grouping in the sidebar */
  category: StoryCategory
  /** The component to render. Returns JSX. */
  render: () => JSX.Element
  /** Context overrides needed to render this component. Omit for context-free components. */
  context?: StoryContext
  /** Whether this story supports interactive keyboard input (e.g., PermissionDialog) */
  interactive?: boolean
}

export type StoryCategory =
  | "Primitives"
  | "Blocks"
  | "Tool Views"
  | "Layout"
  | "Dialogs"
  | "Streaming"
  | "Composite"
