/**
 * NoopBackend — Inert AgentBackend for storybook use.
 * Never yields events, never starts a generator.
 */

import type {
  AgentBackend,
  AgentEvent,
  BackendCapabilities,
  EffortLevel,
  ModelInfo,
  SessionConfig,
  SessionInfo,
  UserMessage,
  PermissionMode,
} from "../../protocol/types"

export class NoopBackend implements AgentBackend {
  async *start(_config: SessionConfig): AsyncGenerator<AgentEvent> {
    // Never yields — storybook seeds state via context overrides
  }

  sendMessage(_message: UserMessage): void {}
  interrupt(): void {}

  async *resume(_sessionId: string): AsyncGenerator<AgentEvent> {}

  async listSessions(): Promise<SessionInfo[]> {
    return []
  }

  async forkSession(_sessionId: string): Promise<string> {
    return ""
  }

  approveToolUse(_id: string): void {}
  denyToolUse(_id: string): void {}
  respondToElicitation(_id: string, _answers: Record<string, string>): void {}
  cancelElicitation(_id: string): void {}

  async setModel(_model: string): Promise<void> {}
  async setPermissionMode(_mode: PermissionMode): Promise<void> {}
  async setEffort(_level: EffortLevel): Promise<void> {}

  capabilities(): BackendCapabilities {
    return {
      name: "noop",
      supportsThinking: true,
      supportsToolApproval: true,
      supportsResume: false,
      supportsContinue: false,
      supportsFork: false,
      supportsStreaming: true,
      supportsSubagents: true,
      supportsCompact: true,
      supportedPermissionModes: ["default"],
    }
  }

  async availableModels(): Promise<ModelInfo[]> {
    return [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }]
  }

  close(): void {}
}
