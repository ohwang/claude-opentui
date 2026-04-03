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
  private claudeSessionId: string | null = null

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

  setClaudeSessionId(id: string) {
    this.claudeSessionId = id
  }

  getClaudeSessionId(): string | null {
    return this.claudeSessionId
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
