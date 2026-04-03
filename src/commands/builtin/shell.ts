/**
 * Shell command execution for ! prefix.
 * Runs commands via Bun.spawn and pushes synthetic tool events
 * to reuse the existing Bash tool rendering in tool-view.tsx.
 */

import type { AgentEvent } from "../../protocol/types"

/**
 * Execute a shell command and push synthetic tool events so the output
 * renders using the existing Bash tool block in tool-view.tsx.
 */
export async function executeShellCommand(
  command: string,
  pushEvent: (event: AgentEvent) => void,
  cwd?: string,
): Promise<void> {
  const id = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Emit tool_use_start so the UI shows the running indicator immediately
  pushEvent({
    type: "tool_use_start",
    id,
    tool: "Bash",
    input: { command },
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
        type: "tool_use_end",
        id,
        output: output || `Process exited with code ${exitCode}`,
        error: `Exit code ${exitCode}`,
      })
    } else {
      pushEvent({
        type: "tool_use_end",
        id,
        output,
      })
    }
  } catch (err) {
    pushEvent({
      type: "tool_use_end",
      id,
      output: "",
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
