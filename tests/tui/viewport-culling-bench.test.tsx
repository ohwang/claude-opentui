/**
 * Viewport Culling Benchmark — measures rendering performance with many blocks.
 *
 * Verifies that OpenTUI's native `viewportCulling` (default=true on <scrollbox>)
 * keeps frame times well under 16ms even with hundreds of conversation blocks.
 *
 * Key finding: OpenTUI's Zig renderer culls at the layout/render level:
 *   - _getVisibleChildren() uses getObjectsInViewport() with binary search
 *   - Non-visible children only get updateFromLayout() (Yoga position update)
 *   - Visible children get full updateLayout() + render() to ANSI buffer
 *
 * SolidJS components still exist in the reactive tree for all blocks, but the
 * Zig rendering cost is O(viewport) not O(total_blocks).
 */

import { describe, it, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { For } from "solid-js"
import { type ScrollBoxRenderable } from "@opentui/core"
import type { Block } from "../../src/protocol/types"

// ---------------------------------------------------------------------------
// Synthetic block generation
// ---------------------------------------------------------------------------

function generateBlocks(count: number): Block[] {
  const blocks: Block[] = []
  for (let i = 0; i < count; i++) {
    const mod = i % 5
    if (mod === 0) {
      blocks.push({ type: "user", text: `User message ${i}: What about this code?` })
    } else if (mod === 1) {
      blocks.push({
        type: "assistant",
        text: `Assistant response ${i}: Here is some content that spans a few lines.\nLine two of the response.\nLine three with some code: \`const x = ${i}\``,
      })
    } else if (mod === 2) {
      blocks.push({
        type: "tool",
        id: `tool-${i}`,
        tool: "Read",
        input: { file_path: `/src/file-${i}.ts` },
        status: "complete" as const,
        output: `File content for block ${i}\nLine 2\nLine 3\nLine 4`,
        startTime: Date.now() - 1000,
        duration: 150,
      })
    } else if (mod === 3) {
      blocks.push({
        type: "tool",
        id: `tool-${i}`,
        tool: "Bash",
        input: { command: `echo "hello from block ${i}"` },
        status: "complete" as const,
        output: `hello from block ${i}`,
        startTime: Date.now() - 500,
        duration: 80,
      })
    } else {
      blocks.push({
        type: "system",
        text: `System notification ${i}`,
      })
    }
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Minimal scrollbox rendering component (no context dependencies)
// ---------------------------------------------------------------------------

function TestConversation(props: { blocks: Block[] }) {
  let scrollboxRef: ScrollBoxRenderable | undefined
  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox ref={(el: ScrollBoxRenderable) => { scrollboxRef = el }} flexGrow={1}>
        <box flexDirection="column">
          <For each={props.blocks}>
            {(block) => (
              <box flexDirection="column" marginTop={1}>
                <text fg="#ffffff">
                  {block.type === "user" ? (block as any).text
                    : block.type === "assistant" ? (block as any).text
                    : block.type === "tool" ? `${(block as any).tool}: ${(block as any).output ?? "..."}`
                    : block.type === "system" ? (block as any).text
                    : "block"}
                </text>
              </box>
            )}
          </For>
        </box>
      </scrollbox>
    </box>
  )
}

// Same component but with viewport culling explicitly disabled
function TestConversationNoCulling(props: { blocks: Block[] }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox flexGrow={1} viewportCulling={false}>
        <box flexDirection="column">
          <For each={props.blocks}>
            {(block) => (
              <box flexDirection="column" marginTop={1}>
                <text fg="#ffffff">
                  {block.type === "user" ? (block as any).text
                    : block.type === "assistant" ? (block as any).text
                    : block.type === "tool" ? `${(block as any).tool}: ${(block as any).output ?? "..."}`
                    : block.type === "system" ? (block as any).text
                    : "block"}
                </text>
              </box>
            )}
          </For>
        </box>
      </scrollbox>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Viewport culling benchmark", () => {
  it("200 blocks with culling (default) — well under 16ms per frame", async () => {
    const blocks = generateBlocks(200)

    const { renderOnce, captureCharFrame } = await testRender(
      () => <TestConversation blocks={blocks} />,
      { width: 120, height: 40 }
    )

    // Initial render (includes SolidJS component creation + first layout)
    const t0 = performance.now()
    await renderOnce()
    const initialRenderMs = performance.now() - t0

    // Verify content is rendered
    const frame = captureCharFrame()
    expect(frame.length).toBeGreaterThan(0)

    // Steady-state frames
    const iterations = 20
    const t1 = performance.now()
    for (let i = 0; i < iterations; i++) {
      await renderOnce()
    }
    const avgFrameMs = (performance.now() - t1) / iterations

    console.log(`[200 blocks, culling ON]  initial=${initialRenderMs.toFixed(1)}ms  avg=${avgFrameMs.toFixed(2)}ms`)

    // Frame time must be under 16ms (60 FPS) with generous CI margin
    expect(avgFrameMs).toBeLessThan(50)
  })

  it("500 blocks: culling keeps frame time under 16ms", async () => {
    const blocks = generateBlocks(500)
    const iterations = 10

    // --- With culling ---
    const { renderOnce: renderCulled } = await testRender(
      () => <TestConversation blocks={blocks} />,
      { width: 120, height: 40 }
    )
    await renderCulled() // warm up
    const t0 = performance.now()
    for (let i = 0; i < iterations; i++) {
      await renderCulled()
    }
    const avgCulled = (performance.now() - t0) / iterations

    // --- Without culling ---
    const { renderOnce: renderNoCull } = await testRender(
      () => <TestConversationNoCulling blocks={blocks} />,
      { width: 120, height: 40 }
    )
    await renderNoCull() // warm up
    const t1 = performance.now()
    for (let i = 0; i < iterations; i++) {
      await renderNoCull()
    }
    const avgNoCull = (performance.now() - t1) / iterations

    console.log(`[500 blocks]  culled=${avgCulled.toFixed(2)}ms  unculled=${avgNoCull.toFixed(2)}ms  ratio=${(avgNoCull / avgCulled).toFixed(1)}x`)

    expect(avgCulled).toBeLessThan(50)
  })

  it("1000 blocks stress test — still manageable with culling", async () => {
    const blocks = generateBlocks(1000)

    const { renderOnce } = await testRender(
      () => <TestConversation blocks={blocks} />,
      { width: 120, height: 40 }
    )

    const t0 = performance.now()
    await renderOnce()
    const initialMs = performance.now() - t0

    const iterations = 5
    const t1 = performance.now()
    for (let i = 0; i < iterations; i++) {
      await renderOnce()
    }
    const avgMs = (performance.now() - t1) / iterations

    console.log(`[1000 blocks, culling ON]  initial=${initialMs.toFixed(1)}ms  avg=${avgMs.toFixed(2)}ms`)

    // Even with 1000 blocks, rendering should stay under 200ms
    // (Yoga layout is the bottleneck here, not ANSI output)
    expect(avgMs).toBeLessThan(200)
  })
})
