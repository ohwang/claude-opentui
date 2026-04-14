# /ab Feature — Comprehensive Testing Plan

## 1. Unit Tests (Pure Logic, No IO)

### 1.1 Argument Parsing (`parseAbArgs`)
- [x] Bare prompt, no flags
- [x] `--a=` and `--b=` shorthand
- [x] `backend:model` shorthand
- [x] `--criteria=` flag
- [x] Unknown backend error
- [x] Quoted prompt segments
- [x] Flags after prompt (interleaved)
- [x] Empty prompt (flags only)
- [ ] Multiple unknown flags (e.g. `--x=foo`) — should be treated as prompt text
- [ ] Empty string input
- [ ] Whitespace-only input
- [ ] `--a=` with no value (edge: `--a=`)
- [ ] Backend with empty model (`--a=claude:`)
- [ ] Multiple `--a=` flags (last wins? first wins? error?)
- [ ] Very long prompt (10k chars)
- [ ] Special characters in prompt (newlines, tabs, unicode)

### 1.2 Event Processing (`processEvent`)
- [x] text_delta accumulation
- [x] text_complete fallback when no deltas
- [x] text_complete no-op when deltas exist
- [x] turn_complete increments + token tracking
- [x] cost_update accumulation
- [x] tool_use_start count + file path extraction
- [x] fatal error capture
- [x] non-fatal error ignored
- [ ] Multiple turn_complete events (multi-turn session)
- [ ] cost_update with null fields (partial updates)
- [ ] tool_use_start with no input object
- [ ] tool_use_start with nested path fields
- [ ] Duplicate file paths deduplication
- [ ] Unknown event types (should not crash)
- [ ] Empty text_delta (zero-length string)
- [ ] turn_complete with no usage field

### 1.3 Judge Logic
- [x] Three templates exist
- [x] Default is quality
- [x] findCriteria lookup
- [x] buildJudgePrompt includes all components
- [x] Output truncation
- [x] parseRecommendation — A/B/TIE/null
- [x] Markdown-wrapped recommendation
- [ ] parseRecommendation with multiple RECOMMENDATION lines (first wins?)
- [ ] buildJudgePrompt with zero-length output sessions
- [ ] buildJudgePrompt with no changed files on either side
- [ ] buildJudgePrompt with very long file lists (100+ files)
- [ ] parseRecommendation with "RECOMMENDATION: C" (invalid)
- [ ] parseRecommendation with recommendation in a code block

### 1.4 Combine Prompt
- [ ] buildCombinePrompt includes both worktree paths
- [ ] buildCombinePrompt includes projectDir write target
- [ ] buildCombinePrompt truncates long session outputs
- [ ] buildCombinePrompt with no changed files
- [ ] buildCombinePrompt with asymmetric diffs (A has files, B has none)

## 2. Integration Tests (Real Git, Mock Backend)

### 2.1 Orchestrator Phase Machine
- [x] review → executing → comparing (happy path)
- [x] WIP preservation (stash/pop)
- [x] adopt winner merges back
- [x] Cross-target (different models)
- [ ] cancel during executing → cleans up worktrees
- [ ] cancel during comparing → cleans up worktrees
- [ ] interrupt both during executing → stats show interrupted
- [ ] interrupt one side → other side still completes
- [ ] adopt with merge conflict → adopt-error phase
- [ ] retryAdopt after conflict resolution
- [ ] preserveWorktreesAndExit → worktrees survive on disk
- [ ] double-start protection (start() called twice)
- [ ] adopt called in wrong phase (not comparing) → no-op
- [ ] startJudge in wrong phase → no-op
- [ ] startCombine in wrong phase → no-op
- [ ] cancel after done → no double-settle

### 2.2 Git Worktree Utilities
- [ ] createWorktrees produces two valid git worktrees
- [ ] cleanupWorktrees removes both + prunes
- [ ] cleanupWorktrees idempotent (call twice)
- [ ] stashDirtyState on clean repo → stashed=false
- [ ] stashDirtyState with staged + unstaged + untracked
- [ ] stashPop restores all file categories
- [ ] seedWorktreeFromStash creates seed commit
- [ ] collectDiff with no changes → zero stats
- [ ] collectDiff with added/modified/deleted files
- [ ] collectDiff with untracked files
- [ ] mergeWinner fast-forward path
- [ ] mergeWinner regular merge path
- [ ] mergeWinner conflict path → abort + report
- [ ] commitWorktreeChanges on clean worktree → false
- [ ] softResetTo leaves changes staged

### 2.3 Session Runner Lifecycle
- [ ] runSession with mock backend → completes with stats
- [ ] runSession interrupt → stats.interrupted = true
- [ ] runSession close → stats.complete = true
- [ ] runSession with invalid backend → immediate error stats
- [ ] runSession onUpdate called for each event
- [ ] Finish timer grace window (idle → 400ms, turn_complete → 800ms)
- [ ] session_state running resets finish timer

## 3. TUI Component Tests (Visual / Interaction)

### 3.1 Target Picker
- [ ] Renders two columns (A and B)
- [ ] Tab switches focus between columns
- [ ] Up/Down cycles backends within focused column
- [ ] Left/Right cycles models within focused column
- [ ] Enter confirms and calls onConfirm
- [ ] Esc cancels and calls onCancel
- [ ] Shows warning when A and B are identical
- [ ] Backend wraps around (last → first on Down)
- [ ] Model wraps around
- [ ] Unavailable backends shown with "(unavailable)"

### 3.2 Split Pane / Session Pane
- [ ] Renders two side-by-side panes
- [ ] Focused pane has accent border
- [ ] Streaming output updates in real-time
- [ ] Status shows "running…" / "complete" / "error" / "interrupted"
- [ ] Status colors: info/success/error/warning
- [ ] Stats footer shows turns/tools/tokens/cost
- [ ] Elapsed time updates
- [ ] PageUp/PageDown scrolls focused pane only
- [ ] "(no output yet)" shown before first delta

### 3.3 Comparison View
- [ ] Shows both side panels with stats
- [ ] Shows prompt summary
- [ ] Shortcut bar: A, B, J, C, Esc
- [ ] Judge result renders when available
- [ ] Judge recommendation highlights winner panel
- [ ] "★ recommended" badge on winner
- [ ] Judge streaming output scrolls
- [ ] Files list truncated at 8 with "+N more"
- [ ] Error shown if session had error
- [ ] Duration shows "—" when missing endTime

### 3.4 Judge Criteria Picker
- [ ] Shows three templates
- [ ] Up/Down navigates
- [ ] Enter confirms selection
- [ ] Esc cancels back to comparing
- [ ] Selected item highlighted with bold + accent color

### 3.5 Combine View
- [ ] Shows streaming reasoning output
- [ ] Shows files touched list (truncated at 10)
- [ ] Shows error if combine failed
- [ ] "(no output yet)" before first delta

### 3.6 Adopt View
- [ ] Adopting state shows "Adopting…" + status
- [ ] Done state shows "Done" + outcome
- [ ] Error state shows worktree paths
- [ ] Error state shows R/P/Esc shortcuts
- [ ] "Press any key to dismiss" on done

### 3.7 AB Modal (Phase Router)
- [ ] Header updates label per phase
- [ ] Correct subview mounted per phase
- [ ] Keyboard dispatch matches current phase
- [ ] Esc in executing → interrupt + cancel
- [ ] Esc in comparing → cancel
- [ ] Esc in judging → interrupt judge
- [ ] Esc in combining → interrupt combine
- [ ] Ctrl+C in executing → interrupt both
- [ ] "J" in comparing → shows criteria picker
- [ ] "A"/"B" in comparing → calls adopt
- [ ] "C" in comparing → calls startCombine
- [ ] "R" in adopt-error → retryAdopt
- [ ] "P" in adopt-error → preserveWorktreesAndExit
- [ ] Any key in done → dismiss

## 4. End-to-End Scenarios (TUI via agent-terminal)

### 4.1 Happy Path Flows
- [ ] `/ab say hello` → target picker → Enter → execution → comparing → adopt A
- [ ] `/ab --a=mock --b=mock say hello` → execution → comparing → adopt B
- [ ] Full judge flow: execute → compare → J → pick criteria → judge runs → adopt winner
- [ ] Full combine flow: execute → compare → C → combine runs → done

### 4.2 Error / Edge Flows
- [ ] `/ab` with no prompt → usage message
- [ ] `/ab --a=banana test` → error message
- [ ] Cancel during execution (Esc)
- [ ] Interrupt during execution (Ctrl+C) then cancel
- [ ] Cancel during comparing (Esc)
- [ ] Cancel during judging (Esc → interrupts judge, returns to comparing)
- [ ] Cancel during combining (Esc)

### 4.3 Keyboard Navigation
- [ ] Tab cycling between A and B columns in target picker
- [ ] Arrow key backend/model selection in target picker
- [ ] Tab/arrows switching pane focus during execution
- [ ] PageUp/PageDown scroll in execution panes

### 4.4 State Integrity
- [ ] Git state clean after cancel at any phase
- [ ] Git state clean after successful adopt
- [ ] No leftover worktree branches after cleanup
- [ ] No leftover stash entries after cleanup
- [ ] Dirty working tree preserved across full A/B cycle

## 5. Performance / Stress
- [ ] Large prompt (10k chars) doesn't truncate incorrectly
- [ ] Many tool uses (100+) tracked correctly
- [ ] Long-running sessions (>60s) — elapsed time stays accurate
- [ ] Rapid event stream (~1000 events/sec) — no dropped events
- [ ] Both sessions completing at very different times (A=1s, B=30s)

## 6. Regression Guards
- [ ] cost_update.cost is additive (+=) not replacement (=)
- [ ] turn_complete.usage replaces token counts (=) not additive (+=)  
- [ ] text_complete doesn't double-count when deltas were streamed
- [ ] Interrupted session still reports partial stats
- [ ] Fatal error stops the session immediately
