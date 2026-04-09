import { describe, expect, it } from "bun:test"
import { mapAcpUpdate } from "../../../src/backends/acp/event-mapper"
import type { AcpSessionUpdateParams } from "../../../src/backends/acp/types"
// AgentEvent type used for documentation — assertions use `as any` casts

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeParams(update: any): AcpSessionUpdateParams {
  return { sessionId: "test-session", update }
}

// ---------------------------------------------------------------------------
// agent_message_chunk → text_delta
// ---------------------------------------------------------------------------

describe("ACP Event Mapper", () => {
  describe("agent_message_chunk → text_delta", () => {
    it("maps text content to text_delta", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello, world!" },
        }),
      )

      expect(events).toHaveLength(1)
      expect(events[0]!).toEqual({ type: "text_delta", text: "Hello, world!" })
    })

    it("returns empty array for missing content", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "agent_message_chunk",
          content: undefined,
        }),
      )

      expect(events).toHaveLength(0)
    })

    it("maps text content with empty string to backend_specific (falsy text falls through)", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "" },
        }),
      )

      // Empty string is falsy → falls through to non-text content branch
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("backend_specific")
    })

    it("maps image content to backend_specific", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "image",
            mimeType: "image/png",
            data: "iVBORw0KGgo=",
          },
        }),
      )

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("backend_specific")
      const bs = events[0]! as any
      expect(bs.backend).toBe("acp")
      expect(bs.data.update.content.type).toBe("image")
    })

    it("maps resource_link content to backend_specific", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "resource_link",
            uri: "file:///project/src/foo.ts",
            name: "foo.ts",
          },
        }),
      )

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("backend_specific")
      const bs = events[0]! as any
      expect(bs.backend).toBe("acp")
      expect(bs.data.method).toBe("session/update")
    })
  })

  // ---------------------------------------------------------------------------
  // tool_call → tool_use_start
  // ---------------------------------------------------------------------------

  describe("tool_call → tool_use_start", () => {
    it("maps toolCallId to id", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-42",
          kind: "read",
          title: "Read file",
          status: "in_progress",
          content: [],
        }),
      )

      expect(events).toHaveLength(1)
      const start = events[0]! as any
      expect(start.type).toBe("tool_use_start")
      expect(start.id).toBe("tc-42")
    })

    it("maps kind 'read' to tool name 'Read'", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-1",
          kind: "read",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("Read")
    })

    it("maps kind 'edit' to tool name 'Edit'", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-2",
          kind: "edit",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("Edit")
    })

    it("maps kind 'execute' to tool name 'Bash'", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-3",
          kind: "execute",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("Bash")
    })

    it("maps kind 'search' to tool name 'Search'", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-4",
          kind: "search",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("Search")
    })

    it("maps kind 'fetch' to tool name 'WebFetch'", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-5",
          kind: "fetch",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("WebFetch")
    })

    it("maps kind 'think' to tool name 'Think'", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-6",
          kind: "think",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("Think")
    })

    it("maps kind 'delete' to tool name 'Delete'", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-7",
          kind: "delete",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("Delete")
    })

    it("maps kind 'move' to tool name 'Move'", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-8",
          kind: "move",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("Move")
    })

    it("falls back to title for unknown kind", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-9",
          kind: "custom_tool",
          title: "My Custom Tool",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("My Custom Tool")
    })

    it("falls back to kind when title is absent for unknown kind", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-10",
          kind: "custom_tool",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("custom_tool")
    })

    it("falls back to 'Tool' when both kind and title are absent", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-11",
          status: "in_progress",
          content: [],
        }),
      )

      expect((events[0]! as any).tool).toBe("Tool")
    })

    it("includes title, kind, locations, and rawInput in input", () => {
      const locations = [{ path: "/project/src/foo.ts", line: 42 }]
      const rawInput = { file_path: "/project/src/foo.ts" }

      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call",
          toolCallId: "tc-12",
          kind: "read",
          title: "Read foo.ts",
          status: "in_progress",
          content: [],
          locations,
          rawInput,
        }),
      )

      expect(events).toHaveLength(1)
      const start = events[0]! as any
      expect(start.input.title).toBe("Read foo.ts")
      expect(start.input.kind).toBe("read")
      expect(start.input.locations).toEqual(locations)
      expect(start.input.rawInput).toEqual(rawInput)
    })
  })

  // ---------------------------------------------------------------------------
  // tool_call_update — status variations
  // ---------------------------------------------------------------------------

  describe("tool_call_update — status variations", () => {
    it("maps completed status to tool_use_end with output text", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-20",
          status: "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "File contents here" },
            },
          ],
        }),
      )

      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.type).toBe("tool_use_end")
      expect(end.id).toBe("tc-20")
      expect(end.output).toBe("File contents here")
      expect(end.error).toBeUndefined()
    })

    it("maps failed status to tool_use_end with error field", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-21",
          status: "failed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Permission denied" },
            },
          ],
        }),
      )

      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.type).toBe("tool_use_end")
      expect(end.id).toBe("tc-21")
      expect(end.output).toBe("Permission denied")
      expect(end.error).toBe("Permission denied")
    })

    it("maps in_progress with text content to tool_use_progress", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-22",
          status: "in_progress",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Processing line 42..." },
            },
          ],
        }),
      )

      expect(events).toHaveLength(1)
      const progress = events[0]! as any
      expect(progress.type).toBe("tool_use_progress")
      expect(progress.id).toBe("tc-22")
      expect(progress.output).toBe("Processing line 42...")
    })

    it("returns empty array for in_progress with no content", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-23",
          status: "in_progress",
        }),
      )

      expect(events).toHaveLength(0)
    })

    it("returns empty array for in_progress with empty content array", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-24",
          status: "in_progress",
          content: [],
        }),
      )

      expect(events).toHaveLength(0)
    })

    it("produces additional backend_specific for diff content", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-25",
          status: "in_progress",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Editing file..." },
            },
            {
              type: "diff",
              path: "/project/src/foo.ts",
              oldText: "const x = 1",
              newText: "const x = 2",
            },
          ],
        }),
      )

      expect(events).toHaveLength(2)

      const progress = events[0]! as any
      expect(progress.type).toBe("tool_use_progress")
      expect(progress.output).toBe("Editing file...")

      const bs = events[1]! as any
      expect(bs.type).toBe("backend_specific")
      expect(bs.backend).toBe("acp")
      expect(bs.data.type).toBe("tool_call_rich_content")
      expect(bs.data.toolCallId).toBe("tc-25")
      expect(bs.data.content).toHaveLength(2)
    })

    it("produces additional backend_specific for terminal content", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-26",
          status: "in_progress",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Running command..." },
            },
            { type: "terminal", terminalId: "term-1" },
          ],
        }),
      )

      expect(events).toHaveLength(2)
      expect(events[0]!.type).toBe("tool_use_progress")
      expect(events[1]!.type).toBe("backend_specific")
      const bs = events[1]! as any
      expect(bs.data.type).toBe("tool_call_rich_content")
    })

    it("uses 'Tool completed' fallback when completed with empty content", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-27",
          status: "completed",
          content: [],
        }),
      )

      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.type).toBe("tool_use_end")
      expect(end.output).toBe("Tool completed")
      expect(end.error).toBeUndefined()
    })

    it("uses 'Tool failed' fallback when failed with empty content", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-28",
          status: "failed",
          content: [],
        }),
      )

      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.type).toBe("tool_use_end")
      expect(end.output).toBe("Tool failed")
      expect(end.error).toBe("Tool call failed")
    })

    it("uses 'Tool completed' fallback when completed with no content", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-29",
          status: "completed",
        }),
      )

      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.output).toBe("Tool completed")
    })

    it("joins multiple text content items with newline", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-30",
          status: "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Line 1" },
            },
            {
              type: "content",
              content: { type: "text", text: "Line 2" },
            },
          ],
        }),
      )

      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.output).toBe("Line 1\nLine 2")
    })

    it("skips non-text content items when extracting output text", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-31",
          status: "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Useful output" },
            },
            {
              type: "diff",
              path: "/project/src/bar.ts",
              oldText: "a",
              newText: "b",
            },
          ],
        }),
      )

      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.output).toBe("Useful output")
    })
  })

  // ---------------------------------------------------------------------------
  // plan → thinking_delta
  // ---------------------------------------------------------------------------

  describe("plan → thinking_delta", () => {
    it("maps plan entries with text to thinking_delta with joined text", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "plan",
          entries: [
            { text: "Step 1: Read the file" },
            { text: "Step 2: Edit the function" },
          ],
        }),
      )

      expect(events).toHaveLength(1)
      expect(events[0]!).toEqual({
        type: "thinking_delta",
        text: "Step 1: Read the file\nStep 2: Edit the function",
      })
    })

    it("maps plan entries with title to thinking_delta using title", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "plan",
          entries: [{ title: "Investigate the bug" }],
        }),
      )

      expect(events).toHaveLength(1)
      expect(events[0]!).toEqual({
        type: "thinking_delta",
        text: "Investigate the bug",
      })
    })

    it("prefers text over title when both are present", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "plan",
          entries: [{ text: "Detailed step", title: "Summary" }],
        }),
      )

      expect(events).toHaveLength(1)
      expect((events[0]! as any).text).toBe("Detailed step")
    })

    it("JSON-stringifies entries without text or title", () => {
      const entry = { status: "pending", priority: 1 }
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "plan",
          entries: [entry],
        }),
      )

      expect(events).toHaveLength(1)
      expect((events[0]! as any).text).toBe(JSON.stringify(entry))
    })

    it("returns empty array for empty entries", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "plan",
          entries: [],
        }),
      )

      expect(events).toHaveLength(0)
    })

    it("returns empty array for missing entries", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "plan",
        }),
      )

      expect(events).toHaveLength(0)
    })

    it("mixes text, title, and object entries", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "plan",
          entries: [
            { text: "First" },
            { title: "Second" },
            { status: "done" },
          ],
        }),
      )

      expect(events).toHaveLength(1)
      expect((events[0]! as any).text).toBe(
        'First\nSecond\n{"status":"done"}',
      )
    })
  })

  // ---------------------------------------------------------------------------
  // available_commands_update → backend_specific
  // ---------------------------------------------------------------------------

  describe("available_commands_update → backend_specific", () => {
    it("maps commands array to backend_specific with type 'available_commands'", () => {
      const commands = [
        { name: "/help", description: "Show help" },
        { name: "/clear", description: "Clear conversation" },
        { name: "/compact" },
      ]

      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "available_commands_update",
          availableCommands: commands,
        }),
      )

      expect(events).toHaveLength(1)
      const bs = events[0]! as any
      expect(bs.type).toBe("backend_specific")
      expect(bs.backend).toBe("acp")
      expect(bs.data.type).toBe("available_commands")
      expect(bs.data.commands).toEqual(commands)
    })

    it("handles empty commands array", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "available_commands_update",
          availableCommands: [],
        }),
      )

      expect(events).toHaveLength(1)
      const bs = events[0]! as any
      expect(bs.data.commands).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Unknown update type → backend_specific
  // ---------------------------------------------------------------------------

  describe("unknown update type → backend_specific", () => {
    it("returns backend_specific with backend 'acp'", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "some_future_update",
          payload: { data: 123 },
        }),
      )

      expect(events).toHaveLength(1)
      const bs = events[0]! as any
      expect(bs.type).toBe("backend_specific")
      expect(bs.backend).toBe("acp")
    })

    it("contains the original update in data", () => {
      const update = {
        sessionUpdate: "new_protocol_feature",
        extra: "value",
      }

      const events = mapAcpUpdate(makeParams(update))

      expect(events).toHaveLength(1)
      const bs = events[0]! as any
      expect(bs.data.method).toBe("session/update")
      expect(bs.data.update).toEqual(update)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("returns empty array when update is undefined", () => {
      const events = mapAcpUpdate({ sessionId: "test-session", update: undefined as any })
      expect(events).toHaveLength(0)
    })

    it("returns empty array when update is null", () => {
      const events = mapAcpUpdate({ sessionId: "test-session", update: null as any })
      expect(events).toHaveLength(0)
    })

    it("returns empty array when sessionUpdate field is missing", () => {
      const events = mapAcpUpdate(makeParams({}))
      expect(events).toHaveLength(0)
    })

    it("returns empty array when sessionUpdate is empty string", () => {
      const events = mapAcpUpdate(makeParams({ sessionUpdate: "" }))
      expect(events).toHaveLength(0)
    })

    it("handles tool_call_update with completed status and non-text content only", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-40",
          status: "completed",
          content: [
            {
              type: "diff",
              path: "/project/src/a.ts",
              oldText: "old",
              newText: "new",
            },
          ],
        }),
      )

      // extractToolContentText returns "" for diff-only content → fallback to "Tool completed"
      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.type).toBe("tool_use_end")
      expect(end.output).toBe("Tool completed")
    })

    it("handles tool_call_update with failed status and non-text content only", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-41",
          status: "failed",
          content: [
            { type: "terminal", terminalId: "term-2" },
          ],
        }),
      )

      expect(events).toHaveLength(1)
      const end = events[0]! as any
      expect(end.type).toBe("tool_use_end")
      expect(end.output).toBe("Tool failed")
      expect(end.error).toBe("Tool call failed")
    })

    it("in_progress with only diff content produces backend_specific but no progress", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-42",
          status: "in_progress",
          content: [
            {
              type: "diff",
              path: "/project/src/b.ts",
              oldText: "x",
              newText: "y",
            },
          ],
        }),
      )

      // No text → no tool_use_progress, but diff → backend_specific
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("backend_specific")
      const bs = events[0]! as any
      expect(bs.data.type).toBe("tool_call_rich_content")
    })

    it("in_progress with text + diff produces both progress and backend_specific", () => {
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-43",
          status: "in_progress",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Applying edit" },
            },
            {
              type: "diff",
              path: "/project/src/c.ts",
              oldText: "a",
              newText: "b",
            },
          ],
        }),
      )

      expect(events).toHaveLength(2)
      expect(events[0]!.type).toBe("tool_use_progress")
      expect(events[1]!.type).toBe("backend_specific")
    })

    it("in_progress with content that has non-text inner type returns no progress", () => {
      // content.type === "content" but inner content is image, not text
      const events = mapAcpUpdate(
        makeParams({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-44",
          status: "in_progress",
          content: [
            {
              type: "content",
              content: {
                type: "image",
                mimeType: "image/png",
                data: "abc=",
              },
            },
          ],
        }),
      )

      // extractToolContentText returns "" for image content → no progress event
      // No diff/terminal → no backend_specific
      expect(events).toHaveLength(0)
    })

    it("preserves sessionId through params but does not appear in events", () => {
      const events = mapAcpUpdate({
        sessionId: "specific-session-123",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hi" },
        } as any,
      })

      expect(events).toHaveLength(1)
      // AgentEvent does not carry sessionId
      expect((events[0]! as any).sessionId).toBeUndefined()
    })
  })
})
