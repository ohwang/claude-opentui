import { describe, expect, it } from "bun:test"
import {
  formatHistoryAsContext,
  formatFullHistory,
  parseCodexSession,
  parseGeminiSession,
} from "../../src/session/cross-backend"
import type { Block } from "../../src/protocol/types"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

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

  // ---------------------------------------------------------------------------
  // formatFullHistory
  // ---------------------------------------------------------------------------

  describe("formatFullHistory", () => {
    it("preserves full text without truncation", () => {
      const longText = "x".repeat(1000)
      const blocks: Block[] = [
        { type: "user", text: longText },
        { type: "assistant", text: longText },
      ]

      const { contextText, turnCount } = formatFullHistory(blocks, "claude")

      // Full text must be preserved — no truncation
      expect(contextText).toContain(longText)
      expect(turnCount).toBe(1)
    })

    it("includes full tool call input and output", () => {
      const longOutput = "y".repeat(500)
      const blocks: Block[] = [
        { type: "user", text: "Fix the bug" },
        {
          type: "tool",
          id: "t1",
          tool: "Bash",
          input: { command: "cat very-long-file.txt" },
          status: "done",
          output: longOutput,
          startTime: Date.now(),
        },
      ]

      const { contextText, toolCallCount } = formatFullHistory(blocks, "codex")

      expect(contextText).toContain(longOutput)
      expect(contextText).toContain("cat very-long-file.txt")
      expect(toolCallCount).toBe(1)
    })

    it("includes thinking blocks in full", () => {
      const longThinking = "reasoning ".repeat(100)
      const blocks: Block[] = [
        { type: "user", text: "Explain this" },
        { type: "thinking", text: longThinking },
        { type: "assistant", text: "Here's my explanation." },
      ]

      const { contextText } = formatFullHistory(blocks, "claude")

      expect(contextText).toContain(longThinking)
      expect(contextText).toContain("[Thinking:")
    })

    it("groups blocks into numbered turns", () => {
      const blocks: Block[] = [
        { type: "user", text: "First question" },
        { type: "assistant", text: "First answer" },
        { type: "user", text: "Second question" },
        { type: "assistant", text: "Second answer" },
      ]

      const { contextText, turnCount } = formatFullHistory(blocks, "claude")

      expect(turnCount).toBe(2)
      expect(contextText).toContain("=== Turn 1 ===")
      expect(contextText).toContain("=== Turn 2 ===")
    })

    it("includes header with origin and footer with resume instruction", () => {
      const blocks: Block[] = [
        { type: "user", text: "Hello" },
        { type: "assistant", text: "Hi" },
      ]

      const { contextText } = formatFullHistory(blocks, "codex")

      expect(contextText).toContain("[Previous conversation history from codex session")
      expect(contextText).toContain("[Resuming session now.")
    })

    it("skips system, error, and plan blocks", () => {
      const blocks: Block[] = [
        { type: "user", text: "Hello" },
        { type: "system", text: "System notice" },
        { type: "error", code: "err", message: "Something failed" },
        { type: "plan", entries: [{ content: "Step 1" }] },
        { type: "assistant", text: "Hi" },
      ]

      const { contextText } = formatFullHistory(blocks, "claude")

      expect(contextText).not.toContain("System notice")
      expect(contextText).not.toContain("Something failed")
      expect(contextText).not.toContain("Step 1")
    })

    it("handles empty block list", () => {
      const { contextText, toolCallCount, turnCount } = formatFullHistory([], "claude")

      expect(contextText).toBe("")
      expect(toolCallCount).toBe(0)
      expect(turnCount).toBe(0)
    })

    it("includes shell blocks with full output", () => {
      const blocks: Block[] = [
        { type: "user", text: "Run git status" },
        {
          type: "shell",
          id: "s1",
          command: "git status",
          output: "On branch main\nnothing to commit",
          status: "done",
          startTime: Date.now(),
        },
      ]

      const { contextText, toolCallCount } = formatFullHistory(blocks, "claude")

      expect(contextText).toContain("[Shell: git status]")
      expect(contextText).toContain("On branch main\nnothing to commit")
      expect(toolCallCount).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // parseCodexSession
  // ---------------------------------------------------------------------------

  describe("parseCodexSession", () => {
    it("parses user and assistant messages from JSONL", () => {
      const dir = mkdtempSync(join(tmpdir(), "codex-test-"))
      const file = join(dir, "test.jsonl")
      const lines = [
        JSON.stringify({ type: "session_meta", payload: { id: "test-id", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" } }),
        JSON.stringify({ type: "response_item", payload: { role: "user", content: [{ type: "input_text", text: "Hello from Codex" }] } }),
        JSON.stringify({ type: "response_item", payload: { role: "assistant", content: [{ type: "output_text", text: "Hello! How can I help?" }] } }),
      ]
      writeFileSync(file, lines.join("\n"))

      const blocks = parseCodexSession(file)

      expect(blocks.length).toBe(2)
      expect(blocks[0]!.type).toBe("user")
      expect((blocks[0] as any).text).toBe("Hello from Codex")
      expect(blocks[1]!.type).toBe("assistant")
      expect((blocks[1] as any).text).toBe("Hello! How can I help?")

      rmSync(dir, { recursive: true })
    })

    it("parses event_msg user messages", () => {
      const dir = mkdtempSync(join(tmpdir(), "codex-test-"))
      const file = join(dir, "test.jsonl")
      const lines = [
        JSON.stringify({ type: "session_meta", payload: { id: "test-id" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Fix the bug" } }),
      ]
      writeFileSync(file, lines.join("\n"))

      const blocks = parseCodexSession(file)

      expect(blocks.length).toBe(1)
      expect(blocks[0]!.type).toBe("user")
      expect((blocks[0] as any).text).toBe("Fix the bug")

      rmSync(dir, { recursive: true })
    })

    it("parses function calls and attaches output", () => {
      const dir = mkdtempSync(join(tmpdir(), "codex-test-"))
      const file = join(dir, "test.jsonl")
      const lines = [
        JSON.stringify({ type: "session_meta", payload: { id: "test-id" } }),
        JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "shell", arguments: '{"cmd":"ls"}', id: "fc1" } }),
        JSON.stringify({ type: "response_item", payload: { type: "function_call_output", output: "file1.ts\nfile2.ts" } }),
      ]
      writeFileSync(file, lines.join("\n"))

      const blocks = parseCodexSession(file)

      expect(blocks.length).toBe(1)
      expect(blocks[0]!.type).toBe("tool")
      expect((blocks[0] as any).tool).toBe("shell")
      expect((blocks[0] as any).output).toBe("file1.ts\nfile2.ts")

      rmSync(dir, { recursive: true })
    })

    it("returns empty array for non-existent file", () => {
      const blocks = parseCodexSession("/nonexistent/path/test.jsonl")
      expect(blocks).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // parseGeminiSession
  // ---------------------------------------------------------------------------

  describe("parseGeminiSession", () => {
    it("parses user and gemini messages from JSON", () => {
      const dir = mkdtempSync(join(tmpdir(), "gemini-test-"))
      const file = join(dir, "session.json")
      const session = {
        sessionId: "test-session",
        startTime: "2025-01-01T00:00:00Z",
        lastUpdated: "2025-01-01T00:01:00Z",
        messages: [
          { type: "user", content: [{ text: "Hello from Gemini" }] },
          { type: "gemini", content: "Hello! I'm Gemini." },
        ],
      }
      writeFileSync(file, JSON.stringify(session))

      const blocks = parseGeminiSession(file)

      expect(blocks.length).toBe(2)
      expect(blocks[0]!.type).toBe("user")
      expect((blocks[0] as any).text).toBe("Hello from Gemini")
      expect(blocks[1]!.type).toBe("assistant")
      expect((blocks[1] as any).text).toBe("Hello! I'm Gemini.")

      rmSync(dir, { recursive: true })
    })

    it("extracts thinking blocks from thoughts array", () => {
      const dir = mkdtempSync(join(tmpdir(), "gemini-test-"))
      const file = join(dir, "session.json")
      const session = {
        sessionId: "test-session",
        messages: [
          { type: "user", content: "What is 2+2?" },
          {
            type: "gemini",
            content: "The answer is 4.",
            thoughts: ["Let me calculate 2+2", "That equals 4"],
          },
        ],
      }
      writeFileSync(file, JSON.stringify(session))

      const blocks = parseGeminiSession(file)

      expect(blocks.length).toBe(4) // 1 user + 2 thinking + 1 assistant
      expect(blocks[0]!.type).toBe("user")
      expect(blocks[1]!.type).toBe("thinking")
      expect((blocks[1] as any).text).toBe("Let me calculate 2+2")
      expect(blocks[2]!.type).toBe("thinking")
      expect((blocks[2] as any).text).toBe("That equals 4")
      expect(blocks[3]!.type).toBe("assistant")

      rmSync(dir, { recursive: true })
    })

    it("handles string content for user messages", () => {
      const dir = mkdtempSync(join(tmpdir(), "gemini-test-"))
      const file = join(dir, "session.json")
      const session = {
        sessionId: "test-session",
        messages: [
          { type: "user", content: "Direct string content" },
        ],
      }
      writeFileSync(file, JSON.stringify(session))

      const blocks = parseGeminiSession(file)

      expect(blocks.length).toBe(1)
      expect((blocks[0] as any).text).toBe("Direct string content")

      rmSync(dir, { recursive: true })
    })

    it("returns empty array for non-existent file", () => {
      const blocks = parseGeminiSession("/nonexistent/path/session.json")
      expect(blocks).toEqual([])
    })

    it("returns empty array for invalid JSON", () => {
      const dir = mkdtempSync(join(tmpdir(), "gemini-test-"))
      const file = join(dir, "session.json")
      writeFileSync(file, "not valid json {{{")

      const blocks = parseGeminiSession(file)
      expect(blocks).toEqual([])

      rmSync(dir, { recursive: true })
    })
  })
})
