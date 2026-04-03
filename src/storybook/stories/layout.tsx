/**
 * Stories for layout components (HeaderBar, StatusBar, ContextualTips, InputArea, ConversationView).
 */

import type { Story } from "../types"
import { HeaderBar } from "../../tui/components/header-bar"
import { StatusBar } from "../../tui/components/status-bar"
import { ContextualTips } from "../../tui/components/tips"
import { InputArea } from "../../tui/components/input-area"
import { BlockView } from "../../tui/components/block-view"
import { type ViewLevel } from "../../tui/components/tool-view"
import { useMessages } from "../../tui/context/messages"

/** Helper: renders blocks from messages context using BlockView */
function ConversationBlocks(props: { viewLevel: ViewLevel }) {
  const { state } = useMessages()
  return (
    <box flexDirection="column">
      {state.blocks.map((block, i) => (
        <BlockView
          block={block}
          viewLevel={props.viewLevel}
          prevType={i > 0 ? state.blocks[i - 1]?.type : undefined}
          showThinking={props.viewLevel !== "collapsed"}
        />
      ))}
    </box>
  )
}
import { idleSession, runningSession, conversationMessages } from "../fixtures/state"
import {
  userBlock,
  assistantBlock,
  toolBlock,
  systemBlock,
  shellBlock,
} from "../fixtures/blocks"

export const layoutStories: Story[] = [
  {
    id: "header-bar",
    title: "HeaderBar",
    description: "Logo, model info, and project path",
    category: "Layout",
    context: {
      session: idleSession(),
    },
    render: () => <HeaderBar />,
  },
  {
    id: "status-bar-idle",
    title: "StatusBar (idle)",
    description: "Status bar in idle state with cost and context info",
    category: "Layout",
    context: {
      session: idleSession(),
    },
    render: () => <StatusBar />,
  },
  {
    id: "status-bar-running",
    title: "StatusBar (running)",
    description: "Status bar during active agent turn",
    category: "Layout",
    context: {
      session: runningSession(),
    },
    render: () => <StatusBar />,
  },
  {
    id: "status-bar-hint",
    title: "StatusBar (with hint)",
    description: "Status bar with permission mode hint",
    category: "Layout",
    context: {
      session: idleSession(),
    },
    render: () => <StatusBar hint="Shift+Tab to cycle permission mode" />,
  },
  {
    id: "status-bar-high-context",
    title: "StatusBar (high ctx%)",
    description: "Status bar near context window limit",
    category: "Layout",
    context: {
      session: idleSession({
        lastTurnInputTokens: 170_000,
        cost: {
          inputTokens: 170_000,
          outputTokens: 45_000,
          cacheReadTokens: 80_000,
          cacheWriteTokens: 10_000,
          totalCostUsd: 0.285,
        },
        turnNumber: 12,
      }),
    },
    render: () => <StatusBar />,
  },
  {
    id: "tips-idle-first-turn",
    title: "ContextualTips (first turn)",
    description: "Tips shown on first turn (basic instruction)",
    category: "Layout",
    context: {
      session: idleSession({ turnNumber: 0 }),
    },
    render: () => <ContextualTips />,
  },
  {
    id: "tips-idle-later-turn",
    title: "ContextualTips (later turn)",
    description: "Tips shown after first turn (advanced hints)",
    category: "Layout",
    context: {
      session: idleSession({ turnNumber: 3 }),
    },
    render: () => <ContextualTips />,
  },
  {
    id: "tips-running",
    title: "ContextualTips (running)",
    description: "Tips shown during agent execution",
    category: "Layout",
    context: {
      session: runningSession(),
    },
    render: () => <ContextualTips />,
  },
  {
    id: "input-area-idle",
    title: "InputArea (idle)",
    description: "Text input with prompt indicator and slash command support",
    category: "Layout",
    interactive: true,
    context: {
      session: idleSession(),
    },
    render: () => <InputArea />,
  },
  {
    id: "input-area-running",
    title: "InputArea (running)",
    description: "Input area while agent is working (messages queue)",
    category: "Layout",
    interactive: true,
    context: {
      session: runningSession(),
    },
    render: () => <InputArea />,
  },
  {
    id: "conversation-full",
    title: "Full conversation",
    description: "Multi-turn conversation with blocks, tools, and system messages",
    category: "Layout",
    context: {
      session: idleSession(),
      messages: conversationMessages([
        userBlock("Fix the authentication bug in the login flow"),
        assistantBlock("I'll investigate the authentication issue. Let me start by reading the relevant files."),
        toolBlock("Read", { file_path: "/src/auth/login.ts" }, { output: "export function login() {\n  // token validation\n}", duration: 45 }),
        toolBlock("Read", { file_path: "/src/auth/middleware.ts" }, { output: "export function authMiddleware() {\n  // check token\n}", duration: 32 }),
        toolBlock("Grep", { pattern: "AuthError", path: "/src" }, { output: "src/auth/login.ts:12:throw new AuthError('expired')", duration: 120 }),
        assistantBlock("Found the issue. The token expiry check uses `Date.now()` which returns milliseconds, but JWT `exp` is in seconds.\n\n```typescript\n// Before:\nif (token.exp < Date.now()) { ... }\n\n// After:\nif (token.exp < Math.floor(Date.now() / 1000)) { ... }\n```\n\nLet me fix it."),
        toolBlock("Edit", { file_path: "/src/auth/login.ts", old_string: "Date.now()", new_string: "Math.floor(Date.now() / 1000)" }, { output: "--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n@@ -5,7 +5,7 @@\n-  if (token.exp < Date.now()) {\n+  if (token.exp < Math.floor(Date.now() / 1000)) {", duration: 85 }),
        systemBlock("Model switched to claude-opus-4-6"),
        userBlock("Now run the tests"),
        assistantBlock("Running the test suite to verify the fix."),
        shellBlock("bun test tests/auth/", { output: "PASS tests/auth/login.test.ts\nPASS tests/auth/middleware.test.ts\n\n2 tests passed", duration: 3400 }),
        assistantBlock("All auth tests pass. The fix correctly converts `Date.now()` milliseconds to seconds for JWT `exp` comparison."),
      ]),
    },
    render: () => <ConversationBlocks viewLevel="expanded" />,
  },
  {
    id: "conversation-collapsed",
    title: "Conversation (collapsed)",
    description: "Same conversation in collapsed view level",
    category: "Layout",
    context: {
      session: idleSession(),
      messages: conversationMessages([
        userBlock("Fix the auth bug"),
        assistantBlock("Let me investigate."),
        toolBlock("Read", { file_path: "/src/auth/login.ts" }, { output: "contents...", duration: 45 }),
        toolBlock("Read", { file_path: "/src/auth/middleware.ts" }, { output: "contents...", duration: 32 }),
        toolBlock("Grep", { pattern: "AuthError" }, { output: "3 results", duration: 120 }),
        assistantBlock("Found and fixed the issue."),
        toolBlock("Edit", { file_path: "/src/auth/login.ts", old_string: "Date.now()", new_string: "Math.floor(Date.now() / 1000)" }, { duration: 85 }),
      ]),
    },
    render: () => <ConversationBlocks viewLevel="collapsed" />,
  },
]
