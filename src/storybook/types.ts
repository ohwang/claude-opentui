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

/** A named state variant for toggling between different component states */
export interface StoryVariant {
  /** Display label in the controls bar */
  label: string
  /** Override context for this variant (merged over story's base context) */
  context?: StoryContext
  /** Override render function for this variant */
  render?: () => JSX.Element
}

export interface Story {
  /** Unique ID (kebab-case), used as catalog key */
  id: string
  /** Human-readable title displayed in tree */
  title: string
  /** One-line description shown in the info bar */
  description: string
  /** Category for grouping in the tree */
  category: StoryCategory
  /** The component to render. Returns JSX. */
  render: () => JSX.Element
  /** Context overrides needed to render this component. Omit for context-free components. */
  context?: StoryContext
  /** Whether this story supports interactive keyboard input (e.g., PermissionDialog) */
  interactive?: boolean
  /** Named state variants the user can toggle between */
  variants?: StoryVariant[]
}

/** Categories ordered to match the real app's component tree */
export type StoryCategory =
  | "Header"
  | "Conversation"
  | "Dialogs"
  | "Input"
  | "Footer"
  | "Overlays"
  | "Primitives"
