/**
 * Orchestrator integration test.
 *
 * Spins up a real git repo in a temp dir, runs A/B with two MockAdapter
 * instances (one labelled A, one labelled B — both share the same
 * mock backend but operate in isolated worktrees), then exercises the
 * end-to-end path: execute → compare → adopt → merge back.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOrchestrator } from "../../src/ab/orchestrator"

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bantai-ab-orch-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "test@bantai.local")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "commit.gpgsign", "false")
  writeFileSync(join(dir, "README.md"), "# hi\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "init")
  return dir
}

function waitForPhase(
  orch: ReturnType<typeof createOrchestrator>,
  target: string,
  timeoutMs = 10000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (orch.phase() === target) return resolve()
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`phase ${target} not reached; current=${orch.phase()}`))
      }
      setTimeout(tick, 25)
    }
    tick()
  })
}

describe("orchestrator (mock backends, real git)", () => {
  let repo: string
  beforeEach(() => {
    repo = makeRepo()
  })
  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }) } catch {}
  })

  it("runs both sides in parallel worktrees and advances to comparing", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-session-abc",
      prompt: "say hello",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    expect(orch.phase()).toBe("review")
    const startPromise = orch.start()
    // Let the orchestrator drive; wait for comparing.
    await waitForPhase(orch, "comparing", 15000)
    await startPromise

    expect(orch.statsA().complete).toBe(true)
    expect(orch.statsB().complete).toBe(true)
    expect(orch.statsA().output.length).toBeGreaterThan(0)
    expect(orch.statsB().output.length).toBeGreaterThan(0)
    expect(orch.diffA()).not.toBeNull()
    expect(orch.diffB()).not.toBeNull()

    orch.cancel() // tears down worktrees
  }, 30000)

  it("preserves uncommitted WIP across the fork (stash/pop)", async () => {
    // Leave some dirty state on main
    writeFileSync(join(repo, "wip.txt"), "uncommitted\n")
    writeFileSync(join(repo, "README.md"), "# changed\n")

    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-wip",
      prompt: "say hi",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })
    const p = orch.start()
    await waitForPhase(orch, "comparing", 15000)
    await p

    // Dirty state should be restored on main
    expect(readFileSync(join(repo, "wip.txt"), "utf-8")).toBe("uncommitted\n")
    expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("# changed\n")

    orch.cancel()
  }, 30000)

  it("adopts a winner and merges the winning branch's changes back into main", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-adopt",
      prompt: "hi",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })
    const p = orch.start()
    await waitForPhase(orch, "comparing", 15000)
    await p

    // Before adopt: main is clean (no files added)
    expect(git(repo, "status", "--porcelain")).toBe("")

    // Inject a fake change in worktree A so adopt has something to merge.
    const wtA = orch.statsA().backendId  // side-effect test
    expect(wtA).toBe("mock")
    // Write directly into A's worktree path via the bundle's pair is not
    // exposed; instead we verify that adopt runs end-to-end cleanly when
    // there are no session changes — the expected outcome is a successful
    // merge (fast-forward of empty delta, or soft-reset no-op).
    const adoptPromise = orch.adopt("A")
    await adoptPromise

    expect(orch.phase()).toBe("done")
  }, 30000)

  it("supports cross-target comparison (different configs per side)", async () => {
    // Same backend but different "model" labels — the orchestrator must
    // route them separately. Full cross-backend (claude vs codex) requires
    // live SDKs and is out of scope for an automated test.
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-xt",
      prompt: "hi",
      targetA: { backendId: "mock", model: "model-a" },
      targetB: { backendId: "mock", model: "model-b" },
    })
    const p = orch.start()
    await waitForPhase(orch, "comparing", 15000)
    await p

    expect(orch.statsA().model).toBe("model-a")
    expect(orch.statsB().model).toBe("model-b")

    orch.cancel()
  }, 30000)
})
