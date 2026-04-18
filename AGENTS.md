# bantai

Open-source terminal UI for agentic coding backends. Decoupled from any single AI provider — works with Claude Code, Codex, ACP, and more.

## Quick Start

```bash
bun install
bun run dev          # Start the TUI
bun test             # Run all tests
```

## Build Requirements

- `bunfig.toml` must include `preload = ["@opentui/solid/preload"]` (Babel plugin for SolidJS JSX)
- Run with `--conditions=browser` flag (e.g., `bun run --conditions=browser ./src/index.ts`)
- Both are already configured in `bunfig.toml` and `package.json` scripts

## Tech Stack

- **Runtime:** Bun (required by OpenTUI's Zig FFI bindings, no Node.js support)
- **Terminal rendering:** OpenTUI v0.1.90 (Zig native core, double-buffered, 60 FPS)
- **UI framework:** SolidJS via `@opentui/solid` (NOT React)
- **Language:** TypeScript (strict mode)
- **Claude backend:** `@anthropic-ai/claude-agent-sdk` (track the latest released version)

## Architecture

Three layers:

1. **CLI Entry Point** (`src/index.ts`, `src/cli/`) — Flag parsing, subcommand dispatch, per-frontend bootstrap
2. **Frontends** (`src/frontends/<name>/`) — `tui/` (SolidJS + OpenTUI, default) and `slack/` (server placeholder). Each frontend exposes a `launch<Name>(flags)` entry point and owns only its presentation concerns.
3. **Agent Protocol Layer** (`src/protocol/`) — Unified `AgentBackend` interface + `AgentEvent` stream

The protocol layer is the load-bearing abstraction. All backends implement `AgentBackend`, all frontends consume `AgentEvent` via `ConversationState` / `SessionHost`.

## Key Conventions

- **SolidJS, not React.** Use `createSignal`, `createStore`, `createMemo`, `batch()`. No `useEffect`, `useState`, `useRef`.
- **No Effect.js.** Plain TypeScript. Factory functions for service creation.
- **Context-based DI.** One `AppContext` created at startup via factories. `<AppContext.Provider>` wraps root. Components use `useApp()`.
- **Event-sourced state.** `ConversationState` derived via reducer: `reduce(state, event) -> newState`. The TUI renders from state, never raw events.
- **16ms event batching.** Wrap signal updates in Solid's `batch()`. Same pattern as OpenCode.
- **~500 line file max.** One component per file, one adapter per file.
- **Types as documentation.** `src/protocol/types.ts` IS the spec.
- **Test contracts, not implementations.** Adapter contract tests validate event ordering and lifecycle rules.
- **Prefer framework primitives over custom logic.** Use built-in capabilities of OpenTUI, SolidJS, and the SDK before writing manual workarounds. Example: `stickyScroll={true}` + `stickyStart="bottom"` on `<scrollbox>` replaces 80+ lines of timer-based scroll nudging and setTimeout hacks. Custom logic for something the framework already handles is harder to maintain and more likely to have race conditions.
- **Explicit over clever.** No metaprogramming, no deep inheritance, no magic.
- **Cleanup must survive deletion.** When removing a variable/timer, grep for ALL references including `onCleanup` callbacks. SolidJS cleanup runs during `renderer.destroy()` — a dangling reference there prevents `process.exit()` and silently breaks exit.
- **`tsc --noEmit` must pass.** Never commit code that adds new TypeScript errors. The type checker catches undefined variables, missing properties, and type mismatches at compile time.
- **Never silently drop data from an external source.** Anywhere we ingest data whose shape we don't fully control — SDK events, session JSONL, MCP payloads, ACP notifications, user-provided config — every skip path MUST log, and every unrecognised shape MUST `log.warn`. A bare `break`, `continue`, `return []`, or untyped `if (!expected) break` is a bug. Concretely:
  - **Event mappers** (`src/backends/*/event-mapper.ts`): every SDK/ACP message branch either maps to an `AgentEvent` or logs. Intentional suppressions (e.g. per-delta streaming items whose content arrives via `*_delta` events) use `log.debug`. Unknown event types, unknown subtypes, and "expected field missing" cases use `log.warn` — these are the signals that a provider's protocol has drifted.
  - **Session-file parsers** (`src/backends/claude/session-reader.ts`, `src/session/cross-backend.ts`): the SDK types `MessageParam.content` as `string | Array<ContentBlockParam>`, and both forms appear in real JSONL. Handle both; when the shape is neither, `log.warn` with a snippet. Synthetic SDK-injected turns (compaction summaries, `<command-name>` slash markers, `<local-command-*>` wrappers, `isMeta: true`) are suppressed with `log.debug` that names the reason — not bare-drops. The "user messages vanish on resume" regression was exactly this bug. When in doubt, normalise the shape (e.g. upgrade a string to `[{ type: "text", text }]`) before the main loop rather than branching mid-loop.
  - **Defaulting to `any`/`unknown`**: if a field is typed `unknown` or `any` and you reach for `as any`, you owe either a runtime check (with a log on the unexpected branch) or a tight narrowed type. "It's probably fine" is how this class of bug ships.
- **Runtime-mutable values must be SolidJS signals or stores.** Plain objects and module-level constants are for truly immutable data only (string enums, static config). If a value can change via a slash command, CLI flag, or user action, it must be reactive. Theme colors (`colors` in `tokens.ts`) are a SolidJS store — never snapshot them into a `const`: read inline in JSX or via `() =>` accessor.
- **Cross-cutting keyboard shortcuts run FIRST in the root handler, not in overlays.** Any `useKeyboard` intercept that does blanket `event.preventDefault()` on non-whitelist keys (the usual "overlay is open — eat everything" pattern) will silently swallow global shortcuts like Cmd+C copy. Centralise cross-cutting shortcuts as small helpers at the top of the root `useKeyboard` in `src/frontends/tui/app.tsx` (e.g. `tryHandleCopyShortcut`) and invoke them before any overlay branch. Every view inherits them for free — no per-view wiring, no per-view regressions when a new overlay is added.

## OpenTUI Prop Rules (CRITICAL)

These rules prevent silent rendering failures and Zig FFI crashes:

1. **`fg=` not `color=`** — `<text color="red">` is silently ignored. Use `<text fg="red">`.
2. **`attributes=` not `bold`/`dimmed`/`italic`** — Boolean styling props are ignored. Use `attributes={TextAttributes.BOLD}` from `@opentui/core`. Combine with `|`: `attributes={TextAttributes.DIM | TextAttributes.ITALIC}`.
3. **Hex strings not numbers for colors** — `fg={174}` crashes the Zig FFI. Use `fg="#d78787"` instead. Reference: ANSI 174 = #d78787, 244 = #808080, 246 = #a8a8a8, 231 = #ffffff, 237 = #3a3a3a.
4. **Never `await render()`** — `render()` resolves immediately. Awaiting causes `main()` to return and the process to exit. Call without await, add `.catch()`.
5. **`dims()?.width` not `dims()?.columns`** — `useTerminalDimensions()` returns `{ width, height }`.
6. **No `borderTop`/`borderBottom` on box with textarea** — Causes Zig segfault. Use a `<text>` dash line component instead.
7. **`scrollBy()` not `scrollToEnd()`** — `ScrollBoxRenderable` has `scrollBy()` and `scrollTo()`, not `scrollToEnd()`.
8. **Keyed `<Show>` + `&&`: object must be last** — `<Show when={obj() && bool}>{(v) => v().prop}</Show>` crashes because `&&` returns the boolean `true`, not the object. Always put the object-producing expression last: `<Show when={bool && obj()}>`.
9. **`backgroundColor=` not `bg=` on box** — `<box bg="...">` is silently ignored. Use `<box backgroundColor="...">`. The `bg` prop only works on `<text>` elements.

10. **Render callbacks must be pure functions of their item** — Never read the list source, store, or unrelated signals inside a `<For>`/`<Index>` callback. OpenTUI's Zig engine sorts children by cached position — stale positions from re-created elements cause visual reordering (unlike DOM, which is idempotent). **Pattern:** derive all view state in a `createMemo` chain *before* it reaches the list (`filtered → grouped → flat → render-ready`). For selection highlighting, use a per-item `createMemo` inside the callback that reads a *scalar* signal (e.g. `selected()`), not the list itself. Use `<For>` for stable object lists, `<Index>` for lists that recompute on every update (search/filter).

Run `bun run lint:opentui` to check for violations.

## Project Structure

```
src/
  index.ts                # CLI entry point (flag parsing -> app bootstrap)
  cli/
    flags.ts              # CLI flag parsing (46 flags)
  protocol/
    types.ts              # AgentEvent, AgentBackend, ConversationState, BackendCapabilities
    reducer.ts            # Event-sourced state: reduce(state, event) -> newState
    registry.ts           # Backend registry + selection
  backends/
    claude/
      adapter.ts          # Claude adapter (query API, default)
  frontends/
    tui/                  # Default interactive TUI frontend
      app.tsx             # Root SolidJS component
      launcher.ts         # launchTui(flags) — called by CLI
      components/         # UI components (one per file)
      context/            # SolidJS reactive state (follows OpenCode pattern)
      theme.ts            # Colors, styles
    slack/                # Slack server frontend (placeholder)
      launcher.ts         # launchSlack(flags) — `bantai slack` entry
  commands/
    registry.ts           # Slash command dispatch
    builtin/              # /help, /clear, /compact, /model
  utils/
    event-batcher.ts      # 16ms batching with Solid batch()
    logger.ts             # File-based session logging (singleton `log`)
tests/
  protocol/               # Contract tests + reducer tests (written FIRST)
  backends/               # Adapter tests
  tui/                    # Component tests
```

## State Machine

7 states: `INITIALIZING` -> `IDLE` -> `RUNNING` -> `WAITING_FOR_PERM` / `WAITING_FOR_ELIC` -> `INTERRUPTING` -> `ERROR` / `SHUTTING_DOWN`

Key rules:
- `sendMessage()` queues everywhere, never blocks
- `interrupt()` in `WAITING_FOR_PERM` must auto-deny first (or SDK hangs)
- `interrupt()` in `WAITING_FOR_ELIC` must auto-respond first
- Error transitions must `close()` the active generator (prevent zombie processes)

## Testing

```bash
bun test                          # All tests
bun test tests/protocol/          # Protocol + contract tests
bun test tests/backends/          # Adapter tests
bun test tests/tui/               # Component tests
bun test --watch                  # Watch mode
```

Contract tests validate:
- `session_init` must be first event
- `turn_start` must precede `text_delta`
- `turn_complete` must follow every turn
- `permission_request` must block until approve/deny
- No events after `close()`

## Logging

Session logs live at `~/.bantai/logs/<session-id>.log`. Each app run gets a unique log file. The session ID and log path are printed to stdout on exit. Use `--debug` for verbose (event-level) logging; default level is `info`. Import the singleton via `import { log } from "./utils/logger"`.

## OpenTUI JSX Elements

Available from `@opentui/solid`:
- `<box>` — Flexbox container (flexDirection, alignItems, justifyContent, padding, etc.)
- `<text>` — Text content
- `<scrollbox>` — Scrollable container (stickyScroll, stickyStart)
- `<textarea>` — Text input with undo/redo, selection, key bindings
- `<markdown>` — Markdown rendering
- `<code>` — Syntax-highlighted code (tree-sitter)
- `<diff>` — Unified diff rendering

Key APIs: `render()`, `useKeyboard()`, `useRenderer()`, `useTerminalDimensions()`
