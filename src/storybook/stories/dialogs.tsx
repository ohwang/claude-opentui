/**
 * Stories for Dialogs category — permission, elicitation, history search.
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
    id: "permission-dialog",
    title: "PermissionDialog",
    description: "Inline permission prompt with approve/deny options",
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
    variants: [
      {
        label: "Bash command",
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
      },
      {
        label: "Edit file",
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
      },
    ],
  },
  {
    id: "elicitation-dialog",
    title: "ElicitationDialog",
    description: "AskUserQuestion with predefined options",
    category: "Dialogs",
    interactive: true,
    context: {
      session: idleSession({ sessionState: "WAITING_FOR_ELIC" }),
      permissions: withElicitation({
        type: "elicitation_request",
        id: "elic-1",
        questions: [{
          question: "Which authentication method should I implement?",
          options: [
            { label: "JWT tokens", description: "Stateless, scalable" },
            { label: "Session cookies", description: "Simple, server-side" },
            { label: "OAuth 2.0", description: "Third-party auth delegation" },
          ],
          allowFreeText: true,
        }],
      }),
    },
    render: () => <ElicitationDialog />,
    variants: [
      {
        label: "single select",
        context: {
          session: idleSession({ sessionState: "WAITING_FOR_ELIC" }),
          permissions: withElicitation({
            type: "elicitation_request",
            id: "elic-1",
            questions: [{
              question: "Which authentication method should I implement?",
              options: [
                { label: "JWT tokens", description: "Stateless, scalable" },
                { label: "Session cookies", description: "Simple, server-side" },
                { label: "OAuth 2.0", description: "Third-party auth delegation" },
              ],
              allowFreeText: true,
            }],
          }),
        },
      },
      {
        label: "multi select",
        context: {
          session: idleSession({ sessionState: "WAITING_FOR_ELIC" }),
          permissions: withElicitation({
            type: "elicitation_request",
            id: "elic-2",
            questions: [{
              question: "Which files should I modify?",
              header: "Files",
              options: [
                { label: "src/auth/login.ts", description: "Login handler" },
                { label: "src/auth/refresh.ts", description: "Token refresh" },
                { label: "src/middleware/auth.ts", description: "Auth middleware" },
                { label: "tests/auth.test.ts", description: "Auth tests" },
              ],
              multiSelect: true,
            }],
          }),
        },
      },
    ],
  },
  {
    id: "history-search",
    title: "HistorySearchModal",
    description: "Ctrl+R fuzzy history search",
    category: "Dialogs",
    interactive: true,
    render: () => <HistorySearchModal history={sampleHistory} onSelect={() => {}} onCancel={() => {}} />,
    variants: [
      { label: "with history", render: () => <HistorySearchModal history={sampleHistory} onSelect={() => {}} onCancel={() => {}} /> },
      { label: "empty", render: () => <HistorySearchModal history={[]} onSelect={() => {}} onCancel={() => {}} /> },
    ],
  },
]
