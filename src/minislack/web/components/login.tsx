/** @jsxImportSource solid-js */

import { createSignal, For, Show } from "solid-js"
import { useSession, useWorkspace } from "../state"
import { createNewUser } from "../api"

export function Login() {
  const session = useSession()
  const ws = useWorkspace()
  const [creating, setCreating] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)

  async function loginAs(userId: string) {
    setError(null)
    try {
      await session.login(userId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function addAndLogin() {
    const name = newName().trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      const res = await createNewUser(name)
      if (res.user && res.token) {
        session.loginWith({ userId: res.user.id, token: res.token })
        await ws.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div class="login">
      <div class="login-card">
        <h1 class="login-title">minislack</h1>
        <p class="login-subtitle">Pick a user to log in as. Each browser tab holds its own session.</p>
        <div class="login-user-list">
          <For each={ws.state.users.filter((u) => !u.is_bot)} fallback={<div style="color: var(--text-muted); padding: 8px;">No users yet — create one below.</div>}>
            {(u) => (
              <button class="login-user" type="button" onClick={() => loginAs(u.id)}>
                <span class="avatar">{initials(u.real_name || u.name)}</span>
                <span style="display: flex; flex-direction: column;">
                  <span>{u.real_name || u.name}</span>
                  <span class="handle">@{u.name}</span>
                </span>
              </button>
            )}
          </For>
        </div>
        <form class="login-new-user" onSubmit={(e) => { e.preventDefault(); addAndLogin() }}>
          <input
            type="text"
            placeholder="New user handle (e.g. alice)"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            disabled={creating()}
          />
          <button type="submit" disabled={creating() || newName().trim().length === 0}>
            {creating() ? "..." : "Add & log in"}
          </button>
        </form>
        <Show when={error()}>
          <div style="color: var(--danger); margin-top: 10px; font-size: 12px;">{error()}</div>
        </Show>
      </div>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase()
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase()
}
