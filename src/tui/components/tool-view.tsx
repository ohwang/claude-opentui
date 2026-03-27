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
 *
 * Enhanced rendering:
 * - Unified diffs render via <diff> with color-coded additions/deletions
 * - Code output renders via <code> with tree-sitter syntax highlighting
 * - Falls back to plain <text> when format cannot be determined
 */

import { For, Show } from "solid-js"
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
function isDiffOutput(output: string): boolean {
  if (!output) return false
  // Unified diffs have @@ hunk headers and --- / +++ file markers
  return (
    output.includes("@@") &&
    (output.includes("---") || output.includes("+++"))
  )
}

/** Extract file extension from tool input for syntax highlighting */
function fileExtension(tool: ToolResult): string | undefined {
  const input = tool.input as Record<string, unknown>
  if (!input) return undefined
  // Check file_path (Read, Write, Edit) and pattern (Grep, Glob)
  const path = (input.file_path ?? input.path) as string | undefined
  if (!path) return undefined
  const dot = path.lastIndexOf(".")
  return dot !== -1 ? path.slice(dot + 1) : undefined
}

/**
 * Map file extension to tree-sitter filetype identifier.
 * Returns undefined for unknown extensions — caller falls back to plain text.
 */
const EXT_TO_FILETYPE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "c_sharp",
  swift: "swift",
  zig: "zig",
  lua: "lua",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  md: "markdown",
  mdx: "markdown",
  dockerfile: "dockerfile",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  r: "r",
  php: "php",
  pl: "perl",
  scala: "scala",
  vue: "vue",
  svelte: "svelte",
  tf: "hcl",
  proto: "proto",
  graphql: "graphql",
  gql: "graphql",
}

function extToFiletype(ext: string | undefined): string | undefined {
  if (!ext) return undefined
  return EXT_TO_FILETYPE[ext.toLowerCase()]
}

/** Tools whose output represents file content (candidates for syntax highlighting) */
const FILE_CONTENT_TOOLS = new Set(["Read", "NotebookRead"])

/**
 * Determine the rendering strategy for a tool's output.
 * Priority: diff > code (with known filetype) > plain text.
 */
function outputRenderMode(tool: ToolResult): {
  mode: "diff" | "code" | "text"
  filetype?: string
} {
  const output = tool.output
  if (!output) return { mode: "text" }

  // 1. Diff detection — works for any tool (Edit, Write, Bash, etc.)
  if (isDiffOutput(output)) {
    const ext = fileExtension(tool)
    return { mode: "diff", filetype: extToFiletype(ext) }
  }

  // 2. Code detection — for tools that read/produce file content
  if (FILE_CONTENT_TOOLS.has(tool.tool)) {
    const ext = fileExtension(tool)
    const ft = extToFiletype(ext)
    if (ft) return { mode: "code", filetype: ft }
  }

  // 3. Edit/Write tool output that wasn't a diff — still try syntax highlighting
  if (tool.tool === "Edit" || tool.tool === "Write") {
    const ext = fileExtension(tool)
    const ft = extToFiletype(ext)
    if (ft) return { mode: "code", filetype: ft }
  }

  return { mode: "text" }
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

  const renderMode = () => outputRenderMode(props.tool)

  return (
    <box flexDirection="column" paddingLeft={1}>
      <text color="cyan" bold>
        {props.tool.tool}({inputStr()})
      </text>
      <Show when={props.tool.error}>
        <text color="red">{"✗ "}{props.tool.error}</text>
      </Show>
      <Show when={props.tool.output && !props.tool.error}>
        <ToolOutput
          output={props.showAll ? props.tool.output : truncatedOutput()}
          renderMode={renderMode()}
        />
      </Show>
    </box>
  )
}

/** Renders tool output using the appropriate renderable based on content type */
function ToolOutput(props: {
  output: string
  renderMode: { mode: "diff" | "code" | "text"; filetype?: string }
}) {
  return (
    <Show
      when={props.renderMode.mode === "diff"}
      fallback={
        <Show
          when={props.renderMode.mode === "code"}
          fallback={<text>{props.output}</text>}
        >
          <code content={props.output} filetype={props.renderMode.filetype} />
        </Show>
      }
    >
      <diff
        diff={props.output}
        view="unified"
        filetype={props.renderMode.filetype}
      />
    </Show>
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
