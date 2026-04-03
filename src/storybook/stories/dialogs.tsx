/**
 * Stories for dialog components (permission, elicitation).
 */

import type { Story } from "../types"
import { PermissionDialog } from "../../tui/components/permission-dialog"
import { ElicitationDialog } from "../../tui/components/elicitation"
import { idleSession, withPermission, withElicitation } from "../fixtures/state"

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
]
