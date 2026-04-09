/**
 * Agent Protocol — Type Definitions
 *
 * The load-bearing abstraction. All backends implement AgentBackend,
 * all TUI components consume AgentEvent via ConversationState.
 *
 * This file IS the spec. Types as documentation.
 */

// ---------------------------------------------------------------------------
// Thinking & Effort — controls for Claude's reasoning behavior
// ---------------------------------------------------------------------------

/** Thinking configuration for extended reasoning */
export type ThinkingConfig =
  | { type: "adaptive" }
  | { type: "enabled"; budgetTokens?: number }
  | { type: "disabled" }

/** Effort level for controlling reasoning depth */
export type EffortLevel = "low" | "medium" | "high" | "max"

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
  input?: unknown // Set when tool input JSON is fully accumulated from streaming deltas
}
export type ToolUseEndEvent = {
  type: "tool_use_end"
  id: string
  output: string
  error?: string
}

/** Shell command lifecycle (user-initiated ! prefix) */
export type ShellStartEvent = {
  type: "shell_start"
  id: string
  command: string
}
export type ShellEndEvent = {
  type: "shell_end"
  id: string
  output: string
  error?: string
  exitCode: number
}

/** Permission flow */
export type PermissionRequestEvent = {
  type: "permission_request"
  id: string
  tool: string
  input: unknown
  suggestions?: PermissionUpdate[]
  /** Short noun phrase for the tool action (e.g., "Read file") — from SDK */
  displayName?: string
  /** Full permission prompt sentence (e.g., "Claude wants to read foo.txt") — from SDK */
  title?: string
  /** Human-readable subtitle (e.g., "Claude will have read and write access to files in ~/Downloads") */
  description?: string
  /** Why this permission request was triggered */
  decisionReason?: string
  /** File path that triggered the permission request */
  blockedPath?: string
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
export type UserMessageEvent = { type: "user_message"; text: string; images?: ImageContent[] }

/** Interrupt (synthetic, emitted by TUI when user presses Ctrl+C) */
export type InterruptEvent = { type: "interrupt" }

/** Shutdown (synthetic, emitted by TUI when user triggers clean exit) */
export type ShutdownEvent = { type: "shutdown" }

/** Turn lifecycle */
export type TurnStartEvent = { type: "turn_start" }
export type TurnCompleteEvent = { type: "turn_complete"; usage?: TokenUsage; sessionId?: string }

/** Session state */
export type SessionInitEvent = {
  type: "session_init"
  tools: ToolInfo[]
  models: ModelInfo[]
  account?: AccountInfo
  sessionId?: string
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
  /** Correlates this task to the Agent ToolUseBlock that spawned it */
  toolUseId?: string
  /** Subagent type (e.g., "Explore", "general-purpose") */
  taskType?: string
}
export type TaskProgressEvent = {
  type: "task_progress"
  taskId: string
  output: string
  /** Name of the most recent tool the subagent used */
  lastToolName?: string
  /** AI-generated progress summary (requires agentProgressSummaries option) */
  summary?: string
}
export type TaskCompleteEvent = {
  type: "task_complete"
  taskId: string
  output: string
  /** Correlates this task completion to the Agent ToolUseBlock that spawned it */
  toolUseId?: string
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
  /** Per-API-call context window fill — the total prompt tokens for the
   *  most recent API call. More accurate than turn_complete.usage which
   *  is cumulative across all API calls in a multi-step agentic turn.
   *
   *  Each backend computes this differently because caching models differ:
   *
   *  - **Anthropic**: input_tokens, cache_read, cache_creation are DISJOINT.
   *    contextTokens = input_tokens + cache_read + cache_creation.
   *    Source: message_start stream event usage.
   *
   *  - **OpenAI (Codex)**: inputTokens INCLUDES cachedInputTokens (subset).
   *    contextTokens = inputTokens (from tokenUsage.last, not .total).
   *
   *  - **Gemini**: promptTokenCount INCLUDES cachedContentTokenCount (subset).
   *    contextTokens = promptTokenCount.
   */
  contextTokens?: number
}

/** Model changed (emitted by /model command) */
export type ModelChangedEvent = {
  type: "model_changed"
  model: string
}

/** Effort level changed (emitted by /thinking command) */
export type EffortChangedEvent = {
  type: "effort_changed"
  effort: EffortLevel
}

/** System message (slash command output, notifications) */
export type SystemMessageEvent = {
  type: "system_message"
  text: string
  /** Ephemeral messages are shown in the UI but excluded from API context.
   *  Matches Claude Code's `display: 'system'` behavior for local commands. */
  ephemeral?: boolean
}

/** Task backgrounding (synthetic, emitted by TUI on Ctrl+B double-press) */
export type TaskBackgroundEvent = { type: "task_background" }
export type TaskForegroundEvent = { type: "task_foreground" }

/** Plan update (ACP structured plan) */
export type PlanUpdateEvent = {
  type: "plan_update"
  entries: PlanEntry[]
}

export interface PlanEntry {
  content: string
  priority?: "high" | "medium" | "low"
  status?: "pending" | "in_progress" | "completed"
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
  | ShutdownEvent
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
  | ModelChangedEvent
  | EffortChangedEvent
  | SystemMessageEvent
  | TaskBackgroundEvent
  | TaskForegroundEvent
  | BackendSpecificEvent
  | ShellStartEvent
  | ShellEndEvent
  | PlanUpdateEvent

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
    options?: { updatedInput?: unknown; alwaysAllow?: boolean; updatedPermissions?: PermissionUpdate[] },
  ): void

  /** Deny a pending tool use request. */
  denyToolUse(id: string, reason?: string, options?: { denyForSession?: boolean }): void

  /** Respond to an elicitation request with answers keyed by question text. */
  respondToElicitation(id: string, answers: Record<string, string>): void

  /** Cancel/decline a pending elicitation request. */
  cancelElicitation(id: string): void

  /** Change the model at runtime. Only valid in IDLE state. */
  setModel(model: string): Promise<void>

  /** Change permission mode. */
  setPermissionMode(mode: PermissionMode): Promise<void>

  /** Change thinking effort level at runtime. Only valid in IDLE state. */
  setEffort(level: EffortLevel): Promise<void>

  /** Query backend capabilities. */
  capabilities(): BackendCapabilities

  /** List available models. */
  availableModels(): Promise<ModelInfo[]>

  /** Reset the backend session (create a fresh session without restarting).
   *  Used by /new to clear server-side conversation history.
   *  Backends that don't support this can leave it unimplemented. */
  resetSession?(): Promise<void>

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
// Block types — flat, append-only conversation model
// ---------------------------------------------------------------------------

export type ToolStatus = "running" | "done" | "error" | "canceled"

export type Block =
  | { type: "user"; text: string; queued?: boolean; images?: ImageContent[] }
  | { type: "assistant"; text: string; timestamp?: number; model?: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; id: string; tool: string; input: unknown; status: ToolStatus; output?: string; error?: string; startTime: number; duration?: number }
  | { type: "system"; text: string; ephemeral?: boolean }
  | { type: "compact"; summary: string }
  | { type: "shell"; id: string; command: string; output: string; error?: string; exitCode?: number; status: "running" | "done" | "error"; startTime: number; duration?: number }
  | { type: "error"; code: string; message: string }
  | { type: "plan"; entries: PlanEntry[] }

// ---------------------------------------------------------------------------
// Conversation State — event-sourced, derived via reducer
// ---------------------------------------------------------------------------

export interface ConversationState {
  /** Current session lifecycle state */
  sessionState: SessionState

  /** Flat, append-only block list */
  blocks: Block[]

  /** Currently streaming text (accumulated text_deltas) */
  streamingText: string

  /** Currently streaming thinking (accumulated thinking_deltas) */
  streamingThinking: string

  /** Pending permission request (at most one at a time) */
  pendingPermission: PermissionRequestEvent | null

  /** Pending elicitation request */
  pendingElicitation: ElicitationRequestEvent | null

  /** Active background tasks */
  activeTasks: Map<string, TaskInfo>

  /** Current model name (updated by /model command, overrides session default) */
  currentModel: string | null

  /** Current effort level (updated by /thinking command, null = default/high) */
  currentEffort: EffortLevel | null

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

  /** Input tokens from the last completed turn — approximates context window fill */
  lastTurnInputTokens: number
  /** True when lastTurnInputTokens was set from per-API-call data (message_start)
   *  during the current turn, so turn_complete should not overwrite it with
   *  cumulative usage. Reset on turn_start. */
  _contextFromStream: boolean

  /** Output tokens accumulated during streaming (reset on turn boundaries, separate from authoritative cost) */
  streamingOutputTokens: number

  /** Whether the current turn is backgrounded (UI collapsed, input re-enabled) */
  backgrounded: boolean

  /** Rate limit utilization (from SDK rate_limit_event) */
  rateLimits: RateLimits | null

  /**
   * True after user_message transitions to RUNNING (before the SDK's turn_start arrives).
   * Allows turn_start to process when already in RUNNING from a user_message,
   * while still ignoring genuine duplicate turn_start events mid-stream.
   */
  awaitingTurnStart: boolean

  /** Files modified in the last completed turn */
  lastTurnFiles?: TurnFileChange[]

  /** Agent-advertised slash commands (from ACP available_commands_update) */
  agentCommands: AgentSlashCommand[]
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

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
  /** Persist session to disk so it can be resumed later (default: true) */
  persistSession?: boolean
  /** Thinking/reasoning configuration */
  thinking?: ThinkingConfig
  /** Effort level for controlling reasoning depth */
  effort?: EffortLevel
}

export interface SessionInfo {
  id: string
  title: string
  createdAt?: number
  updatedAt: number
  messageCount?: number
  gitBranch?: string
  cwd?: string
  fileSize?: number
}

export interface ForkOptions {
  atTurn?: number
}

export interface BackendCapabilities {
  name: string
  sdkVersion?: string
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
  contextWindow?: number
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
  /** Correlates this task to the Agent ToolUseBlock that spawned it */
  toolUseId?: string
  /** Subagent type (e.g., "Explore", "general-purpose") */
  taskType?: string
  /** Name of the most recent tool the subagent used */
  lastToolName?: string
  /** AI-generated progress summary */
  summary?: string
}

export interface CostTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCostUsd: number
}

export interface RateLimitEntry {
  usedPercentage: number // 0-100
  resetsAt?: number      // Unix epoch seconds
  windowDurationMins?: number // Actual window duration (from Codex)
}

export interface RateLimits {
  fiveHour?: RateLimitEntry
  sevenDay?: RateLimitEntry
  /** Generic primary window (Codex backends where duration ≠ 5h or 7d) */
  primary?: RateLimitEntry
  /** Generic secondary window (Codex backends where duration ≠ 5h or 7d) */
  secondary?: RateLimitEntry
}

export interface ElicitationQuestion {
  question: string
  /** Short label displayed as a chip/tag (max 12 chars) */
  header?: string
  options: ElicitationOption[]
  allowFreeText?: boolean
  multiSelect?: boolean
}

export interface ElicitationOption {
  label: string
  description?: string
  preview?: string
}

/** Matches SDK PermissionRuleValue */
export interface PermissionRuleValue {
  toolName: string
  ruleContent?: string
}

/** Matches SDK PermissionUpdateDestination */
export type PermissionUpdateDestination =
  | "userSettings"
  | "projectSettings"
  | "localSettings"
  | "session"
  | "cliArg"

/** Matches SDK PermissionUpdate — used in canUseTool results */
export type PermissionUpdate =
  | {
      type: "addRules"
      rules: PermissionRuleValue[]
      behavior: "allow" | "deny"
      destination: PermissionUpdateDestination
    }
  | {
      type: "replaceRules"
      rules: PermissionRuleValue[]
      behavior: "allow" | "deny"
      destination: PermissionUpdateDestination
    }
  | {
      type: "removeRules"
      rules: PermissionRuleValue[]
      behavior: "allow" | "deny"
      destination: PermissionUpdateDestination
    }
  | {
      type: "setMode"
      mode: PermissionMode
      destination: PermissionUpdateDestination
    }
  | {
      type: "addDirectories"
      directories: string[]
      destination: PermissionUpdateDestination
    }
  | {
      type: "removeDirectories"
      directories: string[]
      destination: PermissionUpdateDestination
    }

// ---------------------------------------------------------------------------
// Turn file change tracking
// ---------------------------------------------------------------------------

export interface TurnFileChange {
  path: string
  action: "read" | "write" | "edit" | "create"
  tool: string
}

/** Agent-advertised slash command (from ACP backends) */
export interface AgentSlashCommand {
  name: string
  description?: string
}

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

export function createInitialState(): ConversationState {
  return {
    sessionState: "INITIALIZING",
    blocks: [],
    streamingText: "",
    streamingThinking: "",
    pendingPermission: null,
    pendingElicitation: null,
    activeTasks: new Map(),
    currentModel: null,
    currentEffort: null,
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
    lastTurnInputTokens: 0,
    _contextFromStream: false,
    streamingOutputTokens: 0,
    backgrounded: false,
    awaitingTurnStart: false,
    lastTurnFiles: undefined,
    rateLimits: null,
    agentCommands: [],
  }
}
