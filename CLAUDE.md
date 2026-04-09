# claude-opentui

Open-source, drop-in replacement for Claude Code's terminal UI. Decouples the TUI from any single AI backend.

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
- **Claude backend:** `@anthropic-ai/claude-agent-sdk` v0.2.85

## Architecture

Three layers:

1. **CLI Entry Point** (`src/index.ts`) — Flag parsing, config resolution, bootstrap
2. **TUI Shell** (`src/tui/`) — SolidJS + OpenTUI components, context providers
3. **Agent Protocol Layer** (`src/protocol/`) — Unified `AgentBackend` interface + `AgentEvent` stream

The protocol layer is the load-bearing abstraction. All backends implement `AgentBackend`, all TUI components consume `AgentEvent` via `ConversationState`.

## Key Conventions

- **SolidJS, not React.** Use `createSignal`, `createStore`, `createMemo`, `batch()`. No `useEffect`, `useState`, `useRef`.
- **No Effect.js.** Plain TypeScript. Factory functions for service creation.
- **Context-based DI.** One `AppContext` created at startup via factories. `<AppContext.Provider>` wraps root. Components use `useApp()`.
- **Event-sourced state.** `ConversationState` derived via reducer: `reduce(state, event) -> newState`. The TUI renders from state, never raw events.
- **16ms event batching.** Wrap signal updates in Solid's `batch()`. Same pattern as OpenCode.
- **~500 line file max.** One component per file, one adapter per file.
- **Types as documentation.** `src/protocol/types.ts` IS the spec.
- **Test contracts, not implementations.** Adapter contract tests validate event ordering and lifecycle rules.
- **Explicit over clever.** No metaprogramming, no deep inheritance, no magic.
- **Cleanup must survive deletion.** When removing a variable/timer, grep for ALL references including `onCleanup` callbacks. SolidJS cleanup runs during `renderer.destroy()` — a dangling reference there prevents `process.exit()` and silently breaks exit.
- **`tsc --noEmit` must pass.** Never commit code that adds new TypeScript errors. The type checker catches undefined variables, missing properties, and type mismatches at compile time.
- **Never silently drop events.** Every event/message received by an event mapper must either be mapped to an `AgentEvent`, or logged. Use `log.debug` for intentionally suppressed events (e.g., streaming items whose content arrives via deltas). Use `log.warn` for truly unhandled/unknown event types — these indicate protocol additions we're missing. A bare `break` or `return []` with no log is a bug.

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
      adapter.ts          # V1 adapter (query API, default)
      adapter-v2.ts       # V2 adapter (session API, --backend claude-v2)
  tui/
    app.tsx               # Root SolidJS component
    components/           # UI components (one per file)
      conversation.tsx    # Scrollbox with stickyScroll
      message-block.tsx   # User/assistant/system message
      tool-view.tsx       # Three-level tool view (Ctrl+O/E)
      input-area.tsx      # Textarea + autocomplete
      status-bar.tsx      # Model, cost, tokens, state
      permission-dialog.tsx
    context/              # SolidJS reactive state (follows OpenCode pattern)
      agent.tsx           # AppContext: backend, batcher, state machine
      messages.tsx        # Message list + queue signals
      session.tsx         # Session management + cost tracking
      permissions.tsx     # Permission + elicitation state
      sync.tsx            # Event stream -> signal updates (batch at 16ms)
    theme.ts              # Colors, styles
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

See `plan.md` section 9 for full state diagram, transitions, and guards.

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

Session logs live at `~/.claude-opentui/logs/<session-id>.log`. Each app run gets a unique log file. The session ID and log path are printed to stdout on exit. Use `--debug` for verbose (event-level) logging; default level is `info`. Import the singleton via `import { log } from "./utils/logger"`.

## Key Reference Files

- `plan.md` — Vision, strategy, milestones, 12 design decisions
- `reference.md` — Type definitions, component tree, adapter notes
- `TODOS.md` — Deferred work items
- `research/` — 20 deep-dive documents on implementation areas

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
