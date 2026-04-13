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
import { backendTrace } from "../../utils/backend-trace"

const trace = backendTrace.scoped("codex")

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
   *
   * Resolves once the subprocess has emitted the "spawn" event and stdin is
   * writable — i.e. the kernel has given us a live process we can actually
   * send bytes to. Without this gate, a subsequent `request("initialize")`
   * can race an ENOENT from spawn() or a subprocess that crashed on startup
   * before the first line of stdio was wired up.
   *
   * Rejects (instead of silently succeeding) when:
   *   - spawn() emits an "error" event before "spawn" (ENOENT, EPERM, etc.)
   *   - the subprocess exits before spawning is acknowledged
   *   - readiness does not arrive within `readyTimeoutMs` (default 5s)
   *
   * When it rejects, the error message includes any captured stderr so the
   * user sees the actual failure reason (e.g. "unknown subcommand 'app-server'")
   * instead of a generic "Transport is closed".
   */
  async start(
    command: string,
    args: string[],
    opts?: { readyTimeoutMs?: number },
  ): Promise<void> {
    const readyTimeoutMs = opts?.readyTimeoutMs ?? 5_000
    log.info("Spawning Codex app-server", { command, args, readyTimeoutMs })

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
      log.info("Codex app-server exited", { code, signal })
      if (!this.closed) {
        this.closed = true
        // Reject all pending requests with the captured stderr so users see
        // the actual crash reason instead of a generic "Transport closed".
        const stderrTail = this.getStderrTail()
        const baseMsg = `Codex app-server exited (code=${code}, signal=${signal})`
        const err = new Error(
          stderrTail ? `${baseMsg}\n\nstderr:\n${stderrTail}` : baseMsg,
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

    // Wait for the subprocess to actually spawn (or fail loudly) before
    // returning. We race three signals:
    //   - "spawn": kernel gave us a pid and stdin is writable
    //   - "error": spawn itself failed (ENOENT, EPERM)
    //   - "exit" before "spawn": the subprocess died immediately on startup
    //   - timeout: the subprocess is hanging during startup (stuck on TTY probe, etc.)
    //
    // On any failure path we surface captured stderr so the caller gets a
    // concrete reason rather than "Transport is closed".
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const done = (err?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.process?.off("spawn", onSpawn)
        this.process?.off("error", onError)
        this.process?.off("exit", onExit)
        if (err) reject(err)
        else resolve()
      }

      const onSpawn = () => {
        // `spawn` fires once the kernel reports the child is live. stdin.writable
        // is expected to be true at this point; guard against edge cases where
        // the stream was destroyed synchronously.
        if (!this.process?.stdin?.writable) {
          const tail = this.getStderrTail()
          done(
            new Error(
              tail
                ? `Codex app-server stdin not writable after spawn\n\nstderr:\n${tail}`
                : "Codex app-server stdin not writable after spawn",
            ),
          )
          return
        }
        done()
      }
      const onError = (err: Error) => {
        const tail = this.getStderrTail()
        done(
          new Error(
            tail
              ? `Failed to spawn '${command}': ${err.message}\n\nstderr:\n${tail}`
              : `Failed to spawn '${command}': ${err.message}`,
          ),
        )
      }
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        const tail = this.getStderrTail()
        const base = `Codex app-server exited before ready (code=${code}, signal=${signal})`
        done(new Error(tail ? `${base}\n\nstderr:\n${tail}` : base))
      }

      this.process!.once("spawn", onSpawn)
      this.process!.once("error", onError)
      this.process!.once("exit", onExit)

      const timer = setTimeout(() => {
        const tail = this.getStderrTail()
        const base = `Codex app-server did not become ready within ${readyTimeoutMs}ms`
        done(new Error(tail ? `${base}\n\nstderr:\n${tail}` : base))
      }, readyTimeoutMs)
    })
  }

  /** Return the last ~4KB of captured stderr for error messages. */
  private getStderrTail(maxBytes = 4096): string {
    if (this.stderrChunks.length === 0) return ""
    const joined = this.stderrChunks.join("\n")
    return joined.length > maxBytes
      ? "…(truncated)…\n" + joined.slice(-maxBytes)
      : joined
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

    const msg: JsonRpcNotification = { method }
    if (params !== undefined) msg.params = params
    log.debug("Codex send notification", { method })
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

    log.debug("Codex send response", { id })
    const msg: JsonRpcResponse = { id, result }
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

    log.debug("Codex send error response", { id, code, message })
    const msg: JsonRpcResponse = { id, error: { code, message, data } }
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
      trace.write({
        dir: "in",
        stage: "transport_recv",
        type: "non_json_line",
        payload: { line },
      })
      return
    }

    log.debug("Codex recv", {
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
