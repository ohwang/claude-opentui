/**
 * Public entry point for the minislack library.
 *
 * Phase 0 — types and core. `startMinislack` and `MinislackHandle` land in
 * Phase 1 once the HTTP/WS server is wired up.
 */

export * from "./types/slack"
export { nextId, peekId } from "./core/ids"
export { nextTs, compareTs, parseTs } from "./core/ts"
export { createWorkspace, createUser, findUser } from "./core/workspace"
export {
  createPublicChannel,
  createPrivateGroup,
  openDirectMessage,
  createMpim,
  findChannelByName,
  resolveChannel,
  joinChannel,
  leaveChannel,
  assertMember,
  MinislackError,
} from "./core/channels"
export { postMessage, listHistory, getMessage } from "./core/messages"
