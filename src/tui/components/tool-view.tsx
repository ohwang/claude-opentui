/**
 * Tool Views — renders individual tool blocks and collapsed tool summaries.
 *
 * ToolBlockView: single tool invocation with status, output, error display.
 * ToolSummaryView: collapsed aggregation of consecutive tool blocks.
 */

import { createSignal, createEffect, createMemo, onCleanup, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { Block } from "../../protocol/types"
import { colors } from "../theme/tokens"
import { syntaxStyle } from "../theme/syntax"

export type ViewLevel = "collapsed" | "expanded" | "show_all"

// ---------------------------------------------------------------------------
// ToolBlockView — renders a single tool block
// ---------------------------------------------------------------------------

/** User-initiated cancellation messages that shouldn't render as errors */
export function isUserDecline(error: string): boolean {
  return error.includes("User declined to answer") || error.includes("Interrupted by user")
}

/** Detect whether tool output contains a unified diff */
function isDiffOutput(tool: string, output: string): boolean {
  if (tool === "Edit" || tool === "Write") {
    return output.includes("--- ") && output.includes("+++ ") && output.includes("@@")
  }
  return false
}

/** Extract a filetype hint from a file path for syntax highlighting */
function filetypeFromPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined
  const dot = filePath.lastIndexOf(".")
  if (dot === -1) return undefined
  const ext = filePath.slice(dot + 1).toLowerCase()
  // Map common extensions to tree-sitter language names
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", go: "go", rb: "ruby",
    java: "java", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    css: "css", html: "html", json: "json", yaml: "yaml", yml: "yaml",
    md: "markdown", sh: "bash", bash: "bash", zsh: "bash",
    toml: "toml", zig: "zig", swift: "swift", kt: "kotlin",
  }
  return map[ext] ?? ext
}

/** Threshold in seconds before showing a critical "may be stuck" warning */
export const TOOL_CRITICAL_THRESHOLD = 300 // 5 minutes

export type ToolBlock = Extract<Block, { type: "tool" }>

export function ToolBlockView(props: { block: Extract<Block, { type: "tool" }>; viewLevel: ViewLevel }) {
  const b = () => props.block

  // Elapsed time signal for running tools — updates every second
  const [elapsed, setElapsed] = createSignal(0)
  let elapsedTimer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (b().status === "running") {
      // Start ticking
      setElapsed(Math.floor((Date.now() - b().startTime) / 1000))
      elapsedTimer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - b().startTime) / 1000))
      }, 1000)
    } else {
      // Tool finished — clear timer
      if (elapsedTimer) {
        clearInterval(elapsedTimer)
        elapsedTimer = undefined
      }
    }
  })
  onCleanup(() => {
    if (elapsedTimer) clearInterval(elapsedTimer)
  })

  /** Primary arg for the tool invocation display: ToolName(arg) */
  const primaryArg = createMemo(() => {
    const inp = b().input as Record<string, unknown> | null
    if (!inp) return ""
    if (inp.file_path) return String(inp.file_path)
    if (inp.command) {
      const cmd = String(inp.command)
      return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd
    }
    if (inp.pattern) {
      const p = String(inp.pattern)
      const path = inp.path ? ` in ${inp.path}` : ""
      const full = p + path
      return full.length > 80 ? full.slice(0, 77) + "..." : full
    }
    if (inp.description) {
      const d = String(inp.description)
      return d.length > 80 ? d.slice(0, 77) + "..." : d
    }
    return ""
  })

  /** Brief result summary for the ⎿ line */
  const resultSummary = createMemo(() => {
    if (b().status === "running") return ""
    if (b().error) return ""
    const out = b().output ?? ""
    if (!out) return ""

    // Generate summary based on tool type
    switch (b().tool) {
      case "Read": {
        const lines = out.split("\n").length
        return `Read ${lines} line${lines === 1 ? "" : "s"}`
      }
      case "Write":
        return `Wrote to ${primaryArg()}`
      case "Edit":
        return `Edited ${primaryArg()}`
      case "Bash": {
        // Show first line of output, truncated
        const firstLine = out.split("\n")[0] ?? ""
        return firstLine.length > 100 ? firstLine.slice(0, 97) + "..." : firstLine
      }
      case "Glob":
      case "Grep": {
        const lines = out.trim().split("\n").filter(l => l.trim()).length
        return `${lines} result${lines === 1 ? "" : "s"}`
      }
      default:
        return out.length > 100 ? out.slice(0, 97) + "..." : out.split("\n")[0] ?? ""
    }
  })

  return (
    <box flexDirection="column">
      {/* Invocation line: ⏺ ToolName(arg) */}
      <box flexDirection="row">
        <text fg={colors.accent.primary}>{"\u23FA "}</text>
        <text fg="white">{b().tool}</text>
        <Show when={primaryArg()}>
          <text fg="gray">{"(" + primaryArg() + ")"}</text>
        </Show>
        {/* Duration for completed tools (expanded/show_all views) */}
        <Show when={b().status !== "running" && props.viewLevel !== "collapsed" && b().duration !== undefined && b().duration! >= 1000}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {" " + (b().duration! < 60000 ? `${Math.round(b().duration! / 1000)}s` : `${Math.floor(b().duration! / 60000)}m ${Math.round((b().duration! % 60000) / 1000)}s`)}
          </text>
        </Show>
      </box>
      {/* Critical warning — only shown after 5 minutes (streaming spinner handles normal elapsed display) */}
      <Show when={b().status === "running" && elapsed() >= TOOL_CRITICAL_THRESHOLD}>
        <box paddingLeft={2}>
          <text fg={colors.status.error} attributes={TextAttributes.DIM}>
            {"\u23BF  Tool may be stuck. Press Ctrl+C to interrupt."}
          </text>
        </box>
      </Show>
      {/* Result line: ⎿  summary */}
      <Show when={props.viewLevel !== "collapsed" && resultSummary()}>
        <box paddingLeft={2}>
          <text fg="gray" attributes={TextAttributes.DIM}>
            {"\u23BF  " + resultSummary()}
          </text>
        </box>
      </Show>
      {/* Full output (show_all mode) */}
      <Show when={props.viewLevel === "show_all" && b().output}>
        <box paddingLeft={4}>
          <Show
            when={isDiffOutput(b().tool, b().output ?? "")}
            fallback={
              <text fg="gray" attributes={TextAttributes.DIM}>
                {b().output}
              </text>
            }
          >
            <diff
              diff={b().output ?? ""}
              view="unified"
              syntaxStyle={syntaxStyle}
              filetype={filetypeFromPath((b().input as Record<string, unknown> | null)?.file_path as string | undefined)}
              addedSignColor={colors.diff.added}
              removedSignColor={colors.diff.removed}
              addedBg={colors.diff.addedBg}
              removedBg={colors.diff.removedBg}
              fg={colors.text.primary}
            />
          </Show>
        </box>
      </Show>
      {/* Error display — prominent bordered box so failures are hard to miss */}
      <Show when={b().error && !isUserDecline(b().error!)}>
        <box paddingLeft={2} paddingTop={1}>
          <box flexDirection="row" borderStyle="single" borderColor="red" paddingLeft={1} paddingRight={1}>
            <text fg={colors.status.error} attributes={TextAttributes.BOLD}>
              {"\u2717 " + (b().error!.split("\n")[0]!.length > 100
                ? b().error!.split("\n")[0]!.slice(0, 97) + "..."
                : b().error!.split("\n")[0]!)}
            </text>
          </box>
        </box>
      </Show>
      {/* User-initiated decline — subtle dim text instead of red error box */}
      <Show when={b().error && isUserDecline(b().error!)}>
        <box paddingLeft={2}>
          <text fg={colors.text.muted} attributes={TextAttributes.DIM}>
            {"\u21B3 " + b().error!.split("\n")[0]}
          </text>
        </box>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Tool summary — collapsed view aggregation (matches Claude Code)
// ---------------------------------------------------------------------------

/** Human-readable tool summary text */
function toolSummaryText(toolName: string, count: number): string {
  const s = count === 1 ? "" : "s"
  switch (toolName) {
    case "Read": return `Read ${count} file${s}`
    case "Edit": return `Edited ${count} file${s}`
    case "Write": return `Wrote ${count} file${s}`
    case "Bash": return `Ran ${count} command${s}`
    case "Glob": case "Grep": return `Searched ${count} pattern${s}`
    case "Agent": return `Spawned ${count} agent${s}`
    default: return `${toolName} (${count})`
  }
}

/** Format elapsed seconds as a human-readable string */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** Collapsed tool summary view — "Running Bash... (5s), Read 2 files (ctrl+o to expand)" */
export function ToolSummaryView(props: { tools: ToolBlock[] }) {
  // Tick signal for running tool elapsed time — updates every second
  const [tick, setTick] = createSignal(Date.now())
  const hasRunning = createMemo(() => props.tools.some(t => t.status === "running"))
  let tickTimer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (hasRunning()) {
      if (!tickTimer) {
        tickTimer = setInterval(() => setTick(Date.now()), 1000)
      }
    } else {
      if (tickTimer) {
        clearInterval(tickTimer)
        tickTimer = undefined
      }
    }
  })
  onCleanup(() => { if (tickTimer) clearInterval(tickTimer) })

  const summaryData = createMemo(() => {
    const now = tick() // subscribe to tick for reactivity
    const completed: Record<string, number> = {}
    const running: Array<{ tool: string; elapsed: number }> = []
    const errorTools: Array<{ tool: string; error: string }> = []

    for (const tool of props.tools) {
      if (tool.status === "running") {
        running.push({ tool: tool.tool, elapsed: Math.floor((now - tool.startTime) / 1000) })
      } else if (tool.status === "error" || tool.error) {
        const errMsg = tool.error ?? "unknown error"
        const firstLine = errMsg.split("\n")[0] ?? errMsg
        const truncated = firstLine.length > 50 ? firstLine.slice(0, 47) + "..." : firstLine
        errorTools.push({ tool: tool.tool, error: truncated })
      } else {
        completed[tool.tool] = (completed[tool.tool] ?? 0) + 1
      }
    }

    const normalParts: string[] = []
    for (const { tool, elapsed } of running) {
      normalParts.push(`Running ${tool}... (${formatElapsed(elapsed)})`)
    }
    for (const [name, count] of Object.entries(completed)) {
      normalParts.push(toolSummaryText(name, count))
    }

    return {
      normalText: normalParts.join(", "),
      errorText: errorTools.map(({ tool, error }) => `${tool} failed (${error})`).join(", "),
      hasErrors: errorTools.length > 0,
    }
  })

  return (
    <box paddingLeft={2} marginTop={1} flexDirection="row">
      <Show when={summaryData().normalText}>
        <text fg={colors.text.secondary} attributes={TextAttributes.DIM}>
          {summaryData().normalText + (summaryData().hasErrors ? ", " : "")}
        </text>
      </Show>
      <Show when={summaryData().hasErrors}>
        <text fg={colors.status.error}>{summaryData().errorText}</text>
      </Show>
      <text fg={colors.text.secondary} attributes={TextAttributes.DIM}>
        {" (ctrl+o to expand)"}
      </text>
    </box>
  )
}

/** Render item: either a block or a tool summary */
export type RenderItem =
  | { kind: "block"; block: Block }
  | { kind: "tool-summary"; tools: ToolBlock[] }

/** Group consecutive tool blocks into summaries when in collapsed view */
export function groupBlocksForRendering(blocks: Block[], viewLevel: ViewLevel): RenderItem[] {
  if (viewLevel !== "collapsed") {
    return blocks.map(b => ({ kind: "block" as const, block: b }))
  }

  const items: RenderItem[] = []
  let toolGroup: ToolBlock[] = []

  for (const block of blocks) {
    if (block.type === "tool") {
      toolGroup.push(block as ToolBlock)
    } else {
      if (toolGroup.length > 0) {
        items.push({ kind: "tool-summary", tools: [...toolGroup] })
        toolGroup = []
      }
      items.push({ kind: "block", block })
    }
  }

  if (toolGroup.length > 0) {
    items.push({ kind: "tool-summary", tools: [...toolGroup] })
  }

  return items
}
