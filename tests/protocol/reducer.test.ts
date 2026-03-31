import { describe, expect, it } from "bun:test"
import { reduce } from "../../src/protocol/reducer"
import {
  createInitialState,
  type AgentEvent,
  type ConversationState,
} from "../../src/protocol/types"

// Helper: apply a sequence of events to initial state
function applyEvents(events: AgentEvent[]): ConversationState {
  return events.reduce(
    (state, event) => reduce(state, event),
    createInitialState(),
  )
}

describe("ConversationState reducer", () => {
  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  describe("session_init", () => {
    it("transitions from INITIALIZING to IDLE", () => {
      const state = applyEvents([
        {
          type: "session_init",
          tools: [{ name: "Read" }, { name: "Write" }],
          models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
        },
      ])
      expect(state.sessionState).toBe("IDLE")
      expect(state.session).not.toBeNull()
      expect(state.session!.tools).toHaveLength(2)
      expect(state.session!.models).toHaveLength(1)
    })

    it("stores account info when provided", () => {
      const state = applyEvents([
        {
          type: "session_init",
          tools: [],
          models: [],
          account: { email: "test@example.com", plan: "pro" },
        },
      ])
      expect(state.session!.account?.email).toBe("test@example.com")
    })
  })

  // -----------------------------------------------------------------------
  // Turn lifecycle
  // -----------------------------------------------------------------------

  describe("turn_start", () => {
    it("transitions from IDLE to RUNNING", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
      ])
      expect(state.sessionState).toBe("RUNNING")
    })

    it("increments turn number", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
      ])
      expect(state.turnNumber).toBe(1)
    })

    it("is ignored during INTERRUPTING state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "working..." },
        { type: "interrupt" },
        { type: "turn_start" }, // should be ignored
      ])
      expect(state.sessionState).toBe("INTERRUPTING")
      expect(state.turnNumber).toBe(1) // not incremented
    })

    it("is ignored during ERROR state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "error", code: "fatal", message: "something broke", severity: "fatal" },
        { type: "turn_start" }, // should be ignored
      ])
      expect(state.sessionState).toBe("ERROR")
      expect(state.turnNumber).toBe(0)
    })

    it("is ignored during RUNNING state (duplicate turn_start)", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "hello" },
        { type: "turn_start" }, // duplicate, should be ignored
      ])
      expect(state.sessionState).toBe("RUNNING")
      expect(state.turnNumber).toBe(1) // not incremented again
      expect(state.streamingText).toBe("hello") // not cleared
    })
  })

  describe("turn_complete", () => {
    it("transitions from RUNNING to IDLE", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "turn_complete" },
      ])
      expect(state.sessionState).toBe("IDLE")
    })

    it("clears streaming text", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "hello" },
        { type: "turn_complete" },
      ])
      expect(state.streamingText).toBe("")
    })

    it("updates cost totals when usage provided", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "turn_complete",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            totalCostUsd: 0.005,
          },
        },
      ])
      expect(state.cost.inputTokens).toBe(100)
      expect(state.cost.outputTokens).toBe(50)
      expect(state.cost.cacheReadTokens).toBe(10)
      expect(state.cost.totalCostUsd).toBe(0.005)
    })

    it("turn_complete flushes streaming text as assistant block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "world" },
        { type: "turn_complete" },
      ])
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0].type).toBe("assistant")
      expect(state.blocks[0]).toMatchObject({ type: "assistant", text: "Hello world" })
    })

    it("produces chronological blocks: text then tool", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "Let me read that file." },
        { type: "text_complete", text: "Let me read that file." },
        {
          type: "tool_use_start",
          id: "t1",
          tool: "Read",
          input: { path: "/foo" },
        },
        { type: "tool_use_end", id: "t1", output: "file contents" },
        { type: "turn_complete" },
      ])
      // text_complete flushes text, tool_use_start flushes before appending tool
      expect(state.blocks).toHaveLength(2)
      expect(state.blocks[0]).toMatchObject({
        type: "assistant",
        text: "Let me read that file.",
      })
      expect(state.blocks[1].type).toBe("tool")
      if (state.blocks[1].type === "tool") {
        expect(state.blocks[1].status).toBe("done")
        expect(state.blocks[1].output).toBe("file contents")
      }
    })

    it("produces chronological blocks: thinking, text, tool", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "thinking_delta", text: "I should read the file." },
        { type: "text_delta", text: "Reading the file now." },
        { type: "text_complete", text: "Reading the file now." },
        {
          type: "tool_use_start",
          id: "t1",
          tool: "Read",
          input: { path: "/bar" },
        },
        { type: "tool_use_end", id: "t1", output: "bar contents" },
        { type: "turn_complete" },
      ])
      expect(state.blocks).toHaveLength(3)
      expect(state.blocks[0]).toMatchObject({
        type: "thinking",
        text: "I should read the file.",
      })
      expect(state.blocks[1]).toMatchObject({
        type: "assistant",
        text: "Reading the file now.",
      })
      expect(state.blocks[2].type).toBe("tool")
      if (state.blocks[2].type === "tool") {
        expect(state.blocks[2].id).toBe("t1")
      }
    })

    it("produces tool block for tools-only turn", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "t1",
          tool: "Bash",
          input: { command: "ls" },
        },
        { type: "tool_use_end", id: "t1", output: "file1\nfile2" },
        { type: "turn_complete" },
      ])
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0].type).toBe("tool")
      if (state.blocks[0].type === "tool") {
        expect(state.blocks[0].status).toBe("done")
        expect(state.blocks[0].output).toBe("file1\nfile2")
      }
    })

    it("ignores duplicate turn_complete", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "turn_complete" },
        { type: "turn_complete" }, // duplicate
      ])
      expect(state.sessionState).toBe("IDLE")
      expect(state.turnNumber).toBe(1) // not incremented by duplicate
    })
  })

  // -----------------------------------------------------------------------
  // User messages
  // -----------------------------------------------------------------------

  describe("user_message", () => {
    it("adds a user block to the blocks array", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "Hello, world!" },
      ])
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({
        type: "user",
        text: "Hello, world!",
      })
    })

    it("preserves existing blocks when adding user message", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "First" },
        { type: "turn_start" },
        { type: "text_complete", text: "Response" },
        { type: "turn_complete" },
        { type: "user_message", text: "Second" },
      ])
      expect(state.blocks).toHaveLength(3)
      expect(state.blocks[0]).toMatchObject({ type: "user", text: "First" })
      expect(state.blocks[1]).toMatchObject({ type: "assistant", text: "Response" })
      expect(state.blocks[2]).toMatchObject({ type: "user", text: "Second" })
    })
  })

  // -----------------------------------------------------------------------
  // Interrupt
  // -----------------------------------------------------------------------

  describe("interrupt", () => {
    it("transitions RUNNING to INTERRUPTING", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "interrupt" },
      ])
      expect(state.sessionState).toBe("INTERRUPTING")
    })

    it("does not change state when IDLE", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "interrupt" },
      ])
      expect(state.sessionState).toBe("IDLE")
    })
  })

  // -----------------------------------------------------------------------
  // System messages
  // -----------------------------------------------------------------------

  describe("system_message", () => {
    it("adds system block to blocks array", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "system_message", text: "Command output here" },
      ])
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({
        type: "system",
        text: "Command output here",
      })
    })
  })

  // -----------------------------------------------------------------------
  // Text streaming
  // -----------------------------------------------------------------------

  describe("text_delta", () => {
    it("accumulates streaming text", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "world" },
      ])
      expect(state.streamingText).toBe("Hello world")
    })
  })

  describe("thinking_delta", () => {
    it("accumulates streaming thinking", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "thinking_delta", text: "Let me " },
        { type: "thinking_delta", text: "think..." },
      ])
      expect(state.streamingThinking).toBe("Let me think...")
    })

    it("flushed thinking block always has a string text property", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "thinking_delta", text: "reasoning" },
        { type: "text_delta", text: "response" },
        { type: "turn_complete" },
      ])
      const thinkingBlocks = state.blocks.filter((b) => b.type === "thinking")
      expect(thinkingBlocks.length).toBeGreaterThan(0)
      for (const block of thinkingBlocks) {
        expect(typeof block.text).toBe("string")
        expect(block.text.length).toBeGreaterThan(0)
      }
    })
  })

  describe("text_complete", () => {
    it("commits text as assistant block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_complete", text: "Hello world" },
      ])
      // text_complete flushes the finalized text as a block
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({ type: "assistant", text: "Hello world" })
      expect(state.streamingText).toBe("")
    })

    it("overwrites streaming text with finalized text and flushes", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "partial" },
        { type: "text_complete", text: "full text" },
      ])
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({ type: "assistant", text: "full text" })
      expect(state.streamingText).toBe("")
    })
  })

  // -----------------------------------------------------------------------
  // Tool lifecycle
  // -----------------------------------------------------------------------

  describe("tool_use_start", () => {
    it("tool_use_start appends running tool block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool1",
          tool: "Read",
          input: { path: "/foo" },
        },
      ])
      const toolBlock = state.blocks.find(
        b => b.type === "tool" && b.id === "tool1"
      )
      expect(toolBlock).toBeDefined()
      if (toolBlock && toolBlock.type === "tool") {
        expect(toolBlock.tool).toBe("Read")
        expect(toolBlock.status).toBe("running")
      }
    })
  })

  describe("tool_use_progress", () => {
    it("tool_use_progress updates tool block output", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool1",
          tool: "Read",
          input: { path: "/foo" },
        },
        { type: "tool_use_progress", id: "tool1", output: "line 1\n" },
        { type: "tool_use_progress", id: "tool1", output: "line 2\n" },
      ])
      const toolBlock = state.blocks.find(
        b => b.type === "tool" && b.id === "tool1"
      )
      expect(toolBlock).toBeDefined()
      if (toolBlock && toolBlock.type === "tool") {
        expect(toolBlock.output).toBe("line 1\nline 2\n")
      }
    })
  })

  describe("tool_use_end", () => {
    it("tool_use_end sets tool block to done", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool1",
          tool: "Read",
          input: { path: "/foo" },
        },
        { type: "tool_use_end", id: "tool1", output: "file contents" },
      ])
      const toolBlock = state.blocks.find(
        b => b.type === "tool" && b.id === "tool1"
      )
      expect(toolBlock).toBeDefined()
      if (toolBlock && toolBlock.type === "tool") {
        expect(toolBlock.status).toBe("done")
        expect(toolBlock.output).toBe("file contents")
      }
    })

    it("preserves error on tool failure", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool1",
          tool: "Read",
          input: { path: "/nonexistent" },
        },
        {
          type: "tool_use_end",
          id: "tool1",
          output: "",
          error: "File not found",
        },
      ])
      const toolBlock = state.blocks.find(
        b => b.type === "tool" && b.id === "tool1"
      )
      expect(toolBlock).toBeDefined()
      if (toolBlock && toolBlock.type === "tool") {
        expect(toolBlock.status).toBe("error")
        expect(toolBlock.error).toBe("File not found")
      }
    })

    it("__last_running__ sentinel closes the most recent running tool", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool_a",
          tool: "Read",
          input: { path: "/a" },
        },
        {
          type: "tool_use_end",
          id: "tool_a",
          output: "done",
        },
        {
          type: "tool_use_start",
          id: "tool_b",
          tool: "Bash",
          input: { command: "ls" },
        },
        {
          type: "tool_use_end",
          id: "__last_running__",
          output: "",
          error: "Command failed",
        },
      ])
      const toolA = state.blocks.find(
        b => b.type === "tool" && b.id === "tool_a"
      )
      const toolB = state.blocks.find(
        b => b.type === "tool" && b.id === "tool_b"
      )
      expect(toolA).toBeDefined()
      expect(toolB).toBeDefined()
      if (toolA && toolA.type === "tool") {
        expect(toolA.status).toBe("done") // already completed, should not change
      }
      if (toolB && toolB.type === "tool") {
        expect(toolB.status).toBe("error") // sentinel should match this one
        expect(toolB.error).toBe("Command failed")
      }
    })

    it("__last_running__ sentinel is a no-op when no running tools exist", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "tool_c",
          tool: "Read",
          input: { path: "/c" },
        },
        {
          type: "tool_use_end",
          id: "tool_c",
          output: "file contents",
        },
        {
          type: "tool_use_end",
          id: "__last_running__",
          output: "",
          error: "Orphan error",
        },
      ])
      // tool_c should remain "done", not be overwritten
      const toolC = state.blocks.find(
        b => b.type === "tool" && b.id === "tool_c"
      )
      expect(toolC).toBeDefined()
      if (toolC && toolC.type === "tool") {
        expect(toolC.status).toBe("done")
        expect(toolC.error).toBeUndefined()
      }
    })
  })

  // -----------------------------------------------------------------------
  // Permission flow
  // -----------------------------------------------------------------------

  describe("permission_request", () => {
    it("transitions to WAITING_FOR_PERM", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "permission_request",
          id: "perm1",
          tool: "Bash",
          input: { command: "rm -rf /" },
        },
      ])
      expect(state.sessionState).toBe("WAITING_FOR_PERM")
      expect(state.pendingPermission).not.toBeNull()
      expect(state.pendingPermission!.id).toBe("perm1")
    })
  })

  // -----------------------------------------------------------------------
  // Elicitation flow
  // -----------------------------------------------------------------------

  describe("elicitation_request", () => {
    it("transitions to WAITING_FOR_ELIC", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "elicitation_request",
          id: "elic1",
          questions: [
            {
              question: "Which option?",
              options: [
                { label: "A", value: "a" },
                { label: "B", value: "b" },
              ],
            },
          ],
        },
      ])
      expect(state.sessionState).toBe("WAITING_FOR_ELIC")
      expect(state.pendingElicitation).not.toBeNull()
    })
  })

  describe("elicitation_response", () => {
    it("clears pending elicitation and returns to RUNNING", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "elicitation_request",
          id: "elic1",
          questions: [
            {
              question: "Which?",
              options: [{ label: "A", value: "a" }],
            },
          ],
        },
        {
          type: "elicitation_response",
          id: "elic1",
          answers: { "0": "a" },
        },
      ])
      expect(state.sessionState).toBe("RUNNING")
      expect(state.pendingElicitation).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Response state guards (interrupt vs response race)
  // -----------------------------------------------------------------------

  describe("permission_response state guard", () => {
    it("is ignored during INTERRUPTING state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "permission_request",
          id: "perm1",
          tool: "Bash",
          input: { command: "rm -rf /" },
        },
        { type: "interrupt" }, // Ctrl+C while waiting for permission
        {
          type: "permission_response",
          id: "perm1",
          approved: true,
        },
      ])
      // Interrupt should NOT be overridden by the late permission_response
      expect(state.sessionState).toBe("INTERRUPTING")
    })
  })

  describe("elicitation_response state guard", () => {
    it("is ignored during INTERRUPTING state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "elicitation_request",
          id: "elic1",
          questions: [
            {
              question: "Which?",
              options: [{ label: "A", value: "a" }],
            },
          ],
        },
        { type: "interrupt" }, // Ctrl+C while waiting for elicitation
        {
          type: "elicitation_response",
          id: "elic1",
          answers: { "0": "a" },
        },
      ])
      // Interrupt should NOT be overridden by the late elicitation_response
      expect(state.sessionState).toBe("INTERRUPTING")
    })
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("error", () => {
    it("fatal error transitions to ERROR state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "error",
          code: "error_max_turns",
          message: "Too many turns",
          severity: "fatal",
        },
      ])
      expect(state.sessionState).toBe("ERROR")
      expect(state.lastError).not.toBeNull()
      expect(state.lastError!.code).toBe("error_max_turns")
    })

    it("fatal error appends error block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "error",
          code: "error_max_turns",
          message: "Too many turns",
          severity: "fatal",
        },
      ])
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({
        type: "error",
        code: "error_max_turns",
        message: "Too many turns",
      })
    })

    it("recoverable error stays in current state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "error",
          code: "rate_limit",
          message: "Rate limited",
          severity: "recoverable",
        },
      ])
      expect(state.sessionState).toBe("RUNNING")
    })

    it("error without severity defaults to fatal", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "error",
          code: "unknown",
          message: "Something broke",
        },
      ])
      expect(state.sessionState).toBe("ERROR")
    })
  })

  // -----------------------------------------------------------------------
  // Cost tracking
  // -----------------------------------------------------------------------

  describe("cost_update", () => {
    it("is ignored to prevent double-counting with turn_complete", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "cost_update",
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.005,
        },
        {
          type: "cost_update",
          inputTokens: 200,
          outputTokens: 75,
          cost: 0.01,
        },
      ])
      // cost_update events are no-ops; turn_complete is the authoritative source
      expect(state.cost.inputTokens).toBe(0)
      expect(state.cost.outputTokens).toBe(0)
      expect(state.cost.totalCostUsd).toBe(0)
    })

    it("turn_complete is the sole source of cost accumulation", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        // Turn 1: streaming cost_update + turn_complete with usage
        { type: "turn_start" },
        { type: "cost_update", inputTokens: 50, outputTokens: 25, cost: 0.003 },
        {
          type: "turn_complete",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            totalCostUsd: 0.005,
          },
        },
        // Turn 2: another turn_complete with usage
        { type: "turn_start" },
        {
          type: "turn_complete",
          usage: {
            inputTokens: 200,
            outputTokens: 75,
            totalCostUsd: 0.01,
          },
        },
      ])
      // Only turn_complete usage is counted, cost_update is ignored
      expect(state.cost.inputTokens).toBe(300)
      expect(state.cost.outputTokens).toBe(125)
      expect(state.cost.cacheReadTokens).toBe(10)
      expect(state.cost.totalCostUsd).toBeCloseTo(0.015)
    })
  })

  // -----------------------------------------------------------------------
  // Task / subagent events
  // -----------------------------------------------------------------------

  describe("task_start", () => {
    it("adds to active tasks", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "task_start", taskId: "t1", description: "Searching files" },
      ])
      expect(state.activeTasks.has("t1")).toBe(true)
      expect(state.activeTasks.get("t1")!.description).toBe("Searching files")
    })
  })

  describe("task_progress", () => {
    it("updates task output", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "task_start", taskId: "t1", description: "Searching" },
        { type: "task_progress", taskId: "t1", output: "Found 3 matches" },
      ])
      expect(state.activeTasks.get("t1")!.output).toBe("Found 3 matches")
    })
  })

  describe("task_complete", () => {
    it("marks task as completed", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "task_start", taskId: "t1", description: "Searching" },
        { type: "task_complete", taskId: "t1", output: "Done" },
      ])
      expect(state.activeTasks.get("t1")!.status).toBe("completed")
    })
  })

  // -----------------------------------------------------------------------
  // Compact
  // -----------------------------------------------------------------------

  describe("compact", () => {
    it("adds compact block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "compact", summary: "Conversation was compacted" },
      ])
      const compactBlock = state.blocks.find(b => b.type === "compact")
      expect(compactBlock).toBeDefined()
      if (compactBlock && compactBlock.type === "compact") {
        expect(compactBlock.summary).toBe("Conversation was compacted")
      }
    })
  })

  // -----------------------------------------------------------------------
  // Backend-specific events
  // -----------------------------------------------------------------------

  describe("backend_specific", () => {
    it("does not change state", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        {
          type: "backend_specific",
          backend: "claude",
          data: { hook: "PreToolUse" },
        },
      ])
      expect(state.sessionState).toBe("IDLE")
    })
  })

  // -----------------------------------------------------------------------
  // Event log invariant
  // -----------------------------------------------------------------------

  describe("event log invariant", () => {
    it("eventLog is not grown by the reducer (caller-managed)", () => {
      const events: AgentEvent[] = [
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "hi" },
        { type: "text_complete", text: "hi" },
        { type: "turn_complete" },
      ]
      const state = applyEvents(events)
      // Reducer no longer copies events into eventLog (O(n²) fix)
      expect(state.eventLog).toHaveLength(0)
    })

    it("state is reconstructable from replaying events", () => {
      const events: AgentEvent[] = [
        { type: "session_init", tools: [{ name: "Read" }], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "world" },
        {
          type: "tool_use_start",
          id: "t1",
          tool: "Read",
          input: { path: "/x" },
        },
        { type: "tool_use_end", id: "t1", output: "contents" },
        { type: "text_complete", text: "Hello world" },
        {
          type: "turn_complete",
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      ]

      // Apply all at once
      const state1 = applyEvents(events)

      // Replay from the same event array
      const state2 = events.reduce(
        (s, e) => reduce(s, e),
        createInitialState(),
      )

      // States should match
      expect(state2.sessionState).toBe(state1.sessionState)
      expect(state2.blocks).toEqual(state1.blocks)
      expect(state2.cost).toEqual(state1.cost)
      expect(state2.turnNumber).toBe(state1.turnNumber)
    })
  })

  // -----------------------------------------------------------------------
  // Message ordering during streaming
  // -----------------------------------------------------------------------

  describe("message ordering during streaming", () => {
    it("user_message during RUNNING shows as queued block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "hello" },
        { type: "user_message", text: "msg2" },
      ])
      const userBlock = state.blocks.find(
        b => b.type === "user" && b.text === "msg2"
      )
      expect(userBlock).toBeDefined()
      expect(userBlock!.queued).toBe(true)
    })

    it("turn_complete unqueues user blocks and preserves order", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "msg1" },
        { type: "turn_start" },
        { type: "text_delta", text: "response" },
        { type: "user_message", text: "msg2" },
        { type: "turn_complete" },
      ])
      expect(state.blocks).toHaveLength(3)
      expect(state.blocks[0]).toMatchObject({ type: "user", text: "msg1" })
      expect(state.blocks[1]).toMatchObject({ type: "assistant", text: "response" })
      expect(state.blocks[2]).toMatchObject({ type: "user", text: "msg2" })
      // msg2 should be unqueued after turn_complete
      expect(state.blocks[2].queued).toBeUndefined()
    })

    it("multiple queued messages maintain order", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "msg1" },
        { type: "turn_start" },
        { type: "text_delta", text: "resp" },
        { type: "user_message", text: "msg2" },
        { type: "user_message", text: "msg3" },
        { type: "turn_complete" },
      ])
      expect(state.blocks).toHaveLength(4)
      expect(state.blocks[0]).toMatchObject({ type: "user", text: "msg1" })
      expect(state.blocks[1]).toMatchObject({ type: "assistant", text: "resp" })
      expect(state.blocks[2]).toMatchObject({ type: "user", text: "msg2" })
      expect(state.blocks[3]).toMatchObject({ type: "user", text: "msg3" })
      // Both should be unqueued
      expect(state.blocks[2].queued).toBeUndefined()
      expect(state.blocks[3].queued).toBeUndefined()
    })

    it("user_message in IDLE still adds immediately", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "msg1" },
      ])
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({ type: "user", text: "msg1" })
      expect(state.blocks[0].queued).toBeUndefined()
    })

    it("user_message during WAITING_FOR_PERM queues", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "permission_request",
          id: "perm1",
          tool: "Bash",
          input: { command: "ls" },
        },
        { type: "user_message", text: "queued" },
      ])
      const userBlock = state.blocks.find(
        b => b.type === "user" && b.text === "queued"
      )
      expect(userBlock).toBeDefined()
      expect(userBlock!.queued).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // flushBuffers ordering
  // -----------------------------------------------------------------------

  describe("flushBuffers ordering", () => {
    it("tool_use_start flushes buffers before appending tool block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "thinking_delta", text: "Let me think" },
        { type: "text_delta", text: "I'll read the file" },
        { type: "tool_use_start", id: "t1", tool: "Read", input: {} },
      ])
      // Thinking and text should be committed BEFORE the tool
      expect(state.blocks).toHaveLength(3)
      expect(state.blocks[0].type).toBe("thinking")
      expect(state.blocks[1].type).toBe("assistant")
      expect(state.blocks[2].type).toBe("tool")
    })

    it("multi-turn tool loop produces continuous block sequence", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "Fix the bug" },
        // Turn 1: text + tool
        { type: "turn_start" },
        { type: "text_delta", text: "I'll read first" },
        { type: "tool_use_start", id: "t1", tool: "Read", input: {} },
        { type: "tool_use_end", id: "t1", output: "contents" },
        { type: "turn_complete" },
        // Turn 2: text + tool
        { type: "turn_start" },
        { type: "text_delta", text: "Now I'll edit" },
        { type: "tool_use_start", id: "t2", tool: "Edit", input: {} },
        { type: "tool_use_end", id: "t2", output: "edited" },
        { type: "turn_complete" },
        // Turn 3: final text
        { type: "turn_start" },
        { type: "text_delta", text: "Done!" },
        { type: "turn_complete" },
      ])
      // Should be: user, text, tool, text, tool, text -- continuous, no gaps
      expect(state.blocks).toHaveLength(6)
      expect(state.blocks[0]).toMatchObject({ type: "user", text: "Fix the bug" })
      expect(state.blocks[1]).toMatchObject({ type: "assistant", text: "I'll read first" })
      expect(state.blocks[2]).toMatchObject({ type: "tool", tool: "Read", status: "done" })
      expect(state.blocks[3]).toMatchObject({ type: "assistant", text: "Now I'll edit" })
      expect(state.blocks[4]).toMatchObject({ type: "tool", tool: "Edit", status: "done" })
      expect(state.blocks[5]).toMatchObject({ type: "assistant", text: "Done!" })
    })

    it("text_complete commits text as assistant block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "partial" },
        { type: "text_complete", text: "full text" },
      ])
      // text_complete should flush the finalized text as a block
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({ type: "assistant", text: "full text" })
      expect(state.streamingText).toBe("")
    })

    it("interrupt flushes buffers before transitioning", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "partial response" },
        { type: "interrupt" },
      ])
      expect(state.sessionState).toBe("INTERRUPTING")
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({ type: "assistant", text: "partial response" })
      expect(state.streamingText).toBe("")
    })

    it("queued user blocks get unqueued on turn_complete", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "response" },
        { type: "user_message", text: "queued msg" },
        { type: "turn_complete" },
      ])
      const userBlock = state.blocks.find(b => b.type === "user" && b.text === "queued msg")
      expect(userBlock).toBeDefined()
      expect(userBlock!.queued).toBeUndefined() // unqueued after turn_complete
    })
  })

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  describe("shutdown", () => {
    it("transitions to SHUTTING_DOWN from RUNNING", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "shutdown" },
      ])
      expect(state.sessionState).toBe("SHUTTING_DOWN")
    })

    it("transitions to SHUTTING_DOWN from IDLE", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "shutdown" },
      ])
      expect(state.sessionState).toBe("SHUTTING_DOWN")
    })

    it("transitions to SHUTTING_DOWN from WAITING_FOR_PERM", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "permission_request",
          id: "perm1",
          tool: "Bash",
          input: { command: "rm -rf /" },
        },
        { type: "shutdown" },
      ])
      expect(state.sessionState).toBe("SHUTTING_DOWN")
    })

    it("flushes streaming text buffer as assistant block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "text_delta", text: "partial " },
        { type: "text_delta", text: "response" },
        { type: "shutdown" },
      ])
      expect(state.streamingText).toBe("")
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({ type: "assistant", text: "partial response" })
    })

    it("flushes streaming thinking buffer as thinking block", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "thinking_delta", text: "deep " },
        { type: "thinking_delta", text: "thought" },
        { type: "shutdown" },
      ])
      expect(state.streamingThinking).toBe("")
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({ type: "thinking", text: "deep thought" })
    })

    it("cancels running tool blocks with status and duration", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "t1",
          tool: "Bash",
          input: { command: "sleep 100" },
        },
        { type: "shutdown" },
      ])
      const toolBlock = state.blocks.find(b => b.type === "tool" && b.id === "t1")
      expect(toolBlock).toBeDefined()
      if (toolBlock && toolBlock.type === "tool") {
        expect(toolBlock.status).toBe("canceled")
        expect(toolBlock.duration).toBeDefined()
        expect(typeof toolBlock.duration).toBe("number")
      }
    })

    it("clears pendingPermission and pendingElicitation", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "permission_request",
          id: "perm1",
          tool: "Bash",
          input: { command: "rm -rf /" },
        },
        { type: "shutdown" },
      ])
      expect(state.pendingPermission).toBeNull()
      expect(state.pendingElicitation).toBeNull()
    })

    it("cancels multiple running tool blocks", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "t1",
          tool: "Read",
          input: { path: "/a" },
        },
        {
          type: "tool_use_start",
          id: "t2",
          tool: "Bash",
          input: { command: "ls" },
        },
        {
          type: "tool_use_start",
          id: "t3",
          tool: "Write",
          input: { path: "/b", content: "x" },
        },
        { type: "shutdown" },
      ])
      const toolBlocks = state.blocks.filter(b => b.type === "tool")
      expect(toolBlocks).toHaveLength(3)
      for (const block of toolBlocks) {
        if (block.type === "tool") {
          expect(block.status).toBe("canceled")
          expect(block.duration).toBeDefined()
        }
      }
    })

    it("does not cancel already-completed tool blocks", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        {
          type: "tool_use_start",
          id: "t1",
          tool: "Read",
          input: { path: "/a" },
        },
        { type: "tool_use_end", id: "t1", output: "contents" },
        {
          type: "tool_use_start",
          id: "t2",
          tool: "Bash",
          input: { command: "ls" },
        },
        { type: "shutdown" },
      ])
      const t1 = state.blocks.find(b => b.type === "tool" && b.id === "t1")
      const t2 = state.blocks.find(b => b.type === "tool" && b.id === "t2")
      expect(t1).toBeDefined()
      expect(t2).toBeDefined()
      if (t1 && t1.type === "tool") {
        expect(t1.status).toBe("done") // already completed, not canceled
      }
      if (t2 && t2.type === "tool") {
        expect(t2.status).toBe("canceled") // was running, gets canceled
      }
    })
  })

  // -----------------------------------------------------------------------
  // Model changed
  // -----------------------------------------------------------------------

  describe("model_changed", () => {
    it("updates currentModel", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "model_changed", model: "Claude Opus 4.6" },
      ])
      expect(state.currentModel).toBe("Claude Opus 4.6")
    })

    it("does not change sessionState", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "model_changed", model: "Claude Sonnet 4.6" },
      ])
      expect(state.sessionState).toBe("RUNNING")
    })

    it("overwrites previous model", () => {
      const state = applyEvents([
        {
          type: "session_init",
          tools: [],
          models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
        },
        { type: "model_changed", model: "Claude Opus 4.6" },
        { type: "model_changed", model: "Claude Haiku 3.5" },
      ])
      expect(state.currentModel).toBe("Claude Haiku 3.5")
    })
  })

  // -----------------------------------------------------------------------
  // Compact (additional coverage)
  // -----------------------------------------------------------------------

  describe("compact (extended)", () => {
    it("adds compact block with summary text", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "compact", summary: "Previous discussion about file handling" },
      ])
      expect(state.blocks).toHaveLength(1)
      expect(state.blocks[0]).toMatchObject({
        type: "compact",
        summary: "Previous discussion about file handling",
      })
    })

    it("preserves existing blocks", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "user_message", text: "Hello" },
        { type: "turn_start" },
        { type: "text_complete", text: "Hi there" },
        { type: "turn_complete" },
        { type: "compact", summary: "User greeted assistant" },
      ])
      expect(state.blocks).toHaveLength(3)
      expect(state.blocks[0]).toMatchObject({ type: "user", text: "Hello" })
      expect(state.blocks[1]).toMatchObject({ type: "assistant", text: "Hi there" })
      expect(state.blocks[2]).toMatchObject({
        type: "compact",
        summary: "User greeted assistant",
      })
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("error recovery", () => {
    it("user_message in ERROR state auto-recovers to IDLE", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "error", code: "stream_error", message: "Stream died", severity: "fatal" },
        { type: "user_message", text: "Try again" },
      ])
      expect(state.sessionState).toBe("IDLE")
      expect(state.lastError).toBeNull()
      expect(state.blocks.some(b => b.type === "user" && b.text === "Try again")).toBe(true)
    })

    it("turn_complete with zero usage preserves last known token count", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "turn_complete", usage: { inputTokens: 5000, outputTokens: 1000 } },
        { type: "turn_start" },
        { type: "turn_complete", usage: { inputTokens: 0, outputTokens: 0 } },
      ])
      // Should preserve the 5000 from first turn, not reset to 0
      expect(state.lastTurnInputTokens).toBe(5000)
    })

    it("turn_complete in ERROR state recovers to IDLE", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "turn_start" },
        { type: "error", code: "test", message: "err", severity: "fatal" },
        { type: "turn_complete", usage: { inputTokens: 100, outputTokens: 50 } },
      ])
      expect(state.sessionState).toBe("IDLE")
    })
  })

  describe("edge cases", () => {
    it("events before session_init stay in INITIALIZING", () => {
      const state = applyEvents([{ type: "text_delta", text: "premature" }])
      expect(state.sessionState).toBe("INITIALIZING")
    })

    it("unknown event type does not crash", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "unknown_event" } as any,
      ])
      expect(state.sessionState).toBe("IDLE")
    })

    it("session_state event does not override state machine", () => {
      const state = applyEvents([
        { type: "session_init", tools: [], models: [] },
        { type: "session_state", state: "running" },
      ])
      // session_state is informational, doesn't override our state machine
      expect(state.sessionState).toBe("IDLE")
    })
  })
})
