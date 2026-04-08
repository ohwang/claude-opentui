/**
 * Gemini CLI SDK Adapter
 *
 * Implements AgentBackend using @google/gemini-cli-sdk's GeminiCliAgent
 * and GeminiCliSession. The SDK is loaded via dynamic import so the
 * adapter compiles without the dependency installed.
 *
 * Usage: --backend gemini
 *
 * The SDK handles tool execution internally via its policy engine.
 * Tool calls stream as ToolCallRequest/ToolCallResponse events.
 * Interrupt is implemented via AbortController.
 *
 * Install the SDK: bun add @google/gemini-cli-sdk
 * Or link locally: bun add ../gemini-cli/packages/sdk
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

const trace = backendTrace.scoped("gemini")

import { mapGeminiEvent } from "./event-mapper"
import type {
  IGeminiCliAgent,
  IGeminiCliSession,
  GeminiCliAgentOptions,
  ServerGeminiStreamEvent,
} from "./types"

// ---------------------------------------------------------------------------
// Gemini Adapter
// ---------------------------------------------------------------------------

export class GeminiAdapter implements AgentBackend {
  private static sdkVersion: string = (() => {
    try { return require("@google/gemini-cli-sdk/package.json").version } catch { return "unknown" }
  })()

  /** Timeout (ms) for the first event from sendStream(). If exceeded, the turn
   *  is aborted and a recoverable error is emitted. Guards against SDK hangs. */
  private static readonly FIRST_EVENT_TIMEOUT_MS = 120_000 // 2 minutes

  private agent: IGeminiCliAgent | null = null
  private session: IGeminiCliSession | null = null
  private messageQueue = new AsyncQueue<UserMessage>()
  private eventChannel: EventChannel<AgentEvent> | null = null
  private closed = false

  // Interrupt via AbortController
  private abortController: AbortController | null = null
  /** True when abort was triggered by user (Ctrl+C), false for timeout aborts */
  private userInitiatedAbort = false

  // Session config for reference
  private config: SessionConfig | null = null

  capabilities(): BackendCapabilities {
    return {
      name: "gemini",
      sdkVersion: GeminiAdapter.sdkVersion,
      supportsThinking: true,
      supportsToolApproval: false, // SDK handles tools internally via policy engine
      supportsResume: true,
      supportsFork: false,
      supportsStreaming: true,
      supportsSubagents: false,
      supportedPermissionModes: ["default", "bypassPermissions"],
    }
  }

  async *start(config: SessionConfig): AsyncGenerator<AgentEvent> {
    this.config = config
    this.eventChannel = new EventChannel<AgentEvent>()

    this.runSession(config).catch((err) => {
      if (!this.closed && this.eventChannel) {
        this.eventChannel.push({
          type: "error",
          code: "adapter_error",
          message: `Gemini session failed: ${err instanceof Error ? err.message : String(err)}`,
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
          message: `Gemini resume failed: ${err instanceof Error ? err.message : String(err)}`,
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
    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "interrupt",
      payload: { hasAbortController: !!this.abortController },
    })

    log.info("Gemini interrupt", { hasAbortController: !!this.abortController })
    this.userInitiatedAbort = true
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    // Push turn_complete so the state machine transitions
    this.eventChannel?.push({ type: "turn_complete" })
  }

  approveToolUse(_id: string): void {
    // Gemini SDK handles tool approval internally via policy engine
    log.debug("approveToolUse called on Gemini adapter — tools are auto-managed by SDK")
  }

  denyToolUse(_id: string, _reason?: string): void {
    log.debug("denyToolUse called on Gemini adapter — tools are auto-managed by SDK")
  }

  respondToElicitation(_id: string, _answers: Record<string, string>): void {
    log.debug("respondToElicitation called on Gemini adapter — not supported")
  }

  cancelElicitation(_id: string): void {
    log.debug("cancelElicitation called on Gemini adapter — not supported")
  }

  async setModel(_model: string): Promise<void> {
    log.warn("setModel() on Gemini adapter — model is fixed at session creation")
    this.eventChannel?.push({
      type: "system_message",
      text: "Model switching is not supported by the Gemini backend. Restart with --model <name> to change.",
    })
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    log.warn("setPermissionMode() on Gemini adapter — not supported")
    this.eventChannel?.push({
      type: "system_message",
      text: "Permission mode switching is not supported by the Gemini backend.",
    })
  }

  async availableModels(): Promise<ModelInfo[]> {
    try {
      const auth = await this.resolveAuth()
      if (!auth) {
        log.warn("No Gemini credentials found — cannot fetch available models")
        return []
      }

      const url = auth.type === "api_key"
        ? `https://generativelanguage.googleapis.com/v1beta/models?key=${auth.token}&pageSize=1000`
        : `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000`
      const headers: Record<string, string> = auth.type === "bearer"
        ? { Authorization: `Bearer ${auth.token}` }
        : {}

      const resp = await fetch(url, { headers })
      if (!resp.ok) {
        log.warn("Failed to fetch Gemini models", { status: resp.status })
        return []
      }

      const data = (await resp.json()) as {
        models?: Array<{
          name: string
          displayName: string
          supportedGenerationMethods?: string[]
        }>
      }

      return (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => ({
          id: m.name.replace(/^models\//, ""),
          name: m.displayName,
          provider: "google",
        }))
    } catch (err) {
      log.warn("Error fetching Gemini models", {
        error: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  }

  // -----------------------------------------------------------------------
  // Private: Auth resolution for model listing
  // -----------------------------------------------------------------------

  /**
   * Resolve auth credentials in priority order:
   * 1. GEMINI_API_KEY env var → API key auth
   * 2. ~/.gemini/oauth_creds.json → OAuth refresh → Bearer token
   */
  private async resolveAuth(): Promise<{ type: "api_key" | "bearer"; token: string } | null> {
    const apiKey = process.env["GEMINI_API_KEY"]
    if (apiKey) return { type: "api_key", token: apiKey }

    // Try OAuth credentials from Gemini CLI's stored tokens
    const homedir = await import("node:os").then((os) => os.homedir())
    const fs = await import("node:fs/promises")
    const path = await import("node:path")

    const credsPath = path.join(homedir, ".gemini", "oauth_creds.json")
    try {
      const raw = await fs.readFile(credsPath, "utf-8")
      const creds = JSON.parse(raw) as {
        client_id?: string
        client_secret?: string
        refresh_token?: string
      }
      if (!creds.refresh_token) return null

      // Client credentials come from the creds file or env vars
      const clientId = creds.client_id ?? process.env["GEMINI_OAUTH_CLIENT_ID"]
      const clientSecret = creds.client_secret ?? process.env["GEMINI_OAUTH_CLIENT_SECRET"]
      if (!clientId || !clientSecret) {
        log.warn("OAuth client credentials not found in ~/.gemini/oauth_creds.json or env vars")
        return null
      }

      const accessToken = await this.refreshOAuthToken(
        creds.refresh_token,
        clientId,
        clientSecret,
      )
      return accessToken ? { type: "bearer", token: accessToken } : null
    } catch {
      // File doesn't exist or is unreadable
      return null
    }
  }

  /** Exchange a refresh token for a short-lived access token. */
  private async refreshOAuthToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
  ): Promise<string | null> {
    try {
      const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      })
      if (!resp.ok) {
        log.warn("OAuth token refresh failed", { status: resp.status })
        return null
      }
      const data = (await resp.json()) as { access_token?: string }
      return data.access_token ?? null
    } catch (err) {
      log.warn("OAuth token refresh error", {
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    // Session listing requires filesystem access to ~/.gemini/temp/
    // Not implemented via SDK — would need to read storage directly
    return []
  }

  async forkSession(
    _sessionId: string,
    _options?: ForkOptions,
  ): Promise<string> {
    throw new Error("Fork not supported on Gemini adapter")
  }

  close(): void {
    if (this.closed) return

    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "close",
      payload: { hadSession: !!this.session },
    })

    this.closed = true

    // Abort any active stream
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    this.messageQueue.close()

    if (this.eventChannel) {
      this.eventChannel.close()
      this.eventChannel = null
    }

    this.agent = null
    this.session = null
  }

  // -----------------------------------------------------------------------
  // Private: Session lifecycle
  // -----------------------------------------------------------------------

  private async runSession(
    config: SessionConfig,
    resumeSessionId?: string,
  ): Promise<void> {
    try {
      // 1. Dynamic import of the SDK
      const sdk = await this.loadSDK()

      // 2. Create agent
      const agentOptions: GeminiCliAgentOptions = {
        cwd: config.cwd ?? process.cwd(),
        model: config.model,
        ...(config.systemPrompt ? { instructions: config.systemPrompt } : {}),
      }
      log.info("Creating Gemini agent", {
        model: agentOptions.model,
        cwd: agentOptions.cwd,
      })
      trace.write({
        dir: "out",
        stage: "sdk_call",
        type: "GeminiCliAgent",
        payload: agentOptions,
      })
      this.agent = new sdk.GeminiCliAgent(agentOptions)

      // 3. Create or resume session
      if (resumeSessionId) {
        log.info("Resuming Gemini session", { sessionId: resumeSessionId })
        trace.write({
          dir: "out",
          stage: "sdk_call",
          type: "resumeSession",
          payload: { sessionId: resumeSessionId },
        })
        this.session = await this.agent.resumeSession(resumeSessionId)
        trace.write({
          dir: "internal",
          stage: "adapter_event",
          type: "session_resumed",
          payload: { sessionId: this.session.id, resumedFrom: resumeSessionId },
        })
      } else {
        trace.write({
          dir: "out",
          stage: "sdk_call",
          type: "session",
          payload: {},
        })
        this.session = this.agent.session()
        trace.write({
          dir: "internal",
          stage: "adapter_event",
          type: "session_created",
          payload: { sessionId: this.session.id },
        })
      }
      log.info("Gemini session created", { sessionId: this.session.id })

      // Emit synthetic session_init immediately so it arrives before the first turn_start.
      // Model info will be updated when the SDK sends a model_info event.
      const modelName = config.model || "gemini-2.5-pro"
      this.eventChannel?.push({
        type: "session_init",
        sessionId: crypto.randomUUID(),
        tools: [],
        models: [{ id: modelName, name: modelName, provider: "google" }],
      })

      // 4. If there's an initial prompt, send the first turn
      if (config.initialPrompt) {
        await this.runTurn(config.initialPrompt)
      }

      // 5. Main message loop
      while (!this.closed) {
        try {
          const message = await this.messageQueue.pull()
          if (this.closed) break
          await this.runTurn(message.text)
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
  // Private: Turn execution
  // -----------------------------------------------------------------------

  private async runTurn(prompt: string): Promise<void> {
    if (!this.session || this.closed) return

    this.abortController = new AbortController()
    this.userInitiatedAbort = false
    log.info("Starting Gemini turn", { promptLength: prompt.length })

    // Emit turn_start
    trace.write({
      dir: "internal",
      stage: "adapter_event",
      type: "turn_start",
      payload: { prompt },
    })
    this.eventChannel?.push({ type: "turn_start" })

    try {
      trace.write({
        dir: "out",
        stage: "sdk_call",
        type: "sendStream",
        payload: { prompt },
      })
      const stream = this.session.sendStream(prompt, this.abortController.signal)

      // Guard: if the stream produces no events within FIRST_EVENT_TIMEOUT_MS,
      // the SDK is likely hung (observed when sendStream is called immediately
      // after a turn finishes). Abort and emit a recoverable error so the user
      // can retry rather than staring at a frozen spinner forever.
      let receivedFirstEvent = false
      const firstEventTimeout = setTimeout(() => {
        if (!receivedFirstEvent && !this.closed) {
          log.warn("Gemini turn timed out waiting for first event", {
            promptLength: prompt.length,
            timeoutMs: GeminiAdapter.FIRST_EVENT_TIMEOUT_MS,
          })
          this.abortController?.abort()
        }
      }, GeminiAdapter.FIRST_EVENT_TIMEOUT_MS)

      try {
        for await (const event of stream) {
          if (!receivedFirstEvent) {
            receivedFirstEvent = true
            clearTimeout(firstEventTimeout)
          }
          if (this.closed) break

          log.debug("Gemini stream event", { type: event.type })
          trace.write({
            dir: "in",
            stage: "sdk_event",
            type: event.type,
            payload: event,
          })

          const mapped = mapGeminiEvent(event)
          if (mapped.length === 0) {
            log.debug("Gemini event produced no mapped events", { type: event.type })
          }
          for (const agentEvent of mapped) {
            trace.write({
              dir: "internal",
              stage: "mapped_event",
              type: agentEvent.type,
              payload: agentEvent,
              meta: { sourceType: event.type },
            })
            this.eventChannel?.push(agentEvent)
          }
        }
      } finally {
        clearTimeout(firstEventTimeout)
      }
    } catch (err) {
      // AbortError is expected on interrupt (user Ctrl+C or first-event timeout)
      if (err instanceof Error && err.name === "AbortError") {
        if (this.userInitiatedAbort) {
          log.info("Gemini turn aborted by user")
          // interrupt() already pushed turn_complete
        } else {
          log.warn("Gemini turn aborted by first-event timeout")
          // Timeout-triggered abort: emit a recoverable error + turn_complete
          // so the TUI returns to IDLE instead of hanging forever.
          if (!this.closed && this.eventChannel) {
            this.eventChannel.push({
              type: "error",
              code: "turn_timeout",
              message: "Gemini did not respond — the SDK may be in a bad state. Try sending your message again.",
              severity: "recoverable",
            })
            this.eventChannel.push({ type: "turn_complete" })
          }
        }
        return
      }

      if (!this.closed && this.eventChannel) {
        log.error("Gemini turn error", { error: String(err) })
        trace.write({
          dir: "internal",
          stage: "adapter_event",
          type: "turn_error",
          payload: { error: err instanceof Error ? err.message : String(err) },
        })
        this.eventChannel.push({
          type: "error",
          code: "turn_error",
          message: err instanceof Error ? err.message : String(err),
          severity: "recoverable",
        })
        // Ensure turn completes even on error
        this.eventChannel.push({ type: "turn_complete" })
      }
    } finally {
      this.abortController = null
    }
  }

  // -----------------------------------------------------------------------
  // Private: SDK loading
  // -----------------------------------------------------------------------

  private async loadSDK(): Promise<{
    GeminiCliAgent: new (options: GeminiCliAgentOptions) => IGeminiCliAgent
  }> {
    try {
      // Try to import the SDK — it's an optional dependency
      const sdk = await import("@google/gemini-cli-sdk")
      log.info("Loaded @google/gemini-cli-sdk")
      return sdk as any
    } catch (err) {
      const message =
        `Failed to load @google/gemini-cli-sdk. ` +
        `Install it with: bun add @google/gemini-cli-sdk\n` +
        `Or link from local Gemini CLI repo: bun add ../gemini-cli/packages/sdk\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
      log.error("SDK load failed", { error: message })
      throw new Error(message)
    }
  }
}
