/**
 * Stories for tool view components.
 */

import type { Story } from "../types"
import { ToolBlockView, type ViewLevel } from "../../tui/components/tool-view"
import { CollapsedToolGroup } from "../../tui/components/collapsed-tool-group"
import { toolBlock } from "../fixtures/blocks"
import type { ToolGroup } from "../../tui/utils/tool-grouping"
import type { Block } from "../../protocol/types"

type ToolBlock = Extract<Block, { type: "tool" }>

function makeToolGroup(blocks: ToolBlock[]): ToolGroup {
  const toolCounts: Record<string, number> = {}
  for (const b of blocks) {
    toolCounts[b.tool] = (toolCounts[b.tool] ?? 0) + 1
  }
  return {
    type: "group",
    blocks,
    totalDuration: blocks.reduce((sum, b) => sum + (b.duration ?? 0), 0),
    toolCounts,
    status: blocks.some((b) => b.status === "running") ? "running" : blocks.some((b) => b.status === "error") ? "error" : "done",
  }
}

export const toolViewsStories: Story[] = [
  {
    id: "tool-read-collapsed",
    title: "Read (collapsed)",
    description: "File read tool in collapsed view",
    category: "Tool Views",
    render: () => (
      <ToolBlockView
        block={toolBlock("Read", { file_path: "/src/auth/login.ts" }, { output: "export function login() {\n  // ...\n}", duration: 45 })}
        viewLevel="collapsed"
      />
    ),
  },
  {
    id: "tool-read-expanded",
    title: "Read (expanded)",
    description: "File read tool in expanded view with output",
    category: "Tool Views",
    render: () => (
      <ToolBlockView
        block={toolBlock("Read", { file_path: "/src/auth/login.ts" }, { output: "import { jwt } from './jwt'\n\nexport async function login(email: string, password: string) {\n  const user = await findUser(email)\n  if (!user || !verify(password, user.hash)) {\n    throw new AuthError('Invalid credentials')\n  }\n  return jwt.sign({ sub: user.id, exp: Date.now() / 1000 + 3600 })\n}", duration: 45 })}
        viewLevel="expanded"
      />
    ),
  },
  {
    id: "tool-edit-collapsed",
    title: "Edit (collapsed)",
    description: "File edit tool in collapsed view",
    category: "Tool Views",
    render: () => (
      <ToolBlockView
        block={toolBlock("Edit", { file_path: "/src/auth/login.ts", old_string: "Date.now()", new_string: "Math.floor(Date.now() / 1000)" }, { output: "--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n@@ -5,7 +5,7 @@\n-  return jwt.sign({ sub: user.id, exp: Date.now() + 3600 })\n+  return jwt.sign({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })", duration: 120 })}
        viewLevel="collapsed"
      />
    ),
  },
  {
    id: "tool-bash-running",
    title: "Bash (running)",
    description: "Running bash command",
    category: "Tool Views",
    render: () => (
      <ToolBlockView
        block={toolBlock("Bash", { command: "npm test -- --watch" }, { status: "running" })}
        viewLevel="expanded"
      />
    ),
  },
  {
    id: "tool-bash-error",
    title: "Bash (error)",
    description: "Failed bash command with error output",
    category: "Tool Views",
    render: () => (
      <ToolBlockView
        block={toolBlock("Bash", { command: "rm -rf /protected" }, { status: "error", error: "Permission denied", duration: 50 })}
        viewLevel="expanded"
      />
    ),
  },
  {
    id: "tool-grep-expanded",
    title: "Grep (expanded)",
    description: "Grep search results expanded",
    category: "Tool Views",
    render: () => (
      <ToolBlockView
        block={toolBlock("Grep", { pattern: "AuthError", path: "/src" }, { output: "src/auth/login.ts:12:    throw new AuthError('Invalid credentials')\nsrc/auth/refresh.ts:8:    throw new AuthError('Token expired')\nsrc/middleware/auth.ts:25:    throw new AuthError('Missing token')", duration: 200 })}
        viewLevel="expanded"
      />
    ),
  },
  {
    id: "collapsed-tool-group",
    title: "CollapsedToolGroup",
    description: "Grouped consecutive tool uses in a single line",
    category: "Tool Views",
    render: () => (
      <CollapsedToolGroup
        group={makeToolGroup([
          toolBlock("Read", { file_path: "/src/auth/login.ts" }, { duration: 45 }),
          toolBlock("Read", { file_path: "/src/auth/refresh.ts" }, { duration: 30 }),
          toolBlock("Grep", { pattern: "AuthError" }, { duration: 200 }),
          toolBlock("Glob", { pattern: "src/**/*.test.ts" }, { duration: 15 }),
        ])}
      />
    ),
  },
  {
    id: "collapsed-tool-group-running",
    title: "CollapsedToolGroup (running)",
    description: "Tool group with active execution",
    category: "Tool Views",
    render: () => (
      <CollapsedToolGroup
        group={makeToolGroup([
          toolBlock("Read", { file_path: "/src/auth/login.ts" }, { duration: 45 }),
          toolBlock("Bash", { command: "npm test" }, { status: "running" }),
        ])}
      />
    ),
  },
]
