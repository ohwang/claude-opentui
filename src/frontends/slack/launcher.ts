/**
 * Slack Launcher — placeholder for the Slack frontend.
 *
 * The intended shape (not yet implemented):
 *
 *   - `bantai slack` boots a long-running server (Socket Mode or HTTP)
 *     that bridges a Slack workspace to one or more agent backends.
 *   - Each Slack channel binds to a project directory (channel = project).
 *   - Each Slack thread optionally becomes one `SessionHost` instance
 *     (thread = session), reusing the same frontend-neutral host the TUI
 *     attaches to today.
 *   - Multi-user identity is resolved at the routing layer: each Slack
 *     user maps to their own agent credentials rather than a shared bot
 *     token.
 *   - The backend registry picks the agent (Claude / Codex / Gemini /
 *     ACP) per-channel or per-thread, so one server can host multiple
 *     backends simultaneously.
 *
 * Until that is built, this module only prints a status message and
 * exits. It exists so the CLI subcommand can be wired up and the
 * multi-frontend directory layout has a real occupant.
 */

import type { CLIFlags } from "../../cli/options"
import { log } from "../../utils/logger"

export async function launchSlack(_flags: CLIFlags): Promise<void> {
  log.setLevel("info")
  log.info("bantai slack invoked — placeholder (no server started)")

  const lines = [
    "",
    "  bantai slack — Slack frontend (placeholder)",
    "",
    "  This subcommand is a non-functional stub. The Slack server is not",
    "  yet implemented. Planned capabilities:",
    "",
    "    • channel = project (folder / repo binding)",
    "    • thread  = session (optional per-thread SessionHost)",
    "    • per-Slack-user identity → per-user agent credentials",
    "    • pluggable backends (claude / codex / gemini / acp)",
    "",
    "  Track progress: https://github.com/ohwang/bantai",
    "",
  ]
  for (const line of lines) process.stdout.write(line + "\n")
}
