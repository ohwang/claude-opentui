/**
 * ACP Adapter
 *
 * Implements AgentBackend by spawning an ACP-compatible agent as a subprocess
 * and speaking JSON-RPC 2.0 over stdio. Supports any agent that implements the
 * Agent Client Protocol: Gemini CLI, GitHub Copilot CLI, and others.
 *
 * Usage:
 *   --backend gemini-acp       (preset: gemini --acp)
 *   --backend copilot-acp      (preset: gh copilot acp-server)
 *   --backend acp              (generic: requires --acp-command)
 *
 * Lifecycle:
 *   1. start() spawns the agent, sends initialize handshake
 *   2. session/new creates a session, discovers modes and models
 *   3. session/prompt sends user input, server streams session/update notifications
 *   4. session/request_permission → permission_request events → user response → JSON-RPC reply
 *   5. interrupt() sends session/cancel notification
 *   6. close() kills the child process
 */

import { log } from "../../utils/logger"
import type {
  AgentEvent,
  BackendCapabilities,
  EffortLevel,
  ForkOptions,
  ModelInfo,
  PermissionMode,
  SessionConfig,
  SessionInfo,
  UserMessage,
} from "../../protocol/types"
import { backendTrace } from "../../utils/backend-trace"
import { BaseAdapter } from "../shared/base-adapter"
import { AcpTransport } from "./transport"
import { mapAcpUpdate } from "./event-mapper"
import type {
  AcpInitializeResult,
  AcpSessionNewResult,
  AcpSessionUpdateParams,
  AcpPermissionRequestParams,
  AcpContentBlock,
  AcpModel,
  AcpMode,
} from "./types"

const trace = backendTrace.scoped("acp")

// ---------------------------------------------------------------------------
// ACP Adapter
// ---------------------------------------------------------------------------

export class AcpAdapter extends BaseAdapter {
  private transport: AcpTransport | null = null

  // Session state
  private sessionId: string | null = null
  private currentModel: string | null = null
  private discoveredModels: AcpModel[] = []
  private discoveredModes: AcpMode[] = []
  private agentName = "ACP Agent"

  // Config
  private command: string
  private args: string[]
  private presetName: string

  // Pending permission requests (server-initiated JSON-RPC requests awaiting our response)
  private pendingApprovals = new Map<
    string,
    { rpcId: number | string; params: AcpPermissionRequestParams }
  >()

  // Turn lifecycle
  private turnCompleteResolve: (() => void) | null = null

  constructor(preset?: { command: string; args: string[]; displayName: string; presetName: string }) {
    super()
    this.command = preset?.command ?? ""
    this.args = preset?.args ?? []
    this.presetName = preset?.presetName ?? "acp"
    if (preset?.displayName) this.agentName = preset.displayName
  }

  capabilities(): BackendCapabilities {
    return {
      name: this.presetName,
      supportsThinking: false,
      supportsToolApproval: true,
      supportsResume: false,
      supportsFork: false,
      supportsStreaming: true,
      supportsSubagents: false,
      supportedPermissionModes: ["default", "bypassPermissions"],
    }
  }

  sendMessage(message: UserMessage): void {
    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "sendMessage",
      payload: message,
    })
    super.sendMessage(message)
  }

  interrupt(): void {
    if (!this.transport?.isAlive || !this.sessionId) return

    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "interrupt",
      payload: { sessionId: this.sessionId, pendingApprovals: this.pendingApprovals.size },
    })

    log.info("Interrupting ACP turn", { sessionId: this.sessionId })

    // Auto-deny pending permission requests
    for (const [toolCallId, approval] of this.pendingApprovals) {
      this.transport.respond(approval.rpcId, {
        outcome: { outcome: "cancelled" },
      })
      this.eventChannel?.push({
        type: "permission_response",
        id: toolCallId,
        behavior: "deny",
      })
    }
    this.pendingApprovals.clear()

    // session/cancel is a notification per ACP spec (no id, no response)
    this.transport.notify("session/cancel", { sessionId: this.sessionId })

    // Resolve turn completion to unblock the message loop
    if (this.turnCompleteResolve) {
      this.eventChannel?.push({ type: "turn_complete" } as AgentEvent)
      const resolve = this.turnCompleteResolve
      this.turnCompleteResolve = null
      resolve()
    }
  }

  approveToolUse(
    id: string,
    options?: { alwaysAllow?: boolean },
  ): void {
    const approval = this.pendingApprovals.get(id)
    if (!approval) return

    // Find the appropriate option
    const opts = approval.params.options ?? []
    const option = options?.alwaysAllow
      ? opts.find(o => o.kind === "allow_always") ?? opts.find(o => o.kind === "allow_once")
      : opts.find(o => o.kind === "allow_once")

    log.info("ACP approval: approve", { id, optionId: option?.optionId })
    this.transport?.respond(approval.rpcId, {
      outcome: {
        outcome: "selected",
        optionId: option?.optionId ?? opts[0]?.optionId ?? "allow",
      },
    })
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

    const opts = approval.params.options ?? []
    const rejectOption = opts.find(o => o.kind === "reject_once") ?? opts.find(o => o.kind === "reject_always")

    log.info("ACP approval: deny", { id, optionId: rejectOption?.optionId })
    this.transport?.respond(approval.rpcId, {
      outcome: {
        outcome: "selected",
        optionId: rejectOption?.optionId ?? "reject",
      },
    })
    this.pendingApprovals.delete(id)
    this.eventChannel?.push({
      type: "permission_response",
      id,
      behavior: "deny",
    })
  }

  respondToElicitation(_id: string, _answers: Record<string, string>): void {
    log.debug("respondToElicitation not supported for ACP backend")
  }

  cancelElicitation(_id: string): void {
    log.debug("cancelElicitation not supported for ACP backend")
  }

  async setModel(model: string): Promise<void> {
    log.debug("setModel not yet implemented for ACP backend", { model })
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (!this.transport?.isAlive || !this.sessionId) return

    // Map our permission modes to ACP mode IDs
    const modeMap: Record<string, string> = {
      default: "default",
      acceptEdits: "autoEdit",
      bypassPermissions: "yolo",
      plan: "plan",
    }
    const modeId = modeMap[mode]
    if (!modeId) return

    try {
      await this.transport.request("session/set_mode", {
        sessionId: this.sessionId,
        modeId,
      })
      log.info("ACP mode set", { mode, modeId })
    } catch (err) {
      log.warn("session/set_mode failed", { error: String(err) })
    }
  }

  async setEffort(_level: EffortLevel): Promise<void> {
    log.debug("setEffort not supported for ACP backend")
  }

  async availableModels(): Promise<ModelInfo[]> {
    return this.discoveredModels.map(m => ({
      id: m.modelId,
      name: m.name,
      provider: this.presetName,
    }))
  }

  async listSessions(): Promise<SessionInfo[]> {
    return []
  }

  async forkSession(_sessionId: string, _options?: ForkOptions): Promise<string> {
    throw new Error("Session forking not supported for ACP backend")
  }

  async resetSession?(): Promise<void> {
    if (!this.transport?.isAlive) return

    // Create a new session on the existing transport
    try {
      const result = (await this.transport.request("session/new", {
        cwd: process.cwd(),
        mcpServers: [],
      })) as AcpSessionNewResult

      this.sessionId = result.sessionId
      if (result.models) {
        this.discoveredModels = result.models.availableModels
        this.currentModel = result.models.currentModelId
      }
      if (result.modes) {
        this.discoveredModes = result.modes.availableModes
      }

      this.eventChannel?.push({
        type: "session_init",
        sessionId: this.sessionId,
        tools: [],
        models: this.discoveredModels.map(m => ({
          id: m.modelId,
          name: m.name,
          provider: this.presetName,
        })),
      })

      log.info("ACP session reset", { sessionId: this.sessionId })
    } catch (err) {
      log.error("Failed to reset ACP session", { error: String(err) })
    }
  }

  protected onClose(): void {
    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "close",
      payload: { sessionId: this.sessionId, hadTransport: !!this.transport },
    })

    // Reject pending approvals
    for (const [, approval] of this.pendingApprovals) {
      this.transport?.respond(approval.rpcId, {
        outcome: { outcome: "cancelled" },
      })
    }
    this.pendingApprovals.clear()

    if (this.transport) {
      this.transport.close()
      this.transport = null
    }
  }

  // -----------------------------------------------------------------------
  // Protected: Session lifecycle
  // -----------------------------------------------------------------------

  protected async runSession(config: SessionConfig): Promise<void> {
    if (!this.command) {
      throw new Error(
        "ACP backend requires a command. Use --backend gemini-acp, --backend copilot-acp, " +
        "or --backend acp with --acp-command <cmd>",
      )
    }

    try {
      // 1. Spawn transport
      this.transport = new AcpTransport()
      await this.transport.start(this.command, this.args)

      // 2. Wire up event handlers
      this.transport.onNotification((method, params) => {
        this.handleNotification(method, params)
      })
      this.transport.onRequest((id, method, params) => {
        this.handleServerRequest(id, method, params)
      })

      // 3. Initialize handshake
      log.info("Sending ACP initialize request")
      const initResult = (await this.transport.request("initialize", {
        protocolVersion: 1,
        clientInfo: {
          name: "claude-opentui",
          version: "0.0.1",
        },
        clientCapabilities: {},
      })) as AcpInitializeResult

      this.agentName = initResult.agentInfo?.title ?? initResult.agentInfo?.name ?? this.agentName
      log.info("ACP agent initialized", {
        agent: this.agentName,
        version: initResult.agentInfo?.version,
        protocolVersion: initResult.protocolVersion,
      })

      // Send initialized notification (harmless if agent doesn't recognize it)
      this.transport.notify("initialized")

      // 4. Create session
      const cwd = config.cwd ?? process.cwd()
      const sessionResult = (await this.transport.request("session/new", {
        cwd,
        mcpServers: [],
      })) as AcpSessionNewResult

      this.sessionId = sessionResult.sessionId
      if (sessionResult.models) {
        this.discoveredModels = sessionResult.models.availableModels
        this.currentModel = sessionResult.models.currentModelId
      }
      if (sessionResult.modes) {
        this.discoveredModes = sessionResult.modes.availableModes
      }

      log.info("ACP session created", {
        sessionId: this.sessionId,
        models: this.discoveredModels.length,
        modes: this.discoveredModes.length,
        currentModel: this.currentModel,
      })

      // 5. Emit session_init
      this.eventChannel?.push({
        type: "session_init",
        sessionId: this.sessionId,
        tools: [],
        models: this.discoveredModels.map(m => ({
          id: m.modelId,
          name: m.name,
          provider: this.presetName,
        })),
      })

      // 6. If there's an initial prompt, send the first turn
      if (config.initialPrompt) {
        await this.sendPrompt(config.initialPrompt)
      }

      // 7. Main message loop
      await this.runMessageLoop(async (message) => {
        await this.sendPrompt(message.text, message.images)
      })
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
  }

  // -----------------------------------------------------------------------
  // Private: Prompt turn
  // -----------------------------------------------------------------------

  private async sendPrompt(
    text: string,
    images?: { data: string; mediaType: string }[],
  ): Promise<void> {
    if (!this.transport?.isAlive || !this.sessionId) return

    // Build prompt content blocks
    const prompt: AcpContentBlock[] = [{ type: "text", text }]
    if (images) {
      for (const img of images) {
        prompt.push({
          type: "image",
          mimeType: img.mediaType,
          data: img.data,
        })
      }
    }

    // Emit turn_start
    this.eventChannel?.push({ type: "turn_start" })

    try {
      // Send prompt — this blocks until the turn completes
      // but streaming updates arrive as notifications
      const resultPromise = this.transport.request("session/prompt", {
        sessionId: this.sessionId,
        prompt,
      })

      // Wait for the prompt result (which signals turn completion)
      const result = (await resultPromise) as { stopReason: string } | undefined

      // Emit turn_complete with stop reason
      this.eventChannel?.push({
        type: "turn_complete",
        sessionId: this.sessionId ?? undefined,
      })

      log.info("ACP prompt completed", { stopReason: result?.stopReason })
    } catch (err) {
      // If we were interrupted, the cancel notification resolves the prompt
      // with an error — that's expected behavior
      if (this.closed) return

      log.error("ACP prompt failed", { error: String(err) })
      this.eventChannel?.push({
        type: "turn_complete",
        sessionId: this.sessionId ?? undefined,
      })
      this.eventChannel?.push({
        type: "error",
        code: "turn_error",
        message: err instanceof Error ? err.message : String(err),
        severity: "recoverable",
      })
    }
  }

  // -----------------------------------------------------------------------
  // Private: Handle server notifications
  // -----------------------------------------------------------------------

  private handleNotification(method: string, params: unknown): void {
    log.debug("ACP notification", { method })

    if (method === "session/update") {
      const events = mapAcpUpdate(params as AcpSessionUpdateParams)
      for (const event of events) {
        trace.write({
          dir: "internal",
          stage: "mapped_event",
          type: event.type,
          payload: event,
          meta: { sourceType: method },
        })
        this.eventChannel?.push(event)
      }
      return
    }

    // Unknown notification — pass through
    log.warn("Unhandled ACP notification", { method })
    this.eventChannel?.push({
      type: "backend_specific",
      backend: "acp",
      data: { method, params },
    })
  }

  // -----------------------------------------------------------------------
  // Private: Handle server-initiated requests
  // -----------------------------------------------------------------------

  private handleServerRequest(
    rpcId: number | string,
    method: string,
    params: any,
  ): void {
    log.info("ACP server request", { method, rpcId })
    trace.write({
      dir: "internal",
      stage: "adapter_event",
      type: "server_request",
      payload: { rpcId, method, params },
    })

    switch (method) {
      case "session/request_permission": {
        const permParams = params as AcpPermissionRequestParams
        const toolCallId = permParams.toolCall?.toolCallId ?? String(rpcId)

        this.pendingApprovals.set(toolCallId, { rpcId, params: permParams })

        this.eventChannel?.push({
          type: "permission_request",
          id: toolCallId,
          tool: "Tool",
          input: permParams.toolCall,
          title: `${this.agentName} requests permission`,
          description: permParams.options?.map(o => o.name).join(" / "),
        })
        break
      }

      case "fs/read_text_file": {
        // Client filesystem read — not implemented in v1
        log.warn("ACP fs/read_text_file requested but not supported", { path: params?.path })
        this.transport?.respondError(
          rpcId,
          -32601,
          "Client-side filesystem access not supported",
        )
        break
      }

      case "fs/write_text_file": {
        log.warn("ACP fs/write_text_file requested but not supported", { path: params?.path })
        this.transport?.respondError(
          rpcId,
          -32601,
          "Client-side filesystem access not supported",
        )
        break
      }

      default:
        log.warn("Unhandled ACP server request", { method })
        this.transport?.respondError(rpcId, -32601, `Method not supported: ${method}`)
    }
  }
}
