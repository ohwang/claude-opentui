/**
 * Workspace aggregate — the top-level mutable state for a running minislack.
 *
 * A Workspace owns its users, channels, files, id counters and ts state.
 * Every mutation in core/ goes through functions that take a Workspace as
 * the first argument. No module-level singletons.
 */

import { nextId } from "./ids"
import type { App, Bot, User, UserProfile, Workspace } from "../types/slack"
import {
  botTokenForApp,
  appTokenForApp,
  userTokenForUser,
} from "../server/auth"

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

// ---------------------------------------------------------------------------
// Apps / Bots — lives here in Phase 1; Phase 3 splits into core/users.ts.
// ---------------------------------------------------------------------------

export interface RegisterAppOpts {
  name: string
  scopes?: string[]
  subscribed_events?: string[]
}

export interface RegisteredApp {
  app: App
  bot: Bot
  botUser: User
  /** xoxb-… token for Web API calls. */
  botToken: string
  /** xapp-… token for apps.connections.open. */
  appToken: string
}

/** Register an app, mint its Bot + bot user, and return credentials. */
export function registerApp(ws: Workspace, opts: RegisterAppOpts): RegisteredApp {
  const appId = nextId(ws, "A")
  const botId = nextId(ws, "B")

  const botUser = createUser(ws, {
    name: slugifyBotName(opts.name),
    real_name: opts.name,
    is_bot: true,
    app_id: appId,
    bot_id: botId,
  })

  const bot: Bot = {
    id: botId,
    app_id: appId,
    user_id: botUser.id,
    name: opts.name,
    deleted: false,
  }

  const botToken = botTokenForApp(appId)
  const appToken = appTokenForApp(appId)

  const app: App = {
    id: appId,
    name: opts.name,
    scopes: opts.scopes ?? [],
    subscribed_events: opts.subscribed_events ?? [],
    bot_id: bot.id,
    bot_user_id: botUser.id,
    tokens: { bot: botToken, app: appToken },
  }
  ws.apps.set(app.id, app)

  return { app, bot, botUser, botToken, appToken }
}

/** Token helper: mint the user token for an existing user. */
export function tokenForUser(user: User): string {
  return userTokenForUser(user.id)
}

function slugifyBotName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_") || "bot"
}
