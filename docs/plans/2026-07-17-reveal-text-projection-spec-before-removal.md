# Spec: reveal-text-projection continuity behavior (preserved before removal)

**Context:** This note preserves the behavioral spec of
`packages/desktop/src/lib/acp/components/agent-panel/logic/reveal-text-projection.ts`
before its deletion as collateral of the token-reveal teardown
(`docs/plans/` — see the teardown task that removed `AgentPanelScenePipelineController`
and everything downstream of it, 2026-07-17). The module itself was never live in
production (its only caller was the dead `AgentPanelScenePipelineController`), so
deleting it changes no user-visible behavior today. It is documented here because
it encodes a *correctness* behavior — not an animation — that the token-reveal
rebuild should consciously decide to reimplement or intentionally drop.

## What it did

`createRevealTextProjection()` was a presentation-layer projector, sitting between
the graph materializer and the (dead) token-reveal overlay, that held the
previously-visible assistant markdown when canonical markdown transiently blanked
mid-turn — the "same-key running replacement" continuity described in
`docs/solutions/ui-bugs/assistant-text-reveal-streaming-block.md`. It never mutated
canonical state; it only overrode the *scene* entries it returned for rendering.

Related now-deleted files: `reveal-scene-patch.ts` (built the `displayScene` patch
variant describing which indices were overridden), `scene-entry-array-view.ts`
(zero-copy Proxy-based patched-array view), `agent-panel-display-model-assistant-content.ts`
(rebuilt an `AssistantMessage`'s chunk list to match the held display text).

## Rule (per `docs/plans/2026-06-09-001-refactor-retire-agent-panel-display-model-plan.md`, U2/U3)

For each assistant scene entry, on every projection `apply()`:

1. **Turn completed → always snap to canonical.** If `turnCompleted` is true,
   the projected text is the canonical `markdown`, even if canonical is empty.
2. **Turn running + canonical blanks + prior text existed → hold prior text.**
   If canonical `markdown.length === 0` AND the previously-visible text for that
   row id was non-empty, the projection returns the previously-visible text
   instead of the empty canonical string.
3. **Otherwise → pass canonical through unchanged.** Any non-empty canonical
   text (including monotonic growth during streaming) is passed straight
   through; the held-text memory is updated to match.
4. **Held text keys off `(sessionId, turnId)`.** Changing either resets the
   held-text map, so text from a finished/previous turn never bleeds into a
   new turn (or a new session) even if a row briefly shares an id or the
   canonical text is empty at the start of the next turn.
5. **Referential stability / no-op fast path.** If the session/turn key is
   unchanged, the input `sceneEntries` array reference is unchanged, and
   `turnCompleted` is unchanged from the previous call, `apply()` returns the
   exact same result object as last time (so downstream patch-detection sees a
   true no-op).
6. **Non-mutating.** The input scene entries array and its objects are never
   mutated; overridden rows are copied via `applyVisibleTextToAssistantEntry`
   (new object, same `id`/`isStreaming`/`tokenRevealCss`/timestamps, only
   `markdown` and `message` are recomputed) and exposed to callers via a
   zero-copy patched-array view, not by splicing the original array.
7. **Patch emission.** When at least one row was overridden, the result's
   `scenePatch` is a `{ kind: "displayScene", patch: { baseSceneEntries,
   entries, entriesByIndex } }` describing exactly the overridden
   index→entry map (so a downstream consumer can apply a fast incremental
   update instead of a full diff). When nothing was overridden, the patch is
   `scenePatchIdentity()` and the entries array is returned by reference
   (`===` the input), not copied.
8. **Only assistant rows are touched.** User/tool/thinking/missing rows pass
   through completely untouched — including staying referentially stable in
   the source array when only an assistant row changed.

## Test coverage that proved this (now deleted)

- `logic/__tests__/reveal-text-projection.test.ts` (10 cases): canonical
  pass-through, monotonic streaming growth, hold-on-blank, snap-on-completion,
  turn-boundary reset, session-boundary reset, referential stability on no-op,
  non-mutation of input, `displayScene` patch shape on override, identity
  patch when nothing overridden.
- `logic/__tests__/reveal-pipeline-integration.test.ts` (5 cases): the same
  rules end-to-end through the real chain
  `agent-panel-graph-materializer → reveal-text-projection → token-reveal-scene-read-model`,
  driving a sequence of `SessionStateGraph` revisions rather than
  hand-built scene entries — proves the orchestration composes, not just each
  stage in isolation.

## Recommendation for the rebuild

If the new client-side presentation buffer can guarantee it never blanks
previously-shown text mid-turn on its own (e.g. because it only ever grows a
buffer forward and never re-renders from a shrinking/blanked canonical
source), this correctness behavior may already be subsumed and does not need
reimplementing. If the new design still derives display text from canonical
`markdown` on every graph revision (as the old materializer → scene pipeline
did), re-verify whether canonical `markdown` can still transiently blank
mid-turn upstream (compaction, transcript rewrite, provider hiccup) — if so,
rule 2 above should be reimplemented or the blank will flash in the UI.
