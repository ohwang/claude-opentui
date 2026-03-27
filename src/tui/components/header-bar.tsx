/**
 * Header Bar — Project path, app name, help hint
 *
 * Fixed 1-line bar at the top of the TUI.
 */

import path from "node:path"

export function HeaderBar() {
  const projectName = path.basename(process.cwd())

  return (
    <box height={1} flexDirection="row" borderBottom="single" borderColor="gray" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <text bold color="blue">
        {projectName}
      </text>
      <box flexGrow={1} />
      <text dimmed color="gray">
        claude-opentui
      </text>
      <box flexGrow={1} />
      <text dimmed color="gray">
        /help
      </text>
    </box>
  )
}
