/**
 * Claude Agent SDK V1 Adapter
 *
 * Maps the SDK's query() API to our AgentBackend interface.
 *
 * Key patterns:
 * - AsyncIterable prompt mode for multi-turn message queuing
 * - canUseTool callback bridges permission_request ↔ approveToolUse/denyToolUse
 * - Single AsyncGenerator for the entire session (not per-turn)
 * - Process lifecycle management (SIGINT/SIGTERM/SIGHUP cleanup)
 */

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk"
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
import { EventChannel } from "../../utils/event-channel"

// ---------------------------------------------------------------------------
// Types for bridging SDK ↔ adapter
// ---------------------------------------------------------------------------

type SDKQuery = ReturnType<typeof sdkQuery>

interface PendingPermission {
  resolve: (result: PermissionResult) => void
  reject: (error: Error) => void
}

interface PermissionResult {
  behavior: "allow" | "deny"
  updatedInput?: Record<string, unknown>
  updatedPermissions?: unknown[]
  message?: string
  interrupt?: boolean
}

interface PendingElicitation {
  resolve: (result: PermissionResult) => void
  reject: (error: Error) => void
}

// ---------------------------------------------------------------------------
// Async queue for message queuing
// ---------------------------------------------------------------------------

class AsyncQueue<T> {
  private queue: T[] = []
  private waiting: ((value: T) => void)[] = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiting.shift()
    if (waiter) {
      waiter(item)
    } else {
      this.queue.push(item)
    }
  }

  async pull(): Promise<T> {
    const item = this.queue.shift()
    if (item !== undefined) return item
    if (this.closed) throw new Error("Queue closed")
    return new Promise<T>((resolve) => {
      this.waiting.push(resolve)
    })
  }

  close(): void {
    this.closed = true
    // Reject waiting pulls so the iterable ends
    for (const waiter of this.waiting) {
      waiter(null as any)
    }
    this.waiting = []
  }

  get size(): number {
    return this.queue.length
  }
}

// ---------------------------------------------------------------------------
// Claude V1 Adapter
// ---------------------------------------------------------------------------

export class ClaudeAdapter implements AgentBackend {
  private activeQuery: SDKQuery | null = null
  private messageQueue = new AsyncQueue<UserMessage>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingElicitations = new Map<string, PendingElicitation>()
  private childPid: number | null = null
  private eventChannel: EventChannel<AgentEvent> | null = null
  private closed = false

  // Tool input JSON accumulation from streaming deltas
  private toolInputJsons = new Map<string, string>()
  private currentToolIds = new Map<number, string>()

  capabilities(): BackendCapabilities {
    return {
      name: "claude",
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

  async *start(config: SessionConfig): AsyncGenerator<AgentEvent> {
    // Build SDK options
    const options = this.buildOptions(config)

    // Create the message iterable for multi-turn
    const messageIterable = this.createMessageIterable(config)

    // Start the query
    this.activeQuery = sdkQuery({
      prompt: messageIterable,
      options,
    })

    // Iterate SDK messages — let the underlying claude binary handle auth/errors
    yield* this.iterateQuery()
  }

  async *resume(sessionId: string): AsyncGenerator<AgentEvent> {
    const config: SessionConfig = { resume: sessionId }
    yield* this.start(config)
  }

  sendMessage(message: UserMessage): void {
    this.messageQueue.push(message)
  }

  interrupt(): void {
    if (this.activeQuery) {
      // Auto-deny any pending permissions (prevent SDK deadlock)
      for (const [id, pending] of this.pendingPermissions) {
        pending.resolve({
          behavior: "deny",
          message: "Interrupted by user",
          interrupt: true,
        })
      }
      this.pendingPermissions.clear()

      // Auto-respond to pending elicitations
      for (const [id, pending] of this.pendingElicitations) {
        pending.resolve({
          behavior: "deny",
          message: "Interrupted by user",
          interrupt: true,
        })
      }
      this.pendingElicitations.clear()

      this.activeQuery.interrupt()
    }
  }

  approveToolUse(
    id: string,
    options?: { updatedInput?: unknown; alwaysAllow?: boolean },
  ): void {
    const pending = this.pendingPermissions.get(id)
    if (!pending) return

    const result: PermissionResult = {
      behavior: "allow",
      updatedInput: options?.updatedInput as Record<string, unknown>,
    }
    pending.resolve(result)
    this.pendingPermissions.delete(id)

    // Emit event to transition state machine WAITING_FOR_PERM → RUNNING
    this.eventChannel?.push({ type: "permission_response", id, behavior: "allow" })
  }

  denyToolUse(id: string, reason?: string): void {
    const pending = this.pendingPermissions.get(id)
    if (!pending) return

    pending.resolve({
      behavior: "deny",
      message: reason ?? "Denied by user",
    })
    this.pendingPermissions.delete(id)

    // Emit event to transition state machine WAITING_FOR_PERM → RUNNING
    this.eventChannel?.push({ type: "permission_response", id, behavior: "deny" })
  }

  respondToElicitation(id: string, answers: Record<string, string>): void {
    const pending = this.pendingElicitations.get(id)
    if (!pending) return

    // For AskUserQuestion, we pass the answer back via the allow behavior
    // The SDK expects the answer in updatedInput
    pending.resolve({
      behavior: "allow",
      updatedInput: answers,
    })
    this.pendingElicitations.delete(id)
  }

  async setModel(model: string): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.setModel(model)
    }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.setPermissionMode(mode)
    }
  }

  async availableModels(): Promise<ModelInfo[]> {
    if (!this.activeQuery) return []
    const models = await this.activeQuery.supportedModels()
    return models.map((m: any) => ({
      id: m.id ?? m.model,
      name: m.name ?? m.model,
      provider: "anthropic",
    }))
  }

  async listSessions(): Promise<SessionInfo[]> {
    // Session listing is handled by the SDK's file-based storage
    // We'd need to read ~/.claude/projects/ directly
    // For now, return empty - the TUI can implement this at the filesystem level
    return []
  }

  async forkSession(
    _sessionId: string,
    _options?: ForkOptions,
  ): Promise<string> {
    // Forking creates a new session with copied history
    // Handled via the SDK's forkSession option
    throw new Error("Fork via start() with config.forkSession = true")
  }

  close(): void {
    this.closed = true
    this.messageQueue.close()

    // Close the event channel (unblocks iterateQuery consumer)
    if (this.eventChannel) {
      this.eventChannel.close()
      this.eventChannel = null
    }

    // Close the active query
    if (this.activeQuery) {
      this.activeQuery.close()
      this.activeQuery = null
    }

    // Clean up any pending permission promises
    for (const [, pending] of this.pendingPermissions) {
      pending.reject(new Error("Adapter closed"))
    }
    this.pendingPermissions.clear()

    for (const [, pending] of this.pendingElicitations) {
      pending.reject(new Error("Adapter closed"))
    }
    this.pendingElicitations.clear()
  }

  // -----------------------------------------------------------------------
  // Private: SDK message → AgentEvent mapping
  // -----------------------------------------------------------------------

  private async *iterateQuery(): AsyncGenerator<AgentEvent> {
    if (!this.activeQuery) return

    this.eventChannel = new EventChannel<AgentEvent>()

    // Run SDK iteration in background — pushes events to channel.
    // This decouples the SDK's async iterable from the consumer, so
    // canUseTool callbacks can push permission_request events to the
    // same channel without waiting for the SDK to yield next.
    const sdkLoop = (async () => {
      try {
        for await (const msg of this.activeQuery!) {
          if (this.closed) break
          const events = this.mapSDKMessage(msg)
          for (const event of events) {
            this.eventChannel!.push(event)
          }
        }
      } catch (err) {
        if (!this.closed) {
          this.eventChannel!.push({
            type: "error" as const,
            code: "adapter_error",
            message: err instanceof Error ? err.message : String(err),
            severity: "fatal" as const,
          })
        }
      }
      this.eventChannel!.close()
    })()

    // Yield from channel — receives both SDK events AND canUseTool callback events
    yield* this.eventChannel[Symbol.asyncIterator]()
  }

  private mapSDKMessage(msg: any): AgentEvent[] {
    const events: AgentEvent[] = []

    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          events.push({
            type: "session_init",
            tools: (msg.tools ?? []).map((t: string) => ({
              name: t,
            })),
            models: [], // Populated via availableModels()
            account: msg.account,
          })
        } else if (msg.subtype === "status") {
          if (msg.status === "compacting") {
            events.push({
              type: "compact",
              summary: "Conversation context is being compacted...",
            })
          }
        }
        break

      case "stream_event":
        events.push(...this.mapStreamEvent(msg.event, msg.parent_tool_use_id))
        break

      case "assistant":
        // Full assistant message (contains complete content blocks)
        // We use stream_event for real-time updates, so this is a no-op
        // unless we want to emit text_complete for the full message
        break

      case "result":
        if (msg.subtype === "success" || !msg.is_error) {
          events.push({
            type: "turn_complete",
            usage: {
              inputTokens: msg.usage?.input_tokens ?? 0,
              outputTokens: msg.usage?.output_tokens ?? 0,
              cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0,
              cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
              totalCostUsd: msg.total_cost_usd ?? 0,
            },
          })
        } else {
          events.push({
            type: "error",
            code: msg.subtype ?? "error_during_execution",
            message: msg.errors?.join(", ") ?? "Unknown error",
            severity: "fatal",
          })
          events.push({
            type: "turn_complete",
            usage: {
              inputTokens: msg.usage?.input_tokens ?? 0,
              outputTokens: msg.usage?.output_tokens ?? 0,
              totalCostUsd: msg.total_cost_usd ?? 0,
            },
          })
        }
        break

      case "tool_progress":
        events.push({
          type: "tool_use_progress",
          id: msg.tool_use_id,
          output: `[${msg.tool_name}] ${msg.elapsed_time_seconds}s elapsed`,
        })
        break

      case "task_started":
        events.push({
          type: "task_start",
          taskId: msg.task_id ?? msg.uuid,
          description: msg.description ?? "Background task",
        })
        break

      case "task_progress":
        events.push({
          type: "task_progress",
          taskId: msg.task_id ?? msg.uuid,
          output: msg.content ?? "",
        })
        break

      case "task_notification":
        events.push({
          type: "task_complete",
          taskId: msg.task_id ?? msg.uuid,
          output: msg.content ?? msg.result ?? "",
        })
        break

      case "rate_limit":
        events.push({
          type: "error",
          code: "rate_limit",
          message: "Rate limited by API",
          severity: "recoverable",
        })
        break

      default:
        // Pass through unknown types for debugging
        events.push({
          type: "backend_specific",
          backend: "claude",
          data: msg,
        })
    }

    return events
  }

  private mapStreamEvent(event: any, parentToolUseId: string | null): AgentEvent[] {
    const events: AgentEvent[] = []

    switch (event.type) {
      case "message_start":
        events.push({ type: "turn_start" })
        break

      case "content_block_start": {
        const block = event.content_block
        if (block?.type === "tool_use") {
          this.currentToolIds.set(event.index, block.id)
          this.toolInputJsons.set(block.id, "")
          events.push({
            type: "tool_use_start",
            id: block.id,
            tool: block.name,
            input: {},
          })
        }
        // text and thinking blocks are just markers; content comes via deltas
        break
      }

      case "content_block_delta": {
        const delta = event.delta
        if (delta?.type === "text_delta") {
          events.push({ type: "text_delta", text: delta.text })
        } else if (delta?.type === "thinking_delta") {
          events.push({ type: "thinking_delta", text: delta.thinking })
        } else if (delta?.type === "input_json_delta") {
          // Accumulate tool input JSON fragments
          const toolId = this.currentToolIds.get(event.index)
          if (toolId) {
            const prev = this.toolInputJsons.get(toolId) ?? ""
            this.toolInputJsons.set(toolId, prev + delta.partial_json)
          }
        }
        break
      }

      case "content_block_stop": {
        const toolId = this.currentToolIds.get(event.index)
        if (toolId) {
          const jsonStr = this.toolInputJsons.get(toolId)
          if (jsonStr) {
            try {
              const parsedInput = JSON.parse(jsonStr)
              events.push({
                type: "tool_use_progress",
                id: toolId,
                output: "",
                input: parsedInput,
              })
            } catch {
              // JSON parse failed — leave input as-is
            }
          }
          this.currentToolIds.delete(event.index)
          this.toolInputJsons.delete(toolId)
        }
        break
      }

      case "message_delta":
        // Contains stop_reason and usage delta. Cost update.
        if (event.usage) {
          events.push({
            type: "cost_update",
            inputTokens: 0,
            outputTokens: event.usage.output_tokens ?? 0,
          })
        }
        break

      case "message_stop":
        // Message is complete. The result message follows with full usage.
        break
    }

    return events
  }

  // -----------------------------------------------------------------------
  // Private: Build SDK options from SessionConfig
  // -----------------------------------------------------------------------

  private buildOptions(config: SessionConfig): any {
    return {
      model: config.model,
      permissionMode: config.permissionMode,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      cwd: config.cwd,
      continue: config.continue,
      resume: config.resume,
      sessionId: config.resume,
      forkSession: config.forkSession,
      mcpServers: config.mcpServers,
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      additionalDirectories: config.additionalDirectories,
      canUseTool: this.createCanUseTool(),
      includePartialMessages: true,
    }
  }

  // -----------------------------------------------------------------------
  // Private: canUseTool callback (permission + elicitation bridge)
  // -----------------------------------------------------------------------

  private createCanUseTool() {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      options: any,
    ): Promise<PermissionResult> => {
      const id = options?.toolUseID ?? crypto.randomUUID()

      // Detect AskUserQuestion (elicitation)
      if (toolName === "AskUserQuestion") {
        return this.handleElicitation(id, input)
      }

      // Normal permission request
      return this.handlePermission(id, toolName, input, options)
    }
  }

  private handlePermission(
    id: string,
    toolName: string,
    input: Record<string, unknown>,
    options: any,
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve, reject) => {
      this.pendingPermissions.set(id, { resolve, reject })

      // Push permission_request to the event channel so the TUI sees it
      // immediately, even while the SDK is blocked waiting for canUseTool
      this.eventChannel?.push({
        type: "permission_request",
        id,
        tool: toolName,
        input,
        suggestions: options?.suggestions,
      })
    })
  }

  private handleElicitation(
    id: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve, reject) => {
      this.pendingElicitations.set(id, { resolve, reject })

      // Parse AskUserQuestion input into ElicitationQuestion[]
      const questions = this.parseElicitationInput(input)

      // Push elicitation_request to the event channel so the TUI sees it
      // immediately, even while the SDK is blocked waiting for the callback
      this.eventChannel?.push({
        type: "elicitation_request",
        id,
        questions,
      })
    })
  }

  private parseElicitationInput(input: Record<string, unknown>): any[] {
    // AskUserQuestion input shape varies, but generally has:
    // { question: string, options: string[] } or similar
    const question = (input.question as string) ?? "Choose an option"
    const options = (input.options as string[]) ?? []

    return [
      {
        question,
        options: options.map((opt: string, i: number) => ({
          label: opt,
          value: String(i),
        })),
        allowFreeText: true,
      },
    ]
  }

  // -----------------------------------------------------------------------
  // Private: Message iterable for multi-turn
  // -----------------------------------------------------------------------

  private async *createMessageIterable(
    config: SessionConfig,
  ): AsyncGenerator<any> {
    // First message from config or wait for user
    if (config.resume || config.continue) {
      // Resuming: don't send an initial message, wait for user
    }

    // Yield messages as the user sends them
    while (!this.closed) {
      try {
        const message = await this.messageQueue.pull()
        yield this.toSDKUserMessage(message)
      } catch {
        break
      }
    }
  }

  private toSDKUserMessage(message: UserMessage): any {
    const content: any[] = [{ type: "text", text: message.text }]

    if (message.images) {
      for (const img of message.images) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType,
            data: img.data,
          },
        })
      }
    }

    return {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: "", // SDK fills this in
    }
  }
}
