/**
 * A/B Judge Criteria Picker — small modal subview shown before the judge runs.
 *
 * Lets the user pick which evaluation template the judge should apply.
 * Defaults to the first template (Quality Showdown). Esc cancels back to
 * the comparison view.
 */

import { TextAttributes } from "@opentui/core"
import type { KeyEvent } from "@opentui/core"
import { createSignal, Index, onCleanup } from "solid-js"
import { JUDGE_TEMPLATES, type JudgeCriteria } from "../../../../ab/judge"
import { setModalKeyHandler } from "../../context/modal"
import { colors } from "../../theme/tokens"
import { ShortcutBar, ShortcutHint } from "../primitives"

export interface JudgeCriteriaPickerProps {
  onConfirm: (criteria: JudgeCriteria) => void
  onCancel: () => void
}

export function JudgeCriteriaPicker(props: JudgeCriteriaPickerProps) {
  const [index, setIndex] = createSignal(0)

  const handleKey = (event: KeyEvent): boolean => {
    if (event.name === "escape") {
      props.onCancel()
      return true
    }
    if (event.name === "up") {
      setIndex((i) => Math.max(0, i - 1))
      return true
    }
    if (event.name === "down") {
      setIndex((i) => Math.min(JUDGE_TEMPLATES.length - 1, i + 1))
      return true
    }
    if (event.name === "return") {
      props.onConfirm(JUDGE_TEMPLATES[index()]!)
      return true
    }
    return false
  }

  setModalKeyHandler(handleKey)
  onCleanup(() => setModalKeyHandler(null))

  return (
    <box flexDirection="column" padding={2}>
      <box
        borderStyle="single"
        borderColor={colors.border.default}
        flexDirection="column"
        padding={2}
      >
        <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
          {"Pick Judge Criteria"}
        </text>
        <box marginTop={1} flexDirection="column">
          <Index each={JUDGE_TEMPLATES}>
            {(t, i) => {
              const isSel = () => i === index()
              return (
                <box flexDirection="column" marginTop={i === 0 ? 0 : 1}>
                  <text
                    fg={isSel() ? colors.accent.primary : colors.text.primary}
                    attributes={isSel() ? TextAttributes.BOLD : 0}
                  >
                    {`${isSel() ? "›" : " "} ${t().name}`}
                  </text>
                  <text fg={colors.text.muted}>{`    ${t().description}`}</text>
                </box>
              )
            }}
          </Index>
        </box>
        <box marginTop={1}>
          <ShortcutBar>
            <ShortcutHint shortcut={"\u2191/\u2193"} action="navigate" />
            <ShortcutHint shortcut="Enter" action="run judge" />
            <ShortcutHint shortcut="Esc" action="cancel" />
          </ShortcutBar>
        </box>
      </box>
    </box>
  )
}
