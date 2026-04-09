import { describe, expect, it, afterEach } from "bun:test"
import { AcpTerminalManager } from "../../src/backends/acp/terminal-manager"

describe("AcpTerminalManager", () => {
  let mgr: AcpTerminalManager

  afterEach(() => {
    mgr?.destroyAll()
  })

  it("creates a terminal and returns output", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("echo", ["hello world"])

    const exitCode = await mgr.waitForExit(id)
    expect(exitCode).toBe(0)

    const { output, isComplete } = mgr.getOutput(id)
    expect(output).toContain("hello world")
    expect(isComplete).toBe(true)

    mgr.release(id)
  })

  it("returns unique terminal IDs", () => {
    mgr = new AcpTerminalManager()
    const id1 = mgr.create("echo", ["a"])
    const id2 = mgr.create("echo", ["b"])
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^terminal-\d+$/)
    expect(id2).toMatch(/^terminal-\d+$/)
  })

  it("captures stderr in output", async () => {
    mgr = new AcpTerminalManager()
    // shell: true means the command+args are joined into a single shell invocation
    // so we pass the entire command as a single string
    const id = mgr.create("echo errtext >&2")

    await mgr.waitForExit(id)
    const { output } = mgr.getOutput(id)
    expect(output).toContain("errtext")
  })

  it("waitForExit resolves with non-zero exit code", async () => {
    mgr = new AcpTerminalManager()
    // shell: true means we can pass shell commands directly
    const id = mgr.create("exit 42")

    const exitCode = await mgr.waitForExit(id)
    expect(exitCode).toBe(42)
  })

  it("kill terminates a running process", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("sleep", ["60"])

    // Give process time to start
    await new Promise(r => setTimeout(r, 100))

    mgr.kill(id)
    const exitCode = await mgr.waitForExit(id)
    // Killed processes return non-zero (typically 143 for SIGTERM or null -> 1)
    expect(exitCode).not.toBe(0)

    const { isComplete } = mgr.getOutput(id)
    expect(isComplete).toBe(true)
  })

  it("kill with SIGKILL terminates immediately", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("sleep", ["60"])

    await new Promise(r => setTimeout(r, 100))

    mgr.kill(id, "SIGKILL")
    const exitCode = await mgr.waitForExit(id)
    expect(exitCode).not.toBe(0)
  })

  it("release cleans up and removes from map", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("echo", ["done"])

    await mgr.waitForExit(id)
    mgr.release(id)

    // After release, getOutput returns empty defaults
    const { output, isComplete } = mgr.getOutput(id)
    expect(output).toBe("")
    expect(isComplete).toBe(true)
  })

  it("release kills a still-running process", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("sleep", ["60"])

    await new Promise(r => setTimeout(r, 100))

    mgr.release(id)

    // After release, terminal is gone
    const { output, isComplete } = mgr.getOutput(id)
    expect(output).toBe("")
    expect(isComplete).toBe(true)
  })

  it("destroyAll kills all terminals", async () => {
    mgr = new AcpTerminalManager()
    const id1 = mgr.create("sleep", ["60"])
    const id2 = mgr.create("sleep", ["60"])

    await new Promise(r => setTimeout(r, 100))

    mgr.destroyAll()

    // Both should be cleaned up
    expect(mgr.getOutput(id1)).toEqual({ output: "", isComplete: true })
    expect(mgr.getOutput(id2)).toEqual({ output: "", isComplete: true })
  })

  it("getOutput for non-existent terminal returns sensible defaults", () => {
    mgr = new AcpTerminalManager()
    const { output, isComplete } = mgr.getOutput("terminal-nonexistent")
    expect(output).toBe("")
    expect(isComplete).toBe(true)
  })

  it("waitForExit for non-existent terminal returns 1", async () => {
    mgr = new AcpTerminalManager()
    const exitCode = await mgr.waitForExit("terminal-nonexistent")
    expect(exitCode).toBe(1)
  })

  it("kill on non-existent terminal is a no-op", () => {
    mgr = new AcpTerminalManager()
    // Should not throw
    mgr.kill("terminal-nonexistent")
  })

  it("release on non-existent terminal is a no-op", () => {
    mgr = new AcpTerminalManager()
    // Should not throw
    mgr.release("terminal-nonexistent")
  })

  it("timeout triggers auto-kill", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("sleep", ["60"], undefined, undefined, 200)

    const exitCode = await mgr.waitForExit(id)
    expect(exitCode).not.toBe(0)

    const { isComplete } = mgr.getOutput(id)
    expect(isComplete).toBe(true)
  })

  it("getOutput before completion has isComplete false", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("sleep", ["5"])

    // Immediately check — process should still be running
    const { isComplete } = mgr.getOutput(id)
    expect(isComplete).toBe(false)

    mgr.kill(id)
    await mgr.waitForExit(id)
  })

  it("handles custom cwd", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("pwd", [], "/tmp")

    const exitCode = await mgr.waitForExit(id)
    expect(exitCode).toBe(0)

    const { output } = mgr.getOutput(id)
    // macOS resolves /tmp to /private/tmp
    expect(output.trim()).toMatch(/\/?tmp$/)
  })

  it("handles custom env", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("echo $MY_TEST_VAR", [], undefined, {
      MY_TEST_VAR: "test_value_123",
    })

    const exitCode = await mgr.waitForExit(id)
    expect(exitCode).toBe(0)

    const { output } = mgr.getOutput(id)
    expect(output).toContain("test_value_123")
  })

  it("double kill is safe", async () => {
    mgr = new AcpTerminalManager()
    const id = mgr.create("sleep", ["60"])

    await new Promise(r => setTimeout(r, 100))

    mgr.kill(id)
    // Second kill should be a no-op (killed flag is set)
    mgr.kill(id)

    const exitCode = await mgr.waitForExit(id)
    expect(exitCode).not.toBe(0)
  })
})
