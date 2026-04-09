/**
 * Codex App-Server JSON-RPC Response Types
 *
 * Typed interfaces for the Codex app-server JSON-RPC responses. These
 * narrow `unknown` from the transport layer into concrete shapes, replacing
 * `as any` casts in the adapter.
 *
 * The transport's `request()` returns `Promise<unknown>`. These types
 * are used with type assertion at the RPC boundary — one controlled
 * assertion per response shape, instead of scattered `as any`.
 */

// ---------------------------------------------------------------------------
// thread/start, thread/resume responses
// ---------------------------------------------------------------------------

export interface CodexThreadResponse {
  thread?: {
    id?: string
  }
  model?: string
  modelProvider?: string
}

// ---------------------------------------------------------------------------
// thread/list response
// ---------------------------------------------------------------------------

export interface CodexThreadListResponse {
  threads?: CodexThreadInfo[]
}

export interface CodexThreadInfo {
  id: string
  createdAt?: number
  preview?: string
  name?: string
}

// ---------------------------------------------------------------------------
// thread/fork response
// ---------------------------------------------------------------------------

export interface CodexThreadForkResponse {
  thread?: {
    id?: string
  }
  threadId?: string
}

// ---------------------------------------------------------------------------
// turn/start response
// ---------------------------------------------------------------------------

export interface CodexTurnStartResponse {
  turn?: {
    id?: string
    status?: string
  }
}

// ---------------------------------------------------------------------------
// thread/tokenUsage/updated notification params
// ---------------------------------------------------------------------------

export interface CodexTokenUsageParams {
  tokenUsage?: {
    last?: CodexTokenUsageEntry
    total?: CodexTokenUsageEntry
  }
}

export interface CodexTokenUsageEntry {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
}

// ---------------------------------------------------------------------------
// turn/start params (outbound)
// ---------------------------------------------------------------------------

export interface CodexTurnStartParams {
  threadId: string
  input: CodexTurnInput[]
  approvalPolicy: string
  instructions?: string
  model?: string
  cwd?: string
}

export interface CodexTurnInput {
  type: "text" | "image"
  text?: string
  url?: string
}

// ---------------------------------------------------------------------------
// Item types for event mapper
// ---------------------------------------------------------------------------

/** A single file change entry in a fileChange item */
export interface CodexFileChangeEntry {
  kind?: string
  path?: string
}

/** MCP tool call result shape */
export interface CodexMcpToolResult {
  content?: CodexMcpContentBlock | CodexMcpContentBlock[]
}

export interface CodexMcpContentBlock {
  type: string
  text?: string
}

/** MCP tool call error shape */
export interface CodexMcpToolError {
  message?: string
}
