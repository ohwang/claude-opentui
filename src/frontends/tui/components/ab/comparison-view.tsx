/**
 * A/B Comparison View — shown after both sessions finish.
 *
 * Surfaces the diff stats / cost / speed comparison plus action buttons:
 * pick winner (A/B), invoke judge, invoke combine, or cancel. The view stays
 * mounted while the judge / combine sessions run — those re-render their own
 * content above this footer, but the comparison summary stays visible so the
 * user can cross-reference the AI's reasoning against the raw stats.
 */

import { TextAttributes } from "@opentui/core"
import { Index, Show } from "solid-js"
import type { JudgeResult, SessionStats } from "../../../../ab/types"
import type { DiffStats } from "../../../../utils/git-worktree"
import { friendlyBackendName, friendlyModelName } from "../../../../protocol/models"
import { colors } from "../../theme/tokens"
import { ShortcutBar, ShortcutHint } from "../primitives"

export interface ComparisonViewProps {
  prompt: string
  statsA: SessionStats
  statsB: SessionStats
  diffA: DiffStats
  diffB: DiffStats
  judge: JudgeResult | null
}

export function ComparisonView(props: ComparisonViewProps) {
  return (
    <box flexDirection="column" padding={1} flexGrow={1} width="100%">
      <box paddingLeft={1}>
        <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
          {"A/B Comparison — Both sides complete"}
        </text>
      </box>

      <box marginTop={1} paddingLeft={1}>
        <text fg={colors.text.secondary}>
          {`Prompt: ${truncate(props.prompt, 200)}`}
        </text>
      </box>

      <box marginTop={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
        <SidePanel
          label="A"
          stats={props.statsA}
          diff={props.diffA}
          highlight={props.judge?.recommendation === "A"}
        />
        <box width={2} />
        <SidePanel
          label="B"
          stats={props.statsB}
          diff={props.diffB}
          highlight={props.judge?.recommendation === "B"}
        />
      </box>

      <Show when={props.judge}>
        {(getJudge: () => JudgeResult) => (
          <box marginTop={1} paddingLeft={1} paddingRight={1} flexDirection="column">
            <text fg={colors.accent.primary} attributes={TextAttributes.BOLD}>
              {`Judge: ${getJudge().criteriaName}${getJudge().complete ? "" : " (running…)"}`}
            </text>
            <Show when={getJudge().recommendation}>
              {(rec: () => "A" | "B" | "tie") => (
                <text fg={colors.status.success} attributes={TextAttributes.BOLD}>
                  {`Recommendation: ${rec()}`}
                </text>
              )}
            </Show>
            <Show when={getJudge().reasoning}>
              <box marginTop={1} maxHeight={10}>
                <scrollbox stickyScroll={true} stickyStart="bottom">
                  <text fg={colors.text.secondary}>
                    {getJudge().reasoning}
                  </text>
                </scrollbox>
              </box>
            </Show>
          </box>
        )}
      </Show>

      <box marginTop={1} paddingLeft={1}>
        <ShortcutBar>
          <ShortcutHint shortcut="A" action="adopt A" />
          <ShortcutHint shortcut="B" action="adopt B" />
          <ShortcutHint shortcut="J" action="run judge" />
          <ShortcutHint shortcut="C" action="run combine" />
          <ShortcutHint shortcut="Esc" action="cancel" />
        </ShortcutBar>
      </box>
    </box>
  )
}

function SidePanel(props: {
  label: "A" | "B"
  stats: SessionStats
  diff: DiffStats
  highlight: boolean
}) {
  const headerColor = () =>
    props.highlight ? colors.status.success : colors.accent.primary
  const dur = () => {
    if (!props.stats.startTime || !props.stats.endTime) return "—"
    return `${Math.max(1, Math.round((props.stats.endTime - props.stats.startTime) / 1000))}s`
  }
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      borderColor={headerColor()}
      padding={1}
      minWidth={28}
    >
      <text fg={headerColor()} attributes={TextAttributes.BOLD}>
        {`${props.label} · ${friendlyBackendName(props.stats.backendId)}${props.stats.model ? ` (${friendlyModelName(props.stats.model)})` : ""}`}
        {props.highlight ? " ★ recommended" : ""}
      </text>
      <text fg={colors.text.secondary}>
        {`turns ${props.stats.turns}  tools ${props.stats.toolUseCount}  duration ${dur()}`}
      </text>
      <text fg={colors.text.secondary}>
        {`tokens in ${props.stats.inputTokens}  out ${props.stats.outputTokens}`}
      </text>
      <text fg={colors.text.secondary}>
        {`cost $${props.stats.totalCostUsd.toFixed(4)}`}
      </text>
      <text fg={colors.text.secondary}>
        {`files changed ${props.diff.filesChanged} (+${props.diff.insertions}/-${props.diff.deletions})`}
      </text>
      <Show when={props.diff.changedFiles.length > 0}>
        <box marginTop={1} flexDirection="column">
          <text fg={colors.text.muted}>{"Files:"}</text>
          <Index each={props.diff.changedFiles.slice(0, 8)}>
            {(f) => (
              <text fg={colors.text.muted}>{`  ${f()}`}</text>
            )}
          </Index>
          <Show when={props.diff.changedFiles.length > 8}>
            <text fg={colors.text.muted}>
              {`  +${props.diff.changedFiles.length - 8} more`}
            </text>
          </Show>
        </box>
      </Show>
      <Show when={props.stats.error}>
        <text fg={colors.status.error}>{`error: ${props.stats.error}`}</text>
      </Show>
    </box>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}
