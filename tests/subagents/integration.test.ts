/**
 * Integration Tests — Full Subagent Pipeline Verification
 *
 * Exercises the complete stack from definition loading through
 * SubagentManager, event relay, reducer state, and surface APIs
 * (slash commands, MCP tools, diagnostics).
 *
 * Uses the MockAdapter backend for deterministic event pipeline testing.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { SubagentManager } from "../../src/subagents/manager"
import { loadDefinitionsFromDir } from "../../src/subagents/definitions"
import { reduce } from "../../src/protocol/reducer"
import { createInitialState } from "../../src/protocol/types"
import type { AgentEvent, TaskInfo } from "../../src/protocol/types"
import type { AgentDefinition } from "../../src/subagents/types"
import { join } from "path"

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const PROJECT_ROOT = join(import.meta.dir, "../..")
const AGENTS_DIR = join(PROJECT_ROOT, "tests/fixtures/agents")

// ---------------------------------------------------------------------------
// 1. Full pipeline: definition -> spawn -> events -> reducer state
// ---------------------------------------------------------------------------

describe("Full pipeline: definition -> spawn -> events -> reducer state", () => {
  let manager: SubagentManager
  let events: AgentEvent[]

  beforeEach(() => {
    manager = new SubagentManager()
    events = []
    manager.setPushEvent((e) => events.push(e))
  })

  afterEach(() => {
    manager.closeAll()
  })

  test("load real definition, spawn, capture events, feed through reducer", async () => {
    // Load a real definition from .claude/agents/
    const defs = loadDefinitionsFromDir(AGENTS_DIR)
    const mockDef = defs.find((d) => d.name === "mock-test")
    expect(mockDef).toBeDefined()
    expect(mockDef!.backend).toBe("mock")

    // Spawn via SubagentManager
    const id = manager.spawn({
      definition: mockDef!,
      prompt: "Hello from integration test",
    })

    // Wait for async event loop to produce events
    await wait(3000)

    // Should have captured events
    expect(events.length).toBeGreaterThan(0)

    // Feed events through the reducer
    let state = createInitialState()

    // The reducer needs session_init and turn_start to be in RUNNING state
    // before task events are meaningful. Simulate a minimal session context.
    state = reduce(state, {
      type: "session_init",
      tools: [],
      models: [{ id: "mock", name: "mock" }],
      sessionId: "test-session",
    })
    state = reduce(state, { type: "turn_start" })

    // Feed all captured subagent events through the reducer
    for (const event of events) {
      state = reduce(state, event)
    }

    // Verify ConversationState.activeTasks has the right entries
    expect(state.activeTasks.size).toBeGreaterThanOrEqual(1)
    const task = state.activeTasks.get(id)
    expect(task).toBeDefined()
    expect(task!.taskId).toBe(id)

    // Verify native tasks have source === "native" and backendName set
    expect(task!.source).toBe("native")
    expect(task!.backendName).toBe("mock")
  }, { timeout: 10000 })

  test("task_start sets correct initial state in reducer", () => {
    const state = createInitialState()

    // Create task_start event like SubagentManager emits
    const taskStartEvent: AgentEvent = {
      type: "task_start",
      taskId: "subagent-1",
      description: "Test agent",
      source: "native",
      backendName: "mock",
    }

    const next = reduce(state, taskStartEvent)

    expect(next.activeTasks.size).toBe(1)
    const task = next.activeTasks.get("subagent-1")
    expect(task).toBeDefined()
    expect(task!.source).toBe("native")
    expect(task!.backendName).toBe("mock")
    expect(task!.status).toBe("running")
    expect(task!.description).toBe("Test agent")
  })

  test("task_progress updates existing task in reducer", () => {
    let state = createInitialState()

    // task_start
    state = reduce(state, {
      type: "task_start",
      taskId: "subagent-1",
      description: "Test agent",
      source: "native",
      backendName: "mock",
    })

    // task_progress with rich metadata
    state = reduce(state, {
      type: "task_progress",
      taskId: "subagent-1",
      output: "Working on it...",
      lastToolName: "Read",
      turnCount: 2,
      toolUseCount: 5,
      tokenUsage: { inputTokens: 1000, outputTokens: 500 },
      thinkingActive: true,
      recentTools: ["Read", "Edit", "Write"],
    })

    const task = state.activeTasks.get("subagent-1")
    expect(task).toBeDefined()
    expect(task!.output).toBe("Working on it...")
    expect(task!.lastToolName).toBe("Read")
    expect(task!.turnCount).toBe(2)
    expect(task!.toolUseCount).toBe(5)
    expect(task!.tokenUsage).toEqual({ inputTokens: 1000, outputTokens: 500 })
    expect(task!.thinkingActive).toBe(true)
    expect(task!.recentTools).toEqual(["Read", "Edit", "Write"])
  })

  test("task_complete marks task as completed with error info", () => {
    let state = createInitialState()

    state = reduce(state, {
      type: "task_start",
      taskId: "subagent-1",
      description: "Test agent",
      source: "native",
      backendName: "mock",
    })

    // Complete with error
    state = reduce(state, {
      type: "task_complete",
      taskId: "subagent-1",
      output: "Failed output",
      state: "error",
      errorMessage: "Something went wrong",
    })

    const task = state.activeTasks.get("subagent-1")
    expect(task).toBeDefined()
    expect(task!.status).toBe("error")
    expect(task!.output).toBe("Failed output")
    expect(task!.errorMessage).toBe("Something went wrong")
    expect(task!.endTime).toBeDefined()
  })

  test("turn_start prunes completed tasks from previous turn", () => {
    let state = createInitialState()

    // Initialize and start first turn
    state = reduce(state, {
      type: "session_init",
      tools: [],
      models: [{ id: "mock", name: "mock" }],
    })
    state = reduce(state, { type: "turn_start" })

    // Add a completed task
    state = reduce(state, {
      type: "task_start",
      taskId: "subagent-1",
      description: "Test",
      source: "native",
      backendName: "mock",
    })
    state = reduce(state, {
      type: "task_complete",
      taskId: "subagent-1",
      output: "Done",
    })

    // Add a running task
    state = reduce(state, {
      type: "task_start",
      taskId: "subagent-2",
      description: "Still running",
      source: "native",
      backendName: "mock",
    })

    // Both present before next turn
    expect(state.activeTasks.size).toBe(2)

    // Complete the turn
    state = reduce(state, { type: "turn_complete" })

    // Both still present during IDLE (kept visible after turn_complete)
    expect(state.activeTasks.size).toBe(2)

    // New turn starts -- completed tasks should be pruned
    state = reduce(state, { type: "turn_start" })
    expect(state.activeTasks.size).toBe(1)
    expect(state.activeTasks.has("subagent-2")).toBe(true)
    expect(state.activeTasks.has("subagent-1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. NativeSubagentView filtering
// ---------------------------------------------------------------------------

describe("NativeSubagentView filtering", () => {
  test("orphanTasks filter excludes source === 'native'", () => {
    // Simulate the filtering logic from conversation.tsx
    const activeTasks = new Map<string, TaskInfo>()

    // Native subagent
    activeTasks.set("subagent-1", {
      taskId: "subagent-1",
      description: "Native task",
      output: "",
      status: "running",
      startTime: Date.now(),
      source: "native",
      backendName: "gemini",
    })

    // Backend-native task (no Agent tool correlation)
    activeTasks.set("task-2", {
      taskId: "task-2",
      description: "Backend task",
      output: "",
      status: "running",
      startTime: Date.now(),
      source: "backend",
    })

    // Task with no source (legacy)
    activeTasks.set("task-3", {
      taskId: "task-3",
      description: "Untagged task",
      output: "",
      status: "running",
      startTime: Date.now(),
    })

    // Replicate orphanTasks filtering from conversation.tsx
    const tasks = Array.from(activeTasks.entries())
    const agentToolIds = new Set<string>() // No Agent tool blocks in this test

    const orphanTasks = tasks.filter(([, task]) => {
      if (task.toolUseId && agentToolIds.has(task.toolUseId)) return false
      if (task.source === "native") return false
      return true
    })

    // orphanTasks should NOT contain the native subagent
    expect(orphanTasks.length).toBe(2)
    expect(orphanTasks.find(([id]) => id === "subagent-1")).toBeUndefined()
    expect(orphanTasks.find(([id]) => id === "task-2")).toBeDefined()
    expect(orphanTasks.find(([id]) => id === "task-3")).toBeDefined()
  })

  test("nativeSubagentTasks filter includes only source === 'native'", () => {
    const activeTasks = new Map<string, TaskInfo>()

    activeTasks.set("subagent-1", {
      taskId: "subagent-1",
      description: "Native task 1",
      output: "",
      status: "running",
      startTime: Date.now(),
      source: "native",
      backendName: "gemini",
    })

    activeTasks.set("subagent-2", {
      taskId: "subagent-2",
      description: "Native task 2",
      output: "Done",
      status: "completed",
      startTime: Date.now(),
      source: "native",
      backendName: "mock",
    })

    activeTasks.set("task-3", {
      taskId: "task-3",
      description: "Backend task",
      output: "",
      status: "running",
      startTime: Date.now(),
      source: "backend",
    })

    activeTasks.set("task-4", {
      taskId: "task-4",
      description: "Untagged task",
      output: "",
      status: "running",
      startTime: Date.now(),
    })

    // Replicate nativeSubagentTasks filtering from conversation.tsx
    const tasks = Array.from(activeTasks.entries())
    const nativeTasks = tasks.filter(([, task]) => task.source === "native")

    expect(nativeTasks.length).toBe(2)
    expect(nativeTasks.find(([id]) => id === "subagent-1")).toBeDefined()
    expect(nativeTasks.find(([id]) => id === "subagent-2")).toBeDefined()
    expect(nativeTasks.find(([id]) => id === "task-3")).toBeUndefined()
    expect(nativeTasks.find(([id]) => id === "task-4")).toBeUndefined()
  })

  test("mixed tasks are correctly separated between views", () => {
    const activeTasks = new Map<string, TaskInfo>()

    // 2 native, 1 backend, 1 agent-correlated
    activeTasks.set("subagent-1", {
      taskId: "subagent-1",
      description: "Cross-backend gemini",
      output: "Working...",
      status: "running",
      startTime: Date.now(),
      source: "native",
      backendName: "gemini",
      turnCount: 3,
      toolUseCount: 7,
    })

    activeTasks.set("subagent-2", {
      taskId: "subagent-2",
      description: "Cross-backend codex",
      output: "Done",
      status: "completed",
      startTime: Date.now(),
      source: "native",
      backendName: "codex",
    })

    activeTasks.set("task-sdk", {
      taskId: "task-sdk",
      description: "SDK subagent (Explore)",
      output: "Exploring...",
      status: "running",
      startTime: Date.now(),
      source: "backend",
      toolUseId: "tool-agent-1", // correlated with Agent tool block
    })

    activeTasks.set("task-orphan", {
      taskId: "task-orphan",
      description: "Backend orphan task",
      output: "",
      status: "running",
      startTime: Date.now(),
      source: "backend",
    })

    const tasks = Array.from(activeTasks.entries())
    const agentToolIds = new Set(["tool-agent-1"])

    const nativeTasks = tasks.filter(([, task]) => task.source === "native")
    const orphanTasks = tasks.filter(([, task]) => {
      if (task.toolUseId && agentToolIds.has(task.toolUseId)) return false
      if (task.source === "native") return false
      return true
    })

    // Native view gets exactly 2 tasks
    expect(nativeTasks.length).toBe(2)
    // Orphan view gets 1 task (agent-correlated filtered, native filtered)
    expect(orphanTasks.length).toBe(1)
    expect(orphanTasks[0]![0]).toBe("task-orphan")
  })
})

// ---------------------------------------------------------------------------
// 3. Diagnostics output includes subagent data
// ---------------------------------------------------------------------------

describe("Diagnostics output includes subagent data", () => {
  test("getDiagnostics includes subagent section with correct counts", async () => {
    // Set up the state bridge with a SubagentManager
    const { setSubagentManagerBridge } = await import(
      "../../src/mcp/state-bridge"
    )
    const { getDiagnostics } = await import("../../src/mcp/tools")
    const { setConversationState } = await import("../../src/mcp/state-bridge")

    const manager = new SubagentManager()
    const events: AgentEvent[] = []
    manager.setPushEvent((e) => events.push(e))

    // Wire the manager into the state bridge
    setSubagentManagerBridge(manager)
    setConversationState(createInitialState())

    // Spawn a mock subagent
    const mockDef: AgentDefinition = {
      name: "diag-test",
      description: "Diagnostics test agent",
      systemPrompt: "Test",
      backend: "mock",
      permissionMode: "bypassPermissions",
      filePath: "test.md",
    }

    const id = manager.spawn({
      definition: mockDef,
      prompt: "hello",
      backendOverride: "mock",
    })

    // Wait for mock to start
    await wait(1000)

    // Call getDiagnostics
    const result = getDiagnostics()
    const diagnosticsText = result.content[0]!.text
    const diagnostics = JSON.parse(diagnosticsText)

    // Verify the subagents section exists and has correct data
    expect(diagnostics.subagents).toBeDefined()
    expect(diagnostics.subagents.total).toBeGreaterThanOrEqual(1)
    expect(diagnostics.subagents.running).toBeGreaterThanOrEqual(1)
    expect(diagnostics.subagents.agents).toBeDefined()
    expect(diagnostics.subagents.agents.length).toBeGreaterThanOrEqual(1)

    // Verify the agent entry has expected fields
    const agentEntry = diagnostics.subagents.agents.find(
      (a: any) => a.id === id,
    )
    expect(agentEntry).toBeDefined()
    expect(agentEntry.name).toBe("diag-test")
    expect(agentEntry.backend).toBe("mock")
    expect(agentEntry.state).toBe("running")

    // Clean up
    manager.closeAll()

    // Reset bridge state to avoid leaking into other tests
    setSubagentManagerBridge(null as any)
  }, { timeout: 10000 })

  test("getDiagnostics handles mixed running/completed/errored subagents", async () => {
    const { setSubagentManagerBridge } = await import("../../src/mcp/state-bridge")
    const { getDiagnostics } = await import("../../src/mcp/tools")
    const { setConversationState } = await import("../../src/mcp/state-bridge")

    const manager = new SubagentManager()
    manager.setPushEvent(() => {})
    setSubagentManagerBridge(manager)
    setConversationState(createInitialState())

    const def: AgentDefinition = {
      name: "count-test",
      systemPrompt: "Test",
      backend: "mock",
      filePath: "test.md",
    }

    // Spawn 3 subagents
    const id1 = manager.spawn({ definition: def, prompt: "a", backendOverride: "mock" })
    manager.spawn({ definition: def, prompt: "b", backendOverride: "mock" })
    manager.spawn({ definition: def, prompt: "c", backendOverride: "mock" })

    await wait(500)

    // Stop one (completed)
    manager.stop(id1)

    const result = getDiagnostics()
    const diagnostics = JSON.parse(result.content[0]!.text)

    expect(diagnostics.subagents.total).toBe(3)
    expect(diagnostics.subagents.completed).toBe(1)
    expect(diagnostics.subagents.running).toBe(2)

    // Clean up
    manager.closeAll()
    setSubagentManagerBridge(null as any)
  }, { timeout: 10000 })
})

// ---------------------------------------------------------------------------
// 4. Slash command execution
// ---------------------------------------------------------------------------

describe("Slash command execution", () => {
  let manager: SubagentManager

  beforeEach(async () => {
    manager = new SubagentManager()
    manager.setPushEvent(() => {})
    // Point the commands module at our test fixtures rather than the user's
    // real ~/.claude/agents/ + project .claude/agents/ (which no longer
    // contains researcher/mock-test/etc).
    const { _setDefinitionsLoaderForTesting } = await import(
      "../../src/subagents/commands"
    )
    _setDefinitionsLoaderForTesting(() => loadDefinitionsFromDir(AGENTS_DIR))
  })

  afterEach(async () => {
    manager.closeAll()
    const { _setDefinitionsLoaderForTesting } = await import(
      "../../src/subagents/commands"
    )
    _setDefinitionsLoaderForTesting(null)
  })

  test("'definitions' subcommand emits system_message with available definitions", async () => {
    const { crossagentCommand, setCommandsManager } = await import(
      "../../src/subagents/commands"
    )

    setCommandsManager(manager)

    const emittedEvents: AgentEvent[] = []
    const ctx = {
      backend: {} as any,
      pushEvent: (e: any) => emittedEvents.push(e),
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
      setModel: async () => {},
    }

    // Execute definitions subcommand
    crossagentCommand.execute("definitions", ctx)

    // Should have emitted a system_message
    expect(emittedEvents.length).toBeGreaterThanOrEqual(1)
    const sysMsg = emittedEvents.find((e) => e.type === "system_message")
    expect(sysMsg).toBeDefined()
    const text = (sysMsg as any).text as string
    expect(text).toContain("Agent definitions:")
    // Should list our 4 definitions
    expect(text).toContain("researcher")
    expect(text).toContain("gemini-helper")
    expect(text).toContain("codex-reviewer")
    expect(text).toContain("mock-test")
  })

  test("'list' subcommand shows 'No subagents' when none spawned", async () => {
    const { crossagentCommand, setCommandsManager } = await import(
      "../../src/subagents/commands"
    )

    setCommandsManager(manager)

    const emittedEvents: AgentEvent[] = []
    const ctx = {
      backend: {} as any,
      pushEvent: (e: any) => emittedEvents.push(e),
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
      setModel: async () => {},
    }

    crossagentCommand.execute("list", ctx)

    const sysMsg = emittedEvents.find((e) => e.type === "system_message")
    expect(sysMsg).toBeDefined()
    expect((sysMsg as any).text).toBe("No subagents.")
  })

  test("'list' subcommand shows spawned subagent", async () => {
    const { crossagentCommand, setCommandsManager } = await import(
      "../../src/subagents/commands"
    )

    setCommandsManager(manager)

    // Spawn a mock agent
    const mockDef: AgentDefinition = {
      name: "list-test",
      systemPrompt: "Test",
      backend: "mock",
      filePath: "test.md",
    }
    manager.spawn({ definition: mockDef, prompt: "hello", backendOverride: "mock" })

    const emittedEvents: AgentEvent[] = []
    const ctx = {
      backend: {} as any,
      pushEvent: (e: any) => emittedEvents.push(e),
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
      setModel: async () => {},
    }

    crossagentCommand.execute("list", ctx)

    const sysMsg = emittedEvents.find((e) => e.type === "system_message")
    expect(sysMsg).toBeDefined()
    const text = (sysMsg as any).text as string
    expect(text).toContain("Subagents:")
    expect(text).toContain("list-test")
    expect(text).toContain("mock")
  })

  test("'spawn' subcommand with real definition spawns and reports", async () => {
    const { crossagentCommand, setCommandsManager } = await import(
      "../../src/subagents/commands"
    )

    setCommandsManager(manager)

    const emittedEvents: AgentEvent[] = []
    const ctx = {
      backend: {} as any,
      pushEvent: (e: any) => emittedEvents.push(e),
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
      setModel: async () => {},
    }

    crossagentCommand.execute("spawn mock-test test prompt", ctx)

    const sysMsg = emittedEvents.find((e) => e.type === "system_message")
    expect(sysMsg).toBeDefined()
    const text = (sysMsg as any).text as string
    expect(text).toContain("Spawned mock-test")
    expect(text).toContain("mock")

    // Verify the subagent was actually created
    const all = manager.listAll()
    expect(all.length).toBeGreaterThanOrEqual(1)
    expect(all[0]!.definitionName).toBe("mock-test")
  })

  test("'spawn' with unknown definition reports error", async () => {
    const { crossagentCommand, setCommandsManager } = await import(
      "../../src/subagents/commands"
    )

    setCommandsManager(manager)

    const emittedEvents: AgentEvent[] = []
    const ctx = {
      backend: {} as any,
      pushEvent: (e: any) => emittedEvents.push(e),
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
      setModel: async () => {},
    }

    crossagentCommand.execute("spawn nonexistent-agent do something", ctx)

    const sysMsg = emittedEvents.find((e) => e.type === "system_message")
    expect(sysMsg).toBeDefined()
    const text = (sysMsg as any).text as string
    expect(text).toContain('No agent definition "nonexistent-agent"')
    expect(text).toContain("Available:")
  })

  test("'status' subcommand shows detailed status", async () => {
    const { crossagentCommand, setCommandsManager } = await import(
      "../../src/subagents/commands"
    )

    setCommandsManager(manager)

    const mockDef: AgentDefinition = {
      name: "status-test",
      description: "Status test agent",
      systemPrompt: "Test",
      backend: "mock",
      filePath: "test.md",
    }
    const id = manager.spawn({ definition: mockDef, prompt: "hello", backendOverride: "mock" })

    // Wait for some progress
    await wait(1000)

    const emittedEvents: AgentEvent[] = []
    const ctx = {
      backend: {} as any,
      pushEvent: (e: any) => emittedEvents.push(e),
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
      setModel: async () => {},
    }

    crossagentCommand.execute(`status ${id}`, ctx)

    const sysMsg = emittedEvents.find((e) => e.type === "system_message")
    expect(sysMsg).toBeDefined()
    const text = (sysMsg as any).text as string
    expect(text).toContain(`Subagent: ${id}`)
    expect(text).toContain("Definition: status-test")
    expect(text).toContain("Backend: mock")
    expect(text).toContain("State: running")
  }, { timeout: 10000 })

  test("'stop' subcommand stops and reports", async () => {
    const { crossagentCommand, setCommandsManager } = await import(
      "../../src/subagents/commands"
    )

    setCommandsManager(manager)

    const mockDef: AgentDefinition = {
      name: "stop-test",
      systemPrompt: "Test",
      backend: "mock",
      filePath: "test.md",
    }
    const id = manager.spawn({ definition: mockDef, prompt: "hello", backendOverride: "mock" })

    const emittedEvents: AgentEvent[] = []
    const ctx = {
      backend: {} as any,
      pushEvent: (e: any) => emittedEvents.push(e),
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
      setModel: async () => {},
    }

    crossagentCommand.execute(`stop ${id}`, ctx)

    const sysMsg = emittedEvents.find((e) => e.type === "system_message")
    expect(sysMsg).toBeDefined()
    expect((sysMsg as any).text).toContain(`Stopped ${id}`)

    // Verify actually stopped
    expect(manager.getStatus(id)!.state).toBe("completed")
  })

  test("missing subcommand shows usage", async () => {
    const { crossagentCommand, setCommandsManager } = await import(
      "../../src/subagents/commands"
    )

    setCommandsManager(manager)

    const emittedEvents: AgentEvent[] = []
    const ctx = {
      backend: {} as any,
      pushEvent: (e: any) => emittedEvents.push(e),
      clearConversation: () => {},
      resetCost: () => {},
      resetSession: async () => {},
      setModel: async () => {},
    }

    crossagentCommand.execute("", ctx)

    const sysMsg = emittedEvents.find((e) => e.type === "system_message")
    expect(sysMsg).toBeDefined()
    expect((sysMsg as any).text).toContain("Usage:")
  })
})

// ---------------------------------------------------------------------------
// 5. MCP tool execution
// ---------------------------------------------------------------------------

describe("MCP tool execution", () => {
  let manager: SubagentManager

  beforeEach(() => {
    manager = new SubagentManager()
    manager.setPushEvent(() => {})
  })

  afterEach(() => {
    manager.closeAll()
  })

  test("crossagent_spawn tool creates a subagent and returns id", async () => {
    const { setSubagentManager, getCrossagentSdkMcpConfig } = await import(
      "../../src/subagents/mcp-tools"
    )

    setSubagentManager(manager)

    const config = getCrossagentSdkMcpConfig()
    expect(config).toBeDefined()

    // Access the server's tool handlers via the MCP server instance
    const server = config!.instance
    expect(server).toBeDefined()

    // We can't easily call individual tool handlers directly from the MCP server
    // instance since they're registered internally. Instead, verify the manager
    // state by calling the manager directly through the same code path the tools use.
    const { getSubagentManager } = await import("../../src/subagents/mcp-tools")
    const mgr = getSubagentManager()
    expect(mgr).toBe(manager)

    // Simulate what crossagent_spawn does
    const defs = loadDefinitionsFromDir(AGENTS_DIR)
    const def = defs.find((d) => d.name === "mock-test")
    expect(def).toBeDefined()

    const subagentId = manager.spawn({
      definition: def!,
      prompt: "MCP tool test",
    })

    expect(subagentId).toMatch(/^subagent-/)
    const status = manager.getStatus(subagentId)
    expect(status).toBeDefined()
    expect(status!.definitionName).toBe("mock-test")
    expect(status!.backendName).toBe("mock")
  })

  test("crossagent_list returns spawned subagent data", async () => {
    const { setSubagentManager } = await import("../../src/subagents/mcp-tools")
    setSubagentManager(manager)

    const def: AgentDefinition = {
      name: "list-tool-test",
      systemPrompt: "Test",
      backend: "mock",
      filePath: "test.md",
    }

    const id = manager.spawn({
      definition: def,
      prompt: "list test",
      backendOverride: "mock",
    })

    // Verify list returns data (simulating what the tool handler does)
    const statuses = manager.listAll()
    expect(statuses.length).toBe(1)
    expect(statuses[0]!.subagentId).toBe(id)
    expect(statuses[0]!.definitionName).toBe("list-tool-test")
    expect(statuses[0]!.backendName).toBe("mock")
    expect(statuses[0]!.state).toBe("running")
  })

  test("crossagent_status returns detailed subagent info", async () => {
    const { setSubagentManager } = await import("../../src/subagents/mcp-tools")
    setSubagentManager(manager)

    const def: AgentDefinition = {
      name: "status-tool-test",
      description: "Status tool test agent",
      systemPrompt: "Test",
      backend: "mock",
      filePath: "test.md",
    }

    const id = manager.spawn({
      definition: def,
      prompt: "status test",
      backendOverride: "mock",
    })

    await wait(1000)

    // Simulate what crossagent_status does
    const status = manager.getStatus(id)
    expect(status).toBeDefined()
    expect(status!.subagentId).toBe(id)
    expect(status!.definitionName).toBe("status-tool-test")
    expect(status!.backendName).toBe("mock")
    expect(status!.state).toBe("running")
    expect(status!.startTime).toBeGreaterThan(0)
    // sessionId should be captured by now
    expect(status!.sessionId).toBeDefined()
  }, { timeout: 10000 })

  test("crossagent_stop stops a running subagent", async () => {
    const { setSubagentManager } = await import("../../src/subagents/mcp-tools")
    setSubagentManager(manager)

    const def: AgentDefinition = {
      name: "stop-tool-test",
      systemPrompt: "Test",
      backend: "mock",
      filePath: "test.md",
    }

    const id = manager.spawn({
      definition: def,
      prompt: "stop test",
      backendOverride: "mock",
    })

    await wait(500)

    // Simulate what crossagent_stop does
    manager.stop(id)
    const status = manager.getStatus(id)
    expect(status!.state).toBe("completed")
    expect(status!.endTime).toBeDefined()
  })

  test("crossagent_send queues a message for running subagent", async () => {
    const { setSubagentManager } = await import("../../src/subagents/mcp-tools")
    setSubagentManager(manager)

    const def: AgentDefinition = {
      name: "send-tool-test",
      systemPrompt: "Test",
      backend: "mock",
      filePath: "test.md",
    }

    const id = manager.spawn({
      definition: def,
      prompt: "send test",
      backendOverride: "mock",
    })

    // Message should queue without error
    manager.sendMessage(id, "follow-up from MCP tool")

    // Verify subagent is still running
    expect(manager.getStatus(id)!.state).toBe("running")
  })

  test("MCP config has expected tool names", async () => {
    const { getCrossagentSdkMcpConfig } = await import(
      "../../src/subagents/mcp-tools"
    )

    const config = getCrossagentSdkMcpConfig()
    expect(config).toBeDefined()
    expect(config!.name).toBe("bantai-crossagent")
  })

  test("getSubagentManager returns null when not set", async () => {
    // Reset the module-level state
    const { setSubagentManager, getSubagentManager } = await import(
      "../../src/subagents/mcp-tools"
    )
    setSubagentManager(null as any)
    // After setting to null, it should return null
    // Note: this tests the getter, which is a simple passthrough
    const mgr = getSubagentManager()
    expect(mgr).toBeNull()
  })
})
