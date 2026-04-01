import { describe, expect, it, beforeEach } from "bun:test"
import { CodexSdkEventMapper } from "../../src/backends/codex-sdk/event-mapper"
import type { ThreadEvent } from "../../src/backends/codex-sdk/types"

describe("Codex SDK Event Mapper", () => {
  let mapper: CodexSdkEventMapper

  beforeEach(() => {
    mapper = new CodexSdkEventMapper()
  })

  describe("thread lifecycle", () => {
    it("maps thread.started to session_init", () => {
      const events = mapper.map({
        type: "thread.started",
        thread_id: "thread-123",
      })
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("session_init")
    })

    it("suppresses turn.started (adapter emits synthetic)", () => {
      const events = mapper.map({ type: "turn.started" })
      expect(events).toHaveLength(0)
    })

    it("maps turn.completed to cost_update + turn_complete with usage", () => {
      const events = mapper.map({
        type: "turn.completed",
        usage: {
          input_tokens: 100,
          cached_input_tokens: 20,
          output_tokens: 50,
        },
      })
      expect(events).toHaveLength(2)
      // First event: cost_update for running token totals
      const costUpdate = events[0] as any
      expect(costUpdate.type).toBe("cost_update")
      expect(costUpdate.inputTokens).toBe(100)
      expect(costUpdate.outputTokens).toBe(50)
      expect(costUpdate.cacheReadTokens).toBe(20)
      // Second event: turn_complete with authoritative usage
      const complete = events[1] as any
      expect(complete.type).toBe("turn_complete")
      expect(complete.usage.inputTokens).toBe(100)
      expect(complete.usage.outputTokens).toBe(50)
      expect(complete.usage.cacheReadTokens).toBe(20)
    })

    it("maps turn.failed to error + turn_complete", () => {
      const events = mapper.map({
        type: "turn.failed",
        error: { message: "API error" },
      })
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe("error")
      expect((events[0] as any).message).toBe("API error")
      expect((events[0] as any).severity).toBe("recoverable")
      expect(events[1].type).toBe("turn_complete")
    })

    it("maps stream error to fatal error", () => {
      const events = mapper.map({
        type: "error",
        message: "Connection lost",
      })
      expect(events).toHaveLength(1)
      const err = events[0] as any
      expect(err.type).toBe("error")
      expect(err.severity).toBe("fatal")
      expect(err.message).toBe("Connection lost")
    })
  })

  describe("agent message streaming", () => {
    it("emits text_delta from item.updated with incremental text", () => {
      // First update
      let events = mapper.map({
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello " },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: "text_delta", text: "Hello " })

      // Second update — only the new text
      events = mapper.map({
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello world" },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: "text_delta", text: "world" })
    })

    it("skips empty delta when text unchanged", () => {
      mapper.map({
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello" },
      })
      const events = mapper.map({
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello" },
      })
      expect(events).toHaveLength(0)
    })

    it("no event for item.started agent_message", () => {
      const events = mapper.map({
        type: "item.started",
        item: { id: "msg-1", type: "agent_message", text: "" },
      })
      expect(events).toHaveLength(0)
    })

    it("maps item.completed agent_message to text_complete", () => {
      const events = mapper.map({
        type: "item.completed",
        item: { id: "msg-1", type: "agent_message", text: "Final answer" },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: "text_complete", text: "Final answer" })
    })
  })

  describe("reasoning streaming", () => {
    it("emits thinking_delta from reasoning item.updated", () => {
      let events = mapper.map({
        type: "item.updated",
        item: { id: "r-1", type: "reasoning", text: "Let me " },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: "thinking_delta", text: "Let me " })

      events = mapper.map({
        type: "item.updated",
        item: { id: "r-1", type: "reasoning", text: "Let me think..." },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: "thinking_delta", text: "think..." })
    })

    it("no event for item.completed reasoning", () => {
      const events = mapper.map({
        type: "item.completed",
        item: { id: "r-1", type: "reasoning", text: "Done thinking" },
      })
      expect(events).toHaveLength(0)
    })
  })

  describe("command execution", () => {
    it("maps item.started command_execution to tool_use_start", () => {
      const events = mapper.map({
        type: "item.started",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "ls -la",
          aggregated_output: "",
          status: "in_progress",
        },
      })
      expect(events).toHaveLength(1)
      const start = events[0] as any
      expect(start.type).toBe("tool_use_start")
      expect(start.id).toBe("cmd-1")
      expect(start.tool).toBe("Bash")
      expect(start.input).toEqual({ command: "ls -la" })
    })

    it("maps item.updated command_execution to tool_use_progress", () => {
      const events = mapper.map({
        type: "item.updated",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "ls -la",
          aggregated_output: "file1.ts\nfile2.ts\n",
          status: "in_progress",
        },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "tool_use_progress",
        id: "cmd-1",
        output: "file1.ts\nfile2.ts\n",
      })
    })

    it("maps item.completed command_execution success to tool_use_end", () => {
      const events = mapper.map({
        type: "item.completed",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "ls -la",
          aggregated_output: "file1.ts\n",
          exit_code: 0,
          status: "completed",
        },
      })
      expect(events).toHaveLength(1)
      const end = events[0] as any
      expect(end.type).toBe("tool_use_end")
      expect(end.id).toBe("cmd-1")
      expect(end.output).toBe("file1.ts\n")
      expect(end.error).toBeUndefined()
    })

    it("maps item.completed command_execution failure to tool_use_end with error", () => {
      const events = mapper.map({
        type: "item.completed",
        item: {
          id: "cmd-2",
          type: "command_execution",
          command: "bad-cmd",
          aggregated_output: "command not found",
          exit_code: 127,
          status: "failed",
        },
      })
      expect(events).toHaveLength(1)
      const end = events[0] as any
      expect(end.type).toBe("tool_use_end")
      expect(end.error).toBe("command not found")
    })
  })

  describe("file changes", () => {
    it("maps item.started file_change to tool_use_start", () => {
      const events = mapper.map({
        type: "item.started",
        item: {
          id: "fc-1",
          type: "file_change",
          changes: [{ path: "src/index.ts", kind: "update" as const }],
          status: "completed" as const,
        },
      })
      expect(events).toHaveLength(1)
      const start = events[0] as any
      expect(start.type).toBe("tool_use_start")
      expect(start.tool).toBe("Edit")
      expect(start.input.changes).toHaveLength(1)
    })

    it("maps item.completed file_change to tool_use_end with summary", () => {
      const events = mapper.map({
        type: "item.completed",
        item: {
          id: "fc-1",
          type: "file_change",
          changes: [
            { path: "src/a.ts", kind: "update" as const },
            { path: "src/b.ts", kind: "add" as const },
          ],
          status: "completed" as const,
        },
      })
      expect(events).toHaveLength(1)
      const end = events[0] as any
      expect(end.type).toBe("tool_use_end")
      expect(end.output).toContain("update: src/a.ts")
      expect(end.output).toContain("add: src/b.ts")
      expect(end.error).toBeUndefined()
    })

    it("maps failed file_change to tool_use_end with error", () => {
      const events = mapper.map({
        type: "item.completed",
        item: {
          id: "fc-2",
          type: "file_change",
          changes: [{ path: "src/x.ts", kind: "update" as const }],
          status: "failed" as const,
        },
      })
      expect(events).toHaveLength(1)
      expect((events[0] as any).error).toBe("File change failed")
    })
  })

  describe("MCP tool calls", () => {
    it("maps item.started mcp_tool_call to tool_use_start", () => {
      const events = mapper.map({
        type: "item.started",
        item: {
          id: "mcp-1",
          type: "mcp_tool_call",
          server: "my-server",
          tool: "search",
          arguments: { query: "test" },
          status: "in_progress" as const,
        },
      })
      expect(events).toHaveLength(1)
      const start = events[0] as any
      expect(start.type).toBe("tool_use_start")
      expect(start.tool).toBe("mcp:my-server/search")
      expect(start.input).toEqual({ query: "test" })
    })

    it("maps item.completed mcp_tool_call success to tool_use_end", () => {
      const events = mapper.map({
        type: "item.completed",
        item: {
          id: "mcp-1",
          type: "mcp_tool_call",
          server: "my-server",
          tool: "search",
          arguments: {},
          result: {
            content: [{ type: "text", text: "search results" }],
            structured_content: null,
          },
          status: "completed" as const,
        },
      })
      expect(events).toHaveLength(1)
      const end = events[0] as any
      expect(end.type).toBe("tool_use_end")
      expect(end.output).toBe("search results")
      expect(end.error).toBeUndefined()
    })

    it("maps item.completed mcp_tool_call failure to tool_use_end with error", () => {
      const events = mapper.map({
        type: "item.completed",
        item: {
          id: "mcp-2",
          type: "mcp_tool_call",
          server: "srv",
          tool: "broken",
          arguments: {},
          error: { message: "Connection refused" },
          status: "failed" as const,
        },
      })
      expect(events).toHaveLength(1)
      expect((events[0] as any).error).toBe("Connection refused")
    })
  })

  describe("web search", () => {
    it("maps item.started web_search to tool_use_start", () => {
      const events = mapper.map({
        type: "item.started",
        item: { id: "ws-1", type: "web_search", query: "TypeScript generics" },
      })
      expect(events).toHaveLength(1)
      const start = events[0] as any
      expect(start.type).toBe("tool_use_start")
      expect(start.tool).toBe("WebSearch")
      expect(start.input).toEqual({ query: "TypeScript generics" })
    })

    it("maps item.completed web_search to tool_use_end", () => {
      const events = mapper.map({
        type: "item.completed",
        item: { id: "ws-1", type: "web_search", query: "TypeScript generics" },
      })
      expect(events).toHaveLength(1)
      expect((events[0] as any).output).toBe("Web search completed")
    })
  })

  describe("todo list", () => {
    it("maps item.started todo_list as backend_specific", () => {
      const events = mapper.map({
        type: "item.started",
        item: {
          id: "todo-1",
          type: "todo_list",
          items: [{ text: "Step 1", completed: false }],
        },
      })
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("backend_specific")
      expect((events[0] as any).backend).toBe("codex-sdk")
    })
  })

  describe("error items", () => {
    it("maps item.started error to recoverable error", () => {
      const events = mapper.map({
        type: "item.started",
        item: { id: "err-1", type: "error", message: "Rate limited" },
      })
      expect(events).toHaveLength(1)
      const err = events[0] as any
      expect(err.type).toBe("error")
      expect(err.code).toBe("codex_item_error")
      expect(err.message).toBe("Rate limited")
      expect(err.severity).toBe("recoverable")
    })
  })

  describe("delta extraction across multiple items", () => {
    it("tracks deltas independently per item ID", () => {
      // Two concurrent items streaming
      let events = mapper.map({
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello" },
      })
      expect(events[0]).toEqual({ type: "text_delta", text: "Hello" })

      events = mapper.map({
        type: "item.updated",
        item: { id: "r-1", type: "reasoning", text: "Think" },
      })
      expect(events[0]).toEqual({ type: "thinking_delta", text: "Think" })

      // Continue msg-1 — offset tracked independently
      events = mapper.map({
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello world" },
      })
      expect(events[0]).toEqual({ type: "text_delta", text: " world" })
    })

    it("reset() clears all tracking state", () => {
      mapper.map({
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello" },
      })

      mapper.reset()

      // After reset, same text re-emits as a full delta
      const events = mapper.map({
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello" },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: "text_delta", text: "Hello" })
    })
  })
})
