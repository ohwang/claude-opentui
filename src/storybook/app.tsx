/**
 * Storybook Shell — two-pane TUI for browsing component stories.
 *
 * Left pane: scrollable sidebar with categories and story titles.
 * Right pane: preview of the selected story wrapped in StoryContextProvider.
 * Bottom: info bar with breadcrumb and description.
 */

import { createSignal, createMemo, Show, For, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import type { KeyEvent } from "@opentui/core"
import { StoryContextProvider } from "./context/story-context"
import { stories, categories } from "./registry"
import type { Story, StoryCategory } from "./types"
import { colors } from "../tui/theme/tokens"

const SIDEBAR_WIDTH = 24

/** Flat list item: either a category header or a story entry */
type SidebarItem =
  | { kind: "category"; category: StoryCategory }
  | { kind: "story"; story: Story; index: number }

export function StorybookApp() {
  const dims = useTerminalDimensions()

  // Build the sidebar item list (category headers + stories)
  const sidebarItems = createMemo((): SidebarItem[] => {
    const items: SidebarItem[] = []
    let storyIndex = 0
    for (const cat of categories) {
      const catStories = stories.filter((s) => s.category === cat)
      if (catStories.length === 0) continue
      items.push({ kind: "category", category: cat })
      for (const story of catStories) {
        items.push({ kind: "story", story, index: storyIndex++ })
      }
    }
    return items
  })

  // Selectable indices are only story items (not category headers)
  const selectableIndices = createMemo(() =>
    sidebarItems()
      .map((item, i) => (item.kind === "story" ? i : -1))
      .filter((i) => i >= 0),
  )

  const [cursorPos, setCursorPos] = createSignal(0) // Index into selectableIndices
  const [focusPane, setFocusPane] = createSignal<"sidebar" | "preview">("sidebar")
  const [filterText, setFilterText] = createSignal("")
  const [isFiltering, setIsFiltering] = createSignal(false)

  const selectedSidebarIndex = createMemo(() => selectableIndices()[cursorPos()] ?? 0)

  const selectedStory = createMemo((): Story | null => {
    const item = sidebarItems()[selectedSidebarIndex()]
    return item?.kind === "story" ? item.story : null
  })

  // Filtered stories for search mode
  const filteredSelectableIndices = createMemo(() => {
    const ft = filterText().toLowerCase()
    if (!ft) return selectableIndices()
    return selectableIndices().filter((i) => {
      const item = sidebarItems()[i]
      return item?.kind === "story" && item.story.title.toLowerCase().includes(ft)
    })
  })

  const moveCursor = (delta: number) => {
    const indices = isFiltering() ? filteredSelectableIndices() : selectableIndices()
    if (indices.length === 0) return
    setCursorPos((prev) => {
      const next = prev + delta
      if (next < 0) return 0
      if (next >= indices.length) return indices.length - 1
      return next
    })
  }

  useKeyboard((event: KeyEvent) => {
    // Filter mode
    if (isFiltering()) {
      if (event.name === "escape") {
        setIsFiltering(false)
        setFilterText("")
        return
      }
      if (event.name === "return") {
        setIsFiltering(false)
        return
      }
      if (event.name === "backspace") {
        setFilterText((t) => t.slice(0, -1))
        setCursorPos(0)
        return
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setFilterText((t) => t + event.name)
        setCursorPos(0)
        return
      }
      // Allow navigation in filter mode
      if (event.name === "down" || (event.name === "j" && !event.ctrl)) {
        moveCursor(1)
        return
      }
      if (event.name === "up" || (event.name === "k" && !event.ctrl)) {
        moveCursor(-1)
        return
      }
      return
    }

    // Global keys
    if (event.name === "q" || (event.name === "c" && event.ctrl)) {
      process.exit(0)
    }

    if (event.name === "tab") {
      setFocusPane((p) => (p === "sidebar" ? "preview" : "sidebar"))
      return
    }

    // Sidebar keys
    if (focusPane() === "sidebar") {
      if (event.name === "down" || event.name === "j") {
        moveCursor(1)
        return
      }
      if (event.name === "up" || event.name === "k") {
        moveCursor(-1)
        return
      }
      if (event.name === "return" || event.name === "l" || event.name === "right") {
        setFocusPane("preview")
        return
      }
      if (event.name === "g") {
        setCursorPos(0)
        return
      }
      if (event.name === "G") {
        const indices = selectableIndices()
        setCursorPos(indices.length - 1)
        return
      }
      if (event.name === "/") {
        setIsFiltering(true)
        setFilterText("")
        return
      }
      return
    }

    // Preview keys
    if (focusPane() === "preview") {
      if (event.name === "escape" || event.name === "h" || event.name === "left") {
        setFocusPane("sidebar")
        return
      }
      // Interactive stories consume other keys
      return
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box flexDirection="row" height={1} flexShrink={0}>
        <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
          {" opentui storybook "}
        </text>
        <box flexGrow={1} />
        <text fg={colors.text.muted}>
          {" j/k:nav  Tab:focus  Enter:preview  /:filter  q:quit "}
        </text>
      </box>

      {/* Separator */}
      <box height={1} flexShrink={0}>
        <text fg={colors.border.muted}>{"─".repeat(dims()?.width ?? 80)}</text>
      </box>

      {/* Main area */}
      <box flexDirection="row" flexGrow={1}>
        {/* Sidebar */}
        <scrollbox width={SIDEBAR_WIDTH} flexShrink={0}>
          <box flexDirection="column">
            <Show when={isFiltering()}>
              <box height={1}>
                <text fg={colors.status.info}>{"/"}</text>
                <text fg={colors.text.primary}>{filterText()}</text>
                <text fg={colors.text.muted}>{"_"}</text>
              </box>
            </Show>
            <For each={sidebarItems()}>
              {(item, i) => {
                if (item.kind === "category") {
                  return (
                    <box height={1} paddingLeft={1}>
                      <text fg={colors.text.white} attributes={TextAttributes.BOLD}>
                        {item.category}
                      </text>
                    </box>
                  )
                }

                // In filter mode, hide non-matching stories
                const visible = createMemo(() => {
                  if (!isFiltering() || !filterText()) return true
                  return item.story.title.toLowerCase().includes(filterText().toLowerCase())
                })

                const isSelected = createMemo(() => i() === selectedSidebarIndex())
                const isFocused = createMemo(() => focusPane() === "sidebar" && isSelected())

                return (
                  <Show when={visible()}>
                    <box height={1} paddingLeft={2}>
                      <text
                        fg={isFocused() ? colors.accent.primary : isSelected() ? colors.text.primary : colors.text.secondary}
                        attributes={isFocused() ? TextAttributes.BOLD : 0}
                      >
                        {(isFocused() ? "▸ " : "  ") + item.story.title.slice(0, SIDEBAR_WIDTH - 4)}
                      </text>
                    </box>
                  </Show>
                )
              }}
            </For>
          </box>
        </scrollbox>

        {/* Vertical separator */}
        <box width={1} flexShrink={0}>
          <box flexDirection="column" height="100%">
            <text fg={colors.border.muted}>{"│".repeat(dims()?.height ? dims()!.height - 4 : 20)}</text>
          </box>
        </box>

        {/* Preview pane */}
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
          <Show
            when={selectedStory()}
            fallback={
              <box flexGrow={1} justifyContent="center" alignItems="center">
                <text fg={colors.text.muted}>Select a story to preview</text>
              </box>
            }
          >
            {(story: Accessor<Story>) => (
              <StoryContextProvider context={story().context}>
                <box flexGrow={1}>
                  {story().render()}
                </box>
              </StoryContextProvider>
            )}
          </Show>
        </box>
      </box>

      {/* Separator */}
      <box height={1} flexShrink={0}>
        <text fg={colors.border.muted}>{"─".repeat(dims()?.width ?? 80)}</text>
      </box>

      {/* Info bar */}
      <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1}>
        <Show when={selectedStory()} fallback={<text fg={colors.text.muted}>No story selected</text>}>
          {(story: Accessor<Story>) => (
            <>
              <text fg={colors.accent.primary}>{story().category}</text>
              <text fg={colors.text.muted}>{" > "}</text>
              <text fg={colors.text.white}>{story().title}</text>
              <text fg={colors.text.muted}>{" — "}</text>
              <text fg={colors.text.secondary}>{story().description}</text>
            </>
          )}
        </Show>
      </box>
    </box>
  )
}
