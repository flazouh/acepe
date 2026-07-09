---
title: "fix: Transcript scroll blank-space on send + stick-to-bottom correctness"
type: fix
status: active
date: 2026-07-02
---

# fix: Transcript scroll blank-space on send + stick-to-bottom correctness

## Overview

Fix the "huge blank space after sending a message" bug in the DOM-authority transcript viewport, plus the cluster of scroll-correctness defects found in a full live audit of the scrolling system (2026-07-02, real dev-app WebView instrumentation).

The audit found the blank space is **not** a scroll-release bug and **not** a projection bug: the awaiting/planning placeholder row physically balloons from ~48px to ~1176–1369px because of a WebKit baseline-propagation leak in `ClaudeWorkingSpark`, and the (correctly) bottom-pinned viewport ends up showing the empty bottom of that invisible sprite strip for the whole pre-stream window.

This plan is the delegation artifact for another developer: every defect is evidence-backed with file paths, the fixes are decision-complete, and each unit carries its own test scenarios and verification.

## Problem Frame

User-visible symptom: send a message → the transcript pane goes almost entirely blank (title bar on top, PR footer + composer at bottom, nothing in between); the sent message is not visible; the pane heals the instant assistant tokens stream in.

### Live evidence (captured 2026-07-02, dev app, rAF ring-buffer traces + MutationObserver + computed-style probes)

1. **Follow never detaches.** During the whole send window `distFromBottom` stays 0–1px and rows stay mounted (146→145→146). The 2026-06-29 release-gating fix (`PROGRAMMATIC_SUPPRESS_MS` + intent-gated release) works. The old "stranded ~1800px above the edge" failure is gone.
2. **The placeholder row balloons.** Frame trace: the only row intersecting the viewport during the blank window is `awaiting:planning` at **h=1369px** (estimate: 48px). `scrollHeight` jumps +1143..+1312px at placeholder mount and collapses (−1194px) when streaming replaces it. 1369 ≈ 84 frames × 16px spark + paddings; the earlier +1143 send matches the 14px spark variant (84 × 14 = 1176).
3. **Root cause chain (computed-style probe during the balloon):**
   - `.claude-working-spark` outer box: `height: 16px; overflow: hidden` — **correctly clamped**;
   - its inner `.claude-working-spark__sprite`: `height: calc(16px * 84) = 1344px` (by design, clipped);
   - but the placeholder row's block container measures **1357px** while containing only that 16px inline-flex span.
   WebKit derives the atomic inline (`inline-flex`) baseline from its first flex item — the 1344px sprite strip — *despite* `overflow: hidden` clipping. The line box in `packages/ui/src/components/agent-panel/planning-placeholder-row.svelte`'s block grows by the phantom ascent. The viewport, pinned to the true bottom, shows the empty bottom ~545px of that strip → full blank pane. Heals when the placeholder row unmounts at first stream content.
4. **Secondary defects observed in the same traces:** placeholder identity thrash (`local:planning` ↔ `awaiting:planning` mount/unmount across consecutive emissions), transient detach blips (dfb 78→97→0) during the swap churn, a ~784ms main-thread stall right after send (no rAF frames), and the send button lost its `aria-label` (breaking both a11y and the QA wrapper's send).

### Why the spark leak escaped tests

`happy-dom` has no layout engine — the repo already documents (parent plan, Unit 0 deviation) that layout phenomena are only verifiable in dev-app QA against the real WebKit WebView. The spark renders fine in isolation in Chrome-family engines; the baseline propagation is WebKit-specific.

## Requirements Trace

- **R1.** After send, the transcript never shows a blank pane: the sent user message stays visible from the moment of send through the start of streaming.
- **R2.** The awaiting/planning placeholder row's layout height stays within a small factor of its visible content (~48px), on WebKit.
- **R3.** Post-send scroll behavior honors the parent plan's R3 ("anchor the sent user turn near the top with a peek of the previous turn, keep follow engaged") without the anchor and the follow-pin fighting each other.
- **R4.** The send window causes no spurious follow release and no transient detach blips from row identity churn.
- **R5.** The "new messages below" affordance (parent plan R10) is actually wired: when the reader is released and content grows below, an indicator appears and clears on return to the edge.
- **R6.** The composer send button is accessible again (`aria-label`), and the QA wrapper can drive sends.
- **R7.** A repeatable QA probe can detect a recurrence of the blank-space class of bug (placeholder balloon, pinned-into-void) without a human watching.

## Scope Boundaries

- Not changing canonical transcript order, identity, or Rust row projection semantics (GOD: order/identity stay in Rust; this plan touches only view-layer geometry and desktop merge logic).
- Not changing message rendering (markdown, diffs, tool cards, token reveal).
- Not resuming the parent migration plan's unfinished perf units (Unit 2 anchor-arithmetic gate, Unit 8 perf gate) — those stay tracked there.

### Deferred to Separate Tasks

- **Send-window main-thread stall (~784ms with no rAF).** Observed but unexplained; likely turn-start processing + full-transcript re-render (`renderedRowsById` is a new `Map` per projection change in `scene-content-viewport.svelte`). Needs its own profiling investigation; do not bundle into this fix.
- **Per-token streaming-tail remount.** `renderKey = rowId:version` and `version` hashes segment text, so every streaming delta re-keys (remounts) the tail row. Changing key semantics risks the "stuck Planning label" regression the version-keying was built to fix (parent plan Unit 3, test B1). Investigate separately with characterization coverage first.
- **Base pierre-diffs font-size hardcoding** (unrelated, already tracked in memory).

## Context & Research

### Relevant Code and Patterns

Core scroll system (all confirmed live):
- `packages/ui/src/components/agent-panel/stick-to-bottom.ts` — pure follow/anchor state machine. `onSend` returns `initialStickState` (follow engaged) + `anchorRowNearTop`; `onContentChange` while following returns `toBottom`.
- `packages/ui/src/components/agent-panel/stick-to-bottom-effects.ts` — DOM controller; ResizeObserver → `notifyContentChanged`; intent-gated release (do NOT regress this — see `docs/solutions/` + memory `viewport-follow-release-intent-gating`).
- `packages/ui/src/components/agent-panel/message-scroller.svelte` + `message-scroller-item.svelte` (`content-visibility: auto`, `contain-intrinsic-size: auto <est>`) + `message-scroller-types.ts`.
- `packages/ui/src/components/agent-panel/claude-working-spark.svelte` — the sprite-strip component (the leak).
- `packages/ui/src/components/agent-panel/planning-placeholder-row.svelte` — hosts the spark inside an `inline-flex items-center` span in a block container.
- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` — desktop Controller: reveal-key consumption (exact-string guard), `onSend(rowId, SEND_REVEAL_PEEK_PX=72)`, edge-state wiring (**does not pass `onFollowStateChange`**).
- `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-rendered-rows.ts` — merge of canonical rows + `local:optimistic:<uuid>` + `local:planning` + `local:review`.
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` — produces `pendingUserRevealRequestKey` = `${panelId}:${version}:${optimisticId ?? "pending"}`.
- Send path: `agent-input-controller.ts` fires `onWillSend` (reveal bump) *before* `setPendingUserEntry` (optimistic entry), both in one synchronous flush.
- Rust: `packages/desktop/src-tauri/src/acp/transcript_viewport/projection.rs` — canonical `awaiting:planning` row (constant id/version); `row_version` = content hash (stable across pushes).

Audit findings on the send timeline (subagent-traced, file:line-verified):
- **F1 (primary):** spark baseline leak balloons the placeholder row (evidence above).
- **F2:** `onSend` anchor is defeated within one frame: state stays follow-engaged, so the next ResizeObserver tick → `onContentChange` → `toBottom` overrides `anchorRowNearTop`. The parent plan's R3 behavior has never actually shipped.
- **F3:** double reveal fire: when the optimistic entry drops on canonical arrival, the reveal key recomputes `…:<optId>` → `…:pending`, re-triggering the reveal `$effect` and a second `onSend` aimed at a row that may have just remounted.
- **F4:** guaranteed rowId churn at first emission: `local:optimistic:<uuid>` → `transcript:<canonicalId>` (different id ⇒ remount) and `local:planning` → `awaiting:planning` (remount), plus observed repeated `local:planning` re-adds on later emissions (placeholder thrash) causing the transient dfb blips.
- **F5:** `onFollowStateChange` (released/hasUnreadBelow) is computed in `@acepe/ui` but never passed by the desktop host — parent plan R10 (unread-below indicator) is silently unwired.
- **F6:** dead code: `packages/ui/src/components/agent-panel/scroll-to-bottom-button.svelte` and `packages/desktop/src/lib/acp/components/agent-panel/components/scroll-to-bottom-button.svelte` have no production consumers (live UI uses `agent-panel-transcript-scroll-controls.svelte`).
- **F7:** the composer send button renders visible text "Send message" but no `aria-label`; `scripts/acepe-qa/interact.ts` selects `button[aria-label='Send message']` → QA `send` reports not-ready. A11y + automation regression.
- **F8:** `packages/desktop/scripts/qa-transcript-viewport-scroll.ts` still reads legacy pixel/buffer fields (`bufferMode`/`bufferTopPx`/…) that the DOM-authority path no longer emits.

### Institutional Learnings

- `docs/solutions/best-practices/enforce-tdd-red-first-for-bugs-and-refactors-2026-06-14.md` — red test must reproduce the *actual* live behavior at the real seam; characterization must capture preserved behavior, never the bug.
- Parent plan `docs/plans/2026-06-28-002-refactor-transcript-viewport-dom-authority-plan.md` — R1–R12 contract for this viewport; Unit 0's ruling that layout phenomena are dev-app-QA-verified, unit tests prove arithmetic only.
- Memory `viewport-follow-release-intent-gating` — never reintroduce release-on-generic-scroll; keep `now`-injectable timing.

### External References

- Second-opinion review (Claude CLI, 2026-07-02) confirmed: (a) absolutely positioning the sprite strip is the most robust cross-engine fix for baseline propagation (out-of-flow boxes are spec-excluded from baseline/line-box computation); (b) spacer-based unification of anchor+follow is sound and is how ChatGPT/Claude-web resolve the same conflict; contributed the edge-case list used in Unit 3's scenarios.
- `stackblitz-labs/use-stick-to-bottom`, shadcn `MessageScroller` (parent plan's reference model).

## Key Technical Decisions

- **Fix the spark at the component, not the placeholder.** Take the sprite strip out of flow (`position: absolute` inside the 16px `position: relative` clipped box, explicit `width`/`height`, `top:0; left:0`), and downgrade the outer box `inline-flex` → `inline-block` with `vertical-align: middle` (its only child is now out-of-flow; flex serves no purpose and is the baseline-leak vector). Rationale: kills the leak at the source everywhere the spark is used; no behavior change for the mask/steps() animation (transforms are positioning-independent).
- **Unify anchor + follow with a last-turn bottom spacer** (honors parent R3): reserve `spacerPx = max(0, viewportH − peekPx − contentBelowSentRowPx)` below the last turn so "sent row near top" *is* the max-scroll position; follow-pin and anchor then agree instead of racing. The spacer shrinks naturally as the reply grows and collapses deterministically at turn end. **Product note:** the user was asked to confirm this over plain pin-to-bottom and was AFK; this option was chosen because parent R3 records "anchor-near-top, per user" as an explicit decision. If product direction changes to plain pin-to-bottom, Unit 3 collapses to deleting `anchorRowNearTop` + the reveal path, and Units 1, 2, 4–7 are unchanged.
- **Stabilize the reveal key** so one send fires exactly one reveal: derive the key from the reveal version only (`${panelId}:${version}`), not the optimistic entry id. The consumer already resolves "latest user row" at fire time; embedding the id only creates the `pending → id → pending` double-fire.
- **Unify placeholder identity** so planning never remounts: give the local planning row the same rowId/version the canonical one uses (`awaiting:planning` / constant version) so the local→canonical handoff is an in-place keyed match, not a remount; keep the local row's `hasPlanningEntry` suppression as-is.
- **Executable regression gate in the QA CLI** (not screenshots, not unit tests): extend the first-send probe to sample per-frame placeholder-row height, `distFromBottom`, and sent-row visibility during the send window. This is the "red test at the real seam" for F1/F2 and the permanent tripwire for this bug class.

## Open Questions

### Resolved During Planning

- Is the blank a release/strand bug? **No** — live dfb trace pinned at 0–1px throughout; release gating works.
- Is it a projection/rows bug? **No** — rows stay mounted and ordered through the window; Rust versions are content hashes and stable.
- Does `content-visibility` skipping cause the blank? **No** — the ballooned row measured `skip:false`; the blank region is real empty layout, not unpainted content.
- Which element leaks? **The spark strip's baseline**, proven by the computed-style chain (outer 16px clamped, block parent 1357px).

### Deferred to Implementation

- Exact spacer implementation site (dedicated spacer element in `message-scroller.svelte` vs `min-height` on the last `message-scroller-item`) — decide against real DOM behavior in the dev app; the arithmetic and edge cases below are the contract.
- Whether `openAt` (session-open positioning) should share the spacer math — likely yes for consistency, but verify reading-position preservation first.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

Send timeline after the fix (one send → one reveal → stable geometry):

```
composer submit
  ├─ optimistic user row mounts (local:optimistic:<uuid>)
  ├─ planning row mounts with rowId "awaiting:planning" (local-owned, canonical-compatible id)
  ├─ reveal fires ONCE (key = panelId:version)
  │    └─ spacer sized: max(0, viewportH − peek − contentBelowSentRow)
  │       → maxScroll position == "sent row near top" → follow-pin lands there
  ├─ placeholder row height ≈ 48px (spark strip out-of-flow; no phantom line box)
  ├─ canonical emission: user row re-keys in place; planning row identity unchanged (no remount)
  └─ streaming: reply grows into the spacer; spacer shrinks; turn end → spacer collapses
```

## Implementation Units

### Phase 1 — Kill the blank (shippable alone)

- [ ] **Unit 1: Fix `ClaudeWorkingSpark` baseline leak**

**Goal:** The spark contributes exactly its visual box (`--spark-size`) to layout in all usage contexts on WebKit.

**Requirements:** R1, R2.

**Dependencies:** None.

**Files:**
- Modify: `packages/ui/src/components/agent-panel/claude-working-spark.svelte`

**Approach:**
- Outer box: `display: inline-block` (drop `inline-flex`), keep explicit `width/height: var(--spark-size)`, `overflow: hidden`, add `position: relative` and `vertical-align: middle`.
- Sprite: `position: absolute; top: 0; left: 0; width: var(--spark-size); height: calc(var(--spark-size) * var(--spark-frames))`. Keep mask + `steps()` animation unchanged.
- Check every spark call site visually (planning placeholder, any tool-card/working usages) — the baseline of the outer box changes from "flex-item baseline" to synthesized; `vertical-align: middle` is the compensator.

**Test scenarios:**
- Test expectation: no happy-dom test — happy-dom has no layout engine and would false-pass (repo-documented). The executable check is the Unit 2 QA probe (placeholder row height stays < 100px during planning) plus dev-app visual QA of spark alignment next to text at sizes 14 and 16.

**Verification:**
- Dev app: send a message; the planning row measures ~48px (QA probe green); the sent message remains visible through the planning window; spark animation still cycles and sits vertically centered next to its label.

- [ ] **Unit 2: Send-window QA regression probe**

**Goal:** A repeatable, machine-checkable gate for this bug class (R7), usable red-first before Unit 1 lands.

**Requirements:** R1, R2, R4, R7.

**Dependencies:** None (write first — it must FAIL on current main, reproducing the live bug; goes green with Unit 1).

**Files:**
- Modify: `packages/desktop/scripts/acepe-qa/interact.ts` (extend the first-send probe sampler)
- Modify: `packages/desktop/scripts/acepe-qa/cli.ts` (surface new fields in the summary)
- Test: `packages/desktop/scripts/acepe-qa/__tests__/` (schema/summary shape tests, matching existing wrapper test style)

**Approach:**
- Per-frame samples during the send window: max onscreen row height, placeholder row (`[data-row-id="awaiting:planning"], [data-row-id="local:planning"]`) height, `distFromBottom`, and whether the just-sent user text's row intersects the viewport.
- Probe verdict fails when: placeholder height > 200px, or the sent row is not visible for > 500ms before first stream content, or dfb exceeds a small threshold while no user intent occurred.

**Test scenarios:**
- Happy path: probe summary reports `placeholder max height`, `sent-row visible`, `max dfb` fields (schema test with a stubbed sample set).
- Error path: stubbed samples with a 1300px placeholder → probe status is fail/warn, not ok.

**Verification:**
- Run red on current code (placeholder ~1176–1369px) → green after Unit 1. Evidence artifact lands in `/tmp` like existing probes.

### Phase 2 — Post-send anchoring correctness

- [ ] **Unit 3: Spacer-unified send anchoring (anchor == max-scroll)**

**Goal:** Honor R3: after send, the sent user row sits near the top (72px peek) and stays there through planning and early streaming, with follow engaged and no anchor/pin race (F2).

**Requirements:** R1, R3.

**Dependencies:** Unit 1 (geometry must be truthful first), Unit 2 (gate).

**Files:**
- Modify: `packages/ui/src/components/agent-panel/stick-to-bottom.ts` (spacer arithmetic as pure functions; `onSend` semantics)
- Modify: `packages/ui/src/components/agent-panel/stick-to-bottom-effects.ts` (spacer application + RO feedback guard)
- Modify: `packages/ui/src/components/agent-panel/message-scroller.svelte` (spacer element or last-item min-height — implementation-time choice)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` (pass send context)
- Test: `packages/ui/src/components/agent-panel/__tests__/stick-to-bottom.test.ts` (extend)
- Test: `packages/ui/src/components/agent-panel/stick-to-bottom-effects.dom.vitest.ts` (extend)

**Approach:**
- `spacerPx = max(0, viewportH − peekPx − contentBelowSentRowTopPx)`; recompute on viewport resize and content growth; idempotent (derive from measured pre-spacer content height); only write when delta > threshold to avoid ResizeObserver feedback loops.
- Spacer lives on/after the last turn only; a new send transfers it (never two).
- While released (reader scrolled up), never reassert max-scroll; fold spacer-height deltas into the existing anchor-preserve compensation.
- Turn end: collapse in one deterministic pass; if pinned at bottom the collapse is invisible.

**Execution note:** Implement the arithmetic test-first in the pure module; DOM wiring verified in dom-vitest for event/apply plumbing and in dev-app QA for real layout.

**Test scenarios:**
- Happy path: send with tall prior content → scroll action lands sent-row top at `viewportTop + peek`; follow stays engaged; subsequent growth below keeps position until content fills the spacer.
- Edge: short session (content < viewport) → spacer clamps so no blank gap persists after the reply ends.
- Edge: user message taller than `viewport − peek` → spacer 0, plain pin (no impossible anchor).
- Edge: window resize mid-turn while following → sent row stays near top; spacer recomputed once (no thrash).
- Error path: released reader mid-turn → spacer resize does not move the reader's anchor row (compensated), and no max-scroll reassertion.
- Integration: rapid double send → only the latest turn carries a spacer.
- Integration (regression): all existing follow/release/unread transitions in `stick-to-bottom.test.ts` still hold — especially never releasing on programmatic writes.

**Verification:**
- Unit 2 probe: sent row visible through the whole pre-stream window. Dev-app QA: send in a long session → message near top with previous-turn peek; streaming fills downward; no jump at turn end when pinned.

- [ ] **Unit 4: Single-fire reveal key**

**Goal:** One send fires exactly one reveal (`onSend`) (F3).

**Requirements:** R3, R4.

**Dependencies:** None (parallel-safe with Unit 3).

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` (key = `${panelId}:${version}`)
- Test: `packages/desktop/src/lib/acp/components/agent-panel/state/__tests__/content-scroll-reveal-controller.vitest.ts` (extend)
- Test: new component-level test beside `scene-content-viewport.svelte`'s existing test conventions asserting consume-once behavior across an optimistic→canonical transition.

**Test scenarios:**
- Happy path: version bump → key changes once; optimistic id appearing/disappearing does not change the key.
- Integration: simulate optimistic entry arriving then dropping on canonical match → reveal effect consumes exactly once.
- Edge: two real sends back-to-back → two distinct keys, two reveals.

**Verification:**
- Instrumented dev-app send shows a single programmatic anchor scroll per send in the rAF trace.

- [ ] **Unit 5: Stable placeholder identity across local→canonical handoff**

**Goal:** The planning placeholder never remounts during a turn (F4 placeholder half); transient dfb blips disappear.

**Requirements:** R4.

**Dependencies:** None.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-rendered-rows.ts` (local planning row uses rowId `awaiting:planning` + the canonical constant version)
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/` (extend the rendered-rows tests)

**Approach:**
- Keep `hasPlanningEntry` suppression; the local row simply becomes key-identical to the canonical one so the keyed `{#each}` treats the handoff as an update. Confirm the constant version string matches Rust's `AWAITING_PLACEHOLDER_VERSION` (`src-tauri/src/acp/transcript_viewport/projection.rs`).
- The optimistic user row's id churn is intentionally untouched: with Unit 3, scroll geometry no longer depends on that row's DOM identity; document this in the unit's code comment budget only if the code cannot say it.

**Test scenarios:**
- Happy path: rendered rows with local planning then canonical planning produce the same `renderKey` for the placeholder.
- Edge: local planning present + canonical placeholder present in the same input → exactly one placeholder row (no duplicate id in the keyed list — Svelte throws on dupes).
- Integration (regression): planning label/spark presentation still swaps between local and canonical presentation data without remount.

**Verification:**
- MutationObserver in dev app shows zero placeholder add/remove pairs between send and first stream content (was: 4–6 events).

### Phase 3 — Wiring, hygiene, and guardrails

- [ ] **Unit 6: Wire the unread-below affordance; delete dead scroll buttons**

**Goal:** Parent plan R10 actually works (R5); dead code removed (F5, F6).

**Requirements:** R5.

**Dependencies:** None.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` (pass `onFollowStateChange`)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`, `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` (surface `hasUnreadBelow` to the scroll controls)
- Modify: `packages/ui/src/components/agent-panel/agent-panel-transcript-scroll-controls.svelte` (unread state on the scroll-to-bottom control)
- Delete: `packages/ui/src/components/agent-panel/scroll-to-bottom-button.svelte`, `packages/desktop/src/lib/acp/components/agent-panel/components/scroll-to-bottom-button.svelte` (+ barrel exports)
- Test: extend the scroll-controls/panel-content component tests per existing conventions.

**Test scenarios:**
- Happy path: released + content grows below → control shows unread affordance; clicking returns to edge and clears it.
- Edge: growth above the anchor while released (estimate→real re-measure) does NOT set unread (the `grewBelow` heuristic already distinguishes; assert it end-to-end through the new wiring).
- Test expectation for deletions: none — removal verified by typecheck + import-guard tests.

**Verification:**
- `bun run check` + UI-package boundary tests green; dev-app QA shows the affordance during a streaming turn while scrolled up.

- [ ] **Unit 7: Send-button a11y + QA wrapper robustness + stale QA script**

**Goal:** Restore `aria-label` on the composer send button; make the QA wrapper resilient; retire the stale legacy QA harness (F7, F8, R6).

**Requirements:** R6, R7.

**Dependencies:** None.

**Files:**
- Modify: the composer send button component (locate via `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` or the `@acepe/ui` composer leaf it renders) — add `aria-label="Send message"`
- Modify: `packages/desktop/scripts/acepe-qa/interact.ts` (send-button selector: accept `aria-label` OR visible text; keep the aria-label the primary contract)
- Delete or rewrite: `packages/desktop/scripts/qa-transcript-viewport-scroll.ts` (references removed pixel/buffer fields; Unit 2's probe supersedes it)
- Test: component test asserting the send control exposes the accessible name (behavioral, not string-matching source).

**Test scenarios:**
- Happy path: send button has accessible name "Send message" in both enabled and stop/streaming states (or documented distinct names per state).
- Integration: `bun run qa send --text=…` completes with `sent: yes` against the dev app.

**Verification:**
- `bun run qa send` works end-to-end again; screen reader name present in the accessibility snapshot.

## System-Wide Impact

- **Interaction graph:** the spark is shared UI — Unit 1 affects every spark call site (planning placeholder, any working indicators). All are visually QA'd in one pass. The spacer (Unit 3) affects only the message scroller.
- **Error propagation:** none of the units cross the IPC boundary; Rust is untouched except read-only reference to the placeholder version constant.
- **State lifecycle risks:** Unit 3's spacer must never survive a session switch or leak across panels — tie its lifetime to the scroller instance; `openAt` path reviewed at implementation time.
- **API surface parity:** `MessageScroller` props stay backward compatible; new spacer inputs must be optional so the website demos keep rendering.
- **Integration coverage:** cross-layer proof lives in the Unit 2 QA probe (real WebView), because happy-dom cannot prove layout.
- **Unchanged invariants:** intent-gated release (never release on layout scroll), canonical row order/identity from Rust, `renderKey = rowId:version` semantics (except the deliberate placeholder id unification), envelope/emission-seq protocol.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Spark `vertical-align` compensation shifts alignment at some call sites | Med | Low | One visual QA pass over all spark usages at both sizes; adjust per-site alignment classes |
| Spacer logic re-introduces "blank space" complaints (intentional space below streaming reply) | Med | Med | It matches Claude.ai/ChatGPT UX and honors recorded R3; flag in PR description with before/after capture; plain pin-to-bottom fallback documented in Key Technical Decisions |
| ResizeObserver ↔ spacer write feedback loop | Med | High | Idempotent computation from pre-spacer content height + write-threshold guard (second-opinion-flagged); dom-vitest for the guard |
| Placeholder id unification collides (duplicate key) when local and canonical rows coexist in one frame | Low | High | Dedup guard in rendered-rows (unit-tested); Svelte will loudly throw in dev if violated |
| Reveal-key change breaks a consumer relying on the id segment | Low | Med | Grep for consumers; only `scene-content-viewport` consumes it today (audit-verified) |

## Documentation / Operational Notes

- After landing, update memory/solutions: the blank-space entry in `viewport-follow-release-intent-gating` (its 2026-06-30 "STILL REPRODUCING" hypothesis is now answered — it was the spark baseline leak, not projection emptiness) and add a solution doc for the WebKit baseline-propagation pattern.
- PR should include the Unit 2 probe output (red on main, green on branch) as evidence.

## Sources & References

- Parent plan: `docs/plans/2026-06-28-002-refactor-transcript-viewport-dom-authority-plan.md` (R1–R12 contract; Unit 4/R10 unfinished halves this plan completes)
- Live evidence: rAF traces, MutationObserver events, and computed-style probes captured 2026-07-02 in the dev app (session `292ca5da-032b-43b3-a8c0-c88cd56f2e82`); screenshots of the blank pane and healed states
- `docs/solutions/best-practices/enforce-tdd-red-first-for-bugs-and-refactors-2026-06-14.md`
- Second-opinion review via Claude CLI (2026-07-02): confirmed spark fix + spacer unification; contributed Unit 3 edge cases
- `stackblitz-labs/use-stick-to-bottom`; shadcn/ui MessageScroller
