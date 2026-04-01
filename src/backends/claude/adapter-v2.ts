/**
 * Claude Agent SDK V2 Adapter (Experimental)
 *
 * Uses the unstable_v2_createSession/resumeSession API.
 * Behind --backend claude-v2 feature flag.
 *
 * V2 API provides explicit turn-based control:
 *   createSession(options) → session.send(msg) → session.stream() → repeat
 *
 * Key differences from V1:
 * - Explicit send() + stream() per turn (vs single AsyncGenerator)
 * - No interrupt() on session (we close the session instead)
 * - No setModel() / setPermissionMode() (not available in V2)
 * - Same SDKMessage types and canUseTool callback as V1
 *
 * Reuses event-mapper.ts and permission-bridge.ts from V1.
 */

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  listSessions as sdkListSessions,
} from "@anthropic-ai/claude-agent-sdk"
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

const trace = backendTrace.scoped("claude-v2")

import { mapSDKMessage, ToolStreamState, type MapperOptions } from "./event-mapper"
import {
  createCanUseTool,
  type PendingPermission,
  type PendingElicitation,
  type PermissionBridgeState,
} from "./permission-bridge"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SDKSession = ReturnType<typeof unstable_v2_createSession>

// ---------------------------------------------------------------------------
// Claude V2 Adapter
// ---------------------------------------------------------------------------

export class ClaudeV2Adapter implements AgentBackend {
  private static sdkVersion: string = (() => {
    try { return require("@anthropic-ai/claude-agent-sdk/package.json").version } catch { return "unknown" }
  })()

  private session: SDKSession | null = null
  private messageQueue = new AsyncQueue<UserMessage>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingElicitations = new Map<string, PendingElicitation>()
  private pendingElicitationInputs = new Map<string, Record<string, unknown>>()
  private eventChannel: EventChannel<AgentEvent> | null = null
  private closed = false
  private interrupted = false
  private activeStream: AsyncGenerator<any, void> | null = null
  private lastSessionOptions: any = null
  private lastSessionId: string | null = null

  // Tool input JSON accumulation from streaming deltas
  private streamState = new ToolStreamState()
  // V2 needs assistant message mapping (no stream_events)
  private mapperOptions: MapperOptions = { mapAssistant: true }

  // Tools denied for the duration of this session
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
      name: "claude-v2",
      sdkVersion: ClaudeV2Adapter.sdkVersion,
      supportsThinking: true,
      supportsToolApproval: true,
      supportsResume: true,
      supportsFork: false, // V2 doesn't expose fork
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
    const options = this.buildOptions(config)

    log.info("Creating V2 session", { model: options.model })
    trace.write({
      dir: "out",
      stage: "sdk_call",
      type: "createSession",
      payload: options,
    })
    this.session = unstable_v2_createSession(options)

    yield* this.runSessionLoop(config)
  }

  async *resume(sessionId: string): AsyncGenerator<AgentEvent> {
    const config: SessionConfig = { resume: sessionId }
    const options = this.buildOptions(config)

    log.info("Resuming V2 session", { sessionId })
    trace.write({
      dir: "out",
      stage: "sdk_call",
      type: "resumeSession",
      payload: { sessionId, options },
    })
    this.session = unstable_v2_resumeSession(sessionId, options)

    yield* this.runSessionLoop(config)
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
    // V2 has no interrupt() method on the session.
    // Close the session entirely and mark for resume on next turn.
    // The turn loop detects session=null and resumes via the saved session ID.
    this.interrupted = true
    log.info("V2 interrupt", {
      pendingPermissions: this.pendingPermissions.size,
      pendingElicitations: this.pendingElicitations.size,
      hasSession: !!this.session,
      lastSessionId: this.lastSessionId,
    })

    // Auto-deny pending permissions/elicitations (prevent SDK deadlock)
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({
        behavior: "deny",
        message: "Interrupted by user",
        interrupt: true,
      })
    }
    this.pendingPermissions.clear()

    for (const [, pending] of this.pendingElicitations) {
      pending.resolve({
        behavior: "deny",
        message: "Interrupted by user",
        interrupt: true,
      })
    }
    this.pendingElicitations.clear()
    this.pendingElicitationInputs.clear()

    // Save session ID before closing so the turn loop can resume
    if (this.session) {
      try {
        this.lastSessionId = this.session.sessionId
      } catch {
        // sessionId throws if not initialized yet
      }
      this.session.close()
      this.session = null
    }

    // Push a synthetic turn_complete so the state machine transitions
    this.eventChannel?.push({ type: "turn_complete" })
  }

  approveToolUse(
    id: string,
    options?: { updatedInput?: unknown; alwaysAllow?: boolean; updatedPermissions?: any[] },
  ): void {
    const pending = this.pendingPermissions.get(id)
    if (!pending) return

    pending.resolve({
      behavior: "allow",
      updatedInput: (options?.updatedInput as Record<string, unknown>) ?? pending.input,
      updatedPermissions: options?.updatedPermissions,
      toolUseID: id,
      decisionClassification: options?.alwaysAllow ? "user_permanent" : "user_temporary",
    })
    this.pendingPermissions.delete(id)
    this.eventChannel?.push({ type: "permission_response", id, behavior: "allow" })
  }

  denyToolUse(id: string, reason?: string, options?: { denyForSession?: boolean }): void {
    const pending = this.pendingPermissions.get(id)
    if (!pending) return

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
    this.eventChannel?.push({ type: "permission_response", id, behavior: "deny" })
  }

  respondToElicitation(id: string, answers: Record<string, string>): void {
    const pending = this.pendingElicitations.get(id)
    if (!pending) return

    const originalInput = this.pendingElicitationInputs.get(id) ?? {}
    const updatedInput: Record<string, unknown> = { ...originalInput, answers }

    pending.resolve({
      behavior: "allow",
      updatedInput,
    })
    this.pendingElicitations.delete(id)
    this.pendingElicitationInputs.delete(id)
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
    this.eventChannel?.push({ type: "elicitation_response", id, answers: {} })
  }

  async setModel(_model: string): Promise<void> {
    // V2 doesn't support runtime model changes
    log.warn("setModel() not supported on V2 adapter — model is fixed at session creation")
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    // V2 doesn't support runtime permission mode changes
    log.warn("setPermissionMode() not supported on V2 adapter — mode is fixed at session creation")
  }

  async availableModels(): Promise<ModelInfo[]> {
    // V2 session doesn't expose a supportedModels() method.
    // Return empty — the TUI can still use the model from session_init.
    return []
  }

  async listSessions(): Promise<SessionInfo[]> {
    try {
      const sessions = await sdkListSessions({ dir: process.cwd() })
      return sessions.map((s) => ({
        id: s.sessionId,
        title: s.summary ?? s.firstPrompt ?? "Untitled",
        createdAt: s.createdAt ?? s.lastModified,
        updatedAt: s.lastModified,
        messageCount: 0, // Not available from SDK metadata
      }))
    } catch (err) {
      log.warn("Failed to list sessions", { error: String(err) })
      return []
    }
  }

  async forkSession(
    _sessionId: string,
    _options?: ForkOptions,
  ): Promise<string> {
    throw new Error("Fork not supported on V2 adapter")
  }

  close(): void {
    this.closed = true
    this.messageQueue.close()

    if (this.eventChannel) {
      this.eventChannel.close()
      this.eventChannel = null
    }

    if (this.session) {
      this.session.close()
      this.session = null
    }

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
  // Private: Session loop — the core V2 turn-based flow
  // -----------------------------------------------------------------------

  private async *runSessionLoop(config: SessionConfig): AsyncGenerator<AgentEvent> {
    if (!this.session) return

    this.eventChannel = new EventChannel<AgentEvent>()

    // Run the turn loop in the background, pushing events to the channel
    const turnLoop = (async () => {
      try {
        // If there's an initial prompt, send it to kick off the first turn
        if (config.initialPrompt) {
          trace.write({
            dir: "out",
            stage: "sdk_call",
            type: "session.send",
            payload: config.initialPrompt,
          })
          await this.session!.send(config.initialPrompt)
          await this.streamTurn()
        }

        // Main loop: wait for messages from the queue, send them, stream responses
        while (!this.closed) {
          try {
            const message = await this.messageQueue.pull()
            if (this.closed) break

            // If session was closed by interrupt, resume it
            if (!this.session && this.lastSessionId) {
              log.info("Resuming V2 session after interrupt", { sessionId: this.lastSessionId })
              trace.write({
                dir: "out",
                stage: "sdk_call",
                type: "resumeSession",
                payload: { sessionId: this.lastSessionId, options: this.lastSessionOptions },
              })
              this.session = unstable_v2_resumeSession(this.lastSessionId, this.lastSessionOptions)
              this.interrupted = false
            }
            if (!this.session) break

            const sdkMessage = this.toSDKMessage(message)
            trace.write({
              dir: "out",
              stage: "sdk_call",
              type: "session.send",
              payload: sdkMessage,
            })
            await this.session.send(sdkMessage)
            await this.streamTurn()
          } catch (err) {
            // Queue closed or session ended
            if (this.closed) break
            throw err
          }
        }
      } catch (err) {
        if (!this.closed && this.eventChannel) {
          this.eventChannel.push({
            type: "error",
            code: "adapter_error",
            message: err instanceof Error ? err.message : String(err),
            severity: "fatal",
          })
        }
      }
      this.eventChannel?.close()
    })().catch((err) => {
      if (!this.closed && this.eventChannel) {
        this.eventChannel.push({
          type: "error",
          code: "adapter_error",
          message: `V2 session loop crashed: ${err instanceof Error ? err.message : String(err)}`,
          severity: "fatal",
        })
        this.eventChannel.close()
      }
    })

    // Yield from channel — receives SDK events and canUseTool callback events
    yield* this.eventChannel[Symbol.asyncIterator]()
  }

  // -----------------------------------------------------------------------
  // Private: Stream a single turn's responses
  // -----------------------------------------------------------------------

  private async streamTurn(): Promise<void> {
    if (!this.session || this.closed) return

    // Reset interrupted flag at the start of each turn
    this.interrupted = false

    try {
      this.activeStream = this.session.stream()
      for await (const msg of this.activeStream) {
        if (this.closed || this.interrupted || !this.eventChannel) break
        log.debug("V2 stream message", {
          type: msg.type,
          subtype: (msg as any).subtype,
          ...(msg.type === "assistant" && {
            contentTypes: (msg as any).message?.content?.map((b: any) => b.type),
            contentCount: (msg as any).message?.content?.length,
          }),
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
        // Capture session ID from the running session for resume-after-interrupt
        if (!this.lastSessionId && this.session) {
          try { this.lastSessionId = this.session.sessionId } catch {}
        }

        const events = mapSDKMessage(msg, this.streamState, this.mapperOptions)
        for (const event of events) {
          trace.write({
            dir: "internal",
            stage: "mapped_event",
            type: event.type,
            payload: event,
            meta: { sourceType: msg.type },
          })
          this.eventChannel.push(event)
        }
      }
    } catch (err) {
      // If stream was interrupted (return() called), this may throw — that's expected
      if (!this.closed && !this.interrupted && this.eventChannel) {
        this.eventChannel.push({
          type: "error",
          code: "stream_error",
          message: err instanceof Error ? err.message : String(err),
          severity: "recoverable",
        })
      }
    } finally {
      this.activeStream = null
    }
  }

  // -----------------------------------------------------------------------
  // Private: Build SDK session options
  // -----------------------------------------------------------------------

  private buildOptions(config: SessionConfig): any {
    log.info("Building V2 SDK options", {
      model: config.model,
      permissionMode: config.permissionMode,
      resume: !!config.resume,
    })
    const options = {
      model: config.model,
      permissionMode: config.permissionMode,
      cwd: config.cwd,
      systemPrompt: config.systemPrompt,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      mcpServers: config.mcpServers,
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      additionalDirectories: config.additionalDirectories,
      settingSources: ["user", "project", "local"],
      canUseTool: createCanUseTool(this.bridgeState),
    }
    this.lastSessionOptions = options
    return options
  }

  // -----------------------------------------------------------------------
  // Private: Convert UserMessage to SDK send() format
  // -----------------------------------------------------------------------

  /**
   * V2 send() accepts string | SDKUserMessage.
   * Use plain string for text-only messages (simpler, more reliable).
   * Use SDKUserMessage only when images are attached.
   */
  private toSDKMessage(message: UserMessage): string | any {
    if (!message.images || message.images.length === 0) {
      return message.text
    }

    // Images require the full SDKUserMessage structure
    const content: any[] = [{ type: "text", text: message.text }]
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

    return {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: "",
    }
  }
}
