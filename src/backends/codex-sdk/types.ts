/**
 * Codex SDK Types (Inline)
 *
 * Defines the subset of @openai/codex-sdk types needed by the adapter.
 * These are defined inline so the adapter compiles and tests pass without
 * the SDK installed. The SDK is loaded via dynamic import at runtime.
 *
 * Source: @openai/codex-sdk v0.118.0 dist/index.d.ts
 */

// ---------------------------------------------------------------------------
// Thread items — the work units within a turn
// ---------------------------------------------------------------------------

export type CommandExecutionStatus = "in_progress" | "completed" | "failed"

export interface CommandExecutionItem {
  id: string
  type: "command_execution"
  command: string
  aggregated_output: string
  exit_code?: number
  status: CommandExecutionStatus
}

export type PatchChangeKind = "add" | "delete" | "update"

export interface FileUpdateChange {
  path: string
  kind: PatchChangeKind
}

export type PatchApplyStatus = "completed" | "failed"

export interface FileChangeItem {
  id: string
  type: "file_change"
  changes: FileUpdateChange[]
  status: PatchApplyStatus
}

export type McpToolCallStatus = "in_progress" | "completed" | "failed"

export interface McpToolCallItem {
  id: string
  type: "mcp_tool_call"
  server: string
  tool: string
  arguments: unknown
  result?: { content: unknown[]; structured_content: unknown }
  error?: { message: string }
  status: McpToolCallStatus
}

export interface AgentMessageItem {
  id: string
  type: "agent_message"
  text: string
}

export interface ReasoningItem {
  id: string
  type: "reasoning"
  text: string
}

export interface WebSearchItem {
  id: string
  type: "web_search"
  query: string
}

export interface ErrorItem {
  id: string
  type: "error"
  message: string
}

export interface TodoItem {
  text: string
  completed: boolean
}

export interface TodoListItem {
  id: string
  type: "todo_list"
  items: TodoItem[]
}

export type ThreadItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem
  | ErrorItem

// ---------------------------------------------------------------------------
// Thread events — yielded by Thread.runStreamed()
// ---------------------------------------------------------------------------

export interface ThreadStartedEvent {
  type: "thread.started"
  thread_id: string
}

export interface TurnStartedEvent {
  type: "turn.started"
}

export interface Usage {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
}

export interface TurnCompletedEvent {
  type: "turn.completed"
  usage: Usage
}

export interface TurnFailedEvent {
  type: "turn.failed"
  error: { message: string }
}

export interface ItemStartedEvent {
  type: "item.started"
  item: ThreadItem
}

export interface ItemUpdatedEvent {
  type: "item.updated"
  item: ThreadItem
}

export interface ItemCompletedEvent {
  type: "item.completed"
  item: ThreadItem
}

export interface ThreadErrorEvent {
  type: "error"
  message: string
}

export type ThreadEvent =
  | ThreadStartedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | ItemStartedEvent
  | ItemUpdatedEvent
  | ItemCompletedEvent
  | ThreadErrorEvent

// ---------------------------------------------------------------------------
// SDK class interfaces (for dynamic import typing)
// ---------------------------------------------------------------------------

export type ApprovalMode = "never" | "on-request" | "on-failure" | "untrusted"
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"

export interface ThreadOptions {
  model?: string
  sandboxMode?: SandboxMode
  workingDirectory?: string
  skipGitRepoCheck?: boolean
  approvalPolicy?: ApprovalMode
  additionalDirectories?: string[]
}

export interface CodexOptions {
  codexPathOverride?: string
  baseUrl?: string
  apiKey?: string
  config?: Record<string, unknown>
  env?: Record<string, string>
}

export interface TurnOptions {
  outputSchema?: unknown
  signal?: AbortSignal
}

export interface StreamedTurn {
  events: AsyncGenerator<ThreadEvent>
}

export interface IThread {
  readonly id: string | null
  runStreamed(input: string, turnOptions?: TurnOptions): Promise<StreamedTurn>
}

export interface ICodex {
  startThread(options?: ThreadOptions): IThread
  resumeThread(id: string, options?: ThreadOptions): IThread
}
