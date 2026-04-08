/**
 * Stories for primitive components.
 */

import type { Story } from "../types"
import {
  Divider,
  StatusIcon,
  ProgressBar,
  BlinkingDot,
  Byline,
  ShortcutHint,
  ShortcutBar,
  type StatusType,
} from "../../tui/components/primitives"
import { EphemeralLine } from "../../tui/components/ephemeral-line"
import { colors } from "../../tui/theme/tokens"

export const primitivesStories: Story[] = [
  {
    id: "divider-default",
    title: "Divider",
    description: "Full-width dash separator (default styling)",
    category: "Primitives",
    render: () => <Divider />,
  },
  {
    id: "divider-custom",
    title: "Divider (custom)",
    description: "Custom character, color, and width",
    category: "Primitives",
    render: () => (
      <box flexDirection="column">
        <Divider char="=" fg={colors.accent.primary} width={40} />
        <box height={1} />
        <Divider char="·" fg={colors.status.info} width={30} />
        <box height={1} />
        <Divider char="━" fg={colors.accent.suggestion} width={50} />
      </box>
    ),
  },
  {
    id: "status-icon-all",
    title: "StatusIcon (all)",
    description: "All seven status icon types",
    category: "Primitives",
    render: () => (
      <box flexDirection="column">
        {(["success", "error", "warning", "info", "running", "declined", "pending"] as StatusType[]).map((s) => (
          <box flexDirection="row">
            <StatusIcon status={s} />
            <text fg={colors.text.inactive}>{s}</text>
          </box>
        ))}
      </box>
    ),
  },
  {
    id: "progress-bar-states",
    title: "ProgressBar",
    description: "Progress bars at various fill levels",
    category: "Primitives",
    render: () => (
      <box flexDirection="column">
        {[0, 0.25, 0.5, 0.75, 1].map((r) => (
          <box flexDirection="row">
            <ProgressBar ratio={r} width={20} />
            <text fg={colors.text.inactive}>{` ${String(Math.round(r * 100)).padStart(3)}%`}</text>
          </box>
        ))}
      </box>
    ),
  },
  {
    id: "blinking-dot-states",
    title: "BlinkingDot",
    description: "All four dot states (active blinks)",
    category: "Primitives",
    render: () => (
      <box flexDirection="column">
        {(["active", "success", "error", "declined"] as const).map((s) => (
          <box flexDirection="row">
            <BlinkingDot status={s} />
            <text fg={colors.text.inactive}>{` ${s}`}</text>
          </box>
        ))}
      </box>
    ),
  },
  {
    id: "byline",
    title: "Byline",
    description: "Middot-separated inline metadata",
    category: "Primitives",
    render: () => (
      <Byline>
        <text fg={colors.text.inactive}>3 turns</text>
        <text fg={colors.text.inactive}>$0.042</text>
        <text fg={colors.text.inactive}>45k tokens</text>
      </Byline>
    ),
  },
  {
    id: "shortcut-hint",
    title: "ShortcutHint",
    description: "Keyboard shortcut hints",
    category: "Primitives",
    render: () => (
      <box flexDirection="column">
        <ShortcutHint shortcut="Enter" action="select" />
        <ShortcutHint shortcut="Esc" action="cancel" parens />
        <ShortcutHint shortcut="Ctrl+R" action="search history" />
      </box>
    ),
  },
  {
    id: "shortcut-bar",
    title: "ShortcutBar",
    description: "Horizontal row of shortcut hints",
    category: "Primitives",
    render: () => (
      <ShortcutBar>
        <ShortcutHint shortcut="Enter" action="confirm" />
        <ShortcutHint shortcut="Esc" action="cancel" />
        <ShortcutHint shortcut="Tab" action="switch" />
      </ShortcutBar>
    ),
  },
  {
    id: "ephemeral-line",
    title: "EphemeralLine",
    description: "1-line ephemeral message area between content and input",
    category: "Primitives",
    render: () => <EphemeralLine message="Interrupt pending... Press Ctrl+D\u00d72 to force exit" />,
    variants: [
      { label: "with message", render: () => <EphemeralLine message="Interrupt pending... Press Ctrl+D\u00d72 to force exit" /> },
      { label: "blank", render: () => <EphemeralLine /> },
      { label: "away notice", render: () => <EphemeralLine message="You were away \u00b7 3 events while you were gone" /> },
      { label: "ctrl+c hint", render: () => <EphemeralLine message="Press Ctrl+C again to exit" /> },
    ],
  },
]
