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
  forceKillTimer?: ReturnType<typeof setTimeout>
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

    // `detached: true` puts the child in its own process group (via setsid on
    // POSIX). Combined with `shell: true`, this is essential on Linux: without
    // it, `spawn("sleep", ["60"], { shell: true })` creates `sh -c "sleep 60"`
    // where `sh` forks and waits on `sleep`. proc.pid is the shell's PID, but
    // `sleep` inherits the stdio pipes. Sending SIGTERM to the shell (or even
    // letting it exit) leaves `sleep` holding the pipes open, so the "close"
    // event on proc never fires — waitForExit hangs indefinitely.
    //
    // On macOS with `sh`, a single-command `sh -c` is typically optimized to
    // exec-replace the shell with the command, so proc.pid IS the command and
    // kill works directly. Linux shells (dash/bash) don't do this in the same
    // way, which is why this bug only manifests on Linux.
    //
    // With `detached: true`, we signal the entire process group via `-pid`,
    // which delivers the signal to both the shell and any children it forked.
    const proc = spawn(command, args ?? [], {
      cwd: cwd ?? process.cwd(),
      env: env ? { ...process.env, ...env } : process.env,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
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

    // Clear any existing force-kill timer
    if (terminal.forceKillTimer) clearTimeout(terminal.forceKillTimer)

    terminal.killed = true
    const sig = signal === "SIGKILL" ? "SIGKILL" : "SIGTERM"
    this.signalTerminal(terminal, sig)

    if (sig === "SIGTERM") {
      // Force kill after 3 seconds if still alive
      terminal.forceKillTimer = setTimeout(() => {
        if (terminal.exitCode === null) {
          this.signalTerminal(terminal, "SIGKILL")
        }
      }, 3000)
    }
  }

  /**
   * Deliver a signal to the managed process.
   *
   * When we spawn with `detached: true`, the child becomes a new process group
   * leader (setsid). Using `process.kill(-pid, signal)` delivers the signal to
   * the entire group — i.e. the shell wrapper AND any children it forked (like
   * `sleep`). Without this, on Linux we'd only signal the shell and the
   * grandchild process would keep the stdio pipes open, preventing the
   * "close" event from ever firing on our ChildProcess.
   *
   * On Windows (where `detached` doesn't create a process group), or if the
   * group-kill fails (e.g. the group is already gone), we fall back to a
   * direct `proc.kill()`.
   */
  private signalTerminal(terminal: ManagedTerminal, sig: NodeJS.Signals): void {
    const pid = terminal.process.pid
    try {
      if (pid !== undefined && process.platform !== "win32") {
        // Negative PID targets the process group.
        process.kill(-pid, sig)
        return
      }
      terminal.process.kill(sig)
    } catch (err) {
      // ESRCH = no such process/group (already exited). Try direct kill as a
      // fallback for any other error; ignore if that also fails.
      try {
        terminal.process.kill(sig)
      } catch (innerErr) {
        log.debug("Terminal kill error (may already be dead)", {
          pid,
          error: String(err),
          fallbackError: String(innerErr),
        })
      }
    }
  }

  release(terminalId: string): void {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return

    // Clear timers
    if (terminal.timeoutTimer) clearTimeout(terminal.timeoutTimer)
    if (terminal.forceKillTimer) clearTimeout(terminal.forceKillTimer)

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
