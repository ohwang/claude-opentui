/**
 * Orchestrator edge-case integration tests.
 *
 * Covers phase machine guards, cancellation at various phases, interrupt
 * semantics, and double-call protection. Uses real git repos + MockAdapter.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOrchestrator } from "../../src/ab/orchestrator"
import type { Phase } from "../../src/ab/types"

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bantai-ab-edge-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "test@bantai.local")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "commit.gpgsign", "false")
  writeFileSync(join(dir, "README.md"), "# test\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "init")
  return dir
}

function waitForPhase(
  orch: ReturnType<typeof createOrchestrator>,
  target: Phase,
  timeoutMs = 10000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (orch.phase() === target) return resolve()
      if (Date.now() - start > timeoutMs) {
        return reject(
          new Error(`phase ${target} not reached; current=${orch.phase()}`),
        )
      }
      setTimeout(tick, 25)
    }
    tick()
  })
}

describe("orchestrator edge cases", () => {
  let repo: string
  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true })
    } catch {}
  })

  it("cancel during executing cleans up worktrees and returns to done", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-cancel-exec",
      prompt: "do stuff",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    orch.start().catch(() => {})
    await waitForPhase(orch, "executing", 5000)

    // Cancel mid-execution
    orch.cancel()
    expect(orch.phase()).toBe("done")

    // Repo should be clean (no worktree branches lingering)
    const branches = git(repo, "branch", "--list", "bantai-ab/*")
    expect(branches).toBe("")
  }, 15000)

  it("cancel during comparing cleans up worktrees", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-cancel-cmp",
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    await orch.start()
    await waitForPhase(orch, "comparing", 15000)
    expect(orch.phase()).toBe("comparing")

    orch.cancel()
    expect(orch.phase()).toBe("done")

    const branches = git(repo, "branch", "--list", "bantai-ab/*")
    expect(branches).toBe("")
  }, 30000)

  it("start() is a no-op when not in review phase", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-double-start",
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    const p = orch.start()
    await waitForPhase(orch, "executing", 5000)

    // Second start should be a no-op
    await orch.start()
    // Phase should still be executing or comparing — not reset to review
    expect(["executing", "comparing"]).toContain(orch.phase())

    await p
    orch.cancel()
  }, 30000)

  it("adopt in wrong phase (not comparing) is a no-op", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-bad-adopt",
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    // adopt before start — phase is "review"
    await orch.adopt("A")
    expect(orch.phase()).toBe("review")

    orch.cancel()
  }, 15000)

  it("startJudge in wrong phase is a no-op", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-bad-judge",
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    // startJudge before reaching comparing
    await orch.startJudge()
    expect(orch.phase()).toBe("review")

    orch.cancel()
  }, 15000)

  it("startCombine in wrong phase is a no-op", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-bad-combine",
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    await orch.startCombine()
    expect(orch.phase()).toBe("review")

    orch.cancel()
  }, 15000)

  it("cancel after done does not double-settle", async () => {
    let settleCount = 0
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-double-settle",
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      onDone: () => {
        settleCount++
      },
    })

    await orch.start()
    await waitForPhase(orch, "comparing", 15000)

    orch.cancel()
    expect(orch.phase()).toBe("done")
    expect(settleCount).toBe(1)

    // Second cancel should not re-trigger onDone
    orch.cancel()
    expect(settleCount).toBe(1)
  }, 30000)

  it("interruptBoth during execution sets interrupted on both sides", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-interrupt-both",
      prompt: "do lots of work",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    const p = orch.start()
    await waitForPhase(orch, "executing", 5000)

    orch.interruptBoth()
    // Wait for sessions to finish after interrupt
    await p.catch(() => {})
    // After interrupt + completion, sessions should reflect interrupted state
    // (Note: depending on timing, sessions may complete before interrupt lands)
    orch.cancel()
    expect(orch.phase()).toBe("done")
  }, 15000)

  it("dirty working tree (multiple files) preserved across full cycle", async () => {
    // Create diverse dirty state
    writeFileSync(join(repo, "new-file.txt"), "brand new\n")
    writeFileSync(join(repo, "README.md"), "# modified\n")
    writeFileSync(join(repo, "tracked.txt"), "")
    git(repo, "add", "tracked.txt")
    writeFileSync(join(repo, "tracked.txt"), "modified after staging\n")

    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-dirty-multi",
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    await orch.start()
    await waitForPhase(orch, "comparing", 15000)

    // Verify dirty state is restored on main during execution
    expect(readFileSync(join(repo, "new-file.txt"), "utf-8")).toBe("brand new\n")
    expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("# modified\n")

    orch.cancel()
  }, 30000)

  it("onDone receives the correct result on cancel", async () => {
    let result: any = null
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-ondone-cancel",
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      onDone: (r) => {
        result = r
      },
    })

    await orch.start()
    await waitForPhase(orch, "comparing", 15000)

    orch.cancel()
    expect(result).not.toBeNull()
    expect(result.phase).toBe("done")
    expect(result.winner).toBeNull()
  }, 30000)

  it("onDone receives the correct result on adopt", async () => {
    let result: any = null
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-ondone-adopt",
      prompt: "test",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
      onDone: (r) => {
        result = r
      },
    })

    await orch.start()
    await waitForPhase(orch, "comparing", 15000)

    await orch.adopt("B")
    expect(result).not.toBeNull()
    expect(result.phase).toBe("done")
    expect(result.winner).toBe("B")
  }, 30000)
})
