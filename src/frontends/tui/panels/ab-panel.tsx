/**
 * AbPanel — thin adapter that renders the A/B comparison modal for the
 * TUI frontend. The `orchestrator` from core is passed through opaquely;
 * the ABModal component owns the UI + orchestrator wiring.
 *
 * Consumed by the TUI `FrontendBridge` when a command calls
 * `ctx.frontend?.openPanel("ab", { orchestrator, onDismiss })`.
 */

import type { OrchestratorHandle } from "../../../ab/orchestrator"
import { ABModal } from "../components/ab/ab-modal"
import type { AbPanelData } from "../../../commands/frontend"

export function AbPanel(props: AbPanelData) {
  return (
    <ABModal
      orchestrator={props.orchestrator as OrchestratorHandle}
      onDismiss={props.onDismiss}
    />
  )
}
