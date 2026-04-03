/**
 * Stories for streaming and animation components.
 */

import type { Story } from "../types"
import { StreamingSpinner } from "../../tui/components/streaming-spinner"
import { runningSession } from "../fixtures/state"

export const streamingStories: Story[] = [
  {
    id: "spinner-thinking",
    title: "Spinner (thinking)",
    description: "Braille dot spinner in thinking state",
    category: "Streaming",
    context: { session: runningSession() },
    render: () => <StreamingSpinner label="Thinking" elapsedSeconds={5} />,
  },
  {
    id: "spinner-long-running",
    title: "Spinner (long running)",
    description: "Spinner with extended elapsed time and token count",
    category: "Streaming",
    context: { session: runningSession() },
    render: () => <StreamingSpinner label="Thinking" elapsedSeconds={349} outputTokens={8500} />,
  },
  {
    id: "spinner-tool",
    title: "Spinner (tool)",
    description: "Spinner showing active tool execution",
    category: "Streaming",
    context: { session: runningSession() },
    render: () => <StreamingSpinner label="Running Bash" elapsedSeconds={12} />,
  },
  {
    id: "streaming-text",
    title: "Streaming text",
    description: "Simulated streaming text accumulation",
    category: "Streaming",
    context: {
      session: runningSession(),
      messages: {
        blocks: [],
        streamingText: "I'll help you fix the authentication bug. Let me start by reading the relevant files to understand the current implementation...",
        streamingThinking: "",
        activeTasks: [],
        backgrounded: false,
      },
    },
    render: () => (
      <box flexDirection="column">
        <text fg="#e4e4e4">{"Streaming text preview (via messages.streamingText):"}</text>
        <box height={1} />
        <text fg="#a8a8a8">{"I'll help you fix the authentication bug. Let me start by reading the relevant files to understand the current implementation..."}</text>
      </box>
    ),
  },
]
