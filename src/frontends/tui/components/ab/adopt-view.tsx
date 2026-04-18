/**
 * A/B Adopt View — shown during adopt + adopt-error + done.
 *
 * For "adopting": render the orchestrator's progress message.
 * For "adopt-error": surface the conflict files and offer retry / preserve worktrees.
 * For "done": brief success line; the modal is dismissed shortly after.
 */

import { TextAttributes } from "@opentui/core"
import { Index, Show } from "solid-js"
import type { AdoptionError } from "../../../../ab/orchestrator"
import { colors } from "../../theme/tokens"
import { ShortcutBar, ShortcutHint } from "../primitives"

export interface AdoptViewProps {
  status: string
  error: AdoptionError | null
  done: boolean
  /** When done, what was the outcome the parent settled on? */
  outcome?: string
}

export function AdoptView(props: AdoptViewProps) {
  return (
    <box flexDirection="column" padding={2} width="100%">
      <Show
        when={!props.error}
        fallback={
          <box flexDirection="column">
            <text fg={colors.status.error} attributes={TextAttributes.BOLD}>
              {"Adoption failed"}
            </text>
            <text fg={colors.text.primary}>{props.error!.message}</text>
            <Show when={props.error!.message.includes("conflict")}>
              <text fg={colors.text.secondary}>
                {"Worktrees are preserved on disk so you can resolve manually:"}
              </text>
            </Show>
            <text fg={colors.text.secondary}>
              {`  Worktree A: ${props.error!.worktreePathA}`}
            </text>
            <text fg={colors.text.secondary}>
              {`  Worktree B: ${props.error!.worktreePathB}`}
            </text>

            <box marginTop={1}>
              <ShortcutBar>
                <ShortcutHint shortcut="R" action="retry adopt" />
                <ShortcutHint shortcut="P" action="preserve and exit" />
                <ShortcutHint shortcut="Esc" action="cancel" />
              </ShortcutBar>
            </box>
          </box>
        }
      >
        <Show
          when={props.done}
          fallback={
            <box flexDirection="column">
              <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
                {"Adopting…"}
              </text>
              <text fg={colors.text.secondary}>{props.status}</text>
            </box>
          }
        >
          <box flexDirection="column">
            <text fg={colors.status.success} attributes={TextAttributes.BOLD}>
              {"Done"}
            </text>
            <text fg={colors.text.secondary}>
              {props.outcome ?? "Comparison finished."}
            </text>
            <text fg={colors.text.muted}>{"Press any key to dismiss."}</text>
          </box>
        </Show>
      </Show>
    </box>
  )
}

/** Convenience: render the conflict file list (used by future expansions). */
export function ConflictList(props: { files: string[] }) {
  return (
    <Index each={props.files}>
      {(f: () => string) => <text fg={colors.text.muted}>{`  ${f()}`}</text>}
    </Index>
  )
}
