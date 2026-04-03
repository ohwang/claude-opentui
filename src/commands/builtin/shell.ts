/**
 * Shell command execution for ! prefix.
 * Runs commands via Bun.spawn and pushes shell_start/shell_end events
 * which render via the dedicated shell-block component.
 */

import type { AgentEvent } from "../../protocol/types"

/**
 * Execute a shell command and push shell events so the output
 * renders using the dedicated shell block component.
 */
export async function executeShellCommand(
  command: string,
  pushEvent: (event: AgentEvent) => void,
  cwd?: string,
): Promise<void> {
  const id = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Emit shell_start so the UI shows the running indicator immediately
  pushEvent({
    type: "shell_start",
    id,
    command,
  })

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: cwd ?? process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited

    const output = stdout + (stderr && stdout ? "\n" : "") + stderr

    if (exitCode !== 0) {
      pushEvent({
        type: "shell_end",
        id,
        output: output || "",
        error: `Exit code ${exitCode}`,
        exitCode,
      })
    } else {
      pushEvent({
        type: "shell_end",
        id,
        output,
        exitCode: exitCode ?? 0,
      })
    }
  } catch (err) {
    pushEvent({
      type: "shell_end",
      id,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    })
  }
}
