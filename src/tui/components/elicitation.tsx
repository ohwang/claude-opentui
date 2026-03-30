/**
 * Elicitation Dialog — AskUserQuestion multi-choice
 *
 * Renders when the agent uses AskUserQuestion (via canUseTool).
 * Arrow keys to navigate, number keys to select, Enter to confirm.
 * Always includes "Other" option for free text.
 *
 * NOT a modal overlay. Renders inline in the conversation flow.
 */

import { createSignal, For, Show } from "solid-js"
import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { usePermissions } from "../context/permissions"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import type { ElicitationQuestion, ElicitationOption } from "../../protocol/types"

function QuestionView(props: {
  question: ElicitationQuestion
  questionIndex: number
  onAnswer: (value: string) => void
}) {
  const [selected, setSelected] = createSignal(0)
  const [showFreeText, setShowFreeText] = createSignal(false)
  let freeTextRef: TextareaRenderable | undefined

  const options = () => {
    const opts = [...props.question.options]
    if (props.question.allowFreeText !== false) {
      opts.push({ label: "Other (type your answer)", value: "__other__" })
    }
    return opts
  }

  useKeyboard((event) => {
    if (showFreeText()) {
      // Escape in free-text mode goes back to option list
      if (event.name === "escape") {
        setShowFreeText(false)
      }
      return // Let textarea handle all other input
    }

    if (event.name === "up" || event.name === "k") {
      setSelected((prev) => Math.max(0, prev - 1))
    } else if (event.name === "down" || event.name === "j") {
      setSelected((prev) => Math.min(options().length - 1, prev + 1))
    } else if (event.name === "return") {
      const opt = options()[selected()]
      if (opt.value === "__other__") {
        setShowFreeText(true)
      } else {
        props.onAnswer(opt.value)
      }
    } else if (event.name >= "1" && event.name <= "9") {
      const idx = parseInt(event.name) - 1
      if (idx < options().length) {
        const opt = options()[idx]
        if (opt.value === "__other__") {
          setShowFreeText(true)
        } else {
          props.onAnswer(opt.value)
        }
      }
    } else if (event.name === "escape") {
      props.onAnswer("") // Cancel
    }
  })

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg="cyan" attributes={TextAttributes.BOLD}>
        {props.question.question}
      </text>

      <Show when={!showFreeText()}>
        <For each={options()}>
          {(option, index) => (
            <box flexDirection="row">
              <text fg={index() === selected() ? "cyan" : "white"}>
                {index() === selected() ? " > " : "   "}
              </text>
              <text fg={index() === selected() ? "cyan" : "white"}>
                {index() + 1}) {option.label}
              </text>
            </box>
          )}
        </For>
        <text fg="gray">
          {"  "}Arrow keys to navigate, Enter to select, Esc to cancel
        </text>
      </Show>

      <Show when={showFreeText()}>
        <text fg="gray">Type your answer and press Enter (Esc to go back):</text>
        <textarea
          ref={(el: TextareaRenderable) => { freeTextRef = el }}
          focused
          height={2}
          placeholder="Type here..."
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
          ]}
          onSubmit={() => {
            const text = freeTextRef?.plainText?.trim() ?? ""
            props.onAnswer(text)
          }}
        />
      </Show>
    </box>
  )
}

export function ElicitationDialog() {
  const { state } = usePermissions()
  const { state: session } = useSession()
  const agent = useAgent()

  const handleAnswer = (questionIndex: number, value: string) => {
    if (!state.pendingElicitation) return

    const id = state.pendingElicitation.id
    agent.backend.respondToElicitation(id, {
      [String(questionIndex)]: value,
    })
  }

  return (
    <Show when={session.sessionState === "WAITING_FOR_ELIC" && state.pendingElicitation}>
      {(elicitation) => (
        <box flexDirection="column" gap={1}>
          <For each={elicitation().questions}>
            {(question, index) => (
              <QuestionView
                question={question}
                questionIndex={index()}
                onAnswer={(value) => handleAnswer(index(), value)}
              />
            )}
          </For>
        </box>
      )}
    </Show>
  )
}
