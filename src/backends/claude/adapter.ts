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

import { query as sdkQuery, listSessions as sdkListSessions, type Options as SDKOptions, type SDKUserMessage as SDKUserMsg, type ModelInfo as SDKModelInfo } from "@anthropic-ai/claude-agent-sdk"
import { getDiagnosticsSdkMcpConfig } from "../../mcp/server"
import { getCrossagentSdkMcpConfig } from "../../subagents/mcp-tools"
import { log } from "../../utils/logger"
import type {
  AgentBackend,
  AgentEvent,
  BackendCapabilities,
  EffortLevel,
  ForkOptions,
  ModelInfo,
  PermissionMode,
  SandboxInfo,
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
  // Pending replay context from /switch — prepended to the next user message
  // as a marked historical section so the model treats it as background
  // rather than a turn to respond to. See SessionConfig.replayContext.
  private pendingReplayContext: string | null = null
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingElicitations = new Map<string, PendingElicitation>()
  private pendingElicitationInputs = new Map<string, Record<string, unknown>>()
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

  /**
   * Claude SDK sandbox/approval model:
   *
   * Approvals and sandboxing are the SAME control — the SDK's permissionMode
   * governs both what actions get prompted and what gets blocked. There is no
   * separate sandbox process; the CLI itself enforces file/command restrictions.
   *
   * Mode mapping (passed directly to SDK):
   *   - "default"           → Ask before file edits AND shell commands
   *   - "acceptEdits"       → Auto-approve file edits, ask before shell commands
   *   - "bypassPermissions" → Auto-approve everything (no prompts at all)
   *   - "plan"              → Read-only: no edits, no commands allowed
   *   - "dontAsk"           → Same as bypassPermissions (--dangerously-* flag)
   *
   * Filesystem scope: cwd + any --add-dir directories. Paths outside are blocked.
   * Protected paths: None explicitly — all paths within scope are equally accessible.
   * Network: Unrestricted (no network sandbox).
   */
  capabilities(): BackendCapabilities {
    const sandboxInfo: SandboxInfo = {
      statusHint: "approvals only, no sandbox",
      modeDetails: {
        default: {
          writableScope: "cwd + allowed directories",
          protectedPaths: "none (all in-scope paths equal)",
          commandApproval: "always",
          editApproval: "always",
          networkAccess: "unrestricted",
          separateSandbox: false,
        },
        acceptEdits: {
          writableScope: "cwd + allowed directories",
          protectedPaths: "none (all in-scope paths equal)",
          commandApproval: "always",
          editApproval: "never",
          networkAccess: "unrestricted",
          separateSandbox: false,
        },
        bypassPermissions: {
          writableScope: "cwd + allowed directories",
          protectedPaths: "none (all in-scope paths equal)",
          commandApproval: "never",
          editApproval: "never",
          networkAccess: "unrestricted",
          separateSandbox: false,
        },
        plan: {
          writableScope: "none (read-only)",
          protectedPaths: "all (no writes allowed)",
          commandApproval: "never",
          editApproval: "never",
          networkAccess: "unrestricted",
          separateSandbox: false,
          caveats: "Read-only mode: no file edits or shell commands",
        },
        dontAsk: {
          writableScope: "cwd + allowed directories",
          protectedPaths: "none (all in-scope paths equal)",
          commandApproval: "never",
          editApproval: "never",
          networkAccess: "unrestricted",
          separateSandbox: false,
        },
      },
    }

    return {
      name: "claude",
      sdkVersion: ClaudeAdapter.sdkVersion,
      supportsThinking: true,
      supportsToolApproval: true,
      supportsResume: true,
      supportsContinue: true,
      supportsFork: true,
      supportsStreaming: true,
      supportsSubagents: true,
      supportsCompact: true,
      supportedPermissionModes: [
        "default",
        "acceptEdits",
        "bypassPermissions",
        "plan",
        "dontAsk",
      ],
      sandboxInfo,
    }
  }

  async *start(config: SessionConfig): AsyncGenerator<AgentEvent> {
    // Stash replay context from /switch so the next real user message picks
    // it up as prepended history. Must NOT be sent as its own turn.
    if (config.replayContext) {
      this.pendingReplayContext = config.replayContext
      log.info("Claude: replay context staged for next user turn", {
        chars: config.replayContext.length,
      })
    }

    // Build SDK options
    const options = this.buildOptions(config)

    // Create the message iterable for multi-turn
    const messageIterable = this.createMessageIterable(config)

    // Start the query
    log.info("ClaudeAdapter: creating SDK query", { model: options.model, permissionMode: options.permissionMode, hasMcpServers: !!(options.mcpServers && Object.keys(options.mcpServers).length) })
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
    log.info("ClaudeAdapter: SDK query created", { hasQuery: !!this.activeQuery })

    // Iterate SDK messages — let the underlying claude binary handle auth/errors
    yield* this.iterateQuery()
  }

  async *resume(sessionId: string, baseConfig?: SessionConfig): AsyncGenerator<AgentEvent> {
    const config: SessionConfig = { ...baseConfig, resume: sessionId }
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
    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "interrupt",
      payload: { pendingPermissions: this.pendingPermissions.size, pendingElicitations: this.pendingElicitations.size },
    })

    if (this.activeQuery) {
      // Auto-deny any pending permissions (prevent SDK deadlock)
      for (const [, pending] of this.pendingPermissions) {
        pending.resolve({
          behavior: "deny",
          message: "Interrupted by user",
          interrupt: true,
        })
      }
      this.pendingPermissions.clear()

      // Auto-respond to pending elicitations
      for (const [, pending] of this.pendingElicitations) {
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

  async setEffort(level: EffortLevel): Promise<void> {
    if (!this.activeQuery) return
    // applyFlagSettings only supports low/medium/high — reject 'max' at runtime
    if (level === "max") {
      this.eventChannel?.push({
        type: "system_message",
        text: "Cannot set effort to 'max' at runtime. Use --effort max at startup.",
        ephemeral: true,
      })
      return
    }
    try {
      await this.activeQuery.applyFlagSettings({ effortLevel: level })
      log.info("setEffort()", { level })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error("setEffort() failed", { error: message })
      this.eventChannel?.push({
        type: "system_message",
        text: `Failed to set effort level: ${message}`,
        ephemeral: true,
      })
    }
  }

  async availableModels(): Promise<ModelInfo[]> {
    if (!this.activeQuery) return []
    const models: SDKModelInfo[] = await this.activeQuery.supportedModels()
    return models
      .map((m) => ({
        id: m.value ?? m.displayName,
        name: m.displayName ?? m.value,
        provider: "anthropic" as const,
      }))
      .filter((m) => m.id != null && m.id !== "undefined" && m.id !== "")
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
    // Forking creates a new session with copied history
    // Handled via the SDK's forkSession option
    throw new Error("Fork via start() with config.forkSession = true")
  }

  close(): void {
    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "close",
      payload: { hadActiveQuery: !!this.activeQuery },
    })

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
    // fire-and-forget
    void (async () => {
      log.info("ClaudeAdapter: background event loop starting")
      let firstMsgLogged = false
      try {
        for await (const msg of this.activeQuery!) {
          if (!firstMsgLogged) {
            firstMsgLogged = true
            log.info("ClaudeAdapter: first SDK message received", { type: msg.type })
          }
          if (this.closed || !this.eventChannel) break
          // SDK messages are a wide union — extract optional fields for logging
          const msgRecord = msg as Record<string, unknown>
          log.debug("V1 SDK message", {
            type: msg.type,
            subtype: msgRecord.subtype,
            ...(msg.type === "stream_event" && {
              eventType: (msgRecord.event as Record<string, unknown> | undefined)?.type,
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
        log.error("ClaudeAdapter: background event loop error", { error: err instanceof Error ? err.message : String(err) })
        if (!this.closed && this.eventChannel) {
          this.eventChannel.push({
            type: "error" as const,
            code: "adapter_error",
            message: err instanceof Error ? err.message : String(err),
            severity: "fatal" as const,
          })
        }
      }
      log.info("ClaudeAdapter: background event loop ended", { closed: this.closed, firstMsgReceived: firstMsgLogged })
      this.eventChannel?.close()
    })().catch((err) => {
      log.error("ClaudeAdapter: unhandled error in background loop", { error: String(err) })
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

  private buildOptions(config: SessionConfig): SDKOptions {
    log.info("Building V1 SDK options", {
      model: config.model,
      permissionMode: config.permissionMode,
      resume: !!config.resume,
      continue: !!config.continue,
      forkSession: !!config.forkSession,
      cwd: config.cwd,
    })
    const opts: SDKOptions = {
      model: config.model,
      systemPrompt: config.systemPrompt,
      permissionMode: config.permissionMode,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      cwd: config.cwd,
      continue: config.continue,
      resume: config.resume,
      forkSession: config.forkSession,
      mcpServers: (() => {
        const servers: Record<string, unknown> = { ...config.mcpServers }
        const diag = getDiagnosticsSdkMcpConfig()
        if (diag) servers["bantai-diagnostics"] = diag
        const crossagent = getCrossagentSdkMcpConfig()
        if (crossagent) servers["bantai-crossagent"] = crossagent
        // Cast: mcpServers values come from user config and our MCP server —
        // both conform to McpServerConfig at runtime but the spread loses type info
        return servers as SDKOptions["mcpServers"]
      })(),
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      additionalDirectories: config.additionalDirectories,
      persistSession: config.persistSession ?? true,
      settingSources: ["user", "project", "local"],
      // Cast: our PermissionResult is structurally identical to the SDK's but
      // updatedPermissions is typed as unknown[] (we pass through SDK values
      // without importing PermissionUpdate from the SDK in the bridge module)
      canUseTool: createCanUseTool(this.bridgeState) as SDKOptions["canUseTool"],
      includePartialMessages: true,
      ...(config.thinking ? { thinking: config.thinking } : {}),
      ...(config.effort ? { effort: config.effort } : {}),
    }
    log.info("ClaudeAdapter: options built", {
      model: opts.model,
      permissionMode: opts.permissionMode,
      maxTurns: opts.maxTurns,
      mcpServerCount: opts.mcpServers ? Object.keys(opts.mcpServers).length : 0,
      hasCanUseTool: !!opts.canUseTool,
      hasSystemPrompt: !!opts.systemPrompt,
      persistSession: opts.persistSession,
    })
    return opts
  }

  // -----------------------------------------------------------------------
  // Private: Message iterable for multi-turn
  // -----------------------------------------------------------------------

  private async *createMessageIterable(
    config: SessionConfig,
  ): AsyncGenerator<SDKUserMsg> {
    log.info("ClaudeAdapter: message iterable started", { resume: !!config.resume, continue: !!config.continue })
    // First message from config or wait for user
    if (config.resume || config.continue) {
      // Resuming: don't send an initial message, wait for user
    }

    // Yield messages as the user sends them
    while (!this.closed) {
      try {
        const message = await this.messageQueue.pull()
        // Prepend any pending /switch replay context as marked historical
        // context so the model responds to the new user message while having
        // the prior conversation available.
        if (this.pendingReplayContext) {
          const replay = this.pendingReplayContext
          this.pendingReplayContext = null
          message.text = `[Historical context — do not respond to this section; it is a replay of the prior conversation for your reference]\n${replay}\n[End of historical context]\n\n[User Message]\n${message.text}`
        }
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

  private toSDKUserMessage(message: UserMessage): SDKUserMsg {
    const content: SDKUserMsg["message"]["content"] = [{ type: "text", text: message.text }]

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
