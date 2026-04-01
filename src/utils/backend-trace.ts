/**
 * Backend trace logger — raw JSONL wire/debug tracing
 *
 * Opt-in append-only trace intended for adapter/backend debugging.
 * Writes one JSON object per line to:
 *   ~/.claude-opentui/logs/<session-id>.backend.jsonl
 *
 * This trace is intentionally verbose and may contain sensitive data.
 */

import { mkdirSync, createWriteStream, type WriteStream } from "fs"
import { join } from "path"
import { log } from "./logger"

const MAX_PAYLOAD_BYTES = 8 * 1024 // 8 KB

export type BackendTraceDirection = "in" | "out" | "internal"

export type BackendTraceStage =
  | "sdk_call"
  | "sdk_event"
  | "mapped_event"
  | "adapter_event"
  | "transport_send"
  | "transport_recv"
  | "transport_stderr"

export interface BackendTraceEntry {
  backend: string
  dir: BackendTraceDirection
  stage: BackendTraceStage
  type: string
  payload?: unknown
  meta?: Record<string, unknown>
}

export interface ScopedBackendTracer {
  write(entry: Omit<BackendTraceEntry, "backend">): void
}

class BackendTraceLogger {
  private enabled = false
  private initialized = false
  private sequence = 0
  private filePath: string | null = null
  private stream: WriteStream | null = null
  private seen = new WeakSet<object>()

  private jsonReplacer = (_key: string, value: unknown): unknown => {
    if (typeof value === "bigint") return value.toString()
    if (typeof value === "string" && value.length > MAX_PAYLOAD_BYTES) {
      return value.slice(0, MAX_PAYLOAD_BYTES) + `...[truncated ${value.length - MAX_PAYLOAD_BYTES} chars]`
    }
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack }
    }
    if (typeof value === "function") {
      return `[Function ${(value as Function).name || "anonymous"}]`
    }
    if (typeof value === "object" && value !== null) {
      if (this.seen.has(value)) return "[Circular]"
      this.seen.add(value)
    }
    return value
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) this.ensureStream()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  getFilePath(): string {
    return this.filePath ?? ""
  }

  scoped(backend: string): ScopedBackendTracer {
    return {
      write: (entry) => this.write({ backend, ...entry }),
    }
  }

  write(entry: BackendTraceEntry): void {
    if (!this.enabled) return

    this.ensureStream()

    const line = {
      ts: new Date().toISOString(),
      seq: ++this.sequence,
      ...entry,
    }

    try {
      this.seen = new WeakSet()
      this.stream!.write(`${JSON.stringify(line, this.jsonReplacer)}\n`)
    } catch {
      // Never crash the app for trace logging.
    }
  }

  close(): void {
    if (this.stream) {
      this.stream.end()
      this.stream = null
    }
  }

  private ensureStream(): void {
    if (this.initialized) return
    this.filePath = join(log.getLogDir(), `${log.getSessionId()}.backend.jsonl`)
    try {
      mkdirSync(log.getLogDir(), { recursive: true })
    } catch {
      // If we can't create the dir, writes will silently fail.
    }
    this.stream = createWriteStream(this.filePath, { flags: "a" })
    this.stream.on("error", () => {}) // Prevent unhandled error crashes
    this.initialized = true
  }
}

export const backendTrace = new BackendTraceLogger()
