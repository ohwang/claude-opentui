/**
 * Adapter replay-context contract tests.
 *
 * The /switch flow populates SessionConfig.replayContext with the formatted
 * prior-session history. Every adapter must:
 *   (1) NOT call startTurn/sendPrompt with replayContext on startup (would
 *       produce a phantom response turn and queue the user's first real
 *       message behind it).
 *   (2) Prepend replayContext, clearly marked as historical, to the next
 *       real user message so the model has the prior conversation in context
 *       but only responds to the new user input.
 *
 * These tests verify the Claude adapter's createMessageIterable behavior
 * because it's the simplest to exercise — it consumes from an in-memory
 * queue and yields SDK messages synchronously. The Codex and ACP adapters
 * use the same pendingReplayContext + prepend-then-null pattern.
 */

import { describe, expect, it } from "bun:test"
import { ClaudeAdapter } from "../../src/backends/claude/adapter"

describe("Claude adapter: replay context", () => {
  it("prepends replayContext as marked historical to the next user message", async () => {
    const adapter = new ClaudeAdapter() as any
    // Prime pendingReplayContext the same way adapter.start(config) does.
    adapter.pendingReplayContext = "PRIOR SESSION: user said hello"
    // Push a user message that will be consumed by createMessageIterable.
    adapter.messageQueue.push({ text: "What's next?" })

    const iter = adapter.createMessageIterable({} as any)
    const { value, done } = await iter.next()
    expect(done).toBe(false)
    // The SDK message content has the replay context + new message.
    const content = value.message.content[0]
    expect(content.type).toBe("text")
    expect(content.text).toContain("Historical context")
    expect(content.text).toContain("PRIOR SESSION: user said hello")
    expect(content.text).toContain("End of historical context")
    expect(content.text).toContain("What's next?")
    // After consumption, pendingReplayContext must be cleared so the NEXT
    // message does not get the replay again.
    expect(adapter.pendingReplayContext).toBeNull()
    adapter.close()
  })

  it("does not inject replay context on subsequent messages", async () => {
    const adapter = new ClaudeAdapter() as any
    adapter.pendingReplayContext = "OLD HISTORY"
    adapter.messageQueue.push({ text: "first real message" })
    adapter.messageQueue.push({ text: "second message" })

    const iter = adapter.createMessageIterable({} as any)
    const first = await iter.next()
    const second = await iter.next()
    expect(first.value.message.content[0].text).toContain("OLD HISTORY")
    expect(second.value.message.content[0].text).not.toContain("OLD HISTORY")
    expect(second.value.message.content[0].text).toBe("second message")
    adapter.close()
  })

  it("sends messages verbatim when no replayContext is pending", async () => {
    const adapter = new ClaudeAdapter() as any
    adapter.pendingReplayContext = null
    adapter.messageQueue.push({ text: "plain message" })

    const iter = adapter.createMessageIterable({} as any)
    const { value } = await iter.next()
    expect(value.message.content[0].text).toBe("plain message")
    adapter.close()
  })
})
