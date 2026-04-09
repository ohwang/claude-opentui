/**
 * ACP Protocol Type Definitions
 *
 * Types for the Agent Client Protocol (ACP) wire format.
 * Based on protocol version 1.
 *
 * Reference: https://agentclientprotocol.com/protocol/schema
 */

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

export interface AcpInitializeParams {
  protocolVersion: number
  clientInfo: AcpClientInfo
  clientCapabilities: AcpClientCapabilities
}

export interface AcpClientInfo {
  name: string
  version: string
  title?: string
}

export interface AcpClientCapabilities {
  fs?: {
    readTextFile?: boolean
    writeTextFile?: boolean
  }
  terminal?: boolean
}

export interface AcpInitializeResult {
  protocolVersion: number
  agentInfo: AcpAgentInfo
  agentCapabilities: AcpAgentCapabilities
  authMethods?: AcpAuthMethod[]
}

export interface AcpAgentInfo {
  name: string
  title: string
  version: string
}

export interface AcpAgentCapabilities {
  loadSession?: boolean
  promptCapabilities?: {
    image?: boolean
    audio?: boolean
    embeddedContext?: boolean
  }
  mcpCapabilities?: {
    http?: boolean
    sse?: boolean
  }
}

export interface AcpAuthMethod {
  id: string
  name: string
  description: string
  _meta?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface AcpSessionNewParams {
  cwd: string
  mcpServers: unknown[]
}

export interface AcpSessionNewResult {
  sessionId: string
  modes?: AcpModeState
  models?: AcpModelState
}

export interface AcpModeState {
  availableModes: AcpMode[]
  currentModeId: string
}

export interface AcpMode {
  id: string
  name: string
  description?: string
}

export interface AcpModelState {
  availableModels: AcpModel[]
  currentModelId: string
}

export interface AcpModel {
  modelId: string
  name: string
  description?: string
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface AcpPromptParams {
  sessionId: string
  prompt: AcpContentBlock[]
}

export interface AcpPromptResult {
  stopReason: string
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type AcpContentBlock =
  | AcpTextContent
  | AcpImageContent
  | AcpResourceLink

export interface AcpTextContent {
  type: "text"
  text: string
}

export interface AcpImageContent {
  type: "image"
  mimeType: string
  data: string // base64
  uri?: string
}

export interface AcpResourceLink {
  type: "resource_link"
  uri: string
  name: string
  mimeType?: string
}

// ---------------------------------------------------------------------------
// Session Update (streaming notifications)
// ---------------------------------------------------------------------------

export interface AcpSessionUpdateParams {
  sessionId: string
  update: AcpUpdate
}

export type AcpUpdate =
  | AcpAgentMessageChunk
  | AcpToolCall
  | AcpToolCallUpdate
  | AcpPlanUpdate
  | AcpAvailableCommandsUpdate
  | AcpGenericUpdate

export interface AcpAgentMessageChunk {
  sessionUpdate: "agent_message_chunk"
  content: AcpContentBlock
}

export interface AcpToolCall {
  sessionUpdate: "tool_call"
  toolCallId: string
  title?: string
  kind?: string
  status: string
  content: AcpToolContent[]
  locations?: AcpLocation[]
  rawInput?: unknown
  rawOutput?: unknown
}

export interface AcpToolCallUpdate {
  sessionUpdate: "tool_call_update"
  toolCallId: string
  title?: string
  kind?: string
  status?: string
  content?: AcpToolContent[]
  locations?: AcpLocation[]
  rawInput?: unknown
  rawOutput?: unknown
}

export interface AcpPlanUpdate {
  sessionUpdate: "plan"
  entries: unknown[]
}

export interface AcpAvailableCommandsUpdate {
  sessionUpdate: "available_commands_update"
  availableCommands: AcpSlashCommand[]
}

export interface AcpGenericUpdate {
  sessionUpdate: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Tool content
// ---------------------------------------------------------------------------

export type AcpToolContent =
  | { type: "content"; content: AcpContentBlock }
  | { type: "diff"; path: string; oldText: string; newText: string }
  | { type: "terminal"; terminalId: string }

export interface AcpLocation {
  path: string
  line?: number
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

export interface AcpSlashCommand {
  name: string
  description?: string
}

// ---------------------------------------------------------------------------
// Permission request (server-initiated request)
// ---------------------------------------------------------------------------

export interface AcpPermissionRequestParams {
  sessionId: string
  toolCall: {
    toolCallId: string
  }
  options: AcpPermissionOption[]
}

export interface AcpPermissionOption {
  optionId: string
  name: string
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always"
}

export interface AcpPermissionResponse {
  outcome: {
    outcome: "selected" | "cancelled"
    optionId?: string
  }
}

// ---------------------------------------------------------------------------
// Cancel (notification, not request)
// ---------------------------------------------------------------------------

export interface AcpCancelParams {
  sessionId: string
}

// ---------------------------------------------------------------------------
// Set mode
// ---------------------------------------------------------------------------

export interface AcpSetModeParams {
  sessionId: string
  modeId: string
}

// ---------------------------------------------------------------------------
// Filesystem (agent-initiated requests to client)
// ---------------------------------------------------------------------------

export interface AcpFsReadParams {
  sessionId: string
  path: string
  line?: number
  limit?: number
}

export interface AcpFsWriteParams {
  sessionId: string
  path: string
  content: string
}

// ---------------------------------------------------------------------------
// ACP presets for known agents
// ---------------------------------------------------------------------------

export interface AcpPreset {
  command: string
  args: string[]
  displayName: string
}

export const ACP_PRESETS: Record<string, AcpPreset> = {
  "gemini-acp": {
    command: "gemini",
    args: ["--acp"],
    displayName: "Gemini CLI (ACP)",
  },
  "copilot-acp": {
    command: "gh",
    args: ["copilot", "acp-server"],
    displayName: "GitHub Copilot (ACP)",
  },
}
