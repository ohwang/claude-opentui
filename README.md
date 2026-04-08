# claude-opentui

Open-source, drop-in replacement for Claude Code's terminal UI. Decouples the TUI from any single AI backend.

## Install

```bash
bun install
bun link        # symlinks claude-opentui into ~/.bun/bin (changes here are reflected immediately)
```

## Usage

```bash
claude-opentui              # start the TUI
claude-opentui --backend mock   # start with mock backend
```

## Development

```bash
bun run dev                 # run from source
bun run dev:mock            # run with mock backend
bun test                    # run all tests
bun run lint:opentui        # check OpenTUI prop rules
```

## License

MIT
