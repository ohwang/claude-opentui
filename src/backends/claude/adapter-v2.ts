/**
 * Claude Agent SDK V2 Adapter (Experimental)
 *
 * Uses the unstable_v2_createSession/resumeSession API.
 * Behind --backend claude-v2 feature flag.
 *
 * V2 API provides a natural session-level abstraction:
 *   createSession() → session.send() → session.stream()
 *
 * This is a skeleton. The V2 API is unstable_ prefixed and may change.
 */

import type {
  AgentBackend,
  AgentEvent,
  BackendCapabilities,
  ForkOptions,
  ModelInfo,
  PermissionMode,
  SessionConfig,
  SessionInfo,
  UserMessage,
} from "../../protocol/types"

export class ClaudeV2Adapter implements AgentBackend {
  capabilities(): BackendCapabilities {
    return {
      name: "claude-v2",
      supportsThinking: true,
      supportsToolApproval: true,
      supportsResume: true,
      supportsFork: true,
      supportsStreaming: true,
      supportsSubagents: true,
      supportedPermissionModes: [
        "default",
        "acceptEdits",
        "bypassPermissions",
        "plan",
        "dontAsk",
      ],
    }
  }

  async *start(_config: SessionConfig): AsyncGenerator<AgentEvent> {
    yield {
      type: "error",
      code: "not_implemented",
      message:
        "Claude V2 adapter is experimental and not yet implemented. " +
        "Use --backend claude (default) for the stable V1 adapter.",
      severity: "fatal",
    }
  }

  async *resume(_sessionId: string): AsyncGenerator<AgentEvent> {
    yield* this.start({})
  }

  sendMessage(_message: UserMessage): void {
    // Not implemented
  }

  interrupt(): void {
    // Not implemented
  }

  approveToolUse(_id: string): void {
    // Not implemented
  }

  denyToolUse(_id: string, _reason?: string, _options?: { denyForSession?: boolean }): void {
    // Not implemented
  }

  respondToElicitation(_id: string, _answers: Record<string, string>): void {
    // Not implemented
  }

  cancelElicitation(_id: string): void {
    // Not implemented
  }

  async setModel(_model: string): Promise<void> {
    // Not implemented
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    // Not implemented
  }

  async availableModels(): Promise<ModelInfo[]> {
    return []
  }

  async listSessions(): Promise<SessionInfo[]> {
    return []
  }

  async forkSession(_sessionId: string, _options?: ForkOptions): Promise<string> {
    throw new Error("Not implemented")
  }

  close(): void {
    // Nothing to clean up
  }
}
