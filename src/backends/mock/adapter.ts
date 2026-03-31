/**
 * Mock Backend — For development and testing
 *
 * Simulates a Claude-like backend without needing the SDK.
 * Streams fake responses with delays to test TUI rendering.
 *
 * Usage: bun run dev -- --backend mock
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

type PendingResolve = (result: { behavior: "allow" | "deny"; message?: string }) => void

export class MockAdapter implements AgentBackend {
  private messageQueue: UserMessage[] = []
  private waitingForMessage: ((msg: UserMessage) => void) | null = null
  private pendingPermission: { id: string; resolve: PendingResolve } | null = null
  private pendingElicitation: { id: string; resolve: PendingResolve } | null = null
  private interrupted = false
  private closed = false

  capabilities(): BackendCapabilities {
    return {
      name: "mock",
      supportsThinking: true,
      supportsToolApproval: true,
      supportsResume: false,
      supportsFork: false,
      supportsStreaming: true,
      supportsSubagents: true,
      supportedPermissionModes: ["default"],
    }
  }

  async *start(_config: SessionConfig): AsyncGenerator<AgentEvent> {
    // Emit session_init immediately
    yield {
      type: "session_init",
      tools: [
        { name: "Read" },
        { name: "Write" },
        { name: "Edit" },
        { name: "Bash" },
        { name: "Grep" },
        { name: "Glob" },
      ],
      models: [
        { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
        { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
      ],
    }

    // Process messages in a loop
    while (!this.closed) {
      const message = await this.nextMessage()
      if (!message || this.closed) break

      // Generate a mock response for each message
      yield* this.generateResponse(message)
    }
  }

  async *resume(_sessionId: string): AsyncGenerator<AgentEvent> {
    yield* this.start({})
  }

  sendMessage(message: UserMessage): void {
    if (this.waitingForMessage) {
      const resolve = this.waitingForMessage
      this.waitingForMessage = null
      resolve(message)
    } else {
      this.messageQueue.push(message)
    }
  }

  interrupt(): void {
    this.interrupted = true
    if (this.pendingPermission) {
      this.pendingPermission.resolve({ behavior: "deny", message: "Interrupted" })
      this.pendingPermission = null
    }
    if (this.pendingElicitation) {
      this.pendingElicitation.resolve({ behavior: "deny", message: "Interrupted" })
      this.pendingElicitation = null
    }
  }

  approveToolUse(id: string): void {
    if (this.pendingPermission?.id === id) {
      this.pendingPermission.resolve({ behavior: "allow" })
      this.pendingPermission = null
    }
  }

  denyToolUse(id: string, reason?: string, _options?: { denyForSession?: boolean }): void {
    if (this.pendingPermission?.id === id) {
      this.pendingPermission.resolve({ behavior: "deny", message: reason })
      this.pendingPermission = null
    }
  }

  respondToElicitation(id: string, _answers: Record<string, string>): void {
    if (this.pendingElicitation?.id === id) {
      this.pendingElicitation.resolve({ behavior: "allow" })
      this.pendingElicitation = null
    }
  }

  cancelElicitation(id: string): void {
    if (this.pendingElicitation?.id === id) {
      this.pendingElicitation.resolve({ behavior: "deny", message: "User declined to answer" })
      this.pendingElicitation = null
    }
  }

  async setModel(_model: string): Promise<void> {}
  async setPermissionMode(_mode: PermissionMode): Promise<void> {}

  async availableModels(): Promise<ModelInfo[]> {
    return [
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    ]
  }

  async listSessions(): Promise<SessionInfo[]> {
    return []
  }

  async forkSession(): Promise<string> {
    throw new Error("Mock adapter does not support forking")
  }

  close(): void {
    this.closed = true
    if (this.waitingForMessage) {
      this.waitingForMessage(null as any)
      this.waitingForMessage = null
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private nextMessage(): Promise<UserMessage | null> {
    const queued = this.messageQueue.shift()
    if (queued) return Promise.resolve(queued)
    if (this.closed) return Promise.resolve(null)

    return new Promise((resolve) => {
      this.waitingForMessage = resolve
    })
  }

  private async *generateResponse(message: UserMessage): AsyncGenerator<AgentEvent> {
    this.interrupted = false

    yield { type: "turn_start" }

    const text = message.text.toLowerCase()

    // Simulate thinking for certain prompts
    if (text.includes("think") || text.length > 50) {
      yield { type: "thinking_delta", text: "Let me think about this..." }
      await this.delay(300)
      yield { type: "thinking_delta", text: " I'll analyze the request carefully." }
      await this.delay(200)
    }

    // Simulate tool use for certain prompts
    if (text.includes("read") || text.includes("file")) {
      yield* this.simulateToolUse()
    }

    // Simulate permission request
    if (text.includes("permission") || text.includes("bash")) {
      yield* this.simulatePermission()
    }

    // Simulate subagent/task
    if (text.includes("agent") || text.includes("task")) {
      yield* this.simulateTasks()
    }

    // Simulate elicitation (ask user question)
    if (text.includes("ask") || text.includes("question")) {
      yield* this.simulateElicitation()
    }

    // Stream the response text
    const response = this.getResponse(text)
    const words = response.split(" ")

    for (let i = 0; i < words.length; i++) {
      if (this.interrupted) {
        yield { type: "text_delta", text: "\n\n*[interrupted]*" }
        break
      }
      yield { type: "text_delta", text: (i > 0 ? " " : "") + words[i] }
      // Emit live cost updates every few words
      if (i > 0 && i % 5 === 0) {
        yield {
          type: "cost_update",
          inputTokens: 0,
          outputTokens: words[i].length * 5,
          cost: 0.0001,
        }
      }
      await this.delay(30 + Math.random() * 40)
    }

    yield { type: "text_complete", text: response }

    yield {
      type: "turn_complete",
      usage: {
        inputTokens: message.text.length * 2,
        outputTokens: response.length,
        totalCostUsd: 0.001 + Math.random() * 0.005,
      },
    }
  }

  private async *simulateToolUse(): AsyncGenerator<AgentEvent> {
    const toolId = `tool_${Date.now()}`

    yield {
      type: "tool_use_start",
      id: toolId,
      tool: "Read",
      input: { file_path: "/src/protocol/types.ts" },
    }

    await this.delay(200)

    yield {
      type: "tool_use_progress",
      id: toolId,
      output: "Reading file...",
    }

    await this.delay(300)

    yield {
      type: "tool_use_end",
      id: toolId,
      output: "interface AgentBackend {\n  start(): AsyncGenerator<AgentEvent>\n  sendMessage(msg: UserMessage): void\n  ...\n}",
    }
  }

  private async *simulatePermission(): AsyncGenerator<AgentEvent> {
    const permId = `perm_${Date.now()}`

    yield {
      type: "permission_request",
      id: permId,
      tool: "Bash",
      input: { command: "echo 'hello world'" },
    }

    // Wait for approve/deny
    const result = await new Promise<{ behavior: "allow" | "deny" }>((resolve) => {
      this.pendingPermission = {
        id: permId,
        resolve: (r) => resolve(r),
      }
    })

    // Emit permission_response to transition state machine back to RUNNING
    yield { type: "permission_response", id: permId, behavior: result.behavior }
  }

  private async *simulateTasks(): AsyncGenerator<AgentEvent> {
    const task1 = `task_${Date.now()}_1`
    const task2 = `task_${Date.now()}_2`

    yield { type: "task_start", taskId: task1, description: "Researching codebase" }
    await this.delay(300)
    yield { type: "task_start", taskId: task2, description: "Running tests" }
    await this.delay(500)
    yield { type: "task_complete", taskId: task1, output: "Found 12 relevant files" }
    await this.delay(400)
    yield { type: "task_complete", taskId: task2, output: "All 97 tests passing" }
  }

  private async *simulateElicitation(): AsyncGenerator<AgentEvent> {
    const elicId = `elic_${Date.now()}`

    yield {
      type: "elicitation_request",
      id: elicId,
      questions: [
        {
          question: "Which framework would you like to use?",
          options: [
            { label: "React" },
            { label: "SolidJS" },
            { label: "Vue" },
            { label: "Svelte" },
          ],
          allowFreeText: true,
        },
      ],
    }

    // Wait for user response
    const result = await new Promise<{ behavior: "allow" | "deny" }>((resolve) => {
      this.pendingElicitation = {
        id: elicId,
        resolve: (r) => resolve(r),
      }
    })

    // Emit elicitation_response to transition state machine back to RUNNING
    yield { type: "elicitation_response", id: elicId, answers: {} }

    if (result.behavior === "deny") {
      yield { type: "text_delta", text: "\n\nOk, I'll skip that question.\n\n" }
    }
  }

  private getResponse(input: string): string {
    if (input.includes("hello") || input.includes("hi")) {
      return "Hello! I'm the mock backend for claude-opentui. I simulate Claude's responses for TUI development. Try asking me to read a file or run a bash command to see tool use and permission flows."
    }
    if (input.includes("help")) {
      return "I can simulate:\n- **Streaming text** (every message)\n- **Thinking blocks** (include 'think' in your message)\n- **Tool use** (include 'read' or 'file')\n- **Permission prompts** (include 'permission' or 'bash')\n- **Elicitations** (include 'ask' or 'question')\n- **Subagents** (include 'agent' or 'task')\n- **Interrupts** (press Ctrl+C while I'm streaming)"
    }
    if (input.includes("error")) {
      return "This would be an error scenario in the real backend."
    }
    return `You said: "${input}"\n\nThis is a mock response from the development backend. The real Claude backend will provide actual AI-generated responses. The mock lets you test the TUI rendering, tool display, permission flow, and keyboard shortcuts without an API key.`
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
