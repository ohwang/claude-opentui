/**
 * auth.test — identify the caller.
 *
 * https://api.slack.com/methods/auth.test
 */

import type { Workspace } from "../../types/slack"
import type { AuthContext } from "../auth"

export interface AuthTestResponse {
  ok: true
  url: string
  team: string
  user: string
  team_id: string
  user_id: string
  bot_id?: string
  is_enterprise_install: false
}

export function authTest(ws: Workspace, ctx: AuthContext): AuthTestResponse {
  const userId = ctx.userId ?? ""
  const user = userId ? ws.users.get(userId) : undefined
  return {
    ok: true,
    url: ws.team.url,
    team: ws.team.name,
    user: user?.name ?? "",
    team_id: ws.team.id,
    user_id: userId,
    ...(ctx.botId ? { bot_id: ctx.botId } : {}),
    is_enterprise_install: false,
  }
}
