---
status: completed
type: refactor
created: 2026-06-09
revised: 2026-06-09
plan_depth: Deep
execution_posture: characterization-first
god_gate: required
---

# refactor: Retire the agent-panel legacy display model

Render the agent panel from **one canonical scene pipeline** by removing the legacy display model (`agent-panel-display-model.ts`, 2,682 LOC) and the scene→display→scene round-trip in the controller.

> **v2 (2026-06-09)** — re-baselined against post-#207 code after document review. The render-branch migration this plan originally targeted **already shipped**: `scene-content-viewport.svelte` already feeds every entry (`user`/`assistant`/`thinking`/`tool_call`) into the shared `@acepe/ui` `AgentPanelConversationEntry`, which branches internally to `AgentUserMessage`/`AgentAssistantMessage`/`AgentThinkingSceneEntry`; the desktop-local `UserMessage`/`AssistantMessage` are consumed **only** by `sticky-user-message.svelte`. So this is not a render migration. The real remaining work is rehoming the two responsibilities still stranded in the display model — the **displayText streaming-continuity** and the **scene-patch emission** the incremental reveal pipeline depends on — then deleting it.

---

## Problem Frame

`agent-panel.svelte` (`~672–740`) builds three artifacts on every update:

1. `graphMaterializedScene` — the canonical scene via `createAgentPanelGraphMaterializerReadModel`. Already the rendered source for all entry branches.
2. The **display model** — `buildAgentPanelBaseModel` → `applyAgentPanelDisplayMemory` → `createAgentPanelDisplaySceneEntriesReadModel` — fed the materializer's scene entries and re-emitting `graphSceneEntries` + `agentPanelDisplayModel.waiting`/`viewport`.
3. `tokenRevealSceneReadModel` — CSS appearance reveal → rendered `tokenRevealSceneEntries`.

Step 2 is the round-trip. The display model is no longer a renderer — it is kept alive for **three** residual jobs:

- **(A) displayText streaming-continuity** — `applyDisplayTextToRow` + `displayTextByRowKey` (`agent-panel-display-model.ts:1157–1196`, hold-on-empty branch at `:1182–1183`) overwrites the rendered assistant `markdown` (`:2431`) when canonical text transiently empties.
- **(B) scene-patch emission** — `createAgentPanelDisplaySceneEntriesReadModel` **writes** the `agentPanelDisplayScenePatches` WeakMap (`:1882`, `:1923`). Two **live** consumers read it via `getAgentPanelDisplayScenePatch`: `token-reveal-scene-read-model.ts:156` and `graph-scene-entry-match.ts:191,390` (the latter imported by the controller). This is the incremental fast-path that keeps reveal updates off the O(n)-per-tick path. **Deleting the display model without rehoming this regresses the `VList` perf contract.**
- **(C) `waiting`/`viewport` flags** — `waiting.show`, `viewport.hasLiveTail/requiresStableTailMount`, computed from `graph.activity` + the transient `pendingSendIntent`. (Verified: these read the *current* snapshot, not cross-render memory — so they can become controller `$derived` cleanly.)

(A) is the last fragment of the pre-CSS reveal-text projector described in `docs/solutions/ui-bugs/assistant-text-reveal-streaming-block.md`; that projector's `AgentAssistantRevealRenderState`/`visibleTextByRowKey` mechanism was replaced by the CSS `tokenRevealCss` contract (2026-05-23) everywhere except this stranded continuity.

**Scope:** the agent-panel render path. **Out of scope:** canonical-model/Rust changes (except the contingency in U1), promoting `pendingUserEntry`, and the pre-existing svelte-check/clippy debt.

---

## GOD Invariants (gate run 2026-06-09)

1. **Visible assistant text is owned by the scene entry (`markdown`/`message.chunks`).** The reveal layer may compute a continuity-corrected visible-text **override supplied to the renderer at render time**; it must NOT mutate the materializer's scene-entry output or any canonical data.
2. **Reveal lifecycle is presentation-only, in a mounted-controller projector** — never the materializer, the canonical graph, or the viewport. `isStreaming` is canonical generation state, not a reveal authority.
3. **No canonical widening or Rust change — *contingent on U1*.** If U1 shows canonical assistant text transiently goes non-empty→empty within a turn (a replace-before-repopulate artifact), invariant 3 is void: the correct fix is upstream (canonical transcript sync never-blank), not presentation smoothing. U1 must produce positive evidence before this invariant is relied on.
4. **No *permanent* dormant render/authority path.** The display model has zero consumers by U4-end and is deleted in U5. Intra-migration coexistence is bounded: at every unit boundary, exactly one authority mutates visible text and exactly one emits scene-patch annotations (asserted by test).
5. **Transcript order / display identity are untouched.**

---

## Key Technical Decisions

- **(A) displayText continuity → the reveal-projection layer, not the materializer.** GOD verdict: baking it into the materializer pollutes the canonical→scene projection (other consumers — `virtual-session-list`, `activity-entry-projection`, `permission-bar` — would inherit smoothed text). The reveal layer is the established home for presentation reveal lifecycle (`assistant-text-reveal-streaming-block.md`). **Resolved: extract into a new focused `reveal-text-projection.ts` composed by the controller beside `token-reveal-scene-read-model`** — NOT by widening `TokenRevealSceneSnapshot` (which lacks `turnId`/`sessionId` and whose interface change would ripple into the controller). The projector reads scene `markdown` + transient state and returns a render-time visible-text override.
- **(B) scene-patch emission → the materializer's scene-entry-array layer.** The materializer already produces scene-entry array deltas and marks them via `agent-panel-scene-entry-array-patch.js` (`markAgentPanelSceneEntryArray{Append,Splice,Truncation}Patch`). The display model's parallel `agentPanelDisplayScenePatches` is a second annotation system layered on the round-trip. **Consolidate onto the materializer's annotations** so `token-reveal-scene-read-model` and `graph-scene-entry-match` keep their incremental fast-path without the display model. Exact emission/consumption sites confirmed during execution (U3).
- **(C) `waiting`/`viewport` → controller `$derived`.** Following the `2026-05-01-002` `isWaitingForResponse`-override precedent; verified these are current-snapshot derivations (no memory), so no stateful read-model is reintroduced. Not promoted to canonical.
- **Reveal contract is `tokenRevealCss` + `message.chunks`.** `AgentAssistantRevealRenderState` / `getMergedAssistantRevealFallbackKey` no longer exist; the plan targets the current contract.
- **`assistant_merged` is a scene/display grouping concept, not a renderer branch** (the shared renderer has only an `assistant` case). Its merge logic lives in the scene/patch layer (`conversation-model.ts` / `graph-scene-entry-match.ts`), so any merged-row concern is handled in U3 (patch layer), not a renderer migration.

---

## High-Level Technical Design

*Directional guidance for review, not implementation specification.*

```text
BEFORE:
  materializer ─scene entries─▶ DISPLAY MODEL ─re-emit + displayText-overwrite + scenePatches + waiting/viewport─▶ token-reveal(CSS) ─▶ render
                                 (also the sole writer of agentPanelDisplayScenePatches, read by token-reveal + graph-scene-entry-match)

AFTER:
  materializer ─scene entries(+ scene-entry-array patch annotations)─▶ reveal-text-projection ─▶ token-reveal(CSS) ─▶ render
  controller derives waiting/viewport from graph.activity + transient pendingSendIntent ($derived)
```

Restores the established layering (`assistant-text-reveal-streaming-block.md`): `SessionStateGraph → pure projection (materializer) → cosmetic reveal projector → passive renderer`.

---

## Requirements Trace

- **R1** — The agent panel renders from materializer scene entries through the reveal layer only; the display-model round-trip is removed. (U4)
- **R2** — Visible assistant-text continuity (no content flicker / no blanking on transient canonical-empty) is preserved, owned by the reveal layer — or deleted if U1 proves it never fires. (U1, U2)
- **R3** — The incremental scene-patch fast-path consumed by `token-reveal-scene-read-model` and `graph-scene-entry-match` survives the display-model deletion (no `VList` perf regression). (U3)
- **R4** — `waiting`/`viewport` become controller `$derived`; thinking-indicator timing and stable-tail-mount behavior are preserved. (U4)
- **R5** — `agent-panel-display-model.ts`, the orphaned read-model chain, and all now-dead imports are deleted; no dormant path remains. (U5)
- **R6** — No regression in rendered text, **reveal pacing/flicker** (verified by capturing the reveal-contract value sequence, not just text snapshots — see U1), remount/flash, or the `VList` perf contract (`docs/plans/2026-04-29-001-...`). (all units; U6 verifies)
- **R7** — Confirm the render-branch migration already shipped (no desktop-local `UserMessage`/`AssistantMessage` in the live conversation tree). (U1 baseline; U6 re-confirm)

---

## Scope Boundaries

### Deferred to Follow-Up Work
- Pre-existing svelte-check debt (8 errors: `tool-call-task`, `vlist-stub`, `tab-bar`, `app-sidebar`, `virtualized-session-list`) and Backend clippy debt.
- If U1 escalates to the canonical-empty-artifact branch (invariant 3 void), the Rust transcript-sync fix is its own plan.

### Outside this plan
- Canonical-model/Rust changes (except diagnosing U1's contingency); promoting `pendingUserEntry` to canonical.

---

## Implementation Units

### U1. Characterize behavior, confirm render parity, and make the three-way continuity decision
**Goal:** Lock current visible-text **and reveal-pacing** behavior in a characterization net; confirm the render-branch migration already shipped; and decide the continuity's fate with race- and canonical-aware evidence.
**Requirements:** R2, R6, R7
**Dependencies:** none
**Files:**
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/reveal-text-continuity-characterization.test.ts` (new)
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/agent-panel-display-model.test.ts` (extend — currently 11 tests)
**Approach:**
- **Render parity (R7):** confirm by inspection that `scene-content-viewport.svelte` routes all branches through `AgentPanelConversationEntry` and that desktop-local `UserMessage`/`AssistantMessage` have no live agent-panel-conversation importer (only `sticky-user-message.svelte`). Record as a baseline fact.
- **Text + pacing capture:** snapshot rendered assistant `markdown` **and** the reveal-contract value sequence (`tokenRevealCss` timing per revision over a simulated frame timeline) across the lifecycle scenarios below — pacing is temporal and is not captured by text snapshots alone.
- **Three-way continuity decision:** instrument the **canonical** layer (the `entry.segments` length feeding `assistantMarkdownText`, and transcript snapshot application in `session-store.svelte.ts`), not just the display-model branch. Outcomes: **(i) LIVE-canonical-stable** — canonical text never goes non-empty→empty mid-turn; continuity is real presentation smoothing → rehome (U2). **(ii) LIVE-canonical-blanks** — canonical segments transition non-empty→empty mid-turn → upstream replace-before-repopulate artifact; **stop, escalate to a Rust/canonical fix** (invariant 3 void), do not smooth downstream. **(iii) VESTIGE** — requires *positive* evidence the hold-on-empty branch is unreachable in production (not merely absent in tidy fixtures) → delete in U2.
- **Race rule:** if LIVE-vs-VESTIGE depends on async channel interleaving (token-stream vs. transcript-snapshot apply are separate paths), default to **LIVE** and add a real-cadence dev-app QA scenario in U6.
**Execution note:** Characterization-first — this net is the safety harness for U2–U5; it lands before any logic moves.
**Test scenarios (lifecycle):**
- Cold completed history → full text, no replay.
- Live streaming → visible text advances; never blanks between revisions; reveal-contract sequence captured.
- Live completion → snaps to full canonical text, fresh suffix only fades.
- Transient-empty (same-key rewrite) → previously-visible text held; record whether the branch fires and whether canonical segments blanked.
- Reduced-motion / instant → full text, no fade.
- `Decision recorded:` one of (i)/(ii)/(iii) with canonical-layer evidence.
**Verification:** Net captures all lifecycle scenarios green against current behavior; render-parity baseline recorded; three-way decision recorded with evidence. (Note: the orphan `agent-panel-scene-read-model.test.ts` has 1 pre-existing failure — expected, deleted in U5; not a regression.)

### U2. Rehome (or retire) displayText continuity in a focused reveal-text projection
**Goal:** Move the continuity into a new `reveal-text-projection.ts` (presentation layer), reading scene `markdown` + transient state and returning a render-time visible-text override — or delete it if U1 returned VESTIGE.
**Requirements:** R2
**Dependencies:** U1
**Files:**
- `packages/desktop/src/lib/acp/components/agent-panel/logic/reveal-text-projection.ts` (new)
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/reveal-text-projection.test.ts` (new)
- `packages/desktop/src/lib/acp/components/agent-panel/logic/agent-panel-display-model.ts` (continuity removed here once live cutover lands in U4)
**Approach:** Extract `applyDisplayTextToRow` + `displayTextByRowKey` into a module keyed on `(rowId, turnId, sessionId, previous-visible-text memory)`, consuming transient reveal state — NOT widening `TokenRevealSceneSnapshot`. It computes a visible-text override; it does not mutate materializer output (invariant 1). **Built and unit-tested in isolation in U2; it goes live in U4** when the round-trip is removed — so exactly one continuity authority is ever live (invariant 4). If VESTIGE: skip the module; assert the materializer `markdown` alone reproduces the U1 baseline; the deletion happens in U5.
**Patterns to follow:** the stateful read-model shape of `token-reveal-scene-read-model.ts`; the projector contract in `assistant-text-reveal-streaming-block.md`.
**Test scenarios:**
- Every U1 lifecycle scenario reproduced byte-identically (text) **and** with the same reveal-contract sequence (pacing).
- Same-key rewrite never blanks a non-empty row.
- Memory resets on `turnId`/`sessionId` change (no cross-turn text bleed).
- Reduced-motion/instant → passthrough, continuity not engaged.
- VESTIGE path (if taken): materializer `markdown` reproduces baseline with continuity absent.
**Verification:** U1 net green with continuity sourced from the new projection (or proven unnecessary); materializer output unchanged.

### U3. Rehome scene-patch emission onto the materializer's scene-entry-array layer
**Goal:** Make `token-reveal-scene-read-model` and `graph-scene-entry-match` get their incremental fast-path from the materializer's scene-entry-array patch annotations, so the fast-path survives the display-model deletion. (The perf-contract coupling document review surfaced.)
**Requirements:** R3
**Dependencies:** U1
**Files:**
- `packages/desktop/src/lib/acp/session-state/agent-panel-scene-entry-array-patch.js` / materializer scene-array construction (emit the needed annotations)
- `packages/desktop/src/lib/acp/components/agent-panel/logic/token-reveal-scene-read-model.ts` (read materializer annotations instead of `getAgentPanelDisplayScenePatch`)
- `packages/desktop/src/lib/acp/components/agent-panel/logic/graph-scene-entry-match.ts` (same)
- tests: extend the token-reveal + graph-scene-entry-match incremental-patch tests
**Approach:** Confirm the exact `agentPanelDisplayScenePatches` write sites (`agent-panel-display-model.ts:1882,1923`) and the two read sites. The materializer already marks append/splice/truncation patches on its scene-entry arrays; ensure those annotations carry everything the two consumers need (the `entriesByIndex` shape `getAgentPanelDisplayScenePatch` provided), then repoint the consumers. Built so the consumers work off materializer annotations **before** U4 removes the display-model emitter — no window where the fast-path is dead.
**Test scenarios:**
- Stable append (one new entry) → consumers take the incremental path, not full recompute (assert via the existing no-op/patch tests).
- Patch / truncation / splice → incremental path taken; output matches full-snapshot path.
- No annotation present → graceful full-snapshot fallback (current behavior) still correct.
- Per-tick work stays O(changed), not O(n) (verify by reading the path, per `2026-04-29-001`).
**Verification:** token-reveal + graph-scene-entry-match incremental tests green sourcing from materializer annotations; no remaining read of `getAgentPanelDisplayScenePatch`.

### U4. Remove the round-trip; move `waiting`/`viewport` to controller `$derived`; cut continuity live
**Goal:** Delete the controller's display-model consumption; render directly from materializer scene entries through the reveal-text projection (U2) + token-reveal. Derive `waiting`/`viewport` in the controller. This is the single atomic cutover where the reveal-text projection (U2) goes live and the display model loses its last consumer.
**Requirements:** R1, R4
**Dependencies:** U2, U3
**Files:**
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` (`~672–740`)
**Approach:** `graphSceneEntries` becomes `graphMaterializedScene.conversation.entries` → reveal-text projection → token-reveal. Replace `agentPanelDisplayModel.waiting`/`viewport` with `$derived` from `graph.activity` + `pendingSendIntent` and the scene tail (no `$effect`). Single cutover — the display model has zero consumers at U4-end.
**Test scenarios:**
- Waiting indicator shows/hides on the same `activity` + `pendingSendIntent` transitions as baseline.
- `requiresStableTailMount` holds the live tail during streaming, releases on completion.
- Send → optimistic → canonical arrival: no remount/flash (`2026-05-01-002` R2).
- Pre-session (no `sessionId`) + pending entry still shows the thinking indicator.
- Streaming reveal matches the U1 reveal-contract sequence (pacing parity).
**Verification:** controller imports none of the display-model render helpers; `agentPanelDisplayModel` gone from the render path; behavior parity in the dev app.

### U5. Delete the display model, the orphaned chain, and all dead imports
**Goal:** Remove `agent-panel-display-model.ts`, the orphaned `scene-display-row-read-model.ts` + `agent-panel-scene-read-model.ts` chain, and prune the now-dead imports/branches in the two former patch consumers.
**Requirements:** R5
**Dependencies:** U4
**Files:**
- delete `agent-panel-display-model.ts` (+ `-equality`, `-assistant-content` if unreferenced after deletion; relocate any surviving generic util like `toArrayIndex`/`areJsonLikeValuesEquivalent` to a neutral home if other callers remain)
- delete `scene-display-row-read-model.ts`, `agent-panel-scene-read-model.ts`
- prune dead `getAgentPanelDisplayScenePatch` imports/branches in `graph-scene-entry-match.ts` and `token-reveal-scene-read-model.ts`
- prune `logic/index.ts` barrel + dead tests
**Approach:** Delete and chase `svelte-check`/compiler; grep-confirm zero non-test importers before each delete.
**Test scenarios:** `Test expectation: none — deletion unit; U1–U3 nets + typecheck are the regression guard.`
**Verification:** `bun run check`, `check:svelte` (no *new* errors vs the pre-existing 8), `bun test` green; grep confirms no `agent-panel-display-model` / `getAgentPanelDisplayScenePatch` references remain.

### U6. GOD re-scan, perf + pacing verification, render-parity re-confirm, cohesion
**Goal:** Confirm no canonical/transcript violation, no perf or pacing regression, render parity intact, and the controller reads as a clean spine.
**Requirements:** R6, R7
**Dependencies:** U5
**Files:** `agent-panel.svelte` spine; `reveal-text-projection.ts`.
**Approach:** Re-run `god-architecture-check` on the diff (no materializer text smoothing, reveal stays presentation-only, no canonical write). Verify `VList` `mergedEntries`/`displayEntries` keying + per-row cost unchanged (`2026-04-29-001`). Use the repro-lab diagnostics the learning mandates (visible length, canonical length, advancement, fade offset) as the pacing oracle; run real-cadence streaming + long-session scroll in the dev app per `acepe-dev-app-qa` (covers the U1 race rule).
**Test scenarios:** `Test expectation: none — verification unit (GOD scan + perf/pacing oracle + manual QA are the gates).`
**Verification:** GOD scan clean; perf contract intact; reveal pacing matches baseline via the repro-lab oracle; full `bun test` green; dev-app QA passes.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Continuity rehome changes reveal pacing/flicker (text snapshots can't see timing) | U1 captures the reveal-contract value sequence, not just text; U2 reproduces it; U6 uses the repro-lab pacing oracle + real-cadence QA. |
| U1's live-vs-vestige is race-dependent and mischaracterized by fixtures | Default to LIVE on interleaving ambiguity; VESTIGE requires positive canonical-layer evidence; real-cadence QA in U6. |
| Canonical-empty is actually an upstream artifact (invariant 3 wrong) | U1 instruments the canonical segment array; the LIVE-canonical-blanks outcome stops and escalates to a Rust fix instead of smoothing downstream. |
| Deleting the display model silently kills the incremental scene-patch fast-path (VList perf) | U3 rehomes patch emission onto the materializer annotations and repoints both consumers **before** U4/U5; U6 verifies the perf contract. |
| Dual continuity / dual patch-emitter authority mid-migration | U2/U3 build in isolation; U4 is the single atomic cutover; invariant 4 asserts one authority per concern at each unit boundary (tested). |
| Surviving `agent-panel-display-model-equality` utils become misnamed orphans | U5 relocates any util with remaining callers to a neutral home. |

---

## Sequencing Rationale

U1 de-risks the one real unknown (live/vestige/artifact) with canonical-layer + pacing evidence before any code moves, and confirms the render migration is already done (collapsing the original U3/U4). U2 and U3 rehome the two stranded responsibilities **in isolation** (continuity, patch emission) so neither the reveal pipeline nor the perf fast-path has a dead window. U4 is the single atomic cutover that removes the round-trip and makes the rehomed pieces live. U5 deletes dead code. U6 gates on GOD + perf + pacing. Each unit is an atomic, behavior-preserving commit; the U1 net stays green throughout.
