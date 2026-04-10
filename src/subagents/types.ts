/** Subagent System — Type Definitions */

import type { AgentBackend, EffortLevel, PermissionMode } from "../protocol/types"

// ---------------------------------------------------------------------------
// Agent Definition — parsed from .md frontmatter (Claude Code compatible + extensions)
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  name: string
  description?: string
  systemPrompt: string // markdown body
  backend?: string // "claude" | "gemini" | "copilot" | "codex" | "acp" | "mock"
  model?: string
  permissionMode?: PermissionMode // defaults to "bypassPermissions" for subagents
  maxTurns?: number
  effort?: EffortLevel
  tools?: string[]
  disallowedTools?: string[]
  color?: string // TUI accent color for this agent
  acpCommand?: string // for generic ACP backend
  acpArgs?: string[]
  filePath: string // source file path
}

// ---------------------------------------------------------------------------
// Backend Factory — used by both primary backend and subagent creation
// ---------------------------------------------------------------------------

export interface BackendFactoryOptions {
  backend: string // "claude" | "codex" | "gemini" | "copilot" | "acp" | "mock"
  acpCommand?: string
  acpArgs?: string[]
}

// ---------------------------------------------------------------------------
// Spawn Options — what you pass to SubagentManager.spawn()
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  definition: AgentDefinition
  prompt: string
  backendOverride?: string
  modelOverride?: string
  cwd?: string
  // Fork support: if true and the backend supports it (e.g., Claude's forkSession),
  // the subagent forks the parent's session instead of starting fresh.
  // This preserves conversation context — useful for "try two approaches" workflows.
  forkParentSession?: boolean
}

// ---------------------------------------------------------------------------
// Subagent Status — returned by getStatus() and listAll()
// ---------------------------------------------------------------------------

export interface SubagentStatus {
  subagentId: string
  definitionName: string
  backendName: string
  sessionId?: string // tracked for log inspection
  state: "running" | "completed" | "error"
  description: string
  output: string
  lastToolName?: string
  startTime: number
  endTime?: number
  errorMessage?: string
  // Rich progress metadata — streamed to TUI for at-a-glance visibility
  turnCount: number // how many conversation turns so far
  toolUseCount: number // total tool invocations
  tokenUsage?: {
    // accumulated token usage (when available)
    inputTokens: number
    outputTokens: number
  }
  thinkingActive: boolean // currently in a thinking block
  recentTools: string[] // last N tool names (rolling window, e.g. last 5)
}

// ---------------------------------------------------------------------------
// Running Subagent — internal bookkeeping for SubagentManager
// ---------------------------------------------------------------------------

export interface RunningSubagent {
  subagentId: string
  definition: AgentDefinition
  status: SubagentStatus
  backend: AgentBackend
  /** Queued messages to send on next turn_complete */
  messageQueue: string[]
  /** True while a turn is in progress (between turn_start and turn_complete) */
  midTurn: boolean
}
