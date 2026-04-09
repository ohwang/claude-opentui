/**
 * Gemini CLI SDK Types (Inline)
 *
 * Defines the subset of @google/gemini-cli-sdk types needed by the adapter.
 * These are defined inline so the adapter compiles and tests pass without
 * the SDK installed. The SDK is loaded via dynamic import at runtime.
 *
 * Source: @google/gemini-cli-core turn.ts, agent/types.ts, scheduler/types.ts
 */

// ---------------------------------------------------------------------------
// ServerGeminiStreamEvent — yielded by GeminiCliSession.sendStream()
// ---------------------------------------------------------------------------

export enum GeminiEventType {
  Content = "content",
  ToolCallRequest = "tool_call_request",
  ToolCallResponse = "tool_call_response",
  ToolCallConfirmation = "tool_call_confirmation",
  UserCancelled = "user_cancelled",
  Error = "error",
  ChatCompressed = "chat_compressed",
  Thought = "thought",
  MaxSessionTurns = "max_session_turns",
  Finished = "finished",
  LoopDetected = "loop_detected",
  Citation = "citation",
  Retry = "retry",
  ContextWindowWillOverflow = "context_window_will_overflow",
  InvalidStream = "invalid_stream",
  ModelInfo = "model_info",
  AgentExecutionStopped = "agent_execution_stopped",
  AgentExecutionBlocked = "agent_execution_blocked",
}

export interface ThoughtSummary {
  subject: string
  description: string
}

export interface ToolCallRequestInfo {
  callId: string
  name: string
  args: Record<string, unknown>
  traceId?: string
}

export interface ToolCallResponseInfo {
  callId: string
  responseParts: unknown[]
  resultDisplay?: unknown
  error?: Error
  errorType?: string
  outputFile?: string
  contentLength?: number
  data?: Record<string, unknown>
}

export interface ToolCallConfirmationDetails {
  callId: string
  name: string
  args: Record<string, unknown>
  decision?: string
}

export interface GeminiFinishedValue {
  reason: string | undefined
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    cachedContentTokenCount?: number
    totalTokenCount?: number
  }
}

export interface GeminiErrorValue {
  error: unknown
}

export type ServerGeminiStreamEvent =
  | { type: GeminiEventType.Content; value: string; traceId?: string }
  | { type: GeminiEventType.Thought; value: ThoughtSummary; traceId?: string }
  | { type: GeminiEventType.ToolCallRequest; value: ToolCallRequestInfo }
  | { type: GeminiEventType.ToolCallResponse; value: ToolCallResponseInfo }
  | { type: GeminiEventType.ToolCallConfirmation; value: ToolCallConfirmationDetails }
  | { type: GeminiEventType.Finished; value: GeminiFinishedValue }
  | { type: GeminiEventType.Error; value: GeminiErrorValue }
  | { type: GeminiEventType.ChatCompressed; value: unknown }
  | { type: GeminiEventType.ModelInfo; value: string }
  | { type: GeminiEventType.UserCancelled }
  | { type: GeminiEventType.MaxSessionTurns }
  | { type: GeminiEventType.LoopDetected }
  | { type: GeminiEventType.Citation; value: string }
  | { type: GeminiEventType.Retry }
  | { type: GeminiEventType.ContextWindowWillOverflow; value: { estimatedRequestTokenCount: number; remainingTokenCount: number } }
  | { type: GeminiEventType.InvalidStream }
  | { type: GeminiEventType.AgentExecutionStopped; value: { reason: string; systemMessage?: string; contextCleared?: boolean } }
  | { type: GeminiEventType.AgentExecutionBlocked; value: { reason: string; systemMessage?: string; contextCleared?: boolean } }

// ---------------------------------------------------------------------------
// SDK class interfaces (for dynamic import typing)
// ---------------------------------------------------------------------------

export interface GeminiCliAgentOptions {
  cwd?: string
  instructions?: string | ((ctx: any) => string | Promise<string>)
  tools?: unknown[]
  skills?: unknown[]
  model?: string
  debug?: boolean
}

export interface IGeminiCliAgent {
  session(options?: { sessionId?: string }): IGeminiCliSession
  resumeSession(sessionId: string): Promise<IGeminiCliSession>
}

export interface IGeminiCliSession {
  readonly id: string
  initialize(): Promise<void>
  sendStream(prompt: string, signal?: AbortSignal): AsyncGenerator<ServerGeminiStreamEvent>
}
