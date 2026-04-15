# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-15

First public release of bantai — an open-source terminal UI for agentic coding backends.

### Highlights

- **Provider-agnostic architecture** — unified `AgentBackend` interface and `AgentEvent` stream that works with Claude Code, OpenAI Codex, and any future backend
- **SolidJS + OpenTUI rendering** — reactive terminal UI built on a Zig-native engine with double-buffered 60 FPS rendering
- **Event-sourced conversation state** — deterministic reducer with 16ms batching, full session replay, and resume support
- **A/B model comparison** — split-pane `/ab` command with git-worktree isolation for comparing backends side-by-side
- **Live backend switching** — `/switch` command to swap backends mid-session without losing context
- **Permission and elicitation dialogs** — tool-use approval flow with interrupt-safe auto-deny/auto-respond
- **Three-level tool detail view** — cycle through summary, expanded, and full output with Ctrl+O/E
- **Slash command system** — `/help`, `/clear`, `/compact`, `/model`, `/switch`, `/ab`, and more
- **Skill progress rendering** — first-class display of multi-step agent skill execution
- **`@`-mention picker** — fuzzy file/symbol autocomplete in the input area
- **Light and dark theme support** — with explicit selection colors and text visibility
- **File-based session logging** — per-session logs at `~/.bantai/logs/`
- **GitHub Actions CI** — lint and test pipeline
