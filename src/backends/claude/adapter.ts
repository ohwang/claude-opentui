/**
 * Claude Agent SDK V1 Adapter
 *
 * Maps the SDK's query() API to our AgentBackend interface.
 *
 * Key patterns:
 * - AsyncIterable prompt mode for multi-turn message queuing
 * - canUseTool callback bridges permission_request <-> approveToolUse/denyToolUse
 * - Single AsyncGenerator for the entire session (not per-turn)
 * - Process lifecycle management (SIGINT/SIGTERM/SIGHUP cleanup)
 */

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk"
import { log } from "../../utils/logger"
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
import { AsyncQueue } from "../../utils/async-queue"
import { backendTrace } from "../../utils/backend-trace"

const trace = backendTrace.scoped("claude")

import { mapSDKMessage, ToolStreamState } from "./event-mapper"
import {
  createCanUseTool,
  handlePermission,
  handleElicitation,
  parseElicitationInput,
  type PendingPermission,
  type PendingElicitation,
  type PermissionResult,
  type PermissionBridgeState,
} from "./permission-bridge"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SDKQuery = ReturnType<typeof sdkQuery>

// ---------------------------------------------------------------------------
// Claude V1 Adapter
// ---------------------------------------------------------------------------

export class ClaudeAdapter implements AgentBackend {
  private static sdkVersion: string = (() => {
    try { return require("@anthropic-ai/claude-agent-sdk/package.json").version } catch { return "unknown" }
  })()

  private activeQuery: SDKQuery | null = null
  private messageQueue = new AsyncQueue<UserMessage>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingElicitations = new Map<string, PendingElicitation>()
  private pendingElicitationInputs = new Map<string, Record<string, unknown>>()
  private childPid: number | null = null
  private eventChannel: EventChannel<AgentEvent> | null = null
  private closed = false

  // Tool input JSON accumulation from streaming deltas
  private streamState = new ToolStreamState()

  // Tools denied for the duration of this session (via "deny for session" option)
  private sessionDeniedTools = new Set<string>()

  // Permission bridge state (passed to extracted functions)
  private get bridgeState(): PermissionBridgeState {
    return {
      pendingPermissions: this.pendingPermissions,
      pendingElicitations: this.pendingElicitations,
      pendingElicitationInputs: this.pendingElicitationInputs,
      sessionDeniedTools: this.sessionDeniedTools,
      getEventChannel: () => this.eventChannel,
    }
  }

  capabilities(): BackendCapabilities {
    return {
      name: "claude",
      sdkVersion: ClaudeAdapter.sdkVersion,
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
    trace.write({
      dir: "out",
      stage: "sdk_call",
      type: "query",
      payload: { options },
    })
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
    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "sendMessage",
      payload: message,
    })
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
      this.pendingElicitationInputs.clear()

      this.activeQuery.interrupt()
    }
  }

  approveToolUse(
    id: string,
    options?: { updatedInput?: unknown; alwaysAllow?: boolean; updatedPermissions?: any[] },
  ): void {
    const pending = this.pendingPermissions.get(id)
    if (!pending) return

    const result: PermissionResult = {
      behavior: "allow",
      updatedInput: (options?.updatedInput as Record<string, unknown>) ?? pending.input,
      updatedPermissions: options?.updatedPermissions,
      toolUseID: id,
      decisionClassification: options?.alwaysAllow ? "user_permanent" : "user_temporary",
    }
    pending.resolve(result)
    this.pendingPermissions.delete(id)

    // Emit event to transition state machine WAITING_FOR_PERM -> RUNNING
    this.eventChannel?.push({ type: "permission_response", id, behavior: "allow" })
  }

  denyToolUse(id: string, reason?: string, options?: { denyForSession?: boolean }): void {
    const pending = this.pendingPermissions.get(id)
    if (!pending) return

    // Track session-level denials so future canUseTool calls are auto-denied
    if (options?.denyForSession) {
      this.sessionDeniedTools.add(pending.toolName)
      log.info("Tool denied for session", { tool: pending.toolName })
    }

    pending.resolve({
      behavior: "deny",
      message: reason ?? "User denied",
      toolUseID: id,
      decisionClassification: "user_reject",
    })
    this.pendingPermissions.delete(id)

    // Emit event to transition state machine WAITING_FOR_PERM -> RUNNING
    this.eventChannel?.push({ type: "permission_response", id, behavior: "deny" })
  }

  respondToElicitation(id: string, answers: Record<string, string>): void {
    const pending = this.pendingElicitations.get(id)
    if (!pending) return

    // Build updatedInput: copy original AskUserQuestion input and add answers map.
    // This matches how the SDK expects the response — the original input (with its
    // questions array) is preserved, and an "answers" map keyed by question text is added.
    const originalInput = this.pendingElicitationInputs.get(id) ?? {}
    const updatedInput: Record<string, unknown> = { ...originalInput, answers }

    pending.resolve({
      behavior: "allow",
      updatedInput,
    })
    this.pendingElicitations.delete(id)
    this.pendingElicitationInputs.delete(id)

    // Emit event to transition state machine WAITING_FOR_ELIC -> RUNNING
    this.eventChannel?.push({ type: "elicitation_response", id, answers })
  }

  cancelElicitation(id: string): void {
    const pending = this.pendingElicitations.get(id)
    if (!pending) return

    pending.resolve({
      behavior: "deny",
      message: "User declined to answer",
    })
    this.pendingElicitations.delete(id)
    this.pendingElicitationInputs.delete(id)

    // Emit event to transition state machine WAITING_FOR_ELIC -> RUNNING
    this.eventChannel?.push({ type: "elicitation_response", id, answers: {} })
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
    this.pendingElicitationInputs.clear()
  }

  // -----------------------------------------------------------------------
  // Private: SDK message -> AgentEvent mapping
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
          if (this.closed || !this.eventChannel) break
          log.debug("V1 SDK message", {
            type: msg.type,
            subtype: (msg as any).subtype,
            ...(msg.type === "stream_event" && {
              eventType: (msg as any).event?.type,
            }),
          })
          trace.write({
            dir: "in",
            stage: "sdk_event",
            type: msg.type,
            payload: msg,
          })
          const events = mapSDKMessage(msg, this.streamState)
          for (const event of events) {
            trace.write({
              dir: "internal",
              stage: "mapped_event",
              type: event.type,
              payload: event,
              meta: { sourceType: msg.type },
            })
            this.eventChannel?.push(event)
          }
        }
      } catch (err) {
        if (!this.closed && this.eventChannel) {
          this.eventChannel.push({
            type: "error" as const,
            code: "adapter_error",
            message: err instanceof Error ? err.message : String(err),
            severity: "fatal" as const,
          })
        }
      }
      this.eventChannel?.close()
    })().catch((err) => {
      if (!this.closed && this.eventChannel) {
        this.eventChannel.push({
          type: "error" as const,
          code: "adapter_error" as const,
          message: `SDK loop crashed: ${err instanceof Error ? err.message : String(err)}`,
          severity: "fatal" as const,
        })
        this.eventChannel.close()
      }
    })

    // Yield from channel — receives both SDK events AND canUseTool callback events
    yield* this.eventChannel[Symbol.asyncIterator]()
  }

  // -----------------------------------------------------------------------
  // Private: Build SDK options from SessionConfig
  // -----------------------------------------------------------------------

  private buildOptions(config: SessionConfig): any {
    log.info("Building V1 SDK options", {
      model: config.model,
      permissionMode: config.permissionMode,
      resume: !!config.resume,
      continue: !!config.continue,
      forkSession: !!config.forkSession,
      cwd: config.cwd,
    })
    return {
      model: config.model,
      systemPrompt: config.systemPrompt,
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
      canUseTool: createCanUseTool(this.bridgeState),
      includePartialMessages: true,
    }
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
        const sdkMessage = this.toSDKUserMessage(message)
        trace.write({
          dir: "out",
          stage: "sdk_call",
          type: "prompt",
          payload: sdkMessage,
        })
        yield sdkMessage
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
