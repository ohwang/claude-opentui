/** @jsxImportSource solid-js */

import { For, Show } from "solid-js"
import { useWorkspace } from "../state"
import type { Channel } from "../../types/slack"

export function Sidebar() {
  const ws = useWorkspace()
  const publicChannels = () => ws.state.channels.filter((c) => c.is_channel)
  const privateGroups = () => ws.state.channels.filter((c) => "is_group" in c && c.is_group && !c.is_im && !c.is_mpim)

  return (
    <aside class="sidebar">
      <div class="sidebar-section">Channels</div>
      <ul>
        <For each={publicChannels()}>
          {(ch) => <SidebarRow channel={ch} prefix="#" />}
        </For>
      </ul>
      <Show when={privateGroups().length > 0}>
        <div class="sidebar-section">Private</div>
        <ul>
          <For each={privateGroups()}>
            {(ch) => <SidebarRow channel={ch} prefix="🔒 " />}
          </For>
        </ul>
      </Show>
    </aside>
  )
}

function SidebarRow(props: { channel: Channel; prefix: string }) {
  const ws = useWorkspace()
  const isActive = () => ws.state.selectedChannel === props.channel.id
  const label = () =>
    "name" in props.channel ? props.channel.name : props.channel.id
  return (
    <li classList={{ active: isActive() }}>
      <button type="button" onClick={() => ws.selectChannel(props.channel.id)}>
        <span>{props.prefix}{label()}</span>
      </button>
    </li>
  )
}
