/**
 * SubagentManager Tests
 *
 * Tests the orchestration engine using the MockAdapter backend.
 * Validates spawn, stop, closeAll, message queuing, event relay,
 * startup timeout, and permission/elicitation handling.
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { SubagentManager } from "../../src/subagents/manager"
import type { AgentEvent, AgentBackend, SessionConfig } from "../../src/protocol/types"
import type { AgentDefinition, SubagentStatus } from "../../src/subagents/types"

const mockDef: AgentDefinition = {
  name: "test-agent",
  systemPrompt: "You are a test agent",
  filePath: "/test/agent.md",
}

/** Wait for async event loop to process */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a minimal AgentBackend that never emits session_init.
 * Its start() returns an async generator that hangs forever.
 */
function createHangingBackend(): { backend: AgentBackend; closeCalls: number[] } {
  const closeCalls: number[] = []
  const backend: AgentBackend = {
    start(_config: SessionConfig): AsyncGenerator<AgentEvent> {
      return (async function* () {
        await new Promise(() => {}) // hang forever
      })()
    },
    sendMessage(): void {},
    interrupt(): void {},
    resume(): AsyncGenerator<AgentEvent> { return (async function* () {})() },
    listSessions() { return Promise.resolve([]) },
    forkSession() { return Promise.reject(new Error("not supported")) },
    approveToolUse(): void {},
    denyToolUse(): void {},
    respondToElicitation(): void {},
    cancelElicitation(): void {},
    setModel() { return Promise.resolve() },
    setPermissionMode() { return Promise.resolve() },
    setEffort() { return Promise.resolve() },
    capabilities() {
      return {
        name: "hanging",
        supportsThinking: false,
        supportsToolApproval: false,
        supportsResume: false,
        supportsFork: false,
        supportsStreaming: false,
        supportsSubagents: false,
        supportedPermissionModes: ["default" as const],
      }
    },
    availableModels() { return Promise.resolve([]) },
    close(): void { closeCalls.push(Date.now()) },
  }
  return { backend, closeCalls }
}

describe("SubagentManager", () => {
  let manager: SubagentManager
  let events: AgentEvent[]

  beforeEach(() => {
    manager = new SubagentManager()
    events = []
    manager.setPushEvent((event) => events.push(event))
  })

  describe("spawn()", () => {
    test("returns a subagentId", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      expect(id).toMatch(/^subagent-\d+$/)
    })

    test("returns incrementing IDs", () => {
      const id1 = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      const id2 = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      expect(id1).toBe("subagent-1")
      expect(id2).toBe("subagent-2")
      // Clean up
      manager.closeAll()
    })

    test("status is 'running' immediately after spawn", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      const status = manager.getStatus(id)
      expect(status).toBeDefined()
      expect(status!.state).toBe("running")
      expect(status!.definitionName).toBe("test-agent")
      expect(status!.backendName).toBe("mock")
      // Clean up
      manager.closeAll()
    })

    test("uses definition.backend when no backendOverride", () => {
      const def: AgentDefinition = {
        ...mockDef,
        backend: "mock",
      }
      const id = manager.spawn({
        definition: def,
        prompt: "hello",
      })
      const status = manager.getStatus(id)
      expect(status!.backendName).toBe("mock")
      manager.closeAll()
    })

    test("uses description from definition when available", () => {
      const def: AgentDefinition = {
        ...mockDef,
        description: "A helpful test agent",
      }
      const id = manager.spawn({
        definition: def,
        prompt: "hello",
        backendOverride: "mock",
      })
      const status = manager.getStatus(id)
      expect(status!.description).toBe("A helpful test agent")
      manager.closeAll()
    })

    test("falls back to name when no description", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      const status = manager.getStatus(id)
      expect(status!.description).toBe("test-agent")
      manager.closeAll()
    })
  })

  describe("getStatus()", () => {
    test("returns status for existing subagent", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      const status = manager.getStatus(id)
      expect(status).toBeDefined()
      expect(status!.subagentId).toBe(id)
      manager.closeAll()
    })

    test("returns undefined for non-existent subagent", () => {
      const status = manager.getStatus("subagent-999")
      expect(status).toBeUndefined()
    })
  })

  describe("listAll()", () => {
    test("returns empty array when no subagents", () => {
      expect(manager.listAll()).toEqual([])
    })

    test("lists all subagents", () => {
      manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      manager.spawn({
        definition: { ...mockDef, name: "agent-2" },
        prompt: "world",
        backendOverride: "mock",
      })
      const all = manager.listAll()
      expect(all).toHaveLength(2)
      expect(all[0]!.definitionName).toBe("test-agent")
      expect(all[1]!.definitionName).toBe("agent-2")
      manager.closeAll()
    })
  })

  describe("stop()", () => {
    test("stops a running subagent", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      expect(manager.getStatus(id)!.state).toBe("running")
      manager.stop(id)
      const status = manager.getStatus(id)
      expect(status!.state).toBe("completed")
      expect(status!.endTime).toBeDefined()
    })

    test("is a no-op for non-existent subagent", () => {
      // Should not throw
      manager.stop("subagent-999")
    })

    test("is a no-op for already stopped subagent", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      manager.stop(id)
      const endTime = manager.getStatus(id)!.endTime
      manager.stop(id)
      // endTime should not change on second stop
      expect(manager.getStatus(id)!.endTime).toBe(endTime)
    })
  })

  describe("closeAll()", () => {
    test("marks all running subagents as error with 'Session ended'", () => {
      const id1 = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      const id2 = manager.spawn({
        definition: mockDef,
        prompt: "world",
        backendOverride: "mock",
      })
      manager.closeAll()
      const s1 = manager.getStatus(id1)
      const s2 = manager.getStatus(id2)
      expect(s1!.state).toBe("error")
      expect(s1!.errorMessage).toBe("Session ended")
      expect(s1!.endTime).toBeDefined()
      expect(s2!.state).toBe("error")
      expect(s2!.errorMessage).toBe("Session ended")
    })

    test("does not affect already completed subagents", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      manager.stop(id)
      expect(manager.getStatus(id)!.state).toBe("completed")
      manager.closeAll()
      // Should still be completed, not error
      expect(manager.getStatus(id)!.state).toBe("completed")
    })
  })

  describe("sendMessage()", () => {
    test("queues a message for a running subagent", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      manager.sendMessage(id, "follow-up message")
      // The message should be in the internal queue
      // We can verify indirectly: the subagent's status still running
      expect(manager.getStatus(id)!.state).toBe("running")
      manager.closeAll()
    })

    test("is a no-op for non-existent subagent", () => {
      // Should not throw
      manager.sendMessage("subagent-999", "hello")
    })

    test("is a no-op for stopped subagent", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      manager.stop(id)
      // Should not throw
      manager.sendMessage(id, "should be ignored")
    })
  })

  describe("event relay", () => {
    test("emits task_start immediately on spawn", () => {
      manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })

      // task_start should be emitted synchronously
      const taskStarts = events.filter((e) => e.type === "task_start")
      expect(taskStarts).toHaveLength(1)
      expect(taskStarts[0]!.type).toBe("task_start")
      manager.closeAll()
    })

    test("emits task_complete on stop", () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      manager.stop(id)

      const taskCompletes = events.filter((e) => e.type === "task_complete")
      expect(taskCompletes).toHaveLength(1)
    })

    test("emits task_complete for each subagent on closeAll", () => {
      manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      manager.spawn({
        definition: mockDef,
        prompt: "world",
        backendOverride: "mock",
      })
      manager.closeAll()

      const taskCompletes = events.filter((e) => e.type === "task_complete")
      expect(taskCompletes).toHaveLength(2)
    })

    test("emits task_progress events as mock backend streams", async () => {
      manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })

      // Wait for the mock backend to process — session_init + sendMessage + response stream
      await wait(2000)

      const progressEvents = events.filter((e) => e.type === "task_progress")
      expect(progressEvents.length).toBeGreaterThan(0)

      manager.closeAll()
    })

    test("does not emit events when pushEvent is not set", () => {
      const manager2 = new SubagentManager()
      // No setPushEvent call
      const id = manager2.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })
      // Should not throw
      manager2.stop(id)
    })

    test("captures sessionId from session_init", async () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })

      // Wait for session_init to be processed
      await wait(500)

      const status = manager.getStatus(id)
      expect(status!.sessionId).toBeDefined()
      expect(status!.sessionId).toMatch(/^mock-/)

      manager.closeAll()
    })

    test("accumulates output from text events", async () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })

      // Wait for mock to stream response
      await wait(2000)

      const status = manager.getStatus(id)
      expect(status!.output.length).toBeGreaterThan(0)

      manager.closeAll()
    })

    test("increments turnCount on turn_complete", async () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
      })

      // Wait for mock to complete a turn
      await wait(2000)

      const status = manager.getStatus(id)
      expect(status!.turnCount).toBeGreaterThanOrEqual(1)

      manager.closeAll()
    })
  })

  describe("startup timeout", () => {
    test("mock backend with short timeout does not timeout (session_init is fast)", async () => {
      const id = manager.spawn({
        definition: mockDef,
        prompt: "hello",
        backendOverride: "mock",
        startupTimeoutMs: 500,
      })

      await wait(300)
      const status = manager.getStatus(id)
      // Should have received session_init, so should still be running
      expect(status!.state).toBe("running")
      expect(status!.sessionId).toBeDefined()
      manager.closeAll()
    })

    test("timeout fires when backend never emits session_init", async () => {
      const testEvents: AgentEvent[] = []
      const { backend, closeCalls } = createHangingBackend()

      // Construct a RunningSubagent manually and call startEventLoop via cast
      const testManager = new SubagentManager()
      testManager.setPushEvent((event) => testEvents.push(event))

      const status: SubagentStatus = {
        subagentId: "subagent-timeout-test",
        definitionName: mockDef.name,
        backendName: "hanging",
        state: "running",
        description: mockDef.name,
        output: "",
        startTime: Date.now(),
        turnCount: 0,
        toolUseCount: 0,
        thinkingActive: false,
        recentTools: [],
      }

      const running = {
        subagentId: "subagent-timeout-test",
        definition: mockDef,
        status,
        backend,
        messageQueue: [] as string[],
        midTurn: false,
      }

      // Call startEventLoop directly via cast to access private method
      const startEventLoop = (testManager as any).startEventLoop.bind(testManager)
      // Use a 200ms timeout for fast test execution
      void startEventLoop(running, {}, "hello", 200)

      // Wait for timeout to fire
      await wait(400)

      expect(status.state).toBe("error")
      expect(status.errorMessage).toContain("failed to initialize within")
      expect(status.errorMessage).toContain("0.2s")
      expect(status.endTime).toBeDefined()

      // Should have emitted task_complete with error state
      const errorCompletes = testEvents.filter(
        (e) => e.type === "task_complete" && (e as any).state === "error",
      )
      expect(errorCompletes.length).toBeGreaterThanOrEqual(1)

      // Backend should have been closed
      expect(closeCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("permission and elicitation relay", () => {
    test("permission_request from subagent does not crash the manager", async () => {
      // Use the mock backend which emits permission_request for "bash" prompts
      const id = manager.spawn({
        definition: { ...mockDef, permissionMode: "default" },
        prompt: "run a bash command",
        backendOverride: "mock",
      })

      // Wait for the mock to process — it will emit permission_request
      // The manager should auto-deny it and continue running
      await wait(2000)

      const status = manager.getStatus(id)
      // Manager should still be running (not crashed)
      expect(status).toBeDefined()
      // State should be running or completed, not undefined/crashed
      expect(["running", "completed", "error"]).toContain(status!.state)

      manager.closeAll()
    })

    test("elicitation_request from subagent does not crash the manager", async () => {
      // Use the mock backend which emits elicitation_request for "ask" prompts
      const id = manager.spawn({
        definition: mockDef,
        prompt: "ask me a question",
        backendOverride: "mock",
      })

      // Wait for the mock to process
      await wait(2000)

      const status = manager.getStatus(id)
      expect(status).toBeDefined()
      expect(["running", "completed", "error"]).toContain(status!.state)

      manager.closeAll()
    })
  })
})
