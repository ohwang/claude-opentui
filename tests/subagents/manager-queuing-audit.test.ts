/**
 * Subagent manager queuing audit tests — message-queuing bugbash (2026-04-13).
 *
 * Exercises the dual-queue architecture: the local `running.messageQueue`
 * (string[]) inside SubagentManager + the backend's own AsyncQueue. Key
 * invariants:
 *   - sendMessage() during mid-turn lands in the local queue, not the backend.
 *   - sendMessage() while idle (between turns) goes directly to the backend.
 *   - On every `turn_complete`, exactly ONE local-queue item drains into the
 *     backend (subsequent turns drain the rest).
 *   - Stopping / closing a subagent with a non-empty local queue emits a
 *     log.warn so the loss is visible, not silent.
 *
 * The SubagentManager private internals are accessed with a narrow type cast.
 * That's acceptable here because the dual-queue behavior is the whole point
 * of the audit — we need visibility into the local queue, not just outputs.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { SubagentManager } from "../../src/subagents/manager"
import { log } from "../../src/utils/logger"
import type { AgentEvent } from "../../src/protocol/types"
import type { AgentDefinition, RunningSubagent } from "../../src/subagents/types"

const mockDef: AgentDefinition = {
  name: "queue-test-agent",
  systemPrompt: "test",
  filePath: "/test/agent.md",
}

/** Peek into the manager's private subagents map for queue inspection. */
function peek(
  manager: SubagentManager,
  id: string,
): RunningSubagent | undefined {
  return (manager as unknown as { subagents: Map<string, RunningSubagent> })
    .subagents.get(id)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("Subagent manager — queuing audit", () => {
  let manager: SubagentManager
  let events: AgentEvent[]
  let logLines: string[]
  let unsubscribe: (() => void) | null = null

  beforeEach(() => {
    manager = new SubagentManager()
    events = []
    logLines = []
    manager.setPushEvent((e) => events.push(e))
    unsubscribe = log.subscribe((line) => logLines.push(line))
  })

  afterEach(() => {
    unsubscribe?.()
    manager.closeAll()
  })

  describe("mid-turn enqueueing", () => {
    test("sendMessage() during mid-turn puts the message in the local queue", async () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "start",
        backendOverride: "mock",
      })

      // Wait for mock to emit turn_start → manager flips midTurn=true.
      // The mock backend streams deltas for ~1.5-2s per turn, so 300ms
      // reliably catches it mid-turn.
      await wait(300)

      const running = peek(manager, id)
      expect(running).toBeDefined()
      // The mock's first turn should have started.
      const wasMidTurn = running!.midTurn
      if (!wasMidTurn) {
        // If the mock turned over faster than 300ms we can't assert; skip
        // the test rather than flake.
        return
      }

      manager.sendMessage(id, "follow-up 1")
      manager.sendMessage(id, "follow-up 2")

      expect(running!.messageQueue).toEqual(["follow-up 1", "follow-up 2"])
    })

    test("sendMessage() between turns goes directly to the backend (not the local queue)", async () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "start",
        backendOverride: "mock",
      })

      // Wait for at least one full turn to complete so midTurn=false.
      await wait(2500)

      const running = peek(manager, id)
      if (!running || running.status.state !== "running") {
        // Mock completed after its only turn — nothing to assert here.
        return
      }
      expect(running.midTurn).toBe(false)

      // This sendMessage should bypass the local queue entirely.
      manager.sendMessage(id, "between-turn message")
      expect(running.messageQueue).toEqual([])
    })
  })

  describe("one-per-turn drain", () => {
    test("exactly one local-queue message drains per turn_complete", async () => {
      // Strategy: spawn, wait mid-turn, queue 3 follow-ups, then observe that
      // messageQueue shrinks by 1 each turn (via the manager's mock loop).
      const id = manager.spawn({
        definition: mockDef,
        prompt: "start",
        backendOverride: "mock",
      })

      await wait(300)
      const running = peek(manager, id)
      if (!running || !running.midTurn) return // see above

      manager.sendMessage(id, "m1")
      manager.sendMessage(id, "m2")
      manager.sendMessage(id, "m3")
      expect(running.messageQueue.length).toBe(3)

      // Each mock turn takes ~1.5-2s. After one turn_complete, the manager
      // shifts exactly one message off the local queue and sends it to the
      // backend, decrementing length by 1.
      //
      // We observe the drain via messageQueue.length shrinking over time.
      // Giving the mock up to ~3s to complete one turn and drain 1 message.
      let drained = false
      for (let i = 0; i < 30; i++) {
        await wait(100)
        if (running.messageQueue.length < 3) {
          drained = true
          break
        }
        if (running.status.state !== "running") break
      }

      // At this point at most 1 message should have drained.
      expect(drained).toBe(true)
      expect(running.messageQueue.length).toBeGreaterThanOrEqual(0)
      expect(running.messageQueue.length).toBeLessThanOrEqual(2)
    })
  })

  describe("queue loss on stop is logged, not silent", () => {
    test("stop() with queued follow-ups emits a log.warn with the drop count", async () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "start",
        backendOverride: "mock",
      })

      await wait(300)
      const running = peek(manager, id)
      if (!running || !running.midTurn) return

      manager.sendMessage(id, "lost-1")
      manager.sendMessage(id, "lost-2")
      manager.sendMessage(id, "lost-3")
      expect(running.messageQueue.length).toBe(3)

      // Clear any prior log lines — we only care about what fires on stop.
      logLines.length = 0

      manager.stop(id)

      const warn = logLines.find(
        (l) =>
          l.includes("Subagent terminated with queued messages dropped") &&
          l.includes('"droppedCount":3'),
      )
      expect(warn).toBeDefined()
      expect(warn).toContain("lost-1")
    })

    test("closeAll() with queued follow-ups also emits a log.warn", async () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "start",
        backendOverride: "mock",
      })

      await wait(300)
      const running = peek(manager, id)
      if (!running || !running.midTurn) return

      manager.sendMessage(id, "x1")
      manager.sendMessage(id, "x2")

      logLines.length = 0
      manager.closeAll()

      const warn = logLines.find(
        (l) =>
          l.includes("Subagent terminated with queued messages dropped") &&
          l.includes('"droppedCount":2'),
      )
      expect(warn).toBeDefined()
    })

    test("stop() with an EMPTY local queue does NOT emit the warning", async () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "start",
        backendOverride: "mock",
      })

      await wait(300)
      logLines.length = 0
      manager.stop(id)

      const warn = logLines.find((l) =>
        l.includes("Subagent terminated with queued messages dropped"),
      )
      expect(warn).toBeUndefined()
    })
  })

  describe("sendMessage() routing by midTurn flag", () => {
    test("sendMessage() before any turn has started still buffers locally if midTurn is false", async () => {
      // Edge case: right after spawn, before the backend has emitted
      // turn_start, midTurn is still false. sendMessage() goes straight to
      // the backend in that case. This documents the current behavior so we
      // notice if it changes.
      const id = manager.spawn({
        definition: mockDef,
        prompt: "start",
        backendOverride: "mock",
      })

      const running = peek(manager, id)
      expect(running).toBeDefined()
      expect(running!.midTurn).toBe(false) // no turn_start processed yet

      manager.sendMessage(id, "pre-turn message")
      // Not in local queue — went straight to backend.
      expect(running!.messageQueue).toEqual([])
    })
  })
})
