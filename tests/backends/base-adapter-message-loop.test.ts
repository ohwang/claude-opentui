/**
 * BaseAdapter.runMessageLoop() tests — message queuing bugbash (2026-04-13).
 *
 * Verifies the shared message-loop helper used by Codex, ACP, and Mock
 * adapters. The tested invariants:
 *   1. FIFO: messages are handled in push order.
 *   2. Clean exit on close(): the loop resolves, it does not throw out.
 *   3. Error propagation from handler: a handler error bubbles up so the
 *      adapter's runSession() catch can push a fatal error event.
 *   4. No handler invocation after close() — even if the queue still has
 *      buffered items, the `!this.closed` check in the loop body wins.
 */

import { describe, expect, it } from "bun:test"
import { BaseAdapter } from "../../src/backends/shared/base-adapter"
import type {
  BackendCapabilities,
  EffortLevel,
  ModelInfo,
  PermissionMode,
  SessionConfig,
  SessionInfo,
  UserMessage,
} from "../../src/protocol/types"

/**
 * Minimal BaseAdapter subclass that exposes the message loop for testing.
 * runSession emits a session_init then hands control to runMessageLoop.
 */
class TestAdapter extends BaseAdapter {
  public received: UserMessage[] = []
  public handlerError: Error | null = null
  public loopExited = false
  public loopThrew: unknown = null
  private handlerImpl: (msg: UserMessage) => Promise<void> = async () => {}

  setHandler(fn: (msg: UserMessage) => Promise<void>): void {
    this.handlerImpl = fn
  }

  capabilities(): BackendCapabilities {
    return {
      name: "test",
      supportsThinking: false,
      supportsToolApproval: false,
      supportsResume: false,
      supportsContinue: false,
      supportsFork: false,
      supportsStreaming: false,
      supportsSubagents: false,
      supportsCompact: false,
      supportedPermissionModes: ["default"],
    }
  }

  protected async runSession(_config: SessionConfig): Promise<void> {
    this.eventChannel?.push({
      type: "session_init",
      sessionId: "test-session",
      tools: [],
      models: [],
    })

    try {
      await this.runMessageLoop(async (msg) => {
        this.received.push(msg)
        await this.handlerImpl(msg)
      })
      this.loopExited = true
    } catch (err) {
      this.loopThrew = err
      this.loopExited = true
      throw err
    }
  }

  interrupt(): void {}
  approveToolUse(): void {}
  denyToolUse(): void {}
  respondToElicitation(): void {}
  cancelElicitation(): void {}
  async setModel(_: string): Promise<void> {}
  async setPermissionMode(_: PermissionMode): Promise<void> {}
  async setEffort(_: EffortLevel): Promise<void> {}
  async availableModels(): Promise<ModelInfo[]> { return [] }
  async listSessions(): Promise<SessionInfo[]> { return [] }
  async forkSession(): Promise<string> { throw new Error("not supported") }
}

/** Helper: drain the event stream in the background so runSession() runs. */
function drainEvents(adapter: TestAdapter, config: SessionConfig = {}) {
  const events: unknown[] = []
  const done = (async () => {
    for await (const event of adapter.start(config)) {
      events.push(event)
    }
  })()
  return { events, done }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe("BaseAdapter.runMessageLoop()", () => {
  describe("FIFO processing", () => {
    it("handles messages in the order they were sent", async () => {
      const adapter = new TestAdapter()
      const { done } = drainEvents(adapter)

      // Let session_init emit.
      await wait(10)

      adapter.sendMessage({ text: "first" })
      adapter.sendMessage({ text: "second" })
      adapter.sendMessage({ text: "third" })

      await wait(30)

      expect(adapter.received.map((m) => m.text)).toEqual([
        "first",
        "second",
        "third",
      ])

      adapter.close()
      await done
    })

    it("processes subsequent messages once a slow handler finishes", async () => {
      const adapter = new TestAdapter()
      let unblockFirst!: () => void
      const firstStarted = new Promise<void>((resolve) => {
        adapter.setHandler(async (msg) => {
          if (msg.text === "slow") {
            resolve()
            await new Promise<void>((r) => {
              unblockFirst = r
            })
          }
        })
      })

      const { done } = drainEvents(adapter)
      await wait(10)

      adapter.sendMessage({ text: "slow" })
      adapter.sendMessage({ text: "next" })
      adapter.sendMessage({ text: "after" })

      await firstStarted
      // Only the slow one has started handling; others must be queued.
      expect(adapter.received.map((m) => m.text)).toEqual(["slow"])

      unblockFirst()
      await wait(30)
      expect(adapter.received.map((m) => m.text)).toEqual([
        "slow",
        "next",
        "after",
      ])

      adapter.close()
      await done
    })
  })

  describe("clean exit on close()", () => {
    it("resolves cleanly without throwing when close() is called while idle", async () => {
      const adapter = new TestAdapter()
      const { done } = drainEvents(adapter)
      await wait(10)

      adapter.close()
      await done

      expect(adapter.loopExited).toBe(true)
      expect(adapter.loopThrew).toBeNull()
    })

    it("resolves cleanly when close() is called after some messages were processed", async () => {
      const adapter = new TestAdapter()
      const { done } = drainEvents(adapter)
      await wait(10)

      adapter.sendMessage({ text: "a" })
      adapter.sendMessage({ text: "b" })
      await wait(20)

      adapter.close()
      await done

      expect(adapter.received.map((m) => m.text)).toEqual(["a", "b"])
      expect(adapter.loopExited).toBe(true)
      expect(adapter.loopThrew).toBeNull()
    })
  })

  describe("error propagation", () => {
    it("handler errors bubble out of runMessageLoop() so runSession() can push a fatal event", async () => {
      const adapter = new TestAdapter()
      adapter.setHandler(async (msg) => {
        if (msg.text === "boom") throw new Error("handler failed")
      })

      const { events, done } = drainEvents(adapter)
      await wait(10)

      adapter.sendMessage({ text: "boom" })
      await done

      // runSession catches and rethrows; the BaseAdapter wrapper turns the
      // thrown error into a fatal error event before closing the channel.
      const errEvents = events.filter(
        (e): e is { type: "error"; severity: string; message: string } =>
          typeof e === "object" &&
          e !== null &&
          (e as { type?: string }).type === "error",
      )
      expect(errEvents.length).toBeGreaterThan(0)
      expect(errEvents[0]!.severity).toBe("fatal")
      expect(errEvents[0]!.message).toContain("handler failed")
    })
  })

  describe("no processing after close()", () => {
    it("messages pushed after close() are not handled", async () => {
      const adapter = new TestAdapter()
      const { done } = drainEvents(adapter)
      await wait(10)

      adapter.close()
      await done

      // After close, sendMessage is a no-op (the queue is closed → push ignored).
      adapter.sendMessage({ text: "ghost" })
      await wait(20)

      expect(adapter.received).toHaveLength(0)
    })

    it("close() while a pull is waiting exits the loop without invoking the handler", async () => {
      const adapter = new TestAdapter()
      let handlerCalls = 0
      adapter.setHandler(async () => {
        handlerCalls++
      })

      const { done } = drainEvents(adapter)
      // Loop is now parked on messageQueue.pull() waiting for a message.
      await wait(20)

      adapter.close()
      await done

      expect(handlerCalls).toBe(0)
      expect(adapter.loopExited).toBe(true)
    })
  })
})
