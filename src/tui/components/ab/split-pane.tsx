/**
 * A/B Split Pane — execution-phase shell.
 *
 * Renders two SessionPane children side by side, with one focused at a time.
 * Owns scroll-box refs so PageUp/PageDown scroll the focused pane only.
 *
 * Keyboard handling lives at the modal level (ABModal) — this component just
 * exposes a `focused` accessor and relays scroll requests via callbacks. Per
 * the OpenTUI prop rules, scrollbox refs use `scrollBy()` / `scrollTo()` only.
 */

import { createSignal, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { SessionPane } from "./session-pane"
import type { Label, SessionStats } from "../../../ab/types"
import type { DiffStats } from "../../../utils/git-worktree"
import { colors } from "../../theme/tokens"
import { ShortcutBar, ShortcutHint } from "../primitives"

export interface SplitPaneProps {
  prompt: string
  statsA: SessionStats
  statsB: SessionStats
  diffA?: DiffStats | null
  diffB?: DiffStats | null
  focused: Label
  onFocusChange: (next: Label) => void
  /** Optional banner text rendered above the split (phase header). */
  banner?: string
  /** Footer hint text — overrides the default execute shortcut bar. */
  footer?: string
  /** Register pane refs upward so the parent can scrollBy() the focused one. */
  onPaneRefs?: (refs: { a?: ScrollBoxRenderable; b?: ScrollBoxRenderable }) => void
}

export function SplitPane(props: SplitPaneProps) {
  let refA: ScrollBoxRenderable | undefined
  let refB: ScrollBoxRenderable | undefined
  const [, setRev] = createSignal(0)

  const publishRefs = () => {
    props.onPaneRefs?.({ a: refA, b: refB })
    setRev((r) => r + 1)
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Banner */}
      <Show when={props.banner}>
        <box flexShrink={0} paddingLeft={2} paddingRight={2}>
          <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
            {props.banner}
          </text>
        </box>
      </Show>

      {/* Prompt summary */}
      <box flexShrink={0} paddingLeft={2} paddingRight={2}>
        <text fg={colors.text.secondary}>
          {`Prompt: ${truncate(props.prompt, 200)}`}
        </text>
      </box>

      {/* Two-pane split */}
      <box flexGrow={1} flexShrink={1} flexDirection="row" padding={1}>
        <SessionPane
          label="A"
          stats={props.statsA}
          diff={props.diffA}
          focused={props.focused === "A"}
          onScrollboxRef={(el) => {
            refA = el
            publishRefs()
          }}
        />
        <box width={1} />
        <SessionPane
          label="B"
          stats={props.statsB}
          diff={props.diffB}
          focused={props.focused === "B"}
          onScrollboxRef={(el) => {
            refB = el
            publishRefs()
          }}
        />
      </box>

      {/* Footer */}
      <box flexShrink={0} paddingLeft={2} paddingRight={2}>
        <Show
          when={props.footer}
          fallback={
            <ShortcutBar>
              <ShortcutHint shortcut={"\u2190/\u2192 or Tab"} action="switch focus" />
              <ShortcutHint shortcut="PgUp/PgDn" action="scroll pane" />
              <ShortcutHint shortcut="Ctrl+C" action="interrupt both" />
              <ShortcutHint shortcut="Esc" action="cancel" />
            </ShortcutBar>
          }
        >
          <text fg={colors.text.muted}>{props.footer}</text>
        </Show>
      </box>
    </box>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}
