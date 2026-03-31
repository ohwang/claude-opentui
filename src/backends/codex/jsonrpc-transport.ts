/**
 * JSON-RPC 2.0 Transport over stdio
 *
 * Bidirectional JSONL transport for communicating with `codex app-server`.
 * Handles three message patterns:
 *   1. Client requests → server responses (matched by ID)
 *   2. Client notifications (no response expected)
 *   3. Server notifications (no response needed) and server-initiated requests
 *      (client must respond — used for approval callbacks)
 *
 * Wire format: newline-delimited JSON, no "jsonrpc":"2.0" field on the wire.
 */

import { spawn, type ChildProcess } from "child_process"
import { log } from "../../utils/logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  id: number | string
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  id: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Server-initiated request (has id + method — client must respond) */
export interface ServerRequest {
  id: number | string
  method: string
  params?: unknown
}

export type TransportEvent =
  | { type: "notification"; method: string; params: unknown }
  | { type: "server_request"; id: number | string; method: string; params: unknown }

// ---------------------------------------------------------------------------
// JSON-RPC Transport
// ---------------------------------------------------------------------------

export class JsonRpcTransport {
  private process: ChildProcess | null = null
  private nextId = 1
  private pendingRequests = new Map<
    number | string,
    { resolve: (result: unknown) => void; reject: (err: Error) => void }
  >()
  private notificationHandler: ((method: string, params: unknown) => void) | null = null
  private requestHandler:
    | ((id: number | string, method: string, params: unknown) => void)
    | null = null
  private closed = false
  private lineBuffer = ""
  private stderrChunks: string[] = []

  /**
   * Spawn `codex app-server` and wire up stdio.
   * Resolves once the process is running and ready for messages.
   */
  async start(command: string, args: string[]): Promise<void> {
    log.info("Spawning Codex app-server", { command, args })

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    })

    // Read stdout line by line (JSONL)
    this.process.stdout!.on("data", (chunk: Buffer) => {
      this.lineBuffer += chunk.toString()
      let newlineIdx: number
      while ((newlineIdx = this.lineBuffer.indexOf("\n")) !== -1) {
        const line = this.lineBuffer.slice(0, newlineIdx).trim()
        this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1)
        if (line) this.handleLine(line)
      }
    })

    // Capture stderr for diagnostics
    this.process.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) {
        this.stderrChunks.push(text)
        log.debug("Codex stderr", { text: text.slice(0, 200) })
      }
    })

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      log.info("Codex app-server exited", { code, signal })
      if (!this.closed) {
        this.closed = true
        // Reject all pending requests
        const err = new Error(
          `Codex app-server exited (code=${code}, signal=${signal})`,
        )
        for (const [, pending] of this.pendingRequests) {
          pending.reject(err)
        }
        this.pendingRequests.clear()
      }
    })

    this.process.on("error", (err) => {
      log.error("Codex app-server spawn error", { error: err.message })
      if (!this.closed) {
        this.closed = true
        for (const [, pending] of this.pendingRequests) {
          pending.reject(err)
        }
        this.pendingRequests.clear()
      }
    })
  }

  /**
   * Send a JSON-RPC request and wait for the matching response.
   */
  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed || !this.process) {
      throw new Error("Transport is closed")
    }

    const id = this.nextId++
    const msg: JsonRpcRequest = { id, method }
    if (params !== undefined) msg.params = params

    log.debug("Codex send request", { id, method })
    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.writeLine(JSON.stringify(msg))
    })
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  notify(method: string, params?: unknown): void {
    if (this.closed || !this.process) return

    const msg: JsonRpcNotification = { method }
    if (params !== undefined) msg.params = params
    log.debug("Codex send notification", { method })
    this.writeLine(JSON.stringify(msg))
  }

  /**
   * Respond to a server-initiated request.
   */
  respond(id: number | string, result: unknown): void {
    if (this.closed || !this.process) return

    log.debug("Codex send response", { id })
    const msg: JsonRpcResponse = { id, result }
    this.writeLine(JSON.stringify(msg))
  }

  /**
   * Respond with an error to a server-initiated request.
   */
  respondError(
    id: number | string,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    if (this.closed || !this.process) return

    log.debug("Codex send error response", { id, code, message })
    const msg: JsonRpcResponse = { id, error: { code, message, data } }
    this.writeLine(JSON.stringify(msg))
  }

  /**
   * Register handler for server notifications (no id).
   */
  onNotification(
    handler: (method: string, params: unknown) => void,
  ): void {
    this.notificationHandler = handler
  }

  /**
   * Register handler for server-initiated requests (has id — must respond).
   */
  onRequest(
    handler: (id: number | string, method: string, params: unknown) => void,
  ): void {
    this.requestHandler = handler
  }

  /**
   * Get captured stderr output (for error diagnostics).
   */
  getStderr(): string {
    return this.stderrChunks.join("\n")
  }

  /**
   * Close the transport and kill the child process.
   */
  close(): void {
    if (this.closed) return
    this.closed = true

    if (this.process) {
      this.process.stdin!.end()
      this.process.kill("SIGTERM")
      // Force kill after 3s if still alive
      const forceTimer = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL")
        }
      }, 3000)
      this.process.on("exit", () => clearTimeout(forceTimer))
      this.process = null
    }

    const err = new Error("Transport closed")
    for (const [, pending] of this.pendingRequests) {
      pending.reject(err)
    }
    this.pendingRequests.clear()
  }

  get isAlive(): boolean {
    return !this.closed && this.process !== null
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private writeLine(line: string): void {
    if (!this.process?.stdin?.writable) return
    this.process.stdin.write(line + "\n")
  }

  private handleLine(line: string): void {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      log.warn("Non-JSON line from app-server", { line: line.slice(0, 200) })
      return
    }

    log.debug("Codex recv", {
      id: msg.id,
      method: msg.method,
      hasResult: msg.result !== undefined,
      hasError: msg.error !== undefined,
    })

    // Response to a client request (has id + result/error, no method)
    if (msg.id !== undefined && !msg.method) {
      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        this.pendingRequests.delete(msg.id)
        if (msg.error) {
          pending.reject(
            new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`),
          )
        } else {
          pending.resolve(msg.result)
        }
      } else {
        log.warn("Response for unknown request ID", { id: msg.id })
      }
      return
    }

    // Server-initiated request (has id + method — client must respond)
    if (msg.id !== undefined && msg.method) {
      if (this.requestHandler) {
        this.requestHandler(msg.id, msg.method, msg.params)
      } else {
        log.warn("No handler for server request", { method: msg.method })
        // Auto-decline to avoid hanging the server
        this.respondError(msg.id, -32601, "Method not handled")
      }
      return
    }

    // Server notification (method, no id)
    if (msg.method && msg.id === undefined) {
      if (this.notificationHandler) {
        this.notificationHandler(msg.method, msg.params)
      } else {
        log.debug("Unhandled notification", { method: msg.method })
      }
      return
    }

    log.warn("Unclassified message from app-server", {
      keys: Object.keys(msg).join(","),
    })
  }
}
