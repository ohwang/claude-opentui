/**
 * Reproduce the judge session hang — mimics what the orchestrator does.
 * Creates an orchestrator with mock backends, runs to comparing, then
 * starts the judge and verifies it completes.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOrchestrator } from "../../src/ab/orchestrator"
import type { Phase } from "../../src/ab/types"

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bantai-judge-repro-"))
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

describe("judge flow via orchestrator", () => {
  let repo: string
  beforeEach(() => { repo = makeRepo() })
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }) } catch {} })

  it("judge session completes and returns to comparing", async () => {
    const orch = createOrchestrator({
      projectDir: repo,
      sessionId: "test-judge",
      prompt: "hi",
      targetA: { backendId: "mock" },
      targetB: { backendId: "mock" },
    })

    await orch.start()
    await waitForPhase(orch, "comparing", 15000)
    expect(orch.phase()).toBe("comparing")

    // Start judge — this should complete and return to comparing
    const judgePromise = orch.startJudge("quality")

    // Wait for judging phase
    await waitForPhase(orch, "judging", 5000)

    // Wait for it to return to comparing
    await waitForPhase(orch, "comparing", 20000)

    await judgePromise

    // Judge result should be populated
    const judge = orch.judge()
    expect(judge).not.toBeNull()
    expect(judge!.complete).toBe(true)
    expect(judge!.reasoning.length).toBeGreaterThan(0)

    orch.cancel()
  }, 45000)
})
