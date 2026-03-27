/**
 * Task View — Subagent/background task display
 *
 * Shows active and completed tasks as a grouped tree.
 * Running tasks show spinner, completed show checkmark.
 * Collapsed by default, toggles with Ctrl+T.
 */

import { For, Show } from "solid-js"
import type { TaskInfo } from "../../protocol/types"

export function TaskView(props: { tasks: [string, TaskInfo][] }) {
  const runningTasks = () => props.tasks.filter(([, t]) => t.status === "running")
  const completedTasks = () =>
    props.tasks.filter(([, t]) => t.status === "completed")

  const hasAny = () => props.tasks.length > 0
  const runningCount = () => runningTasks().length
  const completedCount = () => completedTasks().length

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
        <text color="magenta" bold>
          {header()}
        </text>
        <For each={props.tasks}>
          {([id, task], index) => {
            const isLast = () => index() === props.tasks.length - 1
            const prefix = () => (isLast() ? "└─" : "├─")
            const icon = () => (task.status === "running" ? "⟳" : "✓")
            const color = () => (task.status === "running" ? "yellow" : "green")

            return (
              <box flexDirection="row" paddingLeft={1}>
                <text color="gray">{prefix()} </text>
                <text color={color()}>{icon()} </text>
                <text color="white">{task.description}</text>
                <Show when={task.status === "running"}>
                  <text color="gray">
                    {" "}({Math.round((Date.now() - task.startTime) / 1000)}s)
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={completedTasks().length > 0 && runningCount() === 0}>
          <For each={completedTasks()}>
            {([id, task]) => (
              <Show when={task.output}>
                <box paddingLeft={3}>
                  <text color="gray" dimmed>
                    {task.output.length > 80
                      ? task.output.slice(0, 77) + "..."
                      : task.output}
                  </text>
                </box>
              </Show>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}
