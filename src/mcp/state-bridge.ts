/**
 * State Bridge — module-level mutable refs connecting SolidJS state to the MCP server.
 *
 * SolidJS components call the setters on each update. The MCP server reads
 * via getSnapshot(). No SolidJS imports — pure TypeScript.
 *
 * Same pattern as _cleanExit in app.tsx and _scrollDiagnostics in diagnostics.tsx.
 */

import type { ConversationState, AgentBackend, SessionConfig } from "../protocol/types"
import type { CliRenderer } from "@opentui/core"
import type { SubagentManager } from "../subagents/manager"

export interface StateSnapshot {
  conversationState: ConversationState | null
  backend: AgentBackend | null
  config: SessionConfig | null
  renderer: CliRenderer | null
  subagentManager: SubagentManager | null
}

let _conversationState: ConversationState | null = null
let _backend: AgentBackend | null = null
let _config: SessionConfig | null = null
let _renderer: CliRenderer | null = null
let _subagentManager: SubagentManager | null = null

export function setConversationState(state: ConversationState): void {
  _conversationState = state
}

export function setBackend(backend: AgentBackend): void {
  _backend = backend
}

export function setConfig(config: SessionConfig): void {
  _config = config
}

export function setRenderer(renderer: CliRenderer): void {
  _renderer = renderer
}

export function setSubagentManagerBridge(mgr: SubagentManager): void {
  _subagentManager = mgr
}

export function getSubagentManagerBridge(): SubagentManager | null {
  return _subagentManager
}

export function getSnapshot(): StateSnapshot {
  return {
    conversationState: _conversationState,
    backend: _backend,
    config: _config,
    renderer: _renderer,
    subagentManager: _subagentManager,
  }
}
