/**
 * Base Adapter — Shared lifecycle boilerplate for all backends
 *
 * Owns the common plumbing that every AgentBackend needs:
 *   - messageQueue (AsyncQueue) for queuing user messages
 *   - eventChannel (EventChannel) for pushing events to the TUI consumer
 *   - closed flag + close guards
 *   - start()/resume() skeleton: create channel, run session in background, yield from channel
 *   - sendMessage() pushes to the queue
 *   - close() tears down queue + channel
 *
 * Subclasses implement:
 *   - capabilities()           — static backend info
 *   - runSession(config, id?)  — backend-specific session setup + event mapping
 *   - interrupt()              — backend-specific interrupt logic
 *   - approveToolUse/denyToolUse/respondToElicitation/cancelElicitation
 *   - setModel/setPermissionMode/setEffort
 *   - availableModels/listSessions/forkSession
 *
 * The error handling pattern in start()/resume() wraps runSession() failures
 * in a fatal error event pushed to the channel. Subclasses can override
 * isSwallowedError() to suppress expected errors (e.g., AbortError in Gemini).
 */

import type {
  AgentBackend,
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
import { EventChannel } from "../../utils/event-channel"
import { AsyncQueue } from "../../utils/async-queue"

export abstract class BaseAdapter implements AgentBackend {
  protected messageQueue = new AsyncQueue<UserMessage>()
  protected eventChannel: EventChannel<AgentEvent> | null = null
  protected closed = false

  // ---------------------------------------------------------------------------
  // Abstract — subclasses MUST implement
  // ---------------------------------------------------------------------------

  abstract capabilities(): BackendCapabilities

  /**
   * Backend-specific session lifecycle. Called in the background by start()/resume().
   * Push events to this.eventChannel. Pull messages from this.messageQueue.
   *
   * When this method returns (normally or via throw), the base adapter closes
   * the event channel. Subclasses should NOT close the channel themselves
   * unless they need to close it early from a different code path (e.g., close()).
   */
  protected abstract runSession(
    config: SessionConfig,
    resumeSessionId?: string,
  ): Promise<void>

  abstract interrupt(): void

  abstract approveToolUse(
    id: string,
    options?: { updatedInput?: unknown; alwaysAllow?: boolean; updatedPermissions?: any[] },
  ): void

  abstract denyToolUse(
    id: string,
    reason?: string,
    options?: { denyForSession?: boolean },
  ): void

  abstract respondToElicitation(
    id: string,
    answers: Record<string, string>,
  ): void

  abstract cancelElicitation(id: string): void

  abstract setModel(model: string): Promise<void>
  abstract setPermissionMode(mode: PermissionMode): Promise<void>
  abstract setEffort(level: EffortLevel): Promise<void>
  abstract availableModels(): Promise<ModelInfo[]>
  abstract listSessions(): Promise<SessionInfo[]>
  abstract forkSession(
    sessionId: string,
    options?: ForkOptions,
  ): Promise<string>

  // ---------------------------------------------------------------------------
  // Optional override — subclasses MAY override for reset support
  // ---------------------------------------------------------------------------

  resetSession?(): Promise<void>

  // ---------------------------------------------------------------------------
  // Shared lifecycle: start / resume / sendMessage / close
  // ---------------------------------------------------------------------------

  async *start(config: SessionConfig): AsyncGenerator<AgentEvent> {
    this.eventChannel = new EventChannel<AgentEvent>()

    this.runSessionAndClose(config, config.resume)

    yield* this.eventChannel[Symbol.asyncIterator]()
  }

  async *resume(sessionId: string): AsyncGenerator<AgentEvent> {
    this.eventChannel = new EventChannel<AgentEvent>()

    this.runSessionAndClose({ resume: sessionId }, sessionId)

    yield* this.eventChannel[Symbol.asyncIterator]()
  }

  sendMessage(message: UserMessage): void {
    this.messageQueue.push(message)
  }

  close(): void {
    if (this.closed) return
    this.closed = true

    this.messageQueue.close()

    if (this.eventChannel) {
      this.eventChannel.close()
      this.eventChannel = null
    }

    this.onClose()
  }

  // ---------------------------------------------------------------------------
  // Protected helpers
  // ---------------------------------------------------------------------------

  /**
   * Run runSession() in the background, then always close the event channel.
   * Errors are caught and pushed as fatal error events (unless swallowed).
   * Subclasses do NOT need to close the channel at the end of runSession().
   */
  private runSessionAndClose(
    config: SessionConfig,
    resumeSessionId?: string,
  ): void {
    this.runSession(config, resumeSessionId)
      .catch((err) => {
        if (!this.isSwallowedError(err)) {
          // Push error but don't close yet — the finally block will close
          if (!this.closed && this.eventChannel) {
            this.eventChannel.push({
              type: "error",
              code: "adapter_error",
              message: `${this.capabilities().name} session failed: ${err instanceof Error ? err.message : String(err)}`,
              severity: "fatal",
            })
          }
        }
      })
      .finally(() => {
        this.eventChannel?.close()
      })
  }

  /**
   * Push a fatal error event to the channel and close it.
   * Safe to call when channel is null or already closed.
   */
  protected pushErrorAndClose(message: string): void {
    if (!this.closed && this.eventChannel) {
      this.eventChannel.push({
        type: "error",
        code: "adapter_error",
        message,
        severity: "fatal",
      })
      this.eventChannel.close()
    }
  }

  /**
   * Override to suppress specific errors in start()/resume() catch blocks.
   * Return true to swallow the error (no error event emitted).
   * Default: never swallow.
   */
  protected isSwallowedError(_err: unknown): boolean {
    return false
  }

  /**
   * Override to add backend-specific cleanup during close().
   * Called after messageQueue and eventChannel are closed.
   * Default: no-op.
   */
  protected onClose(): void {}

  /**
   * Standard message loop: pull from messageQueue, call the provided handler.
   * Exits cleanly when the adapter is closed or the queue throws.
   */
  protected async runMessageLoop(
    handler: (message: UserMessage) => Promise<void>,
  ): Promise<void> {
    while (!this.closed) {
      try {
        const message = await this.messageQueue.pull()
        if (this.closed) break
        await handler(message)
      } catch (err) {
        if (this.closed) break
        throw err
      }
    }
  }
}
