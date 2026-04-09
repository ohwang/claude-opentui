/**
 * ACP Terminal Manager
 *
 * Manages terminal processes spawned on behalf of ACP agents.
 * The agent sends terminal/create, terminal/output, terminal/wait_for_exit,
 * terminal/kill, and terminal/release requests; this class handles the
 * underlying child process lifecycle.
 */

import { spawn, type ChildProcess } from "child_process"
import { log } from "../../utils/logger"

interface ManagedTerminal {
  process: ChildProcess
  output: string[]       // accumulated output chunks
  exitCode: number | null
  exitPromise: Promise<number>
  killed: boolean
  timeoutTimer?: ReturnType<typeof setTimeout>
}

export class AcpTerminalManager {
  private terminals = new Map<string, ManagedTerminal>()
  private nextId = 1

  create(
    command: string,
    args?: string[],
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number,
  ): string {
    const terminalId = `terminal-${this.nextId++}`

    const proc = spawn(command, args ?? [], {
      cwd: cwd ?? process.cwd(),
      env: env ? { ...process.env, ...env } : process.env,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const terminal: ManagedTerminal = {
      process: proc,
      output: [],
      exitCode: null,
      killed: false,
      exitPromise: new Promise<number>((resolve) => {
        proc.on("close", (code) => {
          terminal.exitCode = code ?? 1
          resolve(terminal.exitCode)
        })
        proc.on("error", (err) => {
          log.warn("Terminal process error", { terminalId, error: String(err) })
          terminal.exitCode = 1
          resolve(1)
        })
      }),
    }

    // Accumulate stdout and stderr
    proc.stdout?.on("data", (chunk: Buffer) => {
      terminal.output.push(chunk.toString())
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      terminal.output.push(chunk.toString())
    })

    // Optional timeout
    if (timeout && timeout > 0) {
      terminal.timeoutTimer = setTimeout(() => {
        if (terminal.exitCode === null) {
          log.warn("Terminal process timed out", { terminalId, timeout })
          this.kill(terminalId)
        }
      }, timeout)
    }

    this.terminals.set(terminalId, terminal)
    log.info("Terminal created", { terminalId, command, args })
    return terminalId
  }

  getOutput(terminalId: string): { output: string; isComplete: boolean } {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return { output: "", isComplete: true }
    }
    return {
      output: terminal.output.join(""),
      isComplete: terminal.exitCode !== null,
    }
  }

  async waitForExit(terminalId: string): Promise<number> {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return 1
    return terminal.exitPromise
  }

  kill(terminalId: string, signal?: string): void {
    const terminal = this.terminals.get(terminalId)
    if (!terminal || terminal.killed) return

    terminal.killed = true
    try {
      if (signal === "SIGKILL") {
        terminal.process.kill("SIGKILL")
      } else {
        terminal.process.kill("SIGTERM")
        // Force kill after 3 seconds if still alive
        setTimeout(() => {
          if (terminal.exitCode === null) {
            terminal.process.kill("SIGKILL")
          }
        }, 3000)
      }
    } catch (err) {
      log.debug("Terminal kill error (may already be dead)", {
        terminalId,
        error: String(err),
      })
    }
  }

  release(terminalId: string): void {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return

    // Clear timers
    if (terminal.timeoutTimer) clearTimeout(terminal.timeoutTimer)

    // Kill if still running
    if (terminal.exitCode === null) {
      this.kill(terminalId)
    }

    this.terminals.delete(terminalId)
    log.debug("Terminal released", { terminalId })
  }

  /** Clean up all terminals (called on adapter close) */
  destroyAll(): void {
    for (const [id] of this.terminals) {
      this.release(id)
    }
  }
}
