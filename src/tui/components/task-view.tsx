/**
 * Task View — Subagent/background task display
 *
 * Shows active and completed tasks as a grouped tree.
 * Running tasks show spinner, completed show checkmark.
 * Collapsed by default, toggles with Ctrl+T.
 */

import { createSignal, onCleanup, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { TaskInfo } from "../../protocol/types"
import { colors } from "../theme/tokens"

const MAX_VISIBLE_TASKS = 10

export function TaskView(props: { tasks: [string, TaskInfo][] }) {
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((t) => t + 1), 1000)
  onCleanup(() => clearInterval(timer))

  const hasAny = () => props.tasks.length > 0
  const runningCount = () => props.tasks.filter(([, t]) => t.status === "running").length
  const completedCount = () => props.tasks.filter(([, t]) => t.status === "completed").length

  const header = () => {
    if (runningCount() > 0 && completedCount() > 0) {
      return `Running ${runningCount()} agent${runningCount() > 1 ? "s" : ""}... (${completedCount()} finished)`
    }
    if (runningCount() > 0) {
      return `Running ${runningCount()} agent${runningCount() > 1 ? "s" : ""}...`
    }
    return `${completedCount()} agent${completedCount() > 1 ? "s" : ""} finished`
  }

  return (
    <Show when={hasAny()}>
      <box flexDirection="column" paddingTop={1}>
        <text fg="magenta" attributes={TextAttributes.BOLD}>
          {header()}
        </text>
        <For each={props.tasks.slice(0, MAX_VISIBLE_TASKS)}>
          {([id, task], index) => {
            const isLast = () => index() === Math.min(props.tasks.length, MAX_VISIBLE_TASKS) - 1
            const prefix = () => (isLast() ? "└─" : "├─")
            const icon = () => (task.status === "running" ? "⟳" : "✓")
            const color = () => (task.status === "running" ? "yellow" : "green")

            return (
              <box flexDirection="column">
                <box flexDirection="row" paddingLeft={1}>
                  <text fg="gray">{prefix()} </text>
                  <text fg={color()}>{icon()} </text>
                  <text fg="white">{task.description}</text>
                  <Show when={task.status === "running"}>
                    <text fg="gray">
                      {" "}({(() => { tick(); return Math.max(0, Math.round((Date.now() - task.startTime) / 1000)) })()}s)
                    </text>
                  </Show>
                </box>
                <Show when={task.status === "completed" && task.output}>
                  <box paddingLeft={5}>
                    <text fg="gray" attributes={TextAttributes.DIM}>
                      {task.output.length > 80
                        ? task.output.slice(0, 77) + "..."
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
            {"  ... and " + (props.tasks.length - MAX_VISIBLE_TASKS) + " more background tasks"}
          </text>
        </Show>
      </box>
    </Show>
  )
}
