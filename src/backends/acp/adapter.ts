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
import { AcpTerminalManager } from "./terminal-manager"
import { mapAcpUpdate, deriveToolName } from "./event-mapper"
import type {
  AcpInitializeResult,
  AcpAgentCapabilities,
  AcpSessionNewResult,
  AcpSessionUpdateParams,
  AcpPermissionRequestParams,
  AcpTerminalCreateParams,
  AcpTerminalOutputParams,
  AcpTerminalWaitParams,
  AcpTerminalKillParams,
  AcpTerminalReleaseParams,
  AcpFsReadParams,
  AcpFsWriteParams,
  AcpContentBlock,
  AcpModel,
  AcpMode,
  AcpConfigOption,
  AcpConfigOptionUpdateNotification,
} from "./types"
import nodePath from "path"

const trace = backendTrace.scoped("acp")

// ---------------------------------------------------------------------------
// Path validation (exported for testing)
// ---------------------------------------------------------------------------

/** Validate that a path is within the allowed working directory */
export function validatePathWithinCwd(
  filePath: string,
  cwd: string,
): { valid: boolean; resolved: string; error?: string } {
  const resolved = nodePath.resolve(filePath)
  if (!resolved.startsWith(cwd + "/") && resolved !== cwd) {
    return { valid: false, resolved, error: `Path outside working directory: ${filePath}` }
  }
  return { valid: true, resolved }
}

/**
 * Normalize an ACP config option to a consistent shape.
 * Handles Copilot vs Gemini differences:
 *   - Copilot: type="select", currentValue, options[].value
 *   - Gemini: type="enum", value, options[].id
 */
function normalizeConfigOption(raw: AcpConfigOption): AcpConfigOption {
  return {
    ...raw,
    // Normalize type: "select" → "enum"
    type: raw.type === "select" ? "enum" : raw.type,
    // Normalize value: prefer currentValue (Copilot), fall back to value (Gemini)
    value: raw.currentValue ?? raw.value,
    // Normalize choices: ensure each has both id and value
    options: raw.options?.map(c => ({
      ...c,
      id: c.id ?? c.value ?? c.name,
      value: c.value ?? c.id ?? c.name,
    })),
  }
}

// ---------------------------------------------------------------------------
// ACP Adapter
// ---------------------------------------------------------------------------

export class AcpAdapter extends BaseAdapter {
  private transport: AcpTransport | null = null
  private terminalManager = new AcpTerminalManager()

  // Session state
  private sessionId: string | null = null
  private agentCapabilities: AcpAgentCapabilities | null = null
  private currentModel: string | null = null
  private discoveredModels: AcpModel[] = []
  private discoveredModes: AcpMode[] = []
  private discoveredConfigOptions: AcpConfigOption[] = []
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

  /** Map ACP config options to protocol ConfigOption[] and emit a config_options event */
  private emitConfigOptions(): void {
    if (this.discoveredConfigOptions.length === 0) return
    this.eventChannel?.push({
      type: "config_options",
      options: this.discoveredConfigOptions.map(o => ({
        id: o.id,
        name: o.name,
        description: o.description,
        type: o.type,
        value: o.value,
        choices: o.options?.map(c => ({ id: c.id ?? c.value ?? c.name, name: c.name, description: c.description })),
      })),
    })
  }

  private deriveSupportedPermissionModes(): PermissionMode[] {
    // Reverse-map ACP mode IDs to our internal PermissionMode names.
    // Supports both short IDs (Gemini: "default", "yolo") and
    // URI-based IDs (Copilot: "https://...#agent", "https://...#plan").
    const reverseMap: Record<string, PermissionMode> = {
      default: "default",
      autoEdit: "acceptEdits",
      yolo: "bypassPermissions",
      plan: "plan",
    }
    // URI fragment mappings for Copilot-style mode IDs
    const fragmentMap: Record<string, PermissionMode> = {
      agent: "default",
      plan: "plan",
      autopilot: "bypassPermissions",
    }

    if (this.discoveredModes.length > 0) {
      const modes = this.discoveredModes
        .map(m => {
          // Try direct ID match first (Gemini)
          if (reverseMap[m.id]) return reverseMap[m.id]!
          // Try URI fragment match (Copilot)
          const fragment = m.id.split("#").pop()
          if (fragment && fragmentMap[fragment]) return fragmentMap[fragment]!
          // Try name-based matching as fallback
          const name = m.name.toLowerCase()
          if (name.includes("plan")) return "plan" as PermissionMode
          if (name.includes("auto")) return "bypassPermissions" as PermissionMode
          return undefined
        })
        .filter((m): m is PermissionMode => !!m)
      // Always include "default" as a fallback
      if (!modes.includes("default")) modes.unshift("default")
      // Deduplicate
      return [...new Set(modes)]
    }

    // Fallback if no modes discovered yet
    return ["default", "bypassPermissions"]
  }

  capabilities(): BackendCapabilities {
    // Derive thinking support from discovered config options
    const hasThinkingOption = this.discoveredConfigOptions.some(
      o => o.category === "thought_level" || o.id === "thinking" || o.name.toLowerCase().includes("thinking") || o.name.toLowerCase().includes("effort"),
    )

    return {
      name: this.presetName,
      supportsThinking: hasThinkingOption,
      supportsToolApproval: true,
      supportsResume: !!this.agentCapabilities?.loadSession,
      supportsFork: false,
      supportsStreaming: true,
      supportsSubagents: false,
      supportedPermissionModes: this.deriveSupportedPermissionModes(),
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

  denyToolUse(id: string, _reason?: string, options?: { denyForSession?: boolean }): void {
    const approval = this.pendingApprovals.get(id)
    if (!approval) return

    const opts = approval.params.options ?? []
    const rejectOption = options?.denyForSession
      ? opts.find(o => o.kind === "reject_always") ?? opts.find(o => o.kind === "reject_once")
      : opts.find(o => o.kind === "reject_once") ?? opts.find(o => o.kind === "reject_always")

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
    if (!this.transport?.isAlive || !this.sessionId) {
      throw new Error("No active ACP session")
    }

    // Strategy 1: Try config option if a model config option exists
    const modelOption = this.discoveredConfigOptions.find(
      o => o.category === "model" || o.id === "model" || o.name.toLowerCase().includes("model"),
    )
    if (modelOption) {
      try {
        await this.transport.request("session/set_config_option", {
          sessionId: this.sessionId,
          configOptionId: modelOption.id,
          value: model,
        })
        this.currentModel = model
        this.eventChannel?.push({ type: "model_changed", model })
        log.info("ACP model set via config option", { model })
        return
      } catch (err) {
        log.warn("session/set_config_option failed for model", { error: String(err) })
      }
    }

    // Strategy 2: Try session/set_model if agent exposes it
    // (Some agents support this as a direct method)
    try {
      await this.transport.request("session/set_model", {
        sessionId: this.sessionId,
        modelId: model,
      })
      this.currentModel = model
      this.eventChannel?.push({ type: "model_changed", model })
      log.info("ACP model set via session/set_model", { model })
    } catch (err) {
      log.warn("Model switching not supported by this ACP agent", { error: String(err), model })
      throw new Error("Model switching not supported by this ACP agent")
    }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (!this.transport?.isAlive || !this.sessionId) return

    // Strategy 1: Try config option (Copilot supports mode as a config option)
    const modeOption = this.discoveredConfigOptions.find(
      o => o.id === "mode" || o.category === "mode",
    )
    if (modeOption) {
      // Find the matching choice value
      const targetName = mode === "default" ? "agent" : mode === "bypassPermissions" ? "autopilot" : mode
      const choice = modeOption.options?.find(c => {
        const cid = (c.id ?? c.value ?? "").toLowerCase()
        const cname = c.name.toLowerCase()
        return cid.includes(targetName) || cname.includes(targetName)
      })
      if (choice) {
        try {
          await this.transport.request("session/set_config_option", {
            sessionId: this.sessionId,
            configOptionId: modeOption.id,
            value: choice.id ?? choice.value,
          })
          log.info("ACP mode set via config option", { mode, value: choice.id ?? choice.value })
          return
        } catch (err) {
          log.warn("session/set_config_option failed for mode", { error: String(err) })
        }
      }
    }

    // Strategy 2: Try session/set_mode with direct ID mapping (Gemini)
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
      log.info("ACP mode set via session/set_mode", { mode, modeId })
    } catch (err) {
      log.warn("session/set_mode failed", { error: String(err) })
    }
  }

  async setConfigOption(id: string, value: unknown): Promise<void> {
    if (!this.transport?.isAlive || !this.sessionId) return

    await this.transport.request("session/set_config_option", {
      sessionId: this.sessionId,
      configOptionId: id,
      value,
    })

    // Update local state
    const idx = this.discoveredConfigOptions.findIndex(o => o.id === id)
    const existing = this.discoveredConfigOptions[idx]
    if (idx >= 0 && existing) {
      this.discoveredConfigOptions[idx] = { ...existing, value }
    }

    // Emit updated options
    this.emitConfigOptions()

    log.info("ACP config option set", { id, value })
  }

  async setEffort(level: EffortLevel): Promise<void> {
    if (!this.transport?.isAlive || !this.sessionId) return

    // Try config option if a thinking/effort config option exists
    const effortOption = this.discoveredConfigOptions.find(
      o => o.category === "thought_level" || o.id === "thinking" || o.name.toLowerCase().includes("thinking") || o.name.toLowerCase().includes("effort"),
    )
    if (effortOption) {
      try {
        await this.transport.request("session/set_config_option", {
          sessionId: this.sessionId,
          configOptionId: effortOption.id,
          value: level,
        })
        this.eventChannel?.push({ type: "effort_changed", effort: level })
        log.info("ACP effort set via config option", { level })
        return
      } catch (err) {
        log.warn("session/set_config_option failed for effort", { error: String(err) })
      }
    }

    log.debug("Effort control not supported by this ACP agent", { level })
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
      if (result.configOptions) {
        this.discoveredConfigOptions = result.configOptions.map(normalizeConfigOption)
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

      this.emitConfigOptions()

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

    // Kill all managed terminals
    this.terminalManager.destroyAll()

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
        clientCapabilities: {
          terminal: true,
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      })) as AcpInitializeResult

      this.agentName = initResult.agentInfo?.title ?? initResult.agentInfo?.name ?? this.agentName
      this.agentCapabilities = initResult.agentCapabilities ?? null
      log.info("ACP agent initialized", {
        agent: this.agentName,
        version: initResult.agentInfo?.version,
        protocolVersion: initResult.protocolVersion,
        loadSession: !!this.agentCapabilities?.loadSession,
      })

      // Send initialized notification (harmless if agent doesn't recognize it)
      this.transport.notify("initialized")

      // 4. Create or load session
      const cwd = config.cwd ?? process.cwd()
      let sessionResult: AcpSessionNewResult
      if (config.resume && this.agentCapabilities?.loadSession) {
        try {
          sessionResult = (await this.transport.request("session/load", {
            sessionId: config.resume,
          })) as AcpSessionNewResult
          log.info("ACP session loaded", { sessionId: config.resume })
        } catch (err) {
          log.warn("session/load failed, creating new session", { error: String(err) })
          sessionResult = (await this.transport.request("session/new", {
            cwd,
            mcpServers: [],
          })) as AcpSessionNewResult
        }
      } else {
        sessionResult = (await this.transport.request("session/new", {
          cwd,
          mcpServers: [],
        })) as AcpSessionNewResult
      }

      this.sessionId = sessionResult.sessionId
      if (sessionResult.models) {
        this.discoveredModels = sessionResult.models.availableModels
        this.currentModel = sessionResult.models.currentModelId
      }
      if (sessionResult.modes) {
        this.discoveredModes = sessionResult.modes.availableModes
      }
      if (sessionResult.configOptions) {
        this.discoveredConfigOptions = sessionResult.configOptions
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

      // 5b. Emit config options if the agent exposed any
      this.emitConfigOptions()

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

      // Warn on non-normal stop reasons
      if (result?.stopReason && result.stopReason !== "end_turn" && result.stopReason !== "stop") {
        const reasonMessages: Record<string, string> = {
          max_tokens: "Response truncated (token limit reached)",
          max_turn_requests: "Turn ended (maximum tool calls reached)",
          refusal: "Agent refused to continue",
          cancelled: "Turn was cancelled",
        }
        const msg = reasonMessages[result.stopReason] ?? `Turn ended: ${result.stopReason}`
        this.eventChannel?.push({
          type: "system_message",
          text: msg,
          ephemeral: true,
        })
      }

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

    if (method === "config_option_update") {
      this.handleConfigOptionUpdate(params)
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
  // Private: Handle config option updates from agent
  // -----------------------------------------------------------------------

  private handleConfigOptionUpdate(params: unknown): void {
    const update = params as AcpConfigOptionUpdateNotification | undefined
    if (!update?.configOption) return

    const option = update.configOption
    log.info("ACP config option updated by agent", { id: option.id, value: option.value })

    // Update our stored config options
    const idx = this.discoveredConfigOptions.findIndex(o => o.id === option.id)
    if (idx >= 0) {
      this.discoveredConfigOptions[idx] = option
    } else {
      this.discoveredConfigOptions.push(option)
    }

    // Emit refreshed config options list to update TUI state
    this.emitConfigOptions()

    // Map to AgentEvents based on the option type — check category first
    if (option.category === "model" || option.id === "model" || option.name.toLowerCase().includes("model")) {
      const model = String(option.value)
      this.currentModel = model
      this.eventChannel?.push({ type: "model_changed", model })
    } else if (
      option.category === "thought_level" ||
      option.id === "thinking" ||
      option.name.toLowerCase().includes("thinking") ||
      option.name.toLowerCase().includes("effort")
    ) {
      const effort = String(option.value)
      if (["low", "medium", "high", "max"].includes(effort)) {
        this.eventChannel?.push({
          type: "effort_changed",
          effort: effort as EffortLevel,
        })
      }
    } else {
      // Unknown config option — pass through as backend_specific
      this.eventChannel?.push({
        type: "backend_specific",
        backend: "acp",
        data: { type: "config_option_update", option },
      })
    }
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
        const toolCall = permParams.toolCall as Record<string, unknown> | undefined
        const toolName = deriveToolName(toolCall?.kind as string, toolCall?.title as string)

        this.pendingApprovals.set(toolCallId, { rpcId, params: permParams })

        this.eventChannel?.push({
          type: "permission_request",
          id: toolCallId,
          tool: toolName,
          input: permParams.toolCall,
          title: `${this.agentName}: ${toolCall?.title ?? toolName}`,
          description: permParams.options?.map(o => o.name).join(" / "),
          blockedPath: (toolCall?.locations as any[])?.[0]?.path,
        })
        break
      }

      case "terminal/create": {
        const p = params as AcpTerminalCreateParams
        try {
          const terminalId = this.terminalManager.create(
            p.command, p.args, p.cwd, p.env, p.timeout,
          )
          this.transport?.respond(rpcId, { terminalId })

          // Build display command string
          const displayCommand = p.args?.length
            ? `${p.command} ${p.args.join(" ")}`
            : p.command

          // Emit shell_start so the TUI shows a shell block
          this.eventChannel?.push({
            type: "shell_start",
            id: terminalId,
            command: displayCommand,
          })
        } catch (err) {
          this.transport?.respondError(rpcId, -32603, `Failed to create terminal: ${String(err)}`)
        }
        break
      }

      case "terminal/output": {
        const p = params as AcpTerminalOutputParams
        const result = this.terminalManager.getOutput(p.terminalId)
        this.transport?.respond(rpcId, result)
        break
      }

      case "terminal/wait_for_exit": {
        const p = params as AcpTerminalWaitParams
        this.terminalManager.waitForExit(p.terminalId).then(exitCode => {
          this.transport?.respond(rpcId, { exitCode })

          // Emit shell_end with accumulated output
          const { output } = this.terminalManager.getOutput(p.terminalId)
          this.eventChannel?.push({
            type: "shell_end",
            id: p.terminalId,
            output,
            exitCode,
            error: exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined,
          })
        }).catch(err => {
          this.transport?.respondError(rpcId, -32603, `Wait failed: ${String(err)}`)
        })
        break
      }

      case "terminal/kill": {
        const p = params as AcpTerminalKillParams
        this.terminalManager.kill(p.terminalId, p.signal)
        this.transport?.respond(rpcId, {})
        break
      }

      case "terminal/release": {
        const p = params as AcpTerminalReleaseParams
        this.terminalManager.release(p.terminalId)
        this.transport?.respond(rpcId, {})
        break
      }

      case "fs/read_text_file": {
        const p = params as AcpFsReadParams
        this.handleFsRead(rpcId, p)
        break
      }

      case "fs/write_text_file": {
        const p = params as AcpFsWriteParams
        this.handleFsWrite(rpcId, p)
        break
      }

      default:
        log.warn("Unhandled ACP server request", { method })
        this.transport?.respondError(rpcId, -32601, `Method not supported: ${method}`)
    }
  }

  // -----------------------------------------------------------------------
  // Private: Filesystem handlers
  // -----------------------------------------------------------------------

  private async handleFsRead(rpcId: number | string, params: AcpFsReadParams): Promise<void> {
    const { path: filePath, line, limit } = params

    // Security: validate path is within the session's working directory
    const cwd = process.cwd()
    const check = validatePathWithinCwd(filePath, cwd)
    if (!check.valid) {
      log.warn("ACP fs/read_text_file blocked: path outside cwd", { path: filePath, cwd })
      this.transport?.respondError(rpcId, -32602, check.error!)
      return
    }

    try {
      const fs = await import("fs/promises")
      const content = await fs.readFile(check.resolved, "utf-8")

      // Apply line/limit filtering if specified
      if (line !== undefined || limit !== undefined) {
        const lines = content.split("\n")
        const startLine = (line ?? 1) - 1  // 1-indexed
        const endLine = limit ? startLine + limit : lines.length
        const sliced = lines.slice(Math.max(0, startLine), endLine).join("\n")
        this.transport?.respond(rpcId, { content: sliced })
      } else {
        this.transport?.respond(rpcId, { content })
      }

      log.info("ACP fs/read_text_file", { path: filePath })
    } catch (err: any) {
      if (err.code === "ENOENT") {
        this.transport?.respondError(rpcId, -32602, `File not found: ${filePath}`)
      } else if (err.code === "EACCES") {
        this.transport?.respondError(rpcId, -32602, `Permission denied: ${filePath}`)
      } else {
        this.transport?.respondError(rpcId, -32603, `Read failed: ${String(err)}`)
      }
    }
  }

  private async handleFsWrite(rpcId: number | string, params: AcpFsWriteParams): Promise<void> {
    const { path: filePath, content } = params

    // Security: validate path is within the session's working directory
    const cwd = process.cwd()
    const check = validatePathWithinCwd(filePath, cwd)
    if (!check.valid) {
      log.warn("ACP fs/write_text_file blocked: path outside cwd", { path: filePath, cwd })
      this.transport?.respondError(rpcId, -32602, check.error!)
      return
    }

    try {
      const fs = await import("fs/promises")
      // Ensure parent directory exists
      await fs.mkdir(nodePath.dirname(check.resolved), { recursive: true })
      await fs.writeFile(check.resolved, content, "utf-8")
      this.transport?.respond(rpcId, {})
      log.info("ACP fs/write_text_file", { path: filePath })
    } catch (err: any) {
      this.transport?.respondError(rpcId, -32603, `Write failed: ${String(err)}`)
    }
  }
}
