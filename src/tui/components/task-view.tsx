/**
 * Task View — Subagent/background task display
 *
 * Shows active and completed tasks as a grouped tree.
 * Running tasks show blinking dot, completed show solid green dot.
 * Uses BlinkingDot primitive for consistent progress indication.
 */

import { createSignal, onCleanup, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { TaskInfo } from "../../protocol/types"
import { colors } from "../theme/tokens"
import { BlinkingDot } from "./primitives"

const MAX_VISIBLE_TASKS = 10

export function TaskView(props: { tasks: [string, TaskInfo][] }) {
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((t) => t + 1), 1000)
  onCleanup(() => clearInterval(timer))

  const hasAny = () => props.tasks.length > 0
  const runningCount = () => props.tasks.filter(([, t]) => t.status === "running").length
  const completedCount = () => props.tasks.filter(([, t]) => t.status === "completed").length

  const header = () => {
    const r = runningCount()
    const c = completedCount()
    if (r > 0 && c > 0) {
      return `${r} agent${r > 1 ? "s" : ""} running \u00B7 ${c} finished`
    }
    if (r > 0) {
      return `${r} agent${r > 1 ? "s" : ""} running`
    }
    return `${c} agent${c > 1 ? "s" : ""} finished`
  }

  return (
    <Show when={hasAny()}>
      <box flexDirection="column" paddingTop={1}>
        <box flexDirection="row" paddingLeft={2}>
          <BlinkingDot status={runningCount() > 0 ? "active" : "success"} />
          <text fg={colors.accent.secondary} attributes={TextAttributes.BOLD}>
            {" " + header()}
          </text>
        </box>
        <For each={props.tasks.slice(0, MAX_VISIBLE_TASKS)}>
          {([id, task], index) => {
            const isLast = () => index() === Math.min(props.tasks.length, MAX_VISIBLE_TASKS) - 1
            const prefix = () => (isLast() ? "\u2514\u2500" : "\u251C\u2500")
            const dotStatus = () => task.status === "running" ? "active" as const : "success" as const

            return (
              <box flexDirection="column">
                <box flexDirection="row" paddingLeft={3}>
                  <text fg={colors.text.muted}>{prefix()} </text>
                  <BlinkingDot status={dotStatus()} />
                  <text fg={colors.text.white}>{" " + task.description}</text>
                  <Show when={task.status === "running"}>
                    <text fg={colors.text.muted}>
                      {" (" + (() => { tick(); return Math.max(0, Math.round((Date.now() - task.startTime) / 1000)) })() + "s)"}
                    </text>
                  </Show>
                </box>
                <Show when={task.status === "completed" && task.output}>
                  <box paddingLeft={7}>
                    <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
                      {task.output!.length > 80
                        ? task.output!.slice(0, 77) + "..."
                        : task.output}
                    </text>
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={props.tasks.length > MAX_VISIBLE_TASKS}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {"    ... and " + (props.tasks.length - MAX_VISIBLE_TASKS) + " more"}
          </text>
        </Show>
      </box>
    </Show>
  )
}
