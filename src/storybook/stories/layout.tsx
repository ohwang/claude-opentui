/**
 * Stories for layout components (HeaderBar, StatusBar).
 */

import type { Story } from "../types"
import { HeaderBar } from "../../tui/components/header-bar"
import { StatusBar } from "../../tui/components/status-bar"
import { idleSession, runningSession } from "../fixtures/state"

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
]
