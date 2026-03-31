/**
 * Elicitation Dialog — AskUserQuestion multi-choice
 *
 * Renders when the agent uses AskUserQuestion (via canUseTool).
 * Arrow keys to navigate, number keys to select, Enter to confirm.
 * Always includes "Other" option for free text.
 *
 * Answers are keyed by question text to match the SDK's expected format:
 *   { "Which library?": "React", "Which version?": "18" }
 *
 * Escape cancels the entire elicitation via cancelElicitation (deny).
 *
 * NOT a modal overlay. Renders inline in the conversation flow.
 */

import { createSignal, For, Show } from "solid-js"
import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { usePermissions } from "../context/permissions"
import { useAgent } from "../context/agent"
import { useSession } from "../context/session"
import type { ElicitationQuestion } from "../../protocol/types"

function QuestionView(props: {
  question: ElicitationQuestion
  onAnswer: (value: string) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = createSignal(0)
  const [showFreeText, setShowFreeText] = createSignal(false)
  let freeTextRef: TextareaRenderable | undefined

  const options = () => {
    const opts = props.question.options.map((o) => ({
      label: o.label,
      isOther: false,
    }))
    if (props.question.allowFreeText !== false) {
      opts.push({ label: "Other (type your answer)", isOther: true })
    }
    return opts
  }

  const selectOption = (idx: number) => {
    const opt = options()[idx]
    if (!opt) return
    if (opt.isOther) {
      setShowFreeText(true)
    } else {
      // Answer value is the option label, matching SDK expectation
      props.onAnswer(opt.label)
    }
  }

  useKeyboard((event) => {
    if (showFreeText()) {
      if (event.name === "escape") {
        setShowFreeText(false)
      }
      return
    }

    if (event.name === "up" || event.name === "k") {
      setSelected((prev) => Math.max(0, prev - 1))
    } else if (event.name === "down" || event.name === "j") {
      setSelected((prev) => Math.min(options().length - 1, prev + 1))
    } else if (event.name === "return") {
      selectOption(selected())
    } else if (event.name >= "1" && event.name <= "9") {
      const idx = parseInt(event.name) - 1
      if (idx < options().length) {
        selectOption(idx)
      }
    } else if (event.name === "escape") {
      props.onCancel()
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
      <Show when={props.question.header}>
        <text fg="#808080" attributes={TextAttributes.DIM}>
          {props.question.header}
        </text>
      </Show>
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
        <text fg="#808080">
          {"  "}Arrow keys to navigate, Enter to select, Esc to cancel
        </text>
      </Show>

      <Show when={showFreeText()}>
        <text fg="#808080">Type your answer and press Enter (Esc to go back):</text>
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
            if (text) {
              props.onAnswer(text)
            }
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

  // Accumulate answers across multiple questions, keyed by question text
  const [answers, setAnswers] = createSignal<Record<string, string>>({})
  const [currentIdx, setCurrentIdx] = createSignal(0)

  const handleAnswer = (questionText: string, value: string) => {
    if (!state.pendingElicitation) return

    const questions = state.pendingElicitation.questions
    const updated = { ...answers(), [questionText]: value }
    setAnswers(updated)

    // If all questions are answered, send the complete response
    if (Object.keys(updated).length >= questions.length) {
      const id = state.pendingElicitation.id
      agent.backend.respondToElicitation(id, updated)
      setAnswers({})
      setCurrentIdx(0)
    } else {
      // Advance to next question
      setCurrentIdx((prev) => prev + 1)
    }
  }

  const handleCancel = () => {
    if (!state.pendingElicitation) return
    const id = state.pendingElicitation.id
    agent.backend.cancelElicitation(id)
    setAnswers({})
    setCurrentIdx(0)
  }

  return (
    <Show when={session.sessionState === "WAITING_FOR_ELIC" && state.pendingElicitation}>
      {(elicitation) => {
        const questions = elicitation().questions
        const question = () => questions[currentIdx()]

        return (
          <box flexDirection="column">
            {/* Progress indicator for multi-question elicitations */}
            <Show when={questions.length > 1}>
              <text fg="#808080" attributes={TextAttributes.DIM}>
                {"  Question " + (currentIdx() + 1) + "/" + questions.length}
              </text>
            </Show>
            <Show when={question()}>
              {(q) => (
                <QuestionView
                  question={q()}
                  onAnswer={(value) => handleAnswer(q().question, value)}
                  onCancel={handleCancel}
                />
              )}
            </Show>
          </box>
        )
      }}
    </Show>
  )
}
