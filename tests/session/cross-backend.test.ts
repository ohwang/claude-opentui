import { describe, expect, it } from "bun:test"
import {
  formatHistoryAsContext,
} from "../../src/session/cross-backend"
import type { Block } from "../../src/protocol/types"

describe("cross-backend session resume", () => {
  // ---------------------------------------------------------------------------
  // formatHistoryAsContext
  // ---------------------------------------------------------------------------

  describe("formatHistoryAsContext", () => {
    it("formats user and assistant blocks", () => {
      const blocks: Block[] = [
        { type: "user", text: "Hello, how are you?" },
        { type: "assistant", text: "I'm doing well, thanks!" },
      ]

      const { contextText, toolCallCount, warningCount } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("User: Hello, how are you?")
      expect(contextText).toContain("Assistant: I'm doing well, thanks!")
      expect(toolCallCount).toBe(0)
      expect(warningCount).toBe(0)
    })

    it("formats tool blocks with input summary", () => {
      const blocks: Block[] = [
        {
          type: "tool",
          id: "t1",
          tool: "Read",
          input: { file_path: "/src/index.ts" },
          status: "done",
          output: "file contents here",
          startTime: Date.now(),
        },
      ]

      const { contextText, toolCallCount } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("[Tool: Read]")
      expect(contextText).toContain("Read /src/index.ts")
      expect(contextText).toContain("Output: file contents here")
      expect(toolCallCount).toBe(1)
    })

    it("formats Bash tool with command summary", () => {
      const blocks: Block[] = [
        {
          type: "tool",
          id: "t2",
          tool: "Bash",
          input: { command: "ls -la" },
          status: "done",
          output: "total 42\ndrwxr-xr-x  2 user user  4096 ...",
          startTime: Date.now(),
        },
      ]

      const { contextText, toolCallCount } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("[Tool: Bash]")
      expect(contextText).toContain("$ ls -la")
      expect(toolCallCount).toBe(1)
    })

    it("formats shell blocks", () => {
      const blocks: Block[] = [
        {
          type: "shell",
          id: "s1",
          command: "git status",
          output: "On branch main",
          status: "done",
          startTime: Date.now(),
        },
      ]

      const { contextText, toolCallCount } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("[Shell: git status]")
      expect(contextText).toContain("Output: On branch main")
      expect(toolCallCount).toBe(1)
    })

    it("formats thinking blocks with truncation", () => {
      const longThinking = "a".repeat(300)
      const blocks: Block[] = [
        { type: "thinking", text: longThinking },
      ]

      const { contextText } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("[Assistant thinking:")
      // Should be truncated to 200 chars + "..."
      expect(contextText.length).toBeLessThan(longThinking.length + 50)
      expect(contextText).toContain("...")
    })

    it("formats system blocks (non-ephemeral only)", () => {
      const blocks: Block[] = [
        { type: "system", text: "Important notice" },
        { type: "system", text: "Debug info", ephemeral: true },
      ]

      const { contextText } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("[System: Important notice]")
      expect(contextText).not.toContain("Debug info")
    })

    it("formats compact blocks", () => {
      const blocks: Block[] = [
        { type: "compact", summary: "Previous conversation was about TypeScript refactoring" },
      ]

      const { contextText } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("[Compacted context: Previous conversation was about TypeScript refactoring]")
    })

    it("formats error blocks and counts warnings", () => {
      const blocks: Block[] = [
        { type: "error", code: "api_error", message: "Rate limited" },
      ]

      const { contextText, warningCount } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("[Error: Rate limited]")
      expect(warningCount).toBe(1)
    })

    it("formats plan blocks", () => {
      const blocks: Block[] = [
        {
          type: "plan",
          entries: [
            { content: "Step 1: Read code", status: "completed" },
            { content: "Step 2: Write tests", status: "pending" },
          ],
        },
      ]

      const { contextText } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("[Plan:")
      expect(contextText).toContain("completed: Step 1: Read code")
      expect(contextText).toContain("pending: Step 2: Write tests")
    })

    it("handles empty block list", () => {
      const { contextText, toolCallCount, warningCount } = formatHistoryAsContext([])

      expect(contextText).toBe("")
      expect(toolCallCount).toBe(0)
      expect(warningCount).toBe(0)
    })

    it("formats a realistic multi-turn conversation", () => {
      const blocks: Block[] = [
        { type: "user", text: "Fix the bug in auth.ts" },
        { type: "assistant", text: "I'll look at the auth module." },
        {
          type: "tool",
          id: "t1",
          tool: "Read",
          input: { file_path: "/src/auth.ts" },
          status: "done",
          output: "export function login() { ... }",
          startTime: Date.now(),
        },
        { type: "assistant", text: "I found the issue. The token validation is missing." },
        {
          type: "tool",
          id: "t2",
          tool: "Edit",
          input: { file_path: "/src/auth.ts" },
          status: "done",
          output: "File edited successfully",
          startTime: Date.now(),
        },
        { type: "assistant", text: "Fixed! The token was not being validated before use." },
      ]

      const { contextText, toolCallCount } = formatHistoryAsContext(blocks)

      expect(toolCallCount).toBe(2)
      // Verify conversation order is preserved
      const userIdx = contextText.indexOf("User: Fix the bug")
      const assistantIdx = contextText.indexOf("Assistant: I'll look")
      const toolIdx = contextText.indexOf("[Tool: Read]")
      expect(userIdx).toBeLessThan(assistantIdx)
      expect(assistantIdx).toBeLessThan(toolIdx)
    })

    it("truncates long tool output", () => {
      const longOutput = "x".repeat(500)
      const blocks: Block[] = [
        {
          type: "tool",
          id: "t1",
          tool: "Bash",
          input: { command: "cat large-file.txt" },
          status: "done",
          output: longOutput,
          startTime: Date.now(),
        },
      ]

      const { contextText } = formatHistoryAsContext(blocks)

      // Output should be truncated to ~300 chars
      expect(contextText.length).toBeLessThan(longOutput.length)
      expect(contextText).toContain("...")
    })

    it("includes tool error info", () => {
      const blocks: Block[] = [
        {
          type: "tool",
          id: "t1",
          tool: "Bash",
          input: { command: "rm -rf /" },
          status: "error",
          output: "",
          error: "Permission denied",
          startTime: Date.now(),
        },
      ]

      const { contextText } = formatHistoryAsContext(blocks)

      expect(contextText).toContain("Error: Permission denied")
    })
  })
})
