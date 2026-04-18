/** @jsxImportSource solid-js */

import { createEffect, createSignal, For, Show } from "solid-js"
import { useSession, useWorkspace } from "../state"
import { conversationsHistory, postMessage } from "../api"
import type { Message } from "../../types/slack"

export function ChannelView() {
  const ws = useWorkspace()
  const session = useSession()
  const [posting, setPosting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let scrollRef: HTMLDivElement | undefined

  // Fetch history when the selected channel changes.
  createEffect(() => {
    const channelId = ws.state.selectedChannel
    const current = session.current()
    if (!channelId || !current) return
    void (async () => {
      try {
        const res = await conversationsHistory(current.token, channelId, 200)
        // API returns newest-first; the store keeps oldest-first for rendering.
        const ordered = [...res.messages].sort((a, b) => (a.ts < b.ts ? -1 : 1))
        ws.mergeMessages(channelId, ordered)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  })

  // Auto-scroll to bottom when messages change.
  createEffect(() => {
    const channelId = ws.state.selectedChannel
    if (!channelId) return
    ws.state.messagesByChannel[channelId] // read to track
    queueMicrotask(() => {
      if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight
    })
  })

  const currentChannel = () => {
    const id = ws.state.selectedChannel
    return id ? ws.state.channelsById[id] : undefined
  }
  const messages = () => {
    const id = ws.state.selectedChannel
    return id ? ws.state.messagesByChannel[id] ?? [] : []
  }

  async function onSubmit(text: string) {
    const channelId = ws.state.selectedChannel
    const current = session.current()
    if (!channelId || !current) return
    setPosting(true)
    setError(null)
    try {
      await postMessage(current.token, channelId, text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPosting(false)
    }
  }

  return (
    <section class="channel-panel">
      <header class="channel-header">
        <Show when={currentChannel()} fallback={<h2>No channel selected</h2>}>
          {(ch) => (
            <>
              <h2>
                {"name" in ch() ? `#${(ch() as any).name}` : ch().id}
              </h2>
              <span class="count">{ch().members.length} member{ch().members.length === 1 ? "" : "s"}</span>
            </>
          )}
        </Show>
      </header>
      <div class="messages" ref={(el) => (scrollRef = el)}>
        <Show when={messages().length > 0} fallback={<div class="msg empty">No messages yet. Say hello 👋</div>}>
          <For each={messages()}>{(m) => <MessageRow msg={m} />}</For>
        </Show>
      </div>
      <Composer onSubmit={onSubmit} disabled={posting() || !ws.state.selectedChannel} />
      <Show when={error()}>
        <div class="toast">{error()}</div>
      </Show>
    </section>
  )
}

function MessageRow(props: { msg: Message }) {
  const ws = useWorkspace()
  const author = () => ws.state.usersById[props.msg.user]
  const displayName = () => author()?.real_name || author()?.name || props.msg.user
  const when = () => {
    const [secs] = props.msg.ts.split(".")
    const d = new Date(Number(secs) * 1000)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  const isBot = () => !!author()?.is_bot || !!props.msg.bot_id
  return (
    <div class="msg">
      <div classList={{ avatar: true, bot: isBot() }}>
        {initials(displayName())}
      </div>
      <div>
        <div class="msg-head">
          <span class="msg-author">{displayName()}</span>
          <Show when={isBot()}><span class="msg-bot-tag">APP</span></Show>
          <span class="msg-time">{when()}</span>
        </div>
        <div class="msg-text">{props.msg.text}</div>
      </div>
    </div>
  )
}

function Composer(props: { onSubmit: (text: string) => void; disabled?: boolean }) {
  const [value, setValue] = createSignal("")
  function submit(e: Event) {
    e.preventDefault()
    const text = value().trim()
    if (!text || props.disabled) return
    props.onSubmit(text)
    setValue("")
  }
  return (
    <div class="composer">
      <form onSubmit={submit}>
        <input
          type="text"
          placeholder="Message the channel"
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          disabled={props.disabled}
        />
        <button type="submit" disabled={props.disabled || value().trim().length === 0}>
          Send
        </button>
      </form>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase()
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase()
}
