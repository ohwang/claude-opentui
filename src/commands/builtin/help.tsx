/**
 * /help -- Rich modal overlay with keyboard shortcuts, input modes, and commands.
 *
 * 3-column layout inspired by Claude Code's PromptInputHelpMenu.
 * Uses the modal overlay system (showModal) instead of system_message.
 */

import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { showModal } from "../../tui/context/modal"
import { colors } from "../../tui/theme/tokens"
import type { SlashCommand, CommandContext } from "../registry"

// ---------------------------------------------------------------------------
// Shortcut data
// ---------------------------------------------------------------------------

interface ShortcutEntry {
  key: string
  label: string
}

const inputModes: ShortcutEntry[] = [
  { key: "/commands", label: "Slash commands" },
  { key: "@file", label: "File path autocomplete" },
  { key: "Ctrl+G", label: "Open external editor" },
]

const navigation: ShortcutEntry[] = [
  { key: "Ctrl+O", label: "Toggle tool detail" },
  { key: "Ctrl+E", label: "Toggle show-all" },
  { key: "Ctrl+T", label: "Toggle thinking" },
  { key: "Ctrl+Shift+P", label: "Cycle model" },
  { key: "Ctrl+Up/Down", label: "Scroll" },
  { key: "Ctrl+L", label: "Clear conversation" },
]

const actions: ShortcutEntry[] = [
  { key: "Ctrl+C", label: "Interrupt / clear" },
  { key: "Ctrl+D x2", label: "Exit" },
  { key: "Ctrl+V", label: "Paste (text/image)" },
  { key: "Shift+Tab", label: "Cycle perm. mode" },
  { key: "Up/Down", label: "Input history" },
  { key: "Ctrl+R", label: "History search" },
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ShortcutColumn(props: { title: string; items: ShortcutEntry[]; width?: number }) {
  return (
    <box flexDirection="column" width={props.width ?? 30} flexShrink={0}>
      <text
        fg={colors.accent.primary}
        attributes={TextAttributes.BOLD}
      >
        {props.title}
      </text>
      <box marginTop={1} flexDirection="column">
        <For each={props.items}>
          {(entry) => (
            <box flexDirection="row">
              <text fg={colors.accent.highlight}>{"  "}{entry.key}</text>
              <text fg={colors.text.inactive}>{" — "}{entry.label}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

function CommandList(props: { commands: SlashCommand[] }) {
  const local = () => props.commands.filter((c) => c.type !== "prompt")
  const prompts = () => props.commands.filter((c) => c.type === "prompt")

  const formatCmd = (cmd: SlashCommand): string => {
    const alias = cmd.aliases?.length ? ` (${cmd.aliases.join(", ")})` : ""
    const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : ""
    return `  /${cmd.name}${hint}${alias} -- ${cmd.description}`
  }

  return (
    <box flexDirection="column" marginTop={1}>
      <text
        fg={colors.accent.primary}
        attributes={TextAttributes.BOLD}
      >
        {"Commands"}
      </text>
      <box marginTop={1} flexDirection="column">
        <For each={local()}>
          {(cmd) => (
            <text fg={colors.text.primary}>{formatCmd(cmd)}</text>
          )}
        </For>
      </box>

      <Show when={prompts().length > 0}>
        <box marginTop={1} flexDirection="column">
          <text
            fg={colors.text.inactive}
            attributes={TextAttributes.DIM}
          >
            {"Prompt shortcuts (sent to model)"}
          </text>
          <box marginTop={1} flexDirection="column">
            <For each={prompts()}>
              {(cmd) => (
                <text fg={colors.text.primary}>{formatCmd(cmd)}</text>
              )}
            </For>
          </box>
        </box>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

function HelpModal(props: { commands: SlashCommand[] }) {
  return (
    <box flexDirection="column" padding={2}>
      <box
        borderStyle="single"
        borderColor={colors.border.default}
        flexDirection="column"
        padding={2}
      >
        {/* Title */}
        <text
          fg={colors.accent.primary}
          attributes={TextAttributes.BOLD}
        >
          {"Help -- Keyboard Shortcuts & Commands"}
        </text>

        {/* 3-column shortcut layout — fixed widths prevent column bleed */}
        <box flexDirection="row" marginTop={1}>
          <ShortcutColumn title="Input Modes" items={inputModes} width={28} />
          <ShortcutColumn title="Navigation" items={navigation} width={32} />
          <ShortcutColumn title="Actions" items={actions} width={30} />
        </box>

        {/* Registered commands */}
        <CommandList commands={props.commands} />

        {/* Footer */}
        <box marginTop={1}>
          <text
            fg={colors.text.inactive}
            attributes={TextAttributes.DIM}
          >
            {"  Press Escape to close"}
          </text>
        </box>
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Slash command export
// ---------------------------------------------------------------------------

export const helpCommand: SlashCommand = {
  name: "help",
  description: "Show available commands and shortcuts",
  aliases: ["h", "?"],
  execute: (_args: string, ctx: CommandContext) => {
    const commands = ctx.registry?.all() ?? []
    showModal(() => <HelpModal commands={commands} />)
  },
}
