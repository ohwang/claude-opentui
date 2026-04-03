/**
 * Stories for dialog components (permission, elicitation, history search).
 */

import type { Story } from "../types"
import { PermissionDialog } from "../../tui/components/permission-dialog"
import { ElicitationDialog } from "../../tui/components/elicitation"
import { HistorySearchModal } from "../../tui/components/history-search"
import { idleSession, withPermission, withElicitation } from "../fixtures/state"

const sampleHistory = [
  "Fix the authentication bug in login.ts",
  "Add rate limiting to the API endpoints",
  "Explain how the reducer works",
  "/model claude-opus-4-6",
  "Refactor the permission dialog to use the new design system",
  "Write tests for the event batcher",
  "What files handle session management?",
  "/compact",
  "Add image paste support to the input area",
  "Debug why the scrollbox doesn't auto-scroll",
  "Update the README with the new CLI flags",
  "Fix the TypeScript strict mode errors in tests/",
  "/help",
  "How does the tool grouping algorithm work?",
  "Add Ctrl+R history search modal",
]

export const dialogsStories: Story[] = [
  {
    id: "permission-dialog-bash",
    title: "PermissionDialog (Bash)",
    description: "Bash command permission request",
    category: "Dialogs",
    interactive: true,
    context: {
      session: idleSession({ sessionState: "WAITING_FOR_PERM" }),
      permissions: withPermission({
        type: "permission_request",
        id: "perm-1",
        tool: "Bash",
        input: { command: "rm -rf node_modules && npm install" },
        displayName: "Run command",
        title: "Claude wants to run a shell command",
      }),
    },
    render: () => <PermissionDialog />,
  },
  {
    id: "permission-dialog-edit",
    title: "PermissionDialog (Edit)",
    description: "File edit permission request with diff preview",
    category: "Dialogs",
    interactive: true,
    context: {
      session: idleSession({ sessionState: "WAITING_FOR_PERM" }),
      permissions: withPermission({
        type: "permission_request",
        id: "perm-2",
        tool: "Edit",
        input: {
          file_path: "/src/auth/login.ts",
          old_string: "Date.now()",
          new_string: "Math.floor(Date.now() / 1000)",
        },
        displayName: "Edit file",
        title: "Claude wants to edit a file",
      }),
    },
    render: () => <PermissionDialog />,
  },
  {
    id: "elicitation-dialog",
    title: "ElicitationDialog",
    description: "Question with predefined options",
    category: "Dialogs",
    interactive: true,
    context: {
      session: idleSession({ sessionState: "WAITING_FOR_ELIC" }),
      permissions: withElicitation({
        type: "elicitation_request",
        id: "elic-1",
        questions: [
          {
            question: "Which authentication method should I implement?",
            options: [
              { label: "JWT tokens", description: "Stateless, scalable" },
              { label: "Session cookies", description: "Simple, server-side" },
              { label: "OAuth 2.0", description: "Third-party auth delegation" },
            ],
            allowFreeText: true,
          },
        ],
      }),
    },
    render: () => <ElicitationDialog />,
  },
  {
    id: "elicitation-multi-select",
    title: "ElicitationDialog (multi)",
    description: "Multi-select question with many options",
    category: "Dialogs",
    interactive: true,
    context: {
      session: idleSession({ sessionState: "WAITING_FOR_ELIC" }),
      permissions: withElicitation({
        type: "elicitation_request",
        id: "elic-2",
        questions: [
          {
            question: "Which files should I modify?",
            header: "Files",
            options: [
              { label: "src/auth/login.ts", description: "Login handler" },
              { label: "src/auth/refresh.ts", description: "Token refresh" },
              { label: "src/middleware/auth.ts", description: "Auth middleware" },
              { label: "tests/auth.test.ts", description: "Auth tests" },
            ],
            multiSelect: true,
          },
        ],
      }),
    },
    render: () => <ElicitationDialog />,
  },
  {
    id: "history-search",
    title: "HistorySearchModal",
    description: "Ctrl+R fuzzy history search with 15 entries",
    category: "Dialogs",
    interactive: true,
    render: () => (
      <HistorySearchModal
        history={sampleHistory}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ),
  },
  {
    id: "history-search-empty",
    title: "HistorySearch (empty)",
    description: "History search with no prior entries",
    category: "Dialogs",
    interactive: true,
    render: () => (
      <HistorySearchModal
        history={[]}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ),
  },
]
