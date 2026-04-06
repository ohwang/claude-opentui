/**
 * Logger — File-based session logging
 *
 * Writes structured log lines to ~/.claude-opentui/logs/<session-id>.log.
 * Each app invocation gets a unique session ID. Debug logging is enabled
 * via --debug flag.
 */

import { mkdirSync, appendFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LOG_DIR = join(homedir(), ".claude-opentui", "logs")

function generateSessionId(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = now.toISOString().slice(11, 19).replace(/:/g, "")
  const random = Math.random().toString(36).slice(2, 8)
  return `${date}_${time}_${random}`
}

class Logger {
  private sessionId: string
  private logFile: string
  private level: LogLevel = "info"
  private initialized = false
  private backendSessionId: string | null = null
  private backendName: string | null = null
  private _sessionInfoPrinted = false

  constructor() {
    this.sessionId = generateSessionId()
    this.logFile = join(LOG_DIR, `${this.sessionId}.log`)
  }

  /** Ensure log directory exists. Called lazily on first write. */
  private ensureDir() {
    if (this.initialized) return
    try {
      mkdirSync(LOG_DIR, { recursive: true })
    } catch {
      // If we can't create the dir, writes will silently fail
    }
    this.initialized = true
  }

  setLevel(level: LogLevel) {
    this.level = level
  }

  getSessionId(): string {
    return this.sessionId
  }

  getLogFile(): string {
    return this.logFile
  }

  getLogDir(): string {
    return LOG_DIR
  }

  setBackendName(name: string) {
    this.backendName = name
  }

  setBackendSessionId(id: string) {
    this.backendSessionId = id
  }

  getBackendSessionId(): string | null {
    return this.backendSessionId
  }

  /**
   * Print session info to stdout exactly once.
   *
   * Safe to call from multiple exit paths (cleanExit, process.on("exit"),
   * SIGINT safety-net) — the flag ensures output appears only once.
   * Accepts optional extra lines (e.g. backend trace path).
   */
  printSessionInfo(extras?: string[]) {
    if (this._sessionInfoPrinted) return
    this._sessionInfoPrinted = true
    // Backend-aware session label (e.g. "Claude Code Session", "Codex Session")
    if (this.backendSessionId || this.backendName) {
      const label = this.backendSessionLabel()
      const id = this.backendSessionId ?? "not available"
      process.stdout.write(`${label}: ${id}\n`)
    }
    process.stdout.write(`Session: ${this.sessionId}\n`)
    process.stdout.write(`Log: ${this.logFile}\n`)
    if (extras) {
      for (const line of extras) {
        process.stdout.write(`${line}\n`)
      }
    }
  }

  /** Derive a human-friendly label from the backend name. */
  private backendSessionLabel(): string {
    switch (this.backendName) {
      case "claude":
      case "claude-v1":
      case "claude-v2":
        return "Claude Code Session"
      case "codex":
      case "codex-sdk":
        return "Codex Session"
      case "gemini":
        return "Gemini Session"
      default:
        return "Backend Session"
    }
  }

  private write(level: LogLevel, message: string, data?: unknown) {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return

    this.ensureDir()

    const timestamp = new Date().toISOString()
    const tag = level.toUpperCase().padEnd(5)
    let line = `[${timestamp}] [${tag}] ${message}`
    if (data !== undefined) {
      try {
        line += ` ${JSON.stringify(data)}`
      } catch {
        line += ` [unserializable]`
      }
    }
    line += "\n"

    try {
      appendFileSync(this.logFile, line)
    } catch {
      // Silently ignore — never crash the TUI for logging
    }
  }

  debug(message: string, data?: unknown) {
    this.write("debug", message, data)
  }
  info(message: string, data?: unknown) {
    this.write("info", message, data)
  }
  warn(message: string, data?: unknown) {
    this.write("warn", message, data)
  }
  error(message: string, data?: unknown) {
    this.write("error", message, data)
  }
}

/** Singleton logger instance — import and use everywhere */
export const log = new Logger()
