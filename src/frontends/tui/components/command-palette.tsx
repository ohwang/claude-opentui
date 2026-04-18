/**
 * Command Palette Modal -- VSCode-style Ctrl+P fuzzy search over slash commands.
 *
 * Opens as a modal overlay. Captures keystrokes via the modal key handler
 * system to build a search query. Lists matching commands (by name, alias,
 * or description) with Up/Down navigation, Enter to invoke, Escape to cancel.
 *
 * The palette is structured around a PaletteItem discriminated union so
 * future quick-switch toggles (themes, models, debug flags) can slot in
 * alongside slash commands without restructuring the component.
 */

import { createSignal, createMemo, Show, Index, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { KeyEvent } from "@opentui/core"
import type { CommandRegistry, SlashCommand } from "../../../commands/registry"
import { colors } from "../theme/tokens"
import { setModalKeyHandler } from "../context/modal"
import { ShortcutHint, ShortcutBar } from "./primitives"

/** Maximum number of palette rows visible at once. */
const MAX_VISIBLE = 10

/**
 * A palette entry. The `command` kind wraps a slash command that will be
 * invoked via the registry. The `action` kind is a free-form runnable —
 * reserved for future interactive toggles (theme preview, model
 * quick-switch, debug flag panel, etc.) that don't map 1:1 to a slash
 * command. Keeping the union here means new palette sources can be added
 * without restructuring the component.
 */
export type PaletteItem =
  | { kind: "command"; cmd: SlashCommand }
  | { kind: "action"; label: string; description?: string; run: () => void }

export interface CommandPaletteProps {
  registry: CommandRegistry
  /** Invoke a slash command as if the user had typed it. */
  onInvokeCommand: (cmd: SlashCommand) => void
  /** Additional non-slash-command items (theme toggles, etc.). Reserved. */
  extraItems?: PaletteItem[]
  onCancel: () => void
}

/** Format a row for display, truncating to the given width. */
export function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (text.length <= maxWidth) return text
  if (maxWidth <= 3) return text.slice(0, maxWidth)
  return text.slice(0, maxWidth - 3) + "..."
}

/**
 * Build the list of palette items for a given query. Commands are ranked
 * by the registry; free-form actions are filtered by label/description
 * substring and appended. Extracted for direct testing.
 */
export function buildPaletteItems(
  registry: CommandRegistry,
  query: string,
  extraItems: PaletteItem[] = [],
): PaletteItem[] {
  const q = query.toLowerCase()
  const cmds: PaletteItem[] = registry
    .search(query)
    .map((cmd) => ({ kind: "command", cmd }))
  const extras = extraItems.filter((item) => {
    if (!q) return true
    if (item.kind === "action") {
      return (
        item.label.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false)
      )
    }
    return false
  })
  return [...cmds, ...extras]
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const dims = useTerminalDimensions()

  /**
   * View-state derivation chain. The list passed to `<Index>` is pre-flattened
   * so the render callback is a pure function of the item — required by the
   * OpenTUI prop rule #10 (Zig engine caches child positions by index).
   */
  const filtered = createMemo<PaletteItem[]>(() =>
    buildPaletteItems(props.registry, query(), props.extraItems ?? []),
  )

  const visible = createMemo(() => filtered().slice(0, MAX_VISIBLE))
  const overflow = createMemo(() => Math.max(0, filtered().length - MAX_VISIBLE))

  // Clamp the selection whenever the list shrinks below it.
  const clampedSelection = createMemo(() => {
    const max = Math.max(0, filtered().length - 1)
    return Math.min(selectedIndex(), max)
  })

  const invoke = (item: PaletteItem) => {
    if (item.kind === "command") {
      props.onInvokeCommand(item.cmd)
    } else {
      item.run()
    }
  }

  const handleKey = (event: KeyEvent): boolean => {
    if (event.name === "escape") {
      props.onCancel()
      return true
    }

    if (event.name === "up") {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return true
    }

    if (event.name === "down") {
      setSelectedIndex((i) => Math.min(filtered().length - 1, i + 1))
      return true
    }

    if (event.name === "return") {
      const selected = filtered()[clampedSelection()]
      if (selected) {
        invoke(selected)
      } else {
        props.onCancel()
      }
      return true
    }

    if (event.name === "backspace") {
      setQuery((q) => q.slice(0, -1))
      setSelectedIndex(0)
      return true
    }

    // Single printable character (no modifier). OpenTUI's KeyEvent has no
    // `char` field — printable keys arrive as one-character `name` values.
    if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
      setQuery((q) => q + event.name)
      setSelectedIndex(0)
      return true
    }

    return false
  }

  setModalKeyHandler(handleKey)
  onCleanup(() => setModalKeyHandler(null))

  const contentWidth = () => Math.min((dims()?.width ?? 80) - 8, 100)
  // Reserve room for the selection marker + name column; the rest is description.
  const nameColumn = () => Math.min(22, Math.floor(contentWidth() * 0.3))
  const descColumn = () => Math.max(10, contentWidth() - nameColumn() - 4)

  return (
    <box flexDirection="column" padding={2}>
      <box
        borderStyle="single"
        borderColor={colors.border.default}
        flexDirection="column"
        padding={2}
      >
        {/* Title */}
        <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
          {"Command Palette"}
        </text>

        {/* Search input */}
        <box marginTop={1} flexDirection="row">
          <text fg={colors.text.secondary}>{"> "}</text>
          <text fg={colors.text.primary} attributes={TextAttributes.BOLD}>
            {query() || ""}
          </text>
          <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
            {"_"}
          </text>
        </box>

        {/* Results list */}
        <box marginTop={1} flexDirection="column">
          <Show
            when={filtered().length > 0}
            fallback={
              <text fg={colors.text.muted}>{"No matching commands"}</text>
            }
          >
            <Index each={visible()}>
              {(itemAccessor, index) => {
                const isSelected = createMemo(() => index === clampedSelection())
                const label = createMemo(() => {
                  const item = itemAccessor()
                  if (item.kind === "command") return `/${item.cmd.name}`
                  return item.label
                })
                const description = createMemo(() => {
                  const item = itemAccessor()
                  if (item.kind === "command") {
                    const aliases = item.cmd.aliases?.length
                      ? ` (${item.cmd.aliases.map((a) => `/${a}`).join(", ")})`
                      : ""
                    return `${item.cmd.description}${aliases}`
                  }
                  return item.description ?? ""
                })
                return (
                  <box flexDirection="row" height={1}>
                    <text
                      fg={
                        isSelected()
                          ? colors.accent.highlight
                          : colors.text.secondary
                      }
                      attributes={isSelected() ? TextAttributes.BOLD : 0}
                    >
                      {isSelected() ? "> " : "  "}
                    </text>
                    <text
                      fg={
                        isSelected()
                          ? colors.accent.highlight
                          : colors.text.primary
                      }
                      attributes={isSelected() ? TextAttributes.BOLD : 0}
                    >
                      {truncate(label(), nameColumn()).padEnd(nameColumn())}
                    </text>
                    <text fg={colors.text.muted}>{"  "}</text>
                    <text
                      fg={
                        isSelected() ? colors.text.primary : colors.text.muted
                      }
                    >
                      {truncate(description(), descColumn())}
                    </text>
                  </box>
                )
              }}
            </Index>
            <Show when={overflow() > 0}>
              <text fg={colors.text.muted}>
                {`  ${overflow()} more...`}
              </text>
            </Show>
          </Show>
        </box>

        {/* Footer shortcuts */}
        <box marginTop={1}>
          <ShortcutBar>
            <ShortcutHint shortcut={"\u2191/\u2193"} action="navigate" />
            <ShortcutHint shortcut="Enter" action="invoke" />
            <ShortcutHint shortcut="Esc" action="cancel" />
          </ShortcutBar>
        </box>
      </box>
    </box>
  )
}
