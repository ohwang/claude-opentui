/**
 * Stories for composite components (TaskView, TurnSummary, ToastDisplay, DiagnosticsPanel).
 */

import type { Story } from "../types"
import { TaskView } from "../../tui/components/task-view"
import { TurnSummary } from "../../tui/components/turn-summary"
import { ToastDisplay } from "../../tui/components/toast"
import { DiagnosticsPanel } from "../../tui/components/diagnostics"
import { idleSession, conversationMessages } from "../fixtures/state"
import { userBlock, assistantBlock, toolBlock } from "../fixtures/blocks"
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
  {
    id: "task-view-many",
    title: "TaskView (many)",
    description: "Many subagent tasks (tests overflow handling)",
    category: "Composite",
    render: () => (
      <TaskView
        tasks={makeTasks([
          { id: "t1", desc: "Reading source files", status: "completed", output: "Done" },
          { id: "t2", desc: "Analyzing dependencies", status: "completed", output: "Done" },
          { id: "t3", desc: "Running linter", status: "completed", output: "0 errors" },
          { id: "t4", desc: "Running type checker", status: "completed", output: "0 errors" },
          { id: "t5", desc: "Running unit tests", status: "running" },
          { id: "t6", desc: "Running integration tests", status: "running" },
          { id: "t7", desc: "Building documentation", status: "running" },
          { id: "t8", desc: "Checking code coverage", status: "running" },
          { id: "t9", desc: "Security audit", status: "running" },
          { id: "t10", desc: "Performance benchmarks", status: "running" },
          { id: "t11", desc: "E2E test suite", status: "running" },
          { id: "t12", desc: "Deploy verification", status: "running" },
        ])}
      />
    ),
  },
  {
    id: "diagnostics-panel",
    title: "DiagnosticsPanel",
    description: "Full diagnostics overlay (system, session, tokens, context, git)",
    category: "Composite",
    context: {
      session: idleSession({
        turnNumber: 8,
        lastTurnInputTokens: 95_000,
        cost: {
          inputTokens: 95_000,
          outputTokens: 32_000,
          cacheReadTokens: 60_000,
          cacheWriteTokens: 8_000,
          totalCostUsd: 0.178,
        },
      }),
      messages: conversationMessages([
        userBlock("test"),
        assistantBlock("response"),
        toolBlock("Read", { file_path: "/src/index.ts" }, { duration: 40 }),
        toolBlock("Edit", { file_path: "/src/index.ts" }, { duration: 100 }),
        assistantBlock("Done."),
      ]),
    },
    render: () => <DiagnosticsPanel visible onClose={() => {}} />,
  },
]
