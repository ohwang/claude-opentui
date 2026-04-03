/**
 * Stories for composite components (TaskView, TurnSummary, ToastDisplay).
 */

import type { Story } from "../types"
import { TaskView } from "../../tui/components/task-view"
import { TurnSummary } from "../../tui/components/turn-summary"
import { ToastDisplay } from "../../tui/components/toast"
import type { TaskInfo, TurnFileChange } from "../../protocol/types"

function makeTasks(entries: { id: string; desc: string; status: "running" | "completed"; output?: string }[]): [string, TaskInfo][] {
  return entries.map((e) => [
    e.id,
    {
      taskId: e.id,
      description: e.desc,
      output: e.output ?? "",
      status: e.status,
      startTime: Date.now() - 30_000,
    },
  ])
}

export const compositeStories: Story[] = [
  {
    id: "task-view-running",
    title: "TaskView (running)",
    description: "Active subagent tasks with blinking dots",
    category: "Composite",
    render: () => (
      <TaskView
        tasks={makeTasks([
          { id: "t1", desc: "Searching for authentication files", status: "running" },
          { id: "t2", desc: "Analyzing test coverage", status: "completed", output: "Found 12 test files, 85% coverage" },
          { id: "t3", desc: "Reviewing middleware chain", status: "running" },
        ])}
      />
    ),
  },
  {
    id: "task-view-completed",
    title: "TaskView (all done)",
    description: "All subagent tasks completed",
    category: "Composite",
    render: () => (
      <TaskView
        tasks={makeTasks([
          { id: "t1", desc: "Searching for authentication files", status: "completed", output: "Found 3 auth files" },
          { id: "t2", desc: "Analyzing test coverage", status: "completed", output: "85% coverage, 2 untested paths" },
        ])}
      />
    ),
  },
  {
    id: "turn-summary",
    title: "TurnSummary",
    description: "File changes from the last turn",
    category: "Composite",
    render: () => {
      const files: TurnFileChange[] = [
        { path: "src/auth/login.ts", action: "edit", tool: "Edit" },
        { path: "src/auth/refresh.ts", action: "create", tool: "Write" },
        { path: "src/middleware/auth.ts", action: "edit", tool: "Edit" },
        { path: "tests/auth.test.ts", action: "read", tool: "Read" },
      ]
      return <TurnSummary files={files} />
    },
  },
  {
    id: "toast-display",
    title: "ToastDisplay",
    description: "Toast notification area (trigger via toast.info/success/warn/error)",
    category: "Composite",
    render: () => (
      <box flexDirection="column">
        <text fg="#a8a8a8">Toast area (toasts are triggered programmatically via toast.info/success/warn/error)</text>
        <box height={1} />
        <ToastDisplay />
      </box>
    ),
  },
]
