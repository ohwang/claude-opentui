/**
 * A/B Combine View — shown while the combine session runs.
 *
 * The combine session writes directly to the project directory; it merges the
 * best of A and B in-place. We render its streaming output and the running
 * file-touch list. Esc / Ctrl+C interrupts via the orchestrator handle.
 */

import { TextAttributes } from "@opentui/core"
import { Index, Show } from "solid-js"
import type { CombineResult } from "../../../ab/types"
import { colors } from "../../theme/tokens"
import { ShortcutBar, ShortcutHint } from "../primitives"

export interface CombineViewProps {
  result: CombineResult | null
}

export function CombineView(props: CombineViewProps) {
  return (
    <box flexDirection="column" padding={2} flexGrow={1} width="100%">
      <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
        {"Combine — synthesizing best of A + B"}
      </text>
      <text fg={colors.text.secondary}>
        {"Writing combined result to your project directory."}
      </text>

      <Show when={props.result}>
        {(getResult: () => CombineResult) => (
          <box marginTop={1} flexDirection="column" flexGrow={1}>
            <Show when={getResult().filesTouched.length > 0}>
              <box flexDirection="column">
                <text fg={colors.text.muted}>{"Files updated:"}</text>
                <Index each={getResult().filesTouched.slice(0, 10)}>
                  {(f: () => string) => (
                    <text fg={colors.text.muted}>{`  ${f()}`}</text>
                  )}
                </Index>
              </box>
            </Show>
            <box marginTop={1} flexGrow={1}>
              <scrollbox stickyScroll={true} stickyStart="bottom">
                <text fg={colors.text.primary}>
                  {getResult().reasoning || "(no output yet)"}
                </text>
              </scrollbox>
            </box>
            <Show when={getResult().error}>
              <text fg={colors.status.error}>{`error: ${getResult().error}`}</text>
            </Show>
          </box>
        )}
      </Show>

      <box marginTop={1}>
        <ShortcutBar>
          <ShortcutHint shortcut="Ctrl+C" action="interrupt combine" />
          <ShortcutHint shortcut="Esc" action="cancel" />
        </ShortcutBar>
      </box>
    </box>
  )
}
