/**
 * A/B Modal — top-level overlay that drives the orchestrator.
 *
 * Owns:
 *   - the phase router: which subview to render
 *   - the modal key handler: shortcuts that map to orchestrator actions
 *   - the focused-pane signal for split-pane views
 *   - the dismiss-on-done timer
 *
 * Lives inside the modal overlay tree (mounted via showModal()). The
 * orchestrator itself is created by the slash command and passed in here, so
 * cleanup ordering is straightforward: the modal dismisses when the
 * orchestrator settles (onDone callback), or when the user cancels via Esc.
 */

import { TextAttributes } from "@opentui/core"
import type { KeyEvent } from "@opentui/core"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import type { OrchestratorHandle } from "../../../ab/orchestrator"
import { setModalKeyHandler } from "../../context/modal"
import { colors } from "../../theme/tokens"
import type { Label } from "../../../ab/types"
import { TargetPicker } from "./target-picker"
import { SplitPane } from "./split-pane"
import { ComparisonView } from "./comparison-view"
import { JudgeCriteriaPicker } from "./judge-criteria-picker"
import { CombineView } from "./combine-view"
import { AdoptView } from "./adopt-view"

export interface ABModalProps {
  orchestrator: OrchestratorHandle
  /** Called once the modal should be dismissed (settled or user cancelled). */
  onDismiss: () => void
}

export function ABModal(props: ABModalProps) {
  const orch = props.orchestrator

  const [focused, setFocused] = createSignal<Label>("A")
  const [showCriteria, setShowCriteria] = createSignal(false)
  let panesRef: { a?: any; b?: any } = {}

  // Keyboard wiring — phase-aware so e.g. "A" only adopts in comparing.
  const handleKey = (event: KeyEvent): boolean => {
    const phase = orch.phase()

    // Esc / Ctrl+C semantics depend on phase
    if (event.name === "escape") {
      if (phase === "review") {
        // TargetPicker handles its own cancel via setModalKeyHandler — fall through.
        return false
      }
      if (phase === "executing") {
        orch.interruptBoth()
        orch.cancel()
        return true
      }
      if (phase === "judging") {
        orch.interruptJudge()
        return true
      }
      if (phase === "combining") {
        orch.interruptCombine()
        return true
      }
      if (phase === "comparing" || phase === "adopt-error") {
        orch.cancel()
        return true
      }
      if (phase === "done") {
        props.onDismiss()
        return true
      }
      return false
    }

    if (event.ctrl && event.name === "c") {
      if (phase === "executing") {
        orch.interruptBoth()
        return true
      }
      if (phase === "judging") {
        orch.interruptJudge()
        return true
      }
      if (phase === "combining") {
        orch.interruptCombine()
        return true
      }
      return false
    }

    if (phase === "executing") {
      // Pane focus
      if (event.name === "left" || (event.shift && event.name === "tab")) {
        setFocused("A")
        return true
      }
      if (event.name === "right" || event.name === "tab") {
        setFocused("B")
        return true
      }
      // Per-pane scroll
      if (event.name === "pageup" || (event.option && event.name === "k")) {
        const ref = focused() === "A" ? panesRef.a : panesRef.b
        try { ref?.scrollBy?.({ x: 0, y: -10 }) } catch {}
        return true
      }
      if (event.name === "pagedown" || (event.option && event.name === "j")) {
        const ref = focused() === "A" ? panesRef.a : panesRef.b
        try { ref?.scrollBy?.({ x: 0, y: 10 }) } catch {}
        return true
      }
      return false
    }

    if (phase === "comparing") {
      if (event.name === "a") {
        orch.adopt("A").catch(() => {})
        return true
      }
      if (event.name === "b") {
        orch.adopt("B").catch(() => {})
        return true
      }
      if (event.name === "j") {
        setShowCriteria(true)
        return true
      }
      if (event.name === "c") {
        orch.startCombine().catch(() => {})
        return true
      }
      // Pane focus + scroll work on the per-side judge transcript / output
      if (event.name === "left" || (event.shift && event.name === "tab")) {
        setFocused("A")
        return true
      }
      if (event.name === "right" || event.name === "tab") {
        setFocused("B")
        return true
      }
      return false
    }

    if (phase === "adopt-error") {
      if (event.name === "r") {
        orch.retryAdopt().catch(() => {})
        return true
      }
      if (event.name === "p") {
        orch.preserveWorktreesAndExit()
        return true
      }
      return false
    }

    if (phase === "done") {
      props.onDismiss()
      return true
    }

    return false
  }

  // The TargetPicker installs its own modal key handler during the review
  // phase; we install ours for every other phase. We call setModalKeyHandler
  // each time the phase changes so handlers don't overlap.
  const updateHandler = () => {
    const phase = orch.phase()
    if (phase === "review" || showCriteria()) {
      // Subview owns the handler; clear ours so it can install.
    } else {
      setModalKeyHandler(handleKey)
    }
  }

  onMount(() => {
    updateHandler()
  })
  onCleanup(() => {
    setModalKeyHandler(null)
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header phase={orch.phase()} />

      <Show when={orch.phase() === "review" && !showCriteria()}>
        <TargetPicker
          prompt={orch.prompt}
          initialA={orch.targetA}
          initialB={orch.targetB}
          onConfirm={(_a, _b) => {
            // Targets are baked into the orchestrator at creation time; the
            // picker's selections in v1 only confirm the defaults. (A future
            // version can pass them back to a per-comparison reconfigure
            // helper.) Start the run.
            updateHandler()
            orch.start().catch(() => {})
          }}
          onCancel={() => {
            orch.cancel()
            props.onDismiss()
          }}
        />
      </Show>

      <Show when={orch.phase() === "executing"}>
        <SplitPane
          prompt={orch.prompt}
          statsA={orch.statsA()}
          statsB={orch.statsB()}
          diffA={orch.diffA()}
          diffB={orch.diffB()}
          focused={focused()}
          onFocusChange={setFocused}
          onPaneRefs={(refs) => { panesRef = refs }}
          banner="Executing both sides in parallel worktrees"
        />
      </Show>

      <Show when={orch.phase() === "comparing" && !showCriteria()}>
        {/* SplitPane stays visible above the comparison panel so the user can
            still scroll through the streamed transcripts; ComparisonView is
            the actionable summary below. */}
        <ComparisonView
          prompt={orch.prompt}
          statsA={orch.statsA()}
          statsB={orch.statsB()}
          diffA={orch.diffA()!}
          diffB={orch.diffB()!}
          judge={orch.judge()}
        />
      </Show>

      <Show when={showCriteria() && orch.phase() === "comparing"}>
        <JudgeCriteriaPicker
          onConfirm={(criteria) => {
            setShowCriteria(false)
            updateHandler()
            orch.startJudge(criteria.id).catch(() => {})
          }}
          onCancel={() => {
            setShowCriteria(false)
            updateHandler()
          }}
        />
      </Show>

      <Show when={orch.phase() === "judging"}>
        {/* Judge runs in-place; we surface its streaming output via the
            ComparisonView (which already renders judge() reactively). */}
        <ComparisonView
          prompt={orch.prompt}
          statsA={orch.statsA()}
          statsB={orch.statsB()}
          diffA={orch.diffA()!}
          diffB={orch.diffB()!}
          judge={orch.judge()}
        />
      </Show>

      <Show when={orch.phase() === "combining"}>
        <CombineView result={orch.combineResult()} />
      </Show>

      <Show when={orch.phase() === "adopting" || orch.phase() === "adopt-error" || orch.phase() === "done"}>
        <AdoptView
          status={orch.adoptionStatus()}
          error={orch.adoptionError()}
          done={orch.phase() === "done"}
          outcome={orch.adoptionStatus()}
        />
      </Show>
    </box>
  )
}

function Header(props: { phase: string }) {
  const labels: Record<string, string> = {
    review: "Review · pick targets",
    executing: "Executing · running A and B in parallel",
    comparing: "Comparing · pick a winner, judge, or combine",
    "judge-setup": "Judge · pick criteria",
    judging: "Judge · evaluating both approaches",
    combining: "Combine · synthesizing best of both",
    adopting: "Adopting · merging winner back into main",
    "adopt-error": "Adopt error",
    done: "Done",
  }
  return (
    <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
      <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
        {`A/B Comparison · ${labels[props.phase] ?? props.phase}`}
      </text>
    </box>
  )
}
