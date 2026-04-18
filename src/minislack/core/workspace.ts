/**
 * Workspace aggregate — the top-level mutable state for a running minislack.
 *
 * A Workspace owns its users, channels, files, id counters and ts state.
 * Every mutation in core/ goes through functions that take a Workspace as
 * the first argument. No module-level singletons.
 */

import { nextId } from "./ids"
import type { User, UserProfile, Workspace } from "../types/slack"

export interface CreateWorkspaceOpts {
  teamName?: string
  teamDomain?: string
}

/** Create an empty workspace with a fresh team record. */
export function createWorkspace(opts: CreateWorkspaceOpts = {}): Workspace {
  const ws: Workspace = {
    team: {
      // Placeholder — we mint the real id after the counters map exists.
      id: "",
      name: opts.teamName ?? "Minislack",
      domain: opts.teamDomain ?? "minislack",
      url: `https://${opts.teamDomain ?? "minislack"}.slack.com/`,
    },
    users: new Map(),
    apps: new Map(),
    channels: new Map(),
    files: new Map(),
    tsState: new Map(),
    idCounters: new Map(),
  }
  ws.team.id = nextId(ws, "T")
  return ws
}

export interface CreateUserOpts {
  name: string
  real_name?: string
  email?: string
  is_bot?: boolean
  app_id?: string
  bot_id?: string
}

/** Add a user to the workspace. Returns the created User. */
export function createUser(ws: Workspace, opts: CreateUserOpts): User {
  const prefix = opts.is_bot ? "U" : "U" // bot users still use U… for their user record; Bot record uses B…
  const id = nextId(ws, prefix)
  const real_name = opts.real_name ?? opts.name
  const profile: UserProfile = {
    real_name,
    display_name: opts.name,
    email: opts.email,
  }
  const user: User = {
    id,
    team_id: ws.team.id,
    name: opts.name,
    real_name,
    is_bot: !!opts.is_bot,
    app_id: opts.app_id,
    bot_id: opts.bot_id,
    deleted: false,
    profile,
  }
  ws.users.set(id, user)
  return user
}

/** Resolve a user by id OR by handle (@name). Returns undefined if missing. */
export function findUser(ws: Workspace, nameOrId: string): User | undefined {
  if (ws.users.has(nameOrId)) return ws.users.get(nameOrId)
  const handle = nameOrId.startsWith("@") ? nameOrId.slice(1) : nameOrId
  for (const user of ws.users.values()) {
    if (user.name === handle) return user
  }
  return undefined
}
