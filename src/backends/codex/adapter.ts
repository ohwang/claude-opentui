/**
 * Codex App-Server Adapter
 *
 * Implements AgentBackend by spawning `codex app-server` as a child process
 * and speaking JSON-RPC 2.0 over stdio. Full bidirectional protocol with
 * approval callbacks, streaming, interrupt, and thread fork.
 *
 * Usage: --backend codex
 *
 * Lifecycle:
 *   1. start() spawns the process, sends initialize/initialized handshake
 *   2. thread/start creates a thread, turn/start sends user input
 *   3. Server streams notifications → event mapper → AgentEvent channel
 *   4. Server-initiated approval requests → permission_request events → user response → JSON-RPC reply
 *   5. interrupt() calls turn/interrupt
 *   6. close() kills the child process
 */

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

const trace = backendTrace.scoped("codex")

import { JsonRpcTransport } from "./jsonrpc-transport"
import { mapCodexNotification } from "./event-mapper"

// ---------------------------------------------------------------------------
// Permission mode → Codex approval policy mapping
// ---------------------------------------------------------------------------

function toCodexApprovalPolicy(mode?: PermissionMode): string {
  switch (mode) {
    case "bypassPermissions":
    case "dontAsk":
      return "never"
    case "plan":
    case "default":
    case "acceptEdits":
    default:
      return "on-request"
  }
}

// ---------------------------------------------------------------------------
// Codex Adapter
// ---------------------------------------------------------------------------

export class CodexAdapter implements AgentBackend {
  private transport: JsonRpcTransport | null = null
  private messageQueue = new AsyncQueue<UserMessage>()
  private eventChannel: EventChannel<AgentEvent> | null = null
  private closed = false

  // Thread/turn state
  private threadId: string | null = null
  private activeTurnId: string | null = null
  private modelName: string | null = null

  // Cached token usage from thread/tokenUsage/updated (arrives before turn/completed)
  private lastTokenUsage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null = null

  // Pending approval requests (server-initiated JSON-RPC requests awaiting our response)
  private pendingApprovals = new Map<
    string,
    { rpcId: number | string; method: string; params: any }
  >()

  // Session config for reference
  private config: SessionConfig | null = null

  capabilities(): BackendCapabilities {
    return {
      name: "codex",
      supportsThinking: true,
      supportsToolApproval: true,
      supportsResume: true,
      supportsFork: true,
      supportsStreaming: true,
      supportsSubagents: false,
      supportedPermissionModes: [
        "default",
        "acceptEdits",
        "bypassPermissions",
        "dontAsk",
      ],
    }
  }

  async *start(config: SessionConfig): AsyncGenerator<AgentEvent> {
    this.config = config
    this.eventChannel = new EventChannel<AgentEvent>()

    // Run the session loop in the background, pushing events to the channel
    this.runSession(config).catch((err) => {
      if (!this.closed && this.eventChannel) {
        this.eventChannel.push({
          type: "error",
          code: "adapter_error",
          message: `Codex session failed: ${err instanceof Error ? err.message : String(err)}`,
          severity: "fatal",
        })
        this.eventChannel.close()
      }
    })

    yield* this.eventChannel[Symbol.asyncIterator]()
  }

  async *resume(sessionId: string): AsyncGenerator<AgentEvent> {
    this.config = { resume: sessionId }
    this.eventChannel = new EventChannel<AgentEvent>()

    this.runSession(this.config, sessionId).catch((err) => {
      if (!this.closed && this.eventChannel) {
        this.eventChannel.push({
          type: "error",
          code: "adapter_error",
          message: `Codex resume failed: ${err instanceof Error ? err.message : String(err)}`,
          severity: "fatal",
        })
        this.eventChannel.close()
      }
    })

    yield* this.eventChannel[Symbol.asyncIterator]()
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
    if (!this.transport?.isAlive || !this.threadId || !this.activeTurnId) return

    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "interrupt",
      payload: { threadId: this.threadId, turnId: this.activeTurnId, pendingApprovals: this.pendingApprovals.size },
    })

    log.info("Interrupting Codex turn", {
      threadId: this.threadId,
      turnId: this.activeTurnId,
    })

    // Auto-deny pending approval requests
    for (const [itemId, approval] of this.pendingApprovals) {
      this.transport.respond(approval.rpcId, { decision: "cancel" })
      this.eventChannel?.push({
        type: "permission_response",
        id: itemId,
        behavior: "deny",
      })
    }
    this.pendingApprovals.clear()

    // Send turn/interrupt — fire and forget (response comes as turn/completed with status "interrupted")
    this.transport
      .request("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.activeTurnId,
      })
      .catch((err) => {
        log.warn("turn/interrupt failed", { error: String(err) })
      })
  }

  approveToolUse(
    id: string,
    options?: { updatedInput?: unknown; alwaysAllow?: boolean },
  ): void {
    const approval = this.pendingApprovals.get(id)
    if (!approval) return

    const decision = options?.alwaysAllow ? "acceptForSession" : "accept"
    log.info("Codex approval: approve", { id, decision, method: approval.method, rpcId: approval.rpcId })
    this.transport?.respond(approval.rpcId, { decision })
    this.pendingApprovals.delete(id)
    this.eventChannel?.push({
      type: "permission_response",
      id,
      behavior: "allow",
    })
  }

  denyToolUse(id: string, _reason?: string, _options?: { denyForSession?: boolean }): void {
    const approval = this.pendingApprovals.get(id)
    if (!approval) return

    log.info("Codex approval: deny", { id, method: approval.method, rpcId: approval.rpcId })
    this.transport?.respond(approval.rpcId, { decision: "decline" })
    this.pendingApprovals.delete(id)
    this.eventChannel?.push({
      type: "permission_response",
      id,
      behavior: "deny",
    })
  }

  respondToElicitation(id: string, answers: Record<string, string>): void {
    const approval = this.pendingApprovals.get(id)
    if (!approval) return

    log.info("Codex elicitation: respond", { id, method: approval.method, answerKeys: Object.keys(answers).join(",") })
    // MCP elicitation response
    this.transport?.respond(approval.rpcId, {
      action: "accept",
      content: answers,
    })
    this.pendingApprovals.delete(id)
    this.eventChannel?.push({
      type: "elicitation_response",
      id,
      answers,
    })
  }

  cancelElicitation(id: string): void {
    const approval = this.pendingApprovals.get(id)
    if (!approval) return

    log.info("Codex elicitation: cancel", { id, method: approval.method })
    this.transport?.respond(approval.rpcId, {
      action: "decline",
      content: null,
    })
    this.pendingApprovals.delete(id)
    this.eventChannel?.push({
      type: "elicitation_response",
      id,
      answers: {},
    })
  }

  async setModel(_model: string): Promise<void> {
    // Model is set per-turn via turn/start params — no runtime change needed
    log.warn("setModel() on Codex adapter — model is set per turn via turn/start")
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    // Approval policy is set per-turn via turn/start params
    log.warn("setPermissionMode() on Codex adapter — approval policy is set per turn")
  }

  async availableModels(): Promise<ModelInfo[]> {
    // Codex doesn't expose a model list via the app-server protocol
    return [
      { id: "o3", name: "o3", provider: "openai" },
      { id: "o4-mini", name: "o4-mini", provider: "openai" },
      { id: "codex-mini-latest", name: "Codex Mini", provider: "openai" },
    ]
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.transport?.isAlive) return []

    try {
      const result = (await this.transport.request("thread/list")) as any
      const threads = result?.threads ?? []
      return threads.map((t: any) => ({
        id: t.id,
        title: t.preview ?? t.name ?? "Untitled",
        createdAt: t.createdAt ?? 0,
        updatedAt: t.createdAt ?? 0,
        messageCount: 0,
      }))
    } catch (err) {
      log.warn("Failed to list Codex sessions", { error: String(err) })
      return []
    }
  }

  async forkSession(
    sessionId: string,
    _options?: ForkOptions,
  ): Promise<string> {
    if (!this.transport?.isAlive) {
      throw new Error("Transport not connected")
    }

    const result = (await this.transport.request("thread/fork", {
      threadId: sessionId,
    })) as any

    return result?.thread?.id ?? result?.threadId
  }

  close(): void {
    if (this.closed) return

    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "close",
      payload: { threadId: this.threadId, hadTransport: !!this.transport },
    })

    this.closed = true

    this.messageQueue.close()

    // Reject pending approvals
    for (const [, approval] of this.pendingApprovals) {
      this.transport?.respond(approval.rpcId, { decision: "cancel" })
    }
    this.pendingApprovals.clear()

    if (this.eventChannel) {
      this.eventChannel.close()
      this.eventChannel = null
    }

    if (this.transport) {
      this.transport.close()
      this.transport = null
    }
  }

  // -----------------------------------------------------------------------
  // Private: Session lifecycle
  // -----------------------------------------------------------------------

  private async runSession(
    config: SessionConfig,
    resumeSessionId?: string,
  ): Promise<void> {
    try {
      // 1. Spawn transport
      this.transport = new JsonRpcTransport()
      await this.transport.start("codex", ["app-server", "--listen", "stdio://"])

      // 2. Wire up event handlers
      this.transport.onNotification((method, params) => {
        this.handleNotification(method, params)
      })
      this.transport.onRequest((id, method, params) => {
        this.handleServerRequest(id, method, params)
      })

      // 3. Initialize handshake
      log.info("Sending initialize request")
      await this.transport.request("initialize", {
        clientInfo: {
          name: "claude-opentui",
          title: "Claude OpenTUI",
          version: "0.0.1",
        },
        capabilities: {},
      })
      this.transport.notify("initialized")
      log.info("Codex app-server initialized")

      // 4. Start or resume thread
      if (resumeSessionId) {
        const result = (await this.transport.request("thread/resume", {
          threadId: resumeSessionId,
        })) as any
        this.threadId = result?.thread?.id ?? resumeSessionId
        this.modelName = result?.model ?? result?.modelProvider ?? null
        log.info("Resumed Codex thread", { threadId: this.threadId, model: this.modelName })
      } else {
        const result = (await this.transport.request("thread/start", {})) as any
        this.threadId = result?.thread?.id
        this.modelName = result?.model ?? result?.modelProvider ?? null
        log.info("Started Codex thread", { threadId: this.threadId, model: this.modelName })
      }

      if (!this.threadId) {
        throw new Error("Failed to obtain thread ID from Codex")
      }

      // 5. If there's an initial prompt, send the first turn
      if (config.initialPrompt) {
        await this.startTurn(config.initialPrompt)
      }

      // 6. Main message loop
      while (!this.closed) {
        try {
          const message = await this.messageQueue.pull()
          if (this.closed) break
          await this.startTurn(message.text, message.images)
        } catch (err) {
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
  }

  // -----------------------------------------------------------------------
  // Private: Turn management
  // -----------------------------------------------------------------------

  private async startTurn(
    text: string,
    images?: { data: string; mediaType: string }[],
  ): Promise<void> {
    if (!this.transport?.isAlive || !this.threadId) return

    // Build user input
    const input: any[] = [{ type: "text", text }]
    if (images) {
      for (const img of images) {
        input.push({
          type: "image",
          url: `data:${img.mediaType};base64,${img.data}`,
        })
      }
    }

    const turnParams: any = {
      threadId: this.threadId,
      input,
      approvalPolicy: toCodexApprovalPolicy(this.config?.permissionMode),
    }

    if (this.config?.model) {
      turnParams.model = this.config.model
    }
    if (this.config?.cwd) {
      turnParams.cwd = this.config.cwd
    }

    log.info("Starting Codex turn", { threadId: this.threadId })

    try {
      const result = (await this.transport.request(
        "turn/start",
        turnParams,
      )) as any
      this.activeTurnId = result?.turn?.id ?? null
      log.info("Codex turn started", {
        turnId: this.activeTurnId,
        turnStatus: result?.turn?.status,
      })

      // Wait for turn to complete (signaled by turn/completed notification)
      await this.waitForTurnComplete()
    } catch (err) {
      log.error("turn/start failed", { error: String(err) })
      this.eventChannel?.push({
        type: "error",
        code: "turn_error",
        message: err instanceof Error ? err.message : String(err),
        severity: "recoverable",
      })
    }
  }

  /**
   * Block until the active turn completes.
   * The turn loop is driven by notifications — turn/completed signals the end.
   * Includes an exit guard: if the transport dies mid-turn, we emit an error
   * and resolve rather than hanging forever.
   */
  private waitForTurnComplete(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.turnCompleteResolve = resolve

      // Guard: if transport dies while waiting, don't hang forever
      const exitGuard = setInterval(() => {
        if (!this.transport?.isAlive && this.turnCompleteResolve) {
          clearInterval(exitGuard)
          this.activeTurnId = null
          this.eventChannel?.push({
            type: "error",
            code: "transport_died",
            message: "Codex process exited unexpectedly during turn",
            severity: "fatal",
          })
          this.eventChannel?.push({ type: "turn_complete" } as AgentEvent)
          const r = this.turnCompleteResolve
          this.turnCompleteResolve = null
          r()
        }
      }, 500)

      // Clean up the guard when turn completes normally
      const origResolve = this.turnCompleteResolve
      this.turnCompleteResolve = () => {
        clearInterval(exitGuard)
        origResolve()
      }
    })
  }

  private turnCompleteResolve: (() => void) | null = null

  // -----------------------------------------------------------------------
  // Private: Handle server notifications
  // -----------------------------------------------------------------------

  private handleNotification(method: string, params: unknown): void {
    log.debug("Codex notification", { method })

    // Capture token usage from thread/tokenUsage/updated (fires before turn/completed)
    if (method === "thread/tokenUsage/updated") {
      const p = params as any
      const usage = p?.tokenUsage?.last ?? p?.tokenUsage?.total
      if (usage) {
        this.lastTokenUsage = {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.cachedInputTokens ?? 0,
        }
        log.debug("Cached token usage from tokenUsage/updated", this.lastTokenUsage)
      }
    }

    const events = mapCodexNotification(method, params)
    if (events.length === 0) {
      log.debug("Codex notification produced no events", { method })
    }

    for (const event of events) {
      // Augment session_init with actual model name from thread/start response
      if (event.type === "session_init" && this.modelName) {
        event.models = [{ id: this.modelName, name: this.modelName, provider: "openai" }]
      }
      // Inject cached token usage into turn_complete events if usage is undefined
      if (event.type === "turn_complete" && !(event as any).usage && this.lastTokenUsage) {
        ;(event as any).usage = { ...this.lastTokenUsage }
        this.lastTokenUsage = null
      }
      trace.write({
        dir: "internal",
        stage: "mapped_event",
        type: event.type,
        payload: event,
        meta: { sourceType: method },
      })
      this.eventChannel?.push(event)
    }

    // Detect turn completion to unblock the message loop
    if (method === "turn/completed") {
      this.activeTurnId = null
      if (this.turnCompleteResolve) {
        const resolve = this.turnCompleteResolve
        this.turnCompleteResolve = null
        resolve()
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private: Handle server-initiated requests (approvals)
  // -----------------------------------------------------------------------

  private handleServerRequest(
    rpcId: number | string,
    method: string,
    params: any,
  ): void {
    log.info("Codex server request", { method, rpcId })
    trace.write({
      dir: "internal",
      stage: "adapter_event",
      type: "server_request",
      payload: { rpcId, method, params },
    })

    switch (method) {
      case "item/commandExecution/requestApproval": {
        const itemId = params?.itemId ?? String(rpcId)
        this.pendingApprovals.set(itemId, { rpcId, method, params })

        this.eventChannel?.push({
          type: "permission_request",
          id: itemId,
          tool: "Bash",
          input: {
            command: params?.command ?? "",
            cwd: params?.cwd ?? "",
          },
          title: `Codex wants to run a command`,
          description: params?.reason,
        })
        break
      }

      case "item/fileChange/requestApproval": {
        const itemId = params?.itemId ?? String(rpcId)
        this.pendingApprovals.set(itemId, { rpcId, method, params })

        this.eventChannel?.push({
          type: "permission_request",
          id: itemId,
          tool: "Edit",
          input: {
            reason: params?.reason,
          },
          title: `Codex wants to modify files`,
          description: params?.reason,
        })
        break
      }

      case "item/permissions/requestApproval": {
        const itemId = params?.itemId ?? String(rpcId)
        this.pendingApprovals.set(itemId, { rpcId, method, params })

        const perms = params?.permissions ?? {}
        const desc = [
          perms.fileSystem?.read ? `Read: ${perms.fileSystem.read.join(", ")}` : null,
          perms.fileSystem?.write ? `Write: ${perms.fileSystem.write.join(", ")}` : null,
          perms.network?.enabled ? "Network access" : null,
        ]
          .filter(Boolean)
          .join("; ")

        this.eventChannel?.push({
          type: "permission_request",
          id: itemId,
          tool: "Permissions",
          input: perms,
          title: "Codex requests additional permissions",
          description: desc || params?.reason,
        })
        break
      }

      case "mcpServer/elicitation/request": {
        const elicId = params?.elicitationId ?? String(rpcId)
        this.pendingApprovals.set(elicId, { rpcId, method, params })

        this.eventChannel?.push({
          type: "elicitation_request",
          id: elicId,
          questions: [
            {
              question: params?.message ?? "MCP server requires input",
              options: [],
              allowFreeText: true,
            },
          ],
        })
        break
      }

      case "item/tool/requestUserInput": {
        const inputId = params?.itemId ?? String(rpcId)
        this.pendingApprovals.set(inputId, { rpcId, method, params })

        this.eventChannel?.push({
          type: "elicitation_request",
          id: inputId,
          questions: [
            {
              question: params?.message ?? params?.prompt ?? "Codex needs input",
              options: [],
              allowFreeText: true,
            },
          ],
        })
        break
      }

      case "item/tool/call": {
        // MCP tool call that needs client-side execution (rare)
        // Auto-respond since we don't execute tools client-side
        this.transport?.respondError(
          rpcId,
          -32601,
          "Client-side tool execution not supported",
        )
        break
      }

      default:
        log.warn("Unhandled server request", { method })
        this.transport?.respondError(rpcId, -32601, "Method not handled")
    }
  }
}
