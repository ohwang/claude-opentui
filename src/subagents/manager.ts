/**
 * SubagentManager — orchestrates native cross-backend subagents.
 *
 * Each subagent is an independent AgentBackend instance with its own process
 * and session. The manager consumes each child's event stream and re-emits
 * filtered events into the parent's pipeline via pushEvent().
 *
 * All re-emitted events carry the subagent's subagentId (mapped to taskId
 * at the event boundary), ensuring clean scoping when many subagents run
 * concurrently.
 */

import { createBackend } from "./backend-factory"
import { log } from "../utils/logger"
import type { AgentEvent, SessionConfig } from "../protocol/types"
import type { SpawnOptions, SubagentStatus, RunningSubagent } from "./types"

const MAX_RECENT_TOOLS = 5

export class SubagentManager {
  private subagents = new Map<string, RunningSubagent>()
  private pushEvent: ((event: AgentEvent) => void) | null = null
  private nextId = 1

  /** Wire up the event relay. Called by SyncProvider on mount. */
  setPushEvent(fn: (event: AgentEvent) => void): void {
    this.pushEvent = fn
  }

  /**
   * Spawn a new subagent. Returns the subagentId immediately.
   * The backend starts asynchronously in the background.
   */
  spawn(opts: SpawnOptions): string {
    const subagentId = `subagent-${this.nextId++}`
    const def = opts.definition
    const backendName = opts.backendOverride ?? def.backend ?? "claude"

    // Create backend
    const backend = createBackend({
      backend: backendName,
      acpCommand: def.acpCommand,
      acpArgs: def.acpArgs,
    })

    // Initialize status
    const status: SubagentStatus = {
      subagentId,
      definitionName: def.name,
      backendName,
      state: "running",
      description: def.description ?? def.name,
      output: "",
      startTime: Date.now(),
      turnCount: 0,
      toolUseCount: 0,
      thinkingActive: false,
      recentTools: [],
    }

    const running: RunningSubagent = {
      subagentId,
      definition: def,
      status,
      backend,
      messageQueue: [],
    }

    this.subagents.set(subagentId, running)

    // Emit task_start immediately
    this.emit({
      type: "task_start",
      taskId: subagentId,
      description: status.description,
      source: "native",
      backendName,
    } as AgentEvent)

    // Build session config from definition
    const config: SessionConfig = {
      model: opts.modelOverride ?? def.model,
      permissionMode: def.permissionMode ?? "bypassPermissions",
      maxTurns: def.maxTurns,
      cwd: opts.cwd,
      systemPrompt: def.systemPrompt,
      persistSession: true,
      effort: def.effort,
      allowedTools: def.tools,
      disallowedTools: def.disallowedTools,
    }

    // Start the backend event loop in the background
    this.startEventLoop(running, config, opts.prompt).catch((err) => {
      log.error("Subagent event loop failed", { subagentId, error: String(err) })
      this.handleError(running, String(err))
    })

    log.info("Subagent spawned", { subagentId, name: def.name, backend: backendName })
    return subagentId
  }

  /** Send a follow-up message to a running subagent. */
  sendMessage(subagentId: string, text: string): void {
    const running = this.subagents.get(subagentId)
    if (!running || running.status.state !== "running") return
    // Queue the message — it will be sent on the next turn_complete
    running.messageQueue.push(text)
  }

  /** Get status of a specific subagent. */
  getStatus(subagentId: string): SubagentStatus | undefined {
    return this.subagents.get(subagentId)?.status
  }

  /** List all subagent statuses. */
  listAll(): SubagentStatus[] {
    return Array.from(this.subagents.values()).map((r) => r.status)
  }

  /** Stop a running subagent. */
  stop(subagentId: string): void {
    const running = this.subagents.get(subagentId)
    if (!running || running.status.state !== "running") return
    running.backend.close()
    running.status.state = "completed"
    running.status.endTime = Date.now()
    this.emit({
      type: "task_complete",
      taskId: subagentId,
      output: running.status.output,
      state: "completed",
    } as AgentEvent)
    log.info("Subagent stopped", { subagentId })
  }

  /** Shut down all subagents. Called during app cleanup. */
  closeAll(): void {
    for (const [id, running] of this.subagents) {
      if (running.status.state === "running") {
        running.backend.close()
        running.status.state = "error"
        running.status.endTime = Date.now()
        running.status.errorMessage = "Session ended"
        this.emit({
          type: "task_complete",
          taskId: id,
          output: running.status.output,
          state: "error",
          errorMessage: "Session ended",
        } as AgentEvent)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async startEventLoop(
    running: RunningSubagent,
    config: SessionConfig,
    initialPrompt: string,
  ): Promise<void> {
    const { subagentId, backend } = running
    const gen = backend.start(config)

    try {
      for await (const event of gen) {
        if (running.status.state !== "running") break

        switch (event.type) {
          case "session_init":
            running.status.sessionId = event.sessionId
            // Send the initial prompt now that the session is ready
            backend.sendMessage({ text: initialPrompt })
            break

          case "turn_start":
            log.debug("Subagent turn started", { subagentId })
            break

          case "text_delta":
            running.status.output += event.text
            break

          case "text_complete":
            running.status.output = event.text
            this.emitProgress(running)
            break

          case "thinking_delta":
            running.status.thinkingActive = true
            this.emitProgress(running)
            break

          case "tool_use_start":
            running.status.toolUseCount++
            running.status.lastToolName = event.tool
            running.status.recentTools = [
              ...running.status.recentTools.slice(-(MAX_RECENT_TOOLS - 1)),
              event.tool,
            ]
            this.emitProgress(running)
            break

          case "tool_use_end":
            log.debug("Subagent tool use ended", { subagentId, id: event.id })
            break

          case "turn_complete":
            running.status.turnCount++
            running.status.thinkingActive = false
            // Check message queue for follow-ups
            if (running.messageQueue.length > 0) {
              const msg = running.messageQueue.shift()!
              backend.sendMessage({ text: msg })
            }
            this.emitProgress(running)
            break

          case "cost_update":
            running.status.tokenUsage = {
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
            }
            break

          case "error":
            this.handleError(running, event.message)
            return

          default:
            log.debug("Subagent event ignored", { subagentId, type: event.type })
            break
        }
      }
    } catch (err) {
      if (running.status.state === "running") {
        this.handleError(running, String(err))
      }
      return
    }

    // Generator exhausted — subagent completed normally
    if (running.status.state === "running") {
      running.status.state = "completed"
      running.status.endTime = Date.now()
      running.backend.close()
      this.emit({
        type: "task_complete",
        taskId: subagentId,
        output: running.status.output,
        state: "completed",
      } as AgentEvent)
      log.info("Subagent completed", { subagentId })
    }
  }

  private handleError(running: RunningSubagent, message: string): void {
    running.status.state = "error"
    running.status.endTime = Date.now()
    running.status.errorMessage = message
    running.backend.close()
    this.emit({
      type: "task_complete",
      taskId: running.subagentId,
      output: running.status.output,
      state: "error",
      errorMessage: message,
    } as AgentEvent)
    log.error("Subagent error", { subagentId: running.subagentId, error: message })
  }

  private emitProgress(running: RunningSubagent): void {
    this.emit({
      type: "task_progress",
      taskId: running.subagentId,
      output: running.status.output,
      lastToolName: running.status.lastToolName,
      turnCount: running.status.turnCount,
      toolUseCount: running.status.toolUseCount,
      tokenUsage: running.status.tokenUsage,
      thinkingActive: running.status.thinkingActive,
      recentTools: running.status.recentTools,
    } as AgentEvent)
  }

  private emit(event: AgentEvent): void {
    if (this.pushEvent) {
      this.pushEvent(event)
    }
  }
}
