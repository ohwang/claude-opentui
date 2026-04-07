/**
 * Codex SDK Adapter
 *
 * Implements AgentBackend using @openai/codex-sdk's Codex and Thread
 * classes. The SDK is loaded via dynamic import so the adapter compiles
 * without the dependency installed.
 *
 * Usage: --backend codex-sdk
 *
 * Unlike the raw `codex` backend (which speaks JSON-RPC 2.0 to
 * `codex app-server`), this adapter uses the official SDK which
 * internally runs `codex exec --experimental-json` and yields typed
 * ThreadEvent objects over JSONL.
 *
 * The SDK handles tool execution internally via its approval policy.
 * Tool calls stream as item.started/item.updated/item.completed events.
 * Interrupt is implemented via AbortController.
 *
 * Install the SDK: bun add @openai/codex-sdk
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

const trace = backendTrace.scoped("codex-sdk")

import { CodexSdkEventMapper } from "./event-mapper"
import type {
  ICodex,
  IThread,
  CodexOptions,
  ThreadOptions,
  ApprovalMode,
} from "./types"

// ---------------------------------------------------------------------------
// Permission mode → Codex approval policy
// ---------------------------------------------------------------------------

function toApprovalPolicy(mode?: PermissionMode): ApprovalMode {
  switch (mode) {
    case "bypassPermissions":
    case "dontAsk":
      return "never"
    case "plan":
      return "on-request"
    default:
      return "on-failure"
  }
}

// ---------------------------------------------------------------------------
// Codex SDK Adapter
// ---------------------------------------------------------------------------

export class CodexSdkAdapter implements AgentBackend {
  private static sdkVersion: string = (() => {
    try { return require("@openai/codex-sdk/package.json").version } catch { return "unknown" }
  })()

  /** Timeout (ms) for the first event from runStreamed(). Guards against SDK hangs. */
  private static readonly FIRST_EVENT_TIMEOUT_MS = 120_000 // 2 minutes

  private codex: ICodex | null = null
  private thread: IThread | null = null
  private messageQueue = new AsyncQueue<UserMessage>()
  private eventChannel: EventChannel<AgentEvent> | null = null
  private eventMapper = new CodexSdkEventMapper()
  private closed = false

  // Interrupt via AbortController
  private abortController: AbortController | null = null
  private userInitiatedAbort = false

  private config: SessionConfig | null = null

  capabilities(): BackendCapabilities {
    return {
      name: "codex-sdk",
      sdkVersion: CodexSdkAdapter.sdkVersion,
      supportsThinking: true,
      supportsToolApproval: false, // SDK handles tools via approval policy
      supportsResume: true,
      supportsFork: false, // SDK doesn't expose fork
      supportsStreaming: true,
      supportsSubagents: false,
      supportedPermissionModes: ["default", "bypassPermissions", "dontAsk"],
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
          message: `Codex SDK session failed: ${err instanceof Error ? err.message : String(err)}`,
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
          message: `Codex SDK resume failed: ${err instanceof Error ? err.message : String(err)}`,
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
    log.info("Codex SDK interrupt", { hasAbortController: !!this.abortController })
    this.userInitiatedAbort = true
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    this.eventChannel?.push({ type: "turn_complete" })
  }

  approveToolUse(_id: string): void {
    log.debug("approveToolUse called on Codex SDK adapter — tools are auto-managed by approval policy")
  }

  denyToolUse(_id: string, _reason?: string): void {
    log.debug("denyToolUse called on Codex SDK adapter — tools are auto-managed by approval policy")
  }

  respondToElicitation(_id: string, _answers: Record<string, string>): void {
    log.debug("respondToElicitation called on Codex SDK adapter — not supported")
  }

  cancelElicitation(_id: string): void {
    log.debug("cancelElicitation called on Codex SDK adapter — not supported")
  }

  async setModel(_model: string): Promise<void> {
    log.warn("setModel() on Codex SDK adapter — model is fixed at thread creation")
    this.eventChannel?.push({
      type: "system_message",
      text: "Model switching is not supported by the Codex SDK backend. Restart with --model <name> to change.",
    })
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    log.warn("setPermissionMode() on Codex SDK adapter — policy is fixed at thread creation")
    this.eventChannel?.push({
      type: "system_message",
      text: "Permission mode switching is not supported by the Codex SDK backend.",
    })
  }

  async availableModels(): Promise<ModelInfo[]> {
    return [
      { id: "o3", name: "o3", provider: "openai" },
      { id: "o4-mini", name: "o4-mini", provider: "openai" },
      { id: "codex-mini-latest", name: "Codex Mini", provider: "openai" },
    ]
  }

  async listSessions(): Promise<SessionInfo[]> {
    // SDK doesn't expose session listing
    return []
  }

  async forkSession(
    _sessionId: string,
    _options?: ForkOptions,
  ): Promise<string> {
    throw new Error("Fork not supported on Codex SDK adapter")
  }

  close(): void {
    if (this.closed) return
    trace.write({
      dir: "out",
      stage: "adapter_event",
      type: "close",
      payload: { hadThread: !!this.thread },
    })
    this.closed = true

    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    this.messageQueue.close()

    if (this.eventChannel) {
      this.eventChannel.close()
      this.eventChannel = null
    }

    this.codex = null
    this.thread = null
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

      // 2. Create Codex client
      const codexOptions: CodexOptions = {}
      log.info("Creating Codex SDK client")
      this.codex = new sdk.Codex(codexOptions)

      // 3. Build thread options
      const threadOptions: ThreadOptions = {
        model: config.model,
        workingDirectory: config.cwd ?? process.cwd(),
        approvalPolicy: toApprovalPolicy(config.permissionMode),
      }

      // 3b. Inject model name into event mapper so session_init includes it
      this.eventMapper.setModel(threadOptions.model || "codex")

      // 4. Create or resume thread
      if (resumeSessionId) {
        log.info("Resuming Codex SDK thread", { threadId: resumeSessionId })
        trace.write({
          dir: "out",
          stage: "sdk_call",
          type: "resumeThread",
          payload: { threadId: resumeSessionId, options: threadOptions },
        })
        this.thread = this.codex.resumeThread(resumeSessionId, threadOptions)
      } else {
        log.info("Starting Codex SDK thread", { model: threadOptions.model })
        trace.write({
          dir: "out",
          stage: "sdk_call",
          type: "startThread",
          payload: { options: threadOptions },
        })
        this.thread = this.codex.startThread(threadOptions)
      }

      // 5. If there's an initial prompt, send the first turn
      if (config.initialPrompt) {
        await this.runTurn(config.initialPrompt)
      }

      // 6. Main message loop
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
    if (!this.thread || this.closed) return

    this.abortController = new AbortController()
    this.userInitiatedAbort = false
    this.eventMapper.reset()
    log.info("Starting Codex SDK turn", { promptLength: prompt.length })

    // Emit synthetic turn_start before the stream begins
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
        type: "runStreamed",
        payload: { prompt },
      })
      const { events } = await this.thread.runStreamed(prompt, {
        signal: this.abortController.signal,
      })

      // Guard: timeout for first event (same pattern as Gemini adapter)
      let receivedFirstEvent = false
      const firstEventTimeout = setTimeout(() => {
        if (!receivedFirstEvent && !this.closed) {
          log.warn("Codex SDK turn timed out waiting for first event", {
            promptLength: prompt.length,
            timeoutMs: CodexSdkAdapter.FIRST_EVENT_TIMEOUT_MS,
          })
          this.abortController?.abort()
        }
      }, CodexSdkAdapter.FIRST_EVENT_TIMEOUT_MS)

      try {
        for await (const event of events) {
          if (!receivedFirstEvent) {
            receivedFirstEvent = true
            clearTimeout(firstEventTimeout)
          }
          if (this.closed) break

          log.debug("Codex SDK stream event", { type: event.type })
          trace.write({
            dir: "in",
            stage: "sdk_event",
            type: event.type,
            payload: event,
          })

          const mapped = this.eventMapper.map(event)
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
      if (err instanceof Error && err.name === "AbortError") {
        if (this.userInitiatedAbort) {
          log.info("Codex SDK turn aborted by user")
          // interrupt() already pushed turn_complete
        } else {
          log.warn("Codex SDK turn aborted by first-event timeout")
          if (!this.closed && this.eventChannel) {
            this.eventChannel.push({
              type: "error",
              code: "turn_timeout",
              message: "Codex did not respond — try sending your message again.",
              severity: "recoverable",
            })
            this.eventChannel.push({ type: "turn_complete" })
          }
        }
        return
      }

      if (!this.closed && this.eventChannel) {
        trace.write({
          dir: "internal",
          stage: "adapter_event",
          type: "turn_error",
          payload: { error: err instanceof Error ? err.message : String(err) },
        })
        log.error("Codex SDK turn error", { error: String(err) })
        this.eventChannel.push({
          type: "error",
          code: "turn_error",
          message: err instanceof Error ? err.message : String(err),
          severity: "recoverable",
        })
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
    Codex: new (options?: CodexOptions) => ICodex
  }> {
    try {
      const sdk = await import("@openai/codex-sdk")
      log.info("Loaded @openai/codex-sdk")
      return sdk as any
    } catch (err) {
      const message =
        `Failed to load @openai/codex-sdk. ` +
        `Install it with: bun add @openai/codex-sdk\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
      log.error("SDK load failed", { error: message })
      throw new Error(message)
    }
  }
}
