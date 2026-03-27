/**
 * Agent Protocol — Type Definitions
 *
 * The load-bearing abstraction. All backends implement AgentBackend,
 * all TUI components consume AgentEvent via ConversationState.
 *
 * This file IS the spec. Types as documentation.
 */

// ---------------------------------------------------------------------------
// Agent Events — unified stream from all backends
// ---------------------------------------------------------------------------

/** Content streaming */
export type TextDeltaEvent = { type: "text_delta"; text: string }
export type ThinkingDeltaEvent = { type: "thinking_delta"; text: string }
export type TextCompleteEvent = { type: "text_complete"; text: string }

/** Tool lifecycle */
export type ToolUseStartEvent = {
  type: "tool_use_start"
  id: string
  tool: string
  input: unknown
}
export type ToolUseProgressEvent = {
  type: "tool_use_progress"
  id: string
  output: string
}
export type ToolUseEndEvent = {
  type: "tool_use_end"
  id: string
  output: string
  error?: string
}

/** Permission flow */
export type PermissionRequestEvent = {
  type: "permission_request"
  id: string
  tool: string
  input: unknown
  suggestions?: PermissionUpdate[]
}

/** Permission response (approval/denial from user) */
export type PermissionResponseEvent = {
  type: "permission_response"
  id: string
  behavior: "allow" | "deny"
}

/** Elicitation / AskUserQuestion */
export type ElicitationRequestEvent = {
  type: "elicitation_request"
  id: string
  questions: ElicitationQuestion[]
}
export type ElicitationResponseEvent = {
  type: "elicitation_response"
  id: string
  answers: Record<string, string>
}

/** User message (synthetic, emitted by TUI when user submits) */
export type UserMessageEvent = { type: "user_message"; text: string }

/** Interrupt (synthetic, emitted by TUI when user presses Ctrl+C) */
export type InterruptEvent = { type: "interrupt" }

/** Turn lifecycle */
export type TurnStartEvent = { type: "turn_start" }
export type TurnCompleteEvent = { type: "turn_complete"; usage?: TokenUsage }

/** Session state */
export type SessionInitEvent = {
  type: "session_init"
  tools: ToolInfo[]
  models: ModelInfo[]
  account?: AccountInfo
}
export type SessionStateEvent = {
  type: "session_state"
  state: "idle" | "running" | "requires_action"
}
export type CompactEvent = { type: "compact"; summary: string }

/** Tasks / subagents */
export type TaskStartEvent = {
  type: "task_start"
  taskId: string
  description: string
}
export type TaskProgressEvent = {
  type: "task_progress"
  taskId: string
  output: string
}
export type TaskCompleteEvent = {
  type: "task_complete"
  taskId: string
  output: string
}

/** Errors */
export type ErrorEvent = {
  type: "error"
  code: string
  message: string
  severity?: "fatal" | "recoverable"
}

/** Cost tracking */
export type CostUpdateEvent = {
  type: "cost_update"
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cost?: number
}

/** System message (slash command output, notifications) */
export type SystemMessageEvent = {
  type: "system_message"
  text: string
}

/** Backend escape hatch */
export type BackendSpecificEvent = {
  type: "backend_specific"
  backend: string
  data: unknown
}

/** Union of all agent events */
export type AgentEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | TextCompleteEvent
  | ToolUseStartEvent
  | ToolUseProgressEvent
  | ToolUseEndEvent
  | PermissionRequestEvent
  | PermissionResponseEvent
  | ElicitationRequestEvent
  | ElicitationResponseEvent
  | UserMessageEvent
  | InterruptEvent
  | TurnStartEvent
  | TurnCompleteEvent
  | SessionInitEvent
  | SessionStateEvent
  | CompactEvent
  | TaskStartEvent
  | TaskProgressEvent
  | TaskCompleteEvent
  | ErrorEvent
  | CostUpdateEvent
  | SystemMessageEvent
  | BackendSpecificEvent

// ---------------------------------------------------------------------------
// Agent Backend — the unified adapter interface
// ---------------------------------------------------------------------------

export interface AgentBackend {
  /** Start a new session. Returns the event stream for the entire session. */
  start(config: SessionConfig): AsyncGenerator<AgentEvent>

  /** Send a message. Queued if a turn is already running. */
  sendMessage(message: UserMessage): void

  /** Interrupt the current turn. */
  interrupt(): void

  /** Resume a previous session. */
  resume(sessionId: string): AsyncGenerator<AgentEvent>

  /** List available sessions. */
  listSessions(): Promise<SessionInfo[]>

  /** Fork a session at a specific point. */
  forkSession(sessionId: string, options?: ForkOptions): Promise<string>

  /** Approve a pending tool use request. */
  approveToolUse(
    id: string,
    options?: { updatedInput?: unknown; alwaysAllow?: boolean },
  ): void

  /** Deny a pending tool use request. */
  denyToolUse(id: string, reason?: string): void

  /** Respond to an elicitation request. */
  respondToElicitation(id: string, answers: Record<string, string>): void

  /** Change the model at runtime. Only valid in IDLE state. */
  setModel(model: string): Promise<void>

  /** Change permission mode. */
  setPermissionMode(mode: PermissionMode): Promise<void>

  /** Query backend capabilities. */
  capabilities(): BackendCapabilities

  /** List available models. */
  availableModels(): Promise<ModelInfo[]>

  /** Gracefully close the backend and clean up child processes. */
  close(): void
}

// ---------------------------------------------------------------------------
// Session lifecycle state machine
// ---------------------------------------------------------------------------

export type SessionState =
  | "INITIALIZING"
  | "IDLE"
  | "RUNNING"
  | "WAITING_FOR_PERM"
  | "WAITING_FOR_ELIC"
  | "INTERRUPTING"
  | "ERROR"
  | "SHUTTING_DOWN"

// ---------------------------------------------------------------------------
// Conversation State — event-sourced, derived via reducer
// ---------------------------------------------------------------------------

export interface ConversationState {
  /** Current session lifecycle state */
  sessionState: SessionState

  /** All messages in the conversation */
  messages: Message[]

  /** Currently streaming text (accumulated text_deltas) */
  streamingText: string

  /** Currently streaming thinking (accumulated thinking_deltas) */
  streamingThinking: string

  /** Active tool calls (in progress) */
  activeTools: Map<string, ActiveTool>

  /** Completed tool calls (for display) */
  completedTools: ToolResult[]

  /** Pending permission request (at most one at a time) */
  pendingPermission: PermissionRequestEvent | null

  /** Pending elicitation request */
  pendingElicitation: ElicitationRequestEvent | null

  /** Messages queued while a turn is running */
  pendingMessages: UserMessage[]

  /** Active background tasks */
  activeTasks: Map<string, TaskInfo>

  /** Session metadata from session_init */
  session: SessionMetadata | null

  /** Running cost totals */
  cost: CostTotals

  /** Ordered event log (source of truth) */
  eventLog: AgentEvent[]

  /** Error info when in ERROR state */
  lastError: ErrorEvent | null

  /** Current turn number (incremented on turn_start) */
  turnNumber: number
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface Message {
  role: "user" | "assistant" | "system"
  content: MessageContent[]
  timestamp: number
  turnNumber: number
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; output: string; error?: string }
  | { type: "compact"; summary: string }

export interface ActiveTool {
  id: string
  tool: string
  input: unknown
  output: string
  startTime: number
}

export interface ToolResult {
  id: string
  tool: string
  input: unknown
  output: string
  error?: string
  duration: number
}

export interface UserMessage {
  text: string
  images?: ImageContent[]
}

export interface ImageContent {
  data: string // base64
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
}

export interface SessionConfig {
  model?: string
  permissionMode?: PermissionMode
  maxTurns?: number
  maxBudgetUsd?: number
  cwd?: string
  systemPrompt?: string
  resume?: string
  continue?: boolean
  forkSession?: boolean
  mcpServers?: Record<string, unknown>
  allowedTools?: string[]
  disallowedTools?: string[]
  additionalDirectories?: string[]
  /** Initial prompt from CLI (--prompt or positional arg) */
  initialPrompt?: string
}

export interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ForkOptions {
  atTurn?: number
}

export interface BackendCapabilities {
  name: string
  supportsThinking: boolean
  supportsToolApproval: boolean
  supportsResume: boolean
  supportsFork: boolean
  supportsStreaming: boolean
  supportsSubagents: boolean
  supportedPermissionModes: PermissionMode[]
}

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalCostUsd?: number
}

export interface ToolInfo {
  name: string
  description?: string
}

export interface ModelInfo {
  id: string
  name: string
  provider?: string
}

export interface AccountInfo {
  email?: string
  plan?: string
}

export interface SessionMetadata {
  tools: ToolInfo[]
  models: ModelInfo[]
  account?: AccountInfo
  sessionId?: string
}

export interface TaskInfo {
  taskId: string
  description: string
  output: string
  status: "running" | "completed"
  startTime: number
}

export interface CostTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCostUsd: number
}

export interface ElicitationQuestion {
  question: string
  options: ElicitationOption[]
  allowFreeText?: boolean
  multiSelect?: boolean
}

export interface ElicitationOption {
  label: string
  value: string
  preview?: string
}

export type PermissionUpdate =
  | {
      type: "addRules"
      toolName: string
      ruleContent: string
      behavior: "allow" | "deny"
      destination: "project" | "user"
    }
  | {
      type: "replaceRules"
      toolName: string
      ruleContent: string
      behavior: "allow" | "deny"
      destination: "project" | "user"
    }
  | {
      type: "removeRules"
      toolName: string
      destination: "project" | "user"
    }
  | {
      type: "setMode"
      mode: PermissionMode
      destination: "project" | "user"
    }
  | {
      type: "addDirectories"
      paths: string[]
      destination: "project" | "user"
    }
  | {
      type: "removeDirectories"
      paths: string[]
      destination: "project" | "user"
    }

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

export function createInitialState(): ConversationState {
  return {
    sessionState: "INITIALIZING",
    messages: [],
    streamingText: "",
    streamingThinking: "",
    activeTools: new Map(),
    completedTools: [],
    pendingPermission: null,
    pendingElicitation: null,
    pendingMessages: [],
    activeTasks: new Map(),
    session: null,
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: 0,
    },
    eventLog: [],
    lastError: null,
    turnNumber: 0,
  }
}
