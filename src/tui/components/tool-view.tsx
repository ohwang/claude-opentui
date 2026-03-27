/**
 * Tool View — Three-level view system
 *
 * Level 1 (collapsed): Natural language summary
 *   "Read 2 files, ran 1 command (ctrl+o to expand)"
 *
 * Level 2 (expanded): Individual tool blocks with abbreviated output
 *   ToolName(params) + truncated output
 *
 * Level 3 (show all): Full input/output, no truncation
 *
 * Global toggle via Ctrl+O. Ctrl+E for show all.
 * Auto-resets to collapsed on new turn.
 */

import { createSignal, For, Show } from "solid-js"
import type { ToolResult, ActiveTool } from "../../protocol/types"

type ViewLevel = "collapsed" | "expanded" | "show_all"

export function ToolView(props: {
  completedTools: ToolResult[]
  activeTools: [string, ActiveTool][]
  viewLevel?: ViewLevel
}) {
  const level = () => props.viewLevel ?? "collapsed"

  return (
    <Show when={props.completedTools.length > 0 || props.activeTools.length > 0}>
      <box flexDirection="column">
        <Show when={level() === "collapsed"}>
          <ToolSummary
            completed={props.completedTools}
            active={props.activeTools}
          />
        </Show>
        <Show when={level() === "expanded" || level() === "show_all"}>
          <For each={props.completedTools}>
            {(tool) => (
              <ToolBlock
                tool={tool}
                showAll={level() === "show_all"}
              />
            )}
          </For>
          <For each={props.activeTools}>
            {([id, tool]) => <ActiveToolBlock tool={tool} />}
          </For>
        </Show>
      </box>
    </Show>
  )
}

function ToolSummary(props: {
  completed: ToolResult[]
  active: [string, ActiveTool][]
}) {
  const summary = () => {
    const parts: string[] = []

    // Group completed tools by name, with context
    const groups = new Map<string, ToolResult[]>()
    for (const t of props.completed) {
      const list = groups.get(t.tool) ?? []
      list.push(t)
      groups.set(t.tool, list)
    }

    for (const [name, tools] of groups) {
      const verb = toolVerb(name)
      if (tools.length === 1) {
        const detail = toolDetail(tools[0])
        parts.push(detail ? `${verb} ${detail}` : `${verb} 1 item`)
      } else {
        parts.push(`${verb} ${tools.length} items`)
      }
    }

    // Active tools
    if (props.active.length > 0) {
      parts.push(
        `${props.active.length} tool${props.active.length > 1 ? "s" : ""} running`,
      )
    }

    return parts.join(", ")
  }

  return (
    <box>
      <text color="gray">
        {"─ "}{summary()}{" (ctrl+o to expand)"}
      </text>
    </box>
  )
}

/** Detect if output looks like a unified diff */
function isDiffOutput(tool: ToolResult): boolean {
  if (tool.tool !== "Edit" && tool.tool !== "Write") return false
  const output = tool.output
  // Unified diffs start with --- or contain @@ hunks
  return (
    output.includes("@@") &&
    (output.includes("---") || output.includes("+++"))
  )
}

/** Extract file extension from tool input for syntax highlighting */
function fileExtension(tool: ToolResult): string | undefined {
  const input = tool.input as Record<string, unknown>
  const path = input?.file_path as string
  if (!path) return undefined
  const parts = path.split(".")
  return parts.length > 1 ? parts[parts.length - 1] : undefined
}

function ToolBlock(props: { tool: ToolResult; showAll: boolean }) {
  const truncatedOutput = () => {
    if (props.showAll) return props.tool.output
    const lines = props.tool.output.split("\n")
    if (lines.length <= 5) return props.tool.output
    return lines.slice(0, 5).join("\n") + `\n... (${lines.length - 5} more lines)`
  }

  const inputStr = () => {
    try {
      const s = JSON.stringify(props.tool.input)
      if (!props.showAll && s.length > 80) return s.slice(0, 77) + "..."
      return s
    } catch {
      return String(props.tool.input)
    }
  }

  const showDiff = () => isDiffOutput(props.tool)

  return (
    <box flexDirection="column" paddingLeft={1}>
      <text color="cyan" bold>
        {props.tool.tool}({inputStr()})
      </text>
      <Show when={props.tool.error}>
        <text color="red">{"✗ "}{props.tool.error}</text>
      </Show>
      <Show when={props.tool.output && !props.tool.error}>
        <Show when={showDiff()} fallback={<code content={truncatedOutput()} />}>
          <diff
            diff={props.showAll ? props.tool.output : truncatedOutput()}
            view="unified"
            filetype={fileExtension(props.tool)}
          />
        </Show>
      </Show>
    </box>
  )
}

function ActiveToolBlock(props: { tool: ActiveTool }) {
  return (
    <box flexDirection="row" paddingLeft={1}>
      <text color="yellow">
        {"⟳ "}{props.tool.tool}
      </text>
      <text color="gray">
        {" "}({Math.round((Date.now() - props.tool.startTime) / 1000)}s)
      </text>
    </box>
  )
}

/** Extract a short detail from tool input for collapsed summary */
function toolDetail(tool: ToolResult): string {
  const input = tool.input as Record<string, unknown>
  if (!input) return ""

  // Show file path for file operations
  if (input.file_path) {
    const path = String(input.file_path)
    // Show just the filename if path is long
    const parts = path.split("/")
    return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path
  }

  // Show command for Bash
  if (input.command) {
    const cmd = String(input.command)
    return cmd.length > 40 ? cmd.slice(0, 37) + "..." : cmd
  }

  // Show pattern for search
  if (input.pattern) return `"${input.pattern}"`

  return ""
}

/** Map tool name to a natural language past-tense verb */
function toolVerb(toolName: string): string {
  const verbs: Record<string, string> = {
    Read: "Read",
    Write: "Wrote",
    Edit: "Edited",
    Bash: "Ran",
    Grep: "Searched",
    Glob: "Found",
    WebFetch: "Fetched",
    WebSearch: "Searched",
    NotebookEdit: "Edited",
    Task: "Spawned",
  }
  return verbs[toolName] ?? `Used ${toolName} on`
}
