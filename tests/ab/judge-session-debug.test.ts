/**
 * Debug test: verify the judge session completes with a mock backend.
 * This specifically tests the scenario where a long judge prompt is sent
 * to the mock adapter and the session runner's finish timer resolves.
 */

import { describe, expect, it } from "bun:test"
import { runSession } from "../../src/ab/session-runner"

describe("judge session with mock backend", () => {
  it("completes within a reasonable time", async () => {
    const updates: boolean[] = []

    const handle = runSession({
      label: "A",
      target: { backendId: "mock" },
      prompt:
        "You are acting as a judge. Your Task: Read the changed files in both worktrees. " +
        "Evaluate code quality, correctness, completeness, and maintainability. " +
        "Be direct and decisive. The user is waiting to pick a winner. " +
        "RECOMMENDATION: A or RECOMMENDATION: B",
      cwd: process.cwd(),
      onUpdate: (s) => {
        updates.push(s.complete)
      },
    })

    const result = await Promise.race([
      handle.done,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Session did not complete in 15s")), 15000),
      ),
    ])

    expect(result.complete).toBe(true)
    expect(result.turns).toBeGreaterThanOrEqual(1)
    expect(result.output.length).toBeGreaterThan(0)
    // The last update should have complete=true
    expect(updates[updates.length - 1]).toBe(true)

    // Clean up
    handle.close()
  }, 20000)
})
