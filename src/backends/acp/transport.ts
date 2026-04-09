/**
 * ACP JSON-RPC 2.0 Transport over stdio
 *
 * Bidirectional NDJSON transport for communicating with ACP-compatible agents.
 * Handles three message patterns:
 *   1. Client requests → server responses (matched by ID)
 *   2. Client notifications (no response expected)
 *   3. Server notifications and server-initiated requests
 *      (client must respond — used for permission and fs callbacks)
 *
 * Unlike the Codex transport, this includes the "jsonrpc":"2.0" field on
 * all outbound messages per the JSON-RPC 2.0 specification.
 */

import { spawn, type ChildProcess } from "child_process"
import { log } from "../../utils/logger"
import { backendTrace } from "../../utils/backend-trace"

const trace = backendTrace.scoped("acp")

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ---------------------------------------------------------------------------
// ACP Transport
// ---------------------------------------------------------------------------

export class AcpTransport {
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
   * Spawn an ACP agent subprocess and wire up stdio.
   */
  async start(command: string, args: string[]): Promise<void> {
    log.info("Spawning ACP agent", { command, args })

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    })

    // Read stdout line by line (NDJSON)
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
        log.debug("ACP agent stderr", { text: text.slice(0, 200) })
        trace.write({
          dir: "in",
          stage: "transport_stderr",
          type: "stderr",
          payload: { text },
        })
      }
    })

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      log.info("ACP agent exited", { code, signal })
      if (!this.closed) {
        this.closed = true
        const err = new Error(`ACP agent exited (code=${code}, signal=${signal})`)
        for (const [, pending] of this.pendingRequests) {
          pending.reject(err)
        }
        this.pendingRequests.clear()
      }
    })

    this.process.on("error", (err) => {
      log.error("ACP agent spawn error", { error: err.message })
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
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method }
    if (params !== undefined) msg.params = params

    log.debug("ACP send request", { id, method })
    trace.write({
      dir: "out",
      stage: "transport_send",
      type: method,
      payload: msg,
    })
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

    const msg: JsonRpcNotification = { jsonrpc: "2.0", method }
    if (params !== undefined) msg.params = params
    log.debug("ACP send notification", { method })
    trace.write({
      dir: "out",
      stage: "transport_send",
      type: method,
      payload: msg,
    })
    this.writeLine(JSON.stringify(msg))
  }

  /**
   * Respond to a server-initiated request.
   */
  respond(id: number | string, result: unknown): void {
    if (this.closed || !this.process) return

    log.debug("ACP send response", { id })
    const msg: JsonRpcResponse = { jsonrpc: "2.0", id, result }
    trace.write({
      dir: "out",
      stage: "transport_send",
      type: "response",
      payload: msg,
    })
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

    log.debug("ACP send error response", { id, code, message })
    const msg: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message, data } }
    trace.write({
      dir: "out",
      stage: "transport_send",
      type: "response.error",
      payload: msg,
    })
    this.writeLine(JSON.stringify(msg))
  }

  /**
   * Register handler for server notifications (no id).
   */
  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandler = handler
  }

  /**
   * Register handler for server-initiated requests (has id — must respond).
   */
  onRequest(handler: (id: number | string, method: string, params: unknown) => void): void {
    this.requestHandler = handler
  }

  /**
   * Get captured stderr output.
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
      log.warn("Non-JSON line from ACP agent", { line: line.slice(0, 200) })
      trace.write({
        dir: "in",
        stage: "transport_recv",
        type: "non_json_line",
        payload: { line },
      })
      return
    }

    log.debug("ACP recv", {
      id: msg.id,
      method: msg.method,
      hasResult: msg.result !== undefined,
      hasError: msg.error !== undefined,
    })
    trace.write({
      dir: "in",
      stage: "transport_recv",
      type: msg.method ?? (msg.error ? "response.error" : "response"),
      payload: msg,
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

    log.warn("Unclassified message from ACP agent", {
      keys: Object.keys(msg).join(","),
    })
  }
}
