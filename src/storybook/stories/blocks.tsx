/**
 * Stories for block renderers (user, assistant, thinking, system, error, shell, compact, queued).
 */

import type { Story } from "../types"
import { UserBlock } from "../../tui/components/blocks/user-block"
import { AssistantBlock } from "../../tui/components/blocks/assistant-block"
import { SystemBlock } from "../../tui/components/blocks/system-block"
import { ErrorBlock } from "../../tui/components/blocks/error-block"
import { ShellBlock } from "../../tui/components/blocks/shell-block"
import { CompactBlock } from "../../tui/components/blocks/compact-block"
import { QueuedMessage } from "../../tui/components/blocks/queued-message"
import { ThinkingBlock } from "../../tui/components/thinking-block"
import {
  userBlock,
  assistantBlock,
  thinkingBlock,
  systemBlock,
  errorBlock,
  shellBlock,
  compactBlock,
} from "../fixtures/blocks"

export const blocksStories: Story[] = [
  {
    id: "user-block-simple",
    title: "UserBlock",
    description: "User message with prompt indicator",
    category: "Blocks",
    render: () => <UserBlock block={userBlock("Fix the authentication bug in the login flow")} />,
  },
  {
    id: "user-block-images",
    title: "UserBlock (images)",
    description: "User message with image attachments",
    category: "Blocks",
    render: () => (
      <UserBlock
        block={userBlock("What does this error mean?", {
          images: [
            { data: "", mediaType: "image/png" },
            { data: "", mediaType: "image/png" },
          ],
        })}
      />
    ),
  },
  {
    id: "assistant-block-simple",
    title: "AssistantBlock",
    description: "Assistant response with markdown (fade-in animation)",
    category: "Blocks",
    render: () => (
      <AssistantBlock
        block={assistantBlock(
          "I'll fix the authentication bug. The issue is in `src/auth/login.ts` where the token validation skips the expiry check.\n\n```typescript\nif (token.exp < Date.now() / 1000) {\n  throw new AuthError('Token expired')\n}\n```\n\nThis should resolve the issue.",
        )}
      />
    ),
  },
  {
    id: "assistant-block-long",
    title: "AssistantBlock (long)",
    description: "Multi-paragraph assistant response with headers and lists",
    category: "Blocks",
    render: () => (
      <AssistantBlock
        block={assistantBlock(
          "## Analysis\n\nI found three issues in the codebase:\n\n1. **Token expiry** is not validated in `login.ts`\n2. **Session storage** uses deprecated `localStorage` API\n3. **CORS headers** are missing from the auth endpoint\n\n### Recommended Fix\n\nLet me update each file:\n\n- `src/auth/login.ts` — add expiry validation\n- `src/middleware/cors.ts` — add auth endpoint to allowlist\n- `src/session/store.ts` — migrate to `SessionStorage`",
        )}
      />
    ),
  },
  {
    id: "thinking-block-collapsed",
    title: "ThinkingBlock (collapsed)",
    description: "Collapsed thinking indicator",
    category: "Blocks",
    render: () => <ThinkingBlock text="Let me analyze the code structure..." collapsed />,
  },
  {
    id: "thinking-block-expanded",
    title: "ThinkingBlock (expanded)",
    description: "Expanded thinking content with markdown",
    category: "Blocks",
    render: () => (
      <ThinkingBlock
        text="The user wants to fix an auth bug. Let me check:\n- `login.ts` handles token creation\n- `middleware.ts` validates on each request\n- The expiry field is `exp` in JWT spec\n\nI think the issue is that `Date.now()` returns milliseconds but JWT `exp` is in seconds."
      />
    ),
  },
  {
    id: "system-block-info",
    title: "SystemBlock (info)",
    description: "Informational system message",
    category: "Blocks",
    render: () => <SystemBlock block={systemBlock("Model switched to claude-opus-4-6")} />,
  },
  {
    id: "system-block-categories",
    title: "SystemBlock (all types)",
    description: "All system message categories",
    category: "Blocks",
    render: () => (
      <box flexDirection="column">
        <SystemBlock block={systemBlock("Model switched to claude-opus-4-6")} />
        <SystemBlock block={systemBlock("Turn interrupted by user")} />
        <SystemBlock block={systemBlock("Permission denied for Bash command")} />
        <SystemBlock block={systemBlock("Failed to read file: ENOENT")} />
        <SystemBlock block={systemBlock("Copied to clipboard")} />
      </box>
    ),
  },
  {
    id: "error-block",
    title: "ErrorBlock",
    description: "Bordered error display with code",
    category: "Blocks",
    render: () => <ErrorBlock block={errorBlock("stream_error", "Connection to API lost. Check your network connection and API key.")} />,
  },
  {
    id: "shell-block-done",
    title: "ShellBlock (done)",
    description: "Completed shell command with output",
    category: "Blocks",
    render: () => (
      <ShellBlock
        block={shellBlock("git status", {
          output: "On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean\n",
          status: "done",
        })}
        viewLevel="expanded"
      />
    ),
  },
  {
    id: "shell-block-running",
    title: "ShellBlock (running)",
    description: "Currently executing shell command",
    category: "Blocks",
    render: () => <ShellBlock block={shellBlock("npm test", { status: "running" })} viewLevel="collapsed" />,
  },
  {
    id: "shell-block-error",
    title: "ShellBlock (error)",
    description: "Failed shell command",
    category: "Blocks",
    render: () => (
      <ShellBlock
        block={shellBlock("cat /nonexistent", {
          output: "",
          error: "cat: /nonexistent: No such file or directory",
          exitCode: 1,
          status: "error",
        })}
        viewLevel="expanded"
      />
    ),
  },
  {
    id: "compact-block",
    title: "CompactBlock",
    description: "Compacted conversation summary",
    category: "Blocks",
    render: () => (
      <CompactBlock
        block={compactBlock(
          "Discussed authentication architecture. Decided on JWT with refresh tokens. Updated login.ts, middleware.ts, and session store.",
        )}
      />
    ),
  },
  {
    id: "queued-message",
    title: "QueuedMessage",
    description: "Queued user message (sent while agent is running)",
    category: "Blocks",
    render: () => <QueuedMessage block={userBlock("Can you also add rate limiting?")} />,
  },
  {
    id: "queued-messages-multiple",
    title: "QueuedMessage (multiple)",
    description: "Multiple queued messages stacked",
    category: "Blocks",
    render: () => (
      <box flexDirection="column">
        <QueuedMessage block={userBlock("Can you also add rate limiting?")} />
        <QueuedMessage block={userBlock("And update the tests")} />
        <QueuedMessage block={userBlock("Actually, skip the tests for now")} />
      </box>
    ),
  },
]
