/**
 * Storybook Shell — horizontal split TUI for browsing component stories.
 *
 * Top: horizontal tree (categories + stories inline).
 * Middle: optional controls bar for variant toggling.
 * Bottom: full-width preview of the selected story.
 * Footer: info bar with breadcrumb and description.
 *
 * Supports fullscreen zoom mode (f key) for isolated interaction.
 */

import { createSignal, createMemo, createEffect, Show, For } from "solid-js"
import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/solid"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { KeyEvent } from "@opentui/core"
import { StoryContextProvider } from "./context/story-context"
import { stories, categories } from "./registry"
import type { Story, StoryCategory, StoryContext } from "./types"
import { colors } from "../tui/theme/tokens"

export function StorybookApp() {
  const dims = useTerminalDimensions()
  const renderer = useRenderer()

  const cleanExit = () => {
    renderer.destroy()
    process.exit(0)
  }

  // ── Story selection ──────────────────────────────────────────────
  const [cursorPos, setCursorPos] = createSignal(0)
  const [variantIdx, setVariantIdx] = createSignal(0)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [focusPane, setFocusPane] = createSignal<"tree" | "preview">("tree")
  const [filterText, setFilterText] = createSignal("")
  const [isFiltering, setIsFiltering] = createSignal(false)

  // Reset variant when story changes
  const selectedStory = createMemo((): Story | null => {
    const idx = cursorPos()
    return stories[idx] ?? null
  })

  // Active variant context and render
  const activeContext = createMemo((): StoryContext | undefined => {
    const story = selectedStory()
    if (!story) return undefined
    const variants = story.variants
    if (!variants || variants.length === 0) return story.context
    const variant = variants[variantIdx()] ?? variants[0]
    if (!variant) return story.context
    // Merge variant context over story's base context
    if (variant.context) {
      const base = story.context ?? {}
      return {
        session: { ...base.session, ...variant.context.session },
        messages: { ...base.messages, ...variant.context.messages },
        permissions: { ...base.permissions, ...variant.context.permissions },
        agent: { ...base.agent, ...variant.context.agent },
      } as StoryContext
    }
    return story.context
  })

  const activeRender = createMemo(() => {
    const story = selectedStory()
    if (!story) return undefined
    const variants = story.variants
    if (!variants || variants.length === 0) return story.render
    const variant = variants[variantIdx()] ?? variants[0]
    return variant?.render ?? story.render
  })

  const moveCursor = (delta: number) => {
    setCursorPos((prev) => {
      const next = prev + delta
      if (next < 0) return 0
      if (next >= stories.length) return stories.length - 1
      return next
    })
    setVariantIdx(0)
  }

  const cycleVariant = (delta: number) => {
    const story = selectedStory()
    if (!story?.variants?.length) return
    const len = story.variants.length
    setVariantIdx((prev) => ((prev + delta) % len + len) % len)
  }

  // ── Keyboard handler ─────────────────────────────────────────────
  useKeyboard((event: KeyEvent) => {
    // ── Fullscreen mode ──
    if (fullscreen()) {
      if (event.name === "escape") {
        setFullscreen(false)
        return
      }
      // All other keys pass to the component
      return
    }

    // ── Filter mode ──
    if (isFiltering()) {
      if (event.name === "escape") {
        setIsFiltering(false)
        setFilterText("")
        return
      }
      if (event.name === "return") {
        setIsFiltering(false)
        // Jump cursor to the first matching story
        const ft = filterText().toLowerCase()
        if (ft) {
          const idx = stories.findIndex((s) => s.title.toLowerCase().includes(ft))
          if (idx >= 0) setCursorPos(idx)
        }
        setFilterText("")
        return
      }
      if (event.name === "backspace") {
        setFilterText((t) => t.slice(0, -1))
        return
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setFilterText((t) => t + event.name)
        return
      }
      return
    }

    // ── Global keys ──
    if (event.name === "q" || (event.name === "c" && event.ctrl)) {
      cleanExit()
    }

    // Variant cycling (works in both tree and preview)
    if (event.name === "]") { cycleVariant(1); return }
    if (event.name === "[") { cycleVariant(-1); return }
    if (event.name && event.name >= "1" && event.name <= "9" && !event.ctrl && !event.meta) {
      const idx = parseInt(event.name) - 1
      const story = selectedStory()
      if (story?.variants && idx < story.variants.length) {
        setVariantIdx(idx)
      }
      return
    }

    if (event.name === "tab") {
      setFocusPane((p) => (p === "tree" ? "preview" : "tree"))
      return
    }

    // ── Tree pane ──
    if (focusPane() === "tree") {
      if (event.name === "down" || event.name === "j") { moveCursor(1); return }
      if (event.name === "up" || event.name === "k") { moveCursor(-1); return }
      if (event.name === "f" || event.name === "return") { setFullscreen(true); return }
      if (event.name === "g") { setCursorPos(0); setVariantIdx(0); return }
      if (event.name === "G") { setCursorPos(stories.length - 1); setVariantIdx(0); return }
      if (event.name === "/") { setIsFiltering(true); setFilterText(""); return }
      return
    }

    // ── Preview pane ──
    if (focusPane() === "preview") {
      if (event.name === "escape") { setFocusPane("tree"); return }
      if (event.name === "f") { setFullscreen(true); return }
      // Interactive stories consume other keys
      return
    }
  })

  // ── Fullscreen render ─────────────────────────────────────────────
  const FullscreenView = () => {
    const story = selectedStory()
    if (!story) return null
    const renderFn = activeRender()
    if (!renderFn) return null
    return (
      <box flexDirection="column" width="100%" height="100%">
        <StoryContextProvider context={activeContext()}>
          <box flexGrow={1}>
            {renderFn()}
          </box>
        </StoryContextProvider>
        <box height={1} flexShrink={0} paddingLeft={1}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {"Esc to exit fullscreen"}
          </text>
        </box>
      </box>
    )
  }

  // ── Tree items (grouped by category) ──────────────────────────────
  type TreeItem =
    | { kind: "category"; category: StoryCategory }
    | { kind: "story"; story: Story; storyIndex: number }

  const treeItems = createMemo((): TreeItem[] => {
    const items: TreeItem[] = []
    let storyIdx = 0
    for (const cat of categories) {
      const catStories = stories.filter((s) => s.category === cat)
      if (catStories.length === 0) continue
      items.push({ kind: "category", category: cat })
      for (const story of catStories) {
        items.push({ kind: "story", story, storyIndex: storyIdx })
        storyIdx++
      }
    }
    return items
  })

  // Compute total tree rows (category headers + individual stories)
  const totalTreeRows = createMemo(() => {
    let count = 0
    for (const cat of categories) {
      const catStories = stories.filter((s) => s.category === cat)
      if (catStories.length === 0) continue
      count++ // category header
      count += catStories.length // one row per story
    }
    return Math.max(count, 2)
  })

  // Tree viewport height — 1/3 of terminal, clamped
  const treeViewHeight = createMemo(() => {
    const h = dims()?.height ?? 40
    return Math.min(totalTreeRows(), Math.max(8, Math.min(15, Math.floor(h / 3))))
  })

  // Row offset of the currently selected story in the vertical tree
  const selectedRow = createMemo(() => {
    const pos = cursorPos()
    let row = 0
    for (const cat of categories) {
      const catStories = stories.filter((s) => s.category === cat)
      if (catStories.length === 0) continue
      row++ // category header
      for (const story of catStories) {
        if (stories.indexOf(story) === pos) return row
        row++
      }
    }
    return 0
  })

  let treeScrollRef: ScrollBoxRenderable | undefined

  // Auto-scroll tree to keep selection visible
  createEffect(() => {
    const row = selectedRow()
    if (treeScrollRef) {
      const viewH = treeViewHeight()
      treeScrollRef.scrollTo(Math.max(0, row - Math.floor(viewH / 2)))
    }
  })

  // Key that changes on both story and variant switch, forcing re-render
  const previewKey = createMemo(() => {
    const story = selectedStory()
    if (!story) return null
    return `${story.id}-${variantIdx()}`
  })

  const termWidth = () => dims()?.width ?? 120

  // ── Normal layout render ──────────────────────────────────────────
  return (
    <Show when={!fullscreen()} fallback={<FullscreenView />}>
      <box flexDirection="column" width="100%" height="100%">
        {/* Header */}
        <box flexDirection="row" height={1} flexShrink={0}>
          <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
            {" opentui storybook "}
          </text>
          <box flexGrow={1} />
          <text fg={colors.text.muted}>
            {" j/k:nav  [/]:variant  f:fullscreen  /:filter  q:quit "}
          </text>
        </box>

        {/* Separator */}
        <box height={1} flexShrink={0}>
          <text fg={colors.border.muted}>{"─".repeat(termWidth())}</text>
        </box>

        {/* Filter bar */}
        <Show when={isFiltering()}>
          <box height={1} flexShrink={0} paddingLeft={1}>
            <text fg={colors.status.info}>{"/ "}</text>
            <text fg={colors.text.primary}>{filterText()}</text>
            <text fg={colors.text.muted}>{"_"}</text>
          </box>
        </Show>

        {/* Component tree (vertical, scrollable) */}
        <scrollbox
          ref={(el: ScrollBoxRenderable) => { treeScrollRef = el }}
          height={treeViewHeight()}
          flexShrink={0}
          stickyScroll={false}
        >
          <box flexDirection="column">
            <For each={categories}>
              {(cat) => {
                const catStories = createMemo(() => stories.filter((s) => s.category === cat))
                return (
                  <Show when={catStories().length > 0}>
                    <box height={1} paddingLeft={1}>
                      <text fg={colors.text.muted} attributes={TextAttributes.DIM}>{cat}</text>
                    </box>
                    <For each={catStories()}>
                      {(story) => {
                        const storyIdx = createMemo(() => stories.indexOf(story))
                        const isSelected = createMemo(() => storyIdx() === cursorPos())
                        const isFocused = createMemo(() => focusPane() === "tree" && isSelected())
                        return (
                          <box height={1} paddingLeft={3}>
                            <text
                              fg={isFocused() ? colors.accent.primary : isSelected() ? colors.text.white : colors.text.secondary}
                              attributes={isFocused() ? TextAttributes.BOLD : isSelected() ? TextAttributes.BOLD : 0}
                            >
                              {(isFocused() ? "▸" : " ") + story.title}
                            </text>
                          </box>
                        )
                      }}
                    </For>
                  </Show>
                )
              }}
            </For>
          </box>
        </scrollbox>

        {/* Separator */}
        <box height={1} flexShrink={0}>
          <text fg={colors.border.muted}>{"─".repeat(termWidth())}</text>
        </box>

        {/* Controls bar (only when story has variants) */}
        <Show when={selectedStory()?.variants?.length}>
          <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1}>
            <text fg={colors.text.muted} attributes={TextAttributes.DIM}>{"state: "}</text>
            <For each={selectedStory()?.variants ?? []}>
              {(variant, i) => {
                const active = createMemo(() => i() === variantIdx())
                return (
                  <box paddingRight={1}>
                    <text
                      fg={active() ? colors.accent.primary : colors.text.muted}
                      attributes={active() ? TextAttributes.BOLD : TextAttributes.DIM}
                    >
                      {`${active() ? "▸" : " "}${i() + 1}.${variant.label}`}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>

        {/* Preview pane — scrollbox prevents overflow garbling */}
        <scrollbox flexGrow={1} stickyScroll={false}>
          <Show
            when={previewKey()}
            keyed
            fallback={
              <box flexGrow={1} justifyContent="center" alignItems="center">
                <text fg={colors.text.muted}>Select a story to preview</text>
              </box>
            }
          >
            {(_key: string) => {
              const renderFn = activeRender()
              const ctx = activeContext()
              if (!renderFn) return null
              return (
                <StoryContextProvider context={ctx}>
                  <box flexGrow={1}>
                    {renderFn()}
                  </box>
                </StoryContextProvider>
              )
            }}
          </Show>
        </scrollbox>

        {/* Separator */}
        <box height={1} flexShrink={0}>
          <text fg={colors.border.muted}>{"─".repeat(termWidth())}</text>
        </box>

        {/* Info bar */}
        <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1}>
          <Show when={selectedStory()} keyed fallback={<text fg={colors.text.muted}>No story selected</text>}>
            {(story: Story) => (
              <>
                <text fg={colors.accent.primary}>{story.category}</text>
                <text fg={colors.text.muted}>{" > "}</text>
                <text fg={colors.text.white}>{story.title}</text>
                <Show when={story.variants?.length}>
                  <text fg={colors.text.muted}>{" ["}</text>
                  <text fg={colors.accent.cyan}>{story.variants?.[variantIdx()]?.label ?? ""}</text>
                  <text fg={colors.text.muted}>{"]"}</text>
                </Show>
                <text fg={colors.text.muted}>{" — "}</text>
                <text fg={colors.text.secondary}>{story.description}</text>
              </>
            )}
          </Show>
        </box>
      </box>
    </Show>
  )
}
