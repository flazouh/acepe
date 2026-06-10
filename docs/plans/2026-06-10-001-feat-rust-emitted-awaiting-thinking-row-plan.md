---
status: active
type: feat
created: 2026-06-10
revised: 2026-06-10-r2
plan_depth: Deep
execution_posture: test-first
god_gate: required
---

# Rust-Emitted Awaiting "Planning next moves" Thinking Row

## Summary

Make Rust the source of the in-chat "Planning next moves" indicator: during the awaiting-model gap (turn Running, `AwaitingModel`, no assistant entry streamed yet), the transcript-viewport projection emits one **ephemeral** synthetic row that the existing `resolveSceneEntry` fallback maps to a `type:"thinking"` scene entry, rendering in-chat through the existing `@acepe/ui` thinking View. This covers both the mid-session awaiting gap and the initial post-send gap (first turn, before the first session graph event arrives in TS): Rust fires the awaiting row in the first viewport push, eliminating the TS `graph === null` pre-session branch entirely. Retire the TypeScript pre-composer stopgap and **both** branches of the TS waiting-derivation. No canonical transcript or persistence is touched.

## Problem Frame

The in-chat "Planning next moves…" row used to appear during the gap between turn start and the first streamed token. It was produced by the now-deleted display model, which synthesized a waiting **display** row (`WAITING_LABEL`). When the transcript viewport became Rust-owned (`docs/brainstorms/2026-05-28-rust-owned-transcript-viewport-requirements.md`), the WebView stopped owning row visibility: `scene-content-viewport.svelte` renders only `bufferProjection.rows` pushed from Rust. A TypeScript-synthesized scene entry no longer produces a transcript row, so the synthetic waiting row silently stopped reaching the screen. The just-merged display-model retirement removed the defunct projection, confirming the in-chat awaiting placeholder was already broken by the viewport move.

A stopgap added earlier this session — a `WaitingIndicator` shimmer bar in the `agent-panel.svelte` `preComposer` slot gated by `agentPanelWaiting.show` — sits **above the composer**, not in the conversation. That is the wrong shape: the indicator must render in-chat, where it was before.

The GOD-correct fix moves the truth upstream: Rust (which already owns the `AwaitingModel` activity state and the viewport row stream) decides the placeholder row exists, owns its identity/order/version, and ships it through the existing push/delta protocol. TypeScript only does presentation mapping — exactly as it already maps user/assistant/tool rows in the `resolveSceneEntry` content fallback.

## GOD Architecture Assessment

This is a transcript-shaped change; the GOD gate is required. The assessment is positive:

- **Truth moves upstream, not downstream.** The decision "an awaiting placeholder row exists here, now, in this position" becomes a Rust viewport-projection decision derived from canonical `AwaitingModel` activity + transcript tail. Today nothing owns it; the broken-then-stopgapped state is the downstream patch.
- **TS does presentation mapping only.** The existing `resolveSceneEntry` fallback already converts Rust viewport rows (role/segments) into scene-entry view models when a row has no canonical scene entry. Adding a branch that maps the new awaiting row kind to `{ type: "thinking" }` is the same dumb mapping, not display-truth reconstruction.
- **The stopgap is the symptom patch being removed.** Retiring the `preComposer` `WaitingIndicator` and the `deriveAgentPanelWaiting` TS derivation eliminates a reader-level repair, satisfying "deepen, don't patch."
- **Raw provider data is untouched.** The row is derived from canonical activity/turn state, not provider quirks.

Re-run the GOD scan at U6 to confirm no downstream repair crept back in.

## Architectural Constraints Carried Forward

From the Rust-owned transcript viewport requirements (`docs/brainstorms/2026-05-28-rust-owned-transcript-viewport-requirements.md`) — binding context, not the origin of this feature:

- Rust owns row identity, order, kind, and version before the WebView receives data (R1). The awaiting row gets an Acepe-owned `row_id` and a **stable** `version` so the layout index does not churn while awaiting persists.
- The WebView must not derive, merge, or reinterpret transcript rows (R3). The TS change is presentation mapping of a Rust-supplied row, not row synthesis.
- The protocol is delta-oriented and bounded (R10/R13). Appearance and removal of the awaiting row must ride the existing push/delta path as a bounded row add/remove.
- Existing user-visible behavior is preserved (R19). The in-chat "Planning next moves…" View and its running-status shimmer are unchanged.

## Key Technical Decisions

**D1 — Ephemeral viewport-layer row, not a persisted canonical transcript row.** (Confirmed fork.) The placeholder is injected in `project_transcript_viewport_rows`, never added to `TranscriptSnapshot.entries`. It exists only while the live awaiting condition holds and never enters session history/restore. Rationale: the awaiting state is transient; "Planning next moves" in restored history would be wrong; this matches the old display-model behavior (synthetic, non-persisted) and is the lowest-risk layer because the projection call site (`runtime_registry.rs` `with_materialized_viewport`) already has `activity`, `turn_state`, `transcript_snapshot`, and `active_streaming_tail` in scope.

**D2 — Replace (distinct identity), not morph.** (Confirmed fork.) The awaiting row carries its own reserved identity (`row_id`/`source_entry_id`, e.g. `awaiting:planning`). When the first real assistant entry appears, the awaiting condition flips false, the synthetic row is no longer projected, and the real `AssistantThought`/`AssistantText` row takes the tail. The delta carries a row removal + insert. No in-place morph. Rationale: the awaiting row and a real assistant entry have different canonical identities; forcing one identity to morph into the other reintroduces the mixed-identity flicker class documented in `docs/solutions/ui-bugs/transcript-viewport-flicker-finalization-2026-05-14.md`.

**D3 — Awaiting condition is a sibling predicate to `select_active_streaming_tail`.** Add `select_awaiting_placeholder(turn_state, activity, transcript_snapshot) -> bool` in `session_state_engine/graph.rs`, true exactly when `turn_state == Running && activity.kind == AwaitingModel && there is no assistant entry after the latest user entry` (i.e., the case where `select_active_streaming_tail` returns `None` *because no assistant tail exists yet*, while running+awaiting). Compute it at the projection call site and pass the boolean into the projection. Rationale: keeps the predicate pure and unit-testable, keeps the projection signature lean, and co-locates it with the existing tail predicate it is the complement of.

**D4 — Dedicated row kind `AwaitingPlaceholder`, mapped to `type:"thinking"` in the TS fallback.** Add `TranscriptViewportRowKind::AwaitingPlaceholder` and emit the row with:
- **Content:** `TranscriptViewportRowContent::Transcript { role: Role::Assistant, segments: [] }` — reuses the only existing content variant; empty segments yield no rendered text.
- **Version:** a hardcoded constant (`const AWAITING_PLACEHOLDER_VERSION: u64 = 0`) rather than the `row_version(content)` hash. This is required because `row_version` irrefutably destructures `TranscriptViewportRowContent::Transcript { role, segments }` — adding a new variant would break the pattern; bypassing with a constant avoids structural fragility and reflects that the awaiting row genuinely has no content to hash.
- **Reserved id prefix:** both `row_id` and `source_entry_id` use `awaiting:planning`. This prefix is structurally separate from the `transcript:{uuid}` format used for real entries, so `ensure_unique_display_row_ids` cannot produce a collision. (Note: for real transcript rows `row_id = "transcript:{entry_id}"` and `source_entry_id = "{entry_id}"` — they diverge. For the awaiting row both fields hold the same literal `"awaiting:planning"`.)
- `anchor_eligible: true`, `active_streaming_tail: None`, no operation/interaction links.

In `resolveSceneEntry`, a new branch returns `{ id: row.sourceEntryId, type: "thinking", durationMs: null }` (no `label` override, so the View shows the default "Planning next moves…"). Rationale: a dedicated kind makes the TS mapping unambiguous and cannot collide with real empty thought rows (real thoughts arrive as assistant entries and render through the assistant fallback, never `type:"thinking"`). The `awaiting:*` id is guaranteed absent from `sceneEntryById`, so the fallback path is always taken.

**D5 — No `@acepe/ui` View change.** Verified: the canonical thinking View already renders "Planning next moves…" with the running-status shimmer (`packages/ui/src/components/agent-panel/agent-assistant-message.svelte`, `planning-label.ts`, `agent-panel-layout.svelte`). The "before" UI is restored simply by routing a `type:"thinking"` entry to it. The shimmer `WaitingIndicator` variant introduced for the stopgap is not reused and is removed.

## Implementation Units

### U1 — Rust: awaiting-condition predicate + ephemeral row emission

**Files:**
- `packages/desktop/src-tauri/src/acp/session_state_engine/graph.rs` (add `select_awaiting_placeholder`)
- `packages/desktop/src-tauri/src/acp/transcript_viewport/row.rs` (add `AwaitingPlaceholder` kind; content shape)
- `packages/desktop/src-tauri/src/acp/transcript_viewport/projection.rs` (accept the awaiting flag; append the synthetic row)
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` (compute flag at the projection call site and pass it in)

**Behavior:** When the awaiting flag is true, append one `AwaitingPlaceholder` row at the tail (after all projected transcript rows) with reserved `row_id`/`source_entry_id` (`awaiting:planning`), content `Transcript{role:Assistant, segments:[]}`, version = `AWAITING_PLACEHOLDER_VERSION` constant, `anchor_eligible: true`. When false, emit nothing. The row must not enter `TranscriptSnapshot`.

The predicate fires naturally on the first turn (session just created, no prior entries, `Running + AwaitingModel`), covering the initial post-send gap before the first graph event arrives in TS. No separate pre-session mechanism is needed: Rust fires the awaiting row in the first viewport push, at which point the TS-side `graph === null` window has closed or is closing.

**Test scenarios** (`projection.rs` + `graph.rs` unit tests):
- `select_awaiting_placeholder` is true for Running + AwaitingModel + no assistant entry after latest user.
- It is false when an assistant entry already exists after the latest user entry (real thought/text present).
- It is false when `turn_state != Running`.
- It is false when `activity.kind != AwaitingModel` (e.g., tool/operation activity).
- Projection appends exactly one awaiting row, last, when the flag is true.
- Projection emits no awaiting row when the flag is false.
- The awaiting row's `version` is identical across two consecutive projections with the same condition (no layout churn).
- The awaiting row carries no operation/interaction links and `active_streaming_tail: None`.
- `ensure_unique_display_row_ids` leaves the reserved `awaiting:planning` id intact (no collision with transcript rows). Add an explicit collision test: project 100 transcript entries + the awaiting row and verify all `row_id` values are unique.
- `select_awaiting_placeholder` is true on the first turn (empty transcript, session just started, Running + AwaitingModel) — no prior entries needed.
- `select_awaiting_placeholder` is false immediately after the first assistant entry is appended (transition: AwaitingModel → first token lands → assistant entry exists).
- `select_awaiting_placeholder` correctly handles the `RunningOperation→AwaitingModel` gap: after a tool result is recorded (last entry is tool result, not assistant), the predicate is true; after the next assistant entry begins (even empty), it becomes false. Add a boundary test for this transition.
- The awaiting row content is `Transcript{role:Assistant, segments:[]}` and `version == AWAITING_PLACEHOLDER_VERSION` (not a content hash). Verify version is identical across two consecutive projections with the same awaiting condition (no layout churn).

### U2 — TS: map the awaiting row to a thinking scene entry + regenerate bindings

**Files:**
- `packages/desktop/src/lib/services/acp-types.ts` (regenerated specta bindings — do not hand-edit; produced by the specta export step)
- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` (`resolveSceneEntry` branch)

**Behavior:** Add a `resolveSceneEntry` branch that, when `row.kind === "awaitingPlaceholder"`, returns `{ id: row.sourceEntryId, type: "thinking", durationMs: null }` before the role-based content fallbacks. Regenerate `acp-types.ts` from the specta export so `TranscriptViewportRowKind` includes `"awaitingPlaceholder"`.

**Test scenarios** (`scene-content-viewport.svelte.vitest.ts`):
- A buffer containing one `awaitingPlaceholder` row renders the in-chat thinking View showing "Planning next moves…" (and `role="status"` Loading).
- The awaiting row resolves via the fallback (no matching `sceneEntries` entry) — i.e., it renders even when `sceneEntries` is empty.
- An assistant row with thought segments still resolves to `type:"assistant"` (the awaiting branch does not capture real thoughts).
- The rendered awaiting row's initial estimated height is ~36–40px (matching the shimmer row height). Verify the virtualized list height estimate for the awaiting row does not diverge significantly from the rendered height (prevents layout jump on appear/remove). If the height estimate is configurable per-kind, set it explicitly; if it inherits from a shimmer row height constant, confirm that constant value in this test.

**Regression guard (no change expected):** `planning-labels.svelte.vitest.ts` continues to prove the `type:"thinking"` View label is static — the View contract this plan depends on.

### U3 — Replace transition: no duplicate, no flicker, follow-tail reveal

**Files:**
- `packages/desktop/src-tauri/src/acp/transcript_viewport/projection.rs` / `viewport.rs` (delta on row add/remove — verify, likely no code change)
- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` (render-path assertions only)

**Behavior:** When a real assistant entry appears, the awaiting row disappears and the assistant row appears at the tail in the same projection. Verify the delta path carries this as a bounded remove+insert and that layout total height/anchor recompute correctly. While detached, the visible anchor must stay stable across the swap; while following, the tail (now the assistant row) is revealed.

**Test scenarios:**
- Rust: projecting awaiting → then with an assistant entry present yields rows without the awaiting row and with the assistant row at the tail; the layout index reflects the swap (awaiting `row_id` gone).
- Rust/viewport: the buffer delta across the swap is bounded (removed awaiting row + added assistant row), not a full re-push.
- TS vitest: rendering the awaiting buffer then the assistant buffer shows exactly one tail row at each step (no lingering duplicate awaiting entry).
- Carry-forward from `docs/solutions/logic-errors/thinking-indicator-scroll-handoff-2026-04-07.md`: after send, the viewport enters **FollowingTail** mode (not an anchored `RevealRow` targeting `awaiting:planning`). Using RevealRow would leave the anchor on the awaiting row; when that row is removed, `repair_detached_anchor` picks the nearest surviving row WITHOUT tail-reveal — the incoming assistant row would not scroll into view. FollowingTail mode avoids this: the viewport stays at the tail regardless of which row is currently last. Mandate a **viewport-level unit test** (not deferred to U5 QA) that: (a) starts a session in FollowingTail mode, (b) pushes the awaiting row, (c) pushes the swap delta, and (d) asserts the viewport followed to the assistant tail without snap-back or manual re-reveal.
- Reattach test: if the user scrolled into detached mode while the awaiting row is visible (anchored to a real row above), pushing the swap delta removes the awaiting row. Verify `repair_detached_anchor` reattaches to the nearest surviving row (the last user/tool row) — not to the assistant tail — and does NOT issue a tail-reveal (the user deliberately scrolled away).

### U4 — Retire the pre-composer stopgap and the full TS waiting-derivation (both branches)

**Files:**
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` (remove `WaitingIndicator` import, `preComposer` block, `agentPanelWaiting` derived, and the `isWaitingForResponse`/`waitingLabel` props passed to `AgentPanelContent`)
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte` (remove `isWaiting`/`waitingLabel` props + plumbing)
- `packages/desktop/src/lib/acp/components/agent-panel/logic/agent-panel-content-runtime.ts` (remove `isWaitingForResponse`)
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/agent-panel-content-runtime.test.ts` (delete the `isWaitingForResponse` assertions / the "derives waiting only from canonical awaiting-model activity" cases — this suite is built around the removed field and will otherwise fail `bun run check`/`bun test`)
- `packages/desktop/src/lib/acp/components/agent-panel/types/agent-panel-content-props.ts` (remove the optional props)
- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` (remove the dead `_isWaitingForResponse`/`_waitingLabel` props)
- `packages/desktop/src/lib/acp/components/agent-panel/logic/agent-panel-waiting.ts` (+ its test) — delete
- `packages/desktop/src/lib/acp/components/waiting-indicator/` (component, `thinking-cursor` variant, types, index) — delete

**Work-time checks (verify before deleting):**
- `packages/desktop/src/lib/acp/components/debug-panel/streaming-repro-lab.svelte` passes `isWaitingForResponse` — confirm it targets its own logic, not the removed `scene-content-viewport` prop, and leave/adjust accordingly.
- `packages/ui/src/components/agent-panel/agent-tool-question.svelte` `waitingLabel` is the unrelated question-wait label — out of scope, do not touch.
- The `virtualized-entry-list-stub.svelte` test fixture declares/renders an `isWaitingForResponse` prop — remove the now-orphaned prop (and any `data-waiting` assertion) so no stale reference survives the grep-clean criterion.
- Sequence after U1+U2 are verified rendering in-chat, so there is no regression window where neither indicator shows.
- `deriveAgentPanelWaiting` has **two** branches: (1) post-session: `activity.kind === "awaiting_model"` + no streaming tail; (2) pre-session: `graph === null && (pendingSendIntent || sceneEntries.length > 0)`. Both are replaced by U1. U1's awaiting row fires on the first viewport push (before the TS `graph` property even settles), so the pre-session branch is superseded. Delete both; do not preserve the `graph === null` guard.

**Test scenarios:**
- `bun run check` (desktop + ui) passes with the props/module removed.
- No remaining import of `deriveAgentPanelWaiting` or `WaitingIndicator` (grep clean).
- No remaining reference to `graph === null` in the `agent-panel-waiting` module (confirm deleted, not just guarded).

### U5 — Live awaiting/reveal QA against the dev binary

**Behavior:** Drive a real awaiting window through the QA bridge (port 9223, dev `target/debug/acepe`; never `/Applications/Acepe.app`). Using the working send technique (type → await ~450ms for Svelte reactivity → confirm `!send.disabled` → click), send a prompt and capture the transcript during the gap.

**Verification:**
- "Planning next moves…" appears **in-chat** as the trailing conversation row during the awaiting gap (not above the composer).
- It is replaced by the real assistant content when streaming begins — no duplicate, no flicker.
- Follow-tail reveals it after send; the row is not visible above the composer (the stopgap is gone).
- Capture the in-chat row's position relative to the composer to prove the shape is correct.
- **Cancel-mid-await:** send a prompt, observe the awaiting row in-chat, then cancel the turn before any assistant token arrives. Pass criterion: the awaiting row disappears (turn exits `Running` → predicate flips false → removal delta arrives). Fail criterion: the row persists after cancellation.
- **Tool-step re-appearance:** for a multi-step agent (at least one tool call before the final answer), verify that "Planning next moves…" reappears in-chat between each tool result and the next assistant token — and disappears cleanly when each token arrives. Pass criterion: the indicator appears and disappears as a single bounded delta per tool-step gap, with no visible stutter or double row. Fail criterion: row persists into the streaming turn, or appears when there is already an assistant entry at the tail.
- **Initial-send timing:** record the elapsed time from the send click to the first appearance of the in-chat awaiting row. Pass criterion: visible within one render cycle after the first viewport push (no perceivable blank flash before the row appears). If IPC latency causes a visible blank gap on first send, document the gap duration and file a follow-up to pre-warm the session or emit the row earlier in the session lifecycle.

### U6 — GOD re-scan + cohesion + binding integrity

- Re-run the GOD architecture check: confirm the awaiting row is owned in Rust, TS does only presentation mapping, and no downstream repair was reintroduced.
- Confirm `acp-types.ts` is the generated artifact (regenerated, not hand-edited) and matches the Rust enum.
- `cargo clippy` clean in `src-tauri/`; `bun run check` + `bun test` clean in `packages/desktop` and `packages/ui`.

## Test Plan Summary

| Seam | File | Proves |
|------|------|--------|
| Awaiting predicate | `src-tauri/.../session_state_engine/graph.rs` | Condition true only in the Running+AwaitingModel+no-assistant gap; first-turn + RunningOperation→AwaitingModel boundary |
| Row emission | `src-tauri/.../transcript_viewport/projection.rs` | One ephemeral row, last, stable constant version, no links; absent otherwise; no id collision |
| Swap/delta (FollowingTail) | `src-tauri/.../transcript_viewport/{projection,viewport}.rs` | Bounded remove+insert; viewport stays in FollowingTail across the swap; reattach-to-nearest on detached scroll |
| TS mapping + height | `.../agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts` | Awaiting row → in-chat thinking View via fallback; estimated height ~36-40px |
| View contract | `.../agent-panel/components/__tests__/planning-labels.svelte.vitest.ts` | (Regression guard) thinking View label unchanged |
| Live | QA bridge (port 9223) | In-chat indicator during awaiting gap; cancel removes it; tool-step re-appearance bounded; no above-composer bar; initial-send timing |

## Risks & Mitigations

- **Flicker on the awaiting→assistant identity swap** (per the 2026-05-14 finalization learning). Mitigation: distinct stable identities (D2), constant awaiting `version` (no churn), bounded delta verified in U3, anchor-preservation assertion while detached.
- **Follow-tail not revealing the awaiting tail row after send** (per the 2026-04-07 handoff learning). Mitigation: U3 reveal-target check + U5 live QA; the row is `anchor_eligible` and at the tail so Rust follow-tail treats it as the reveal target.
- **Placeholder reappearing between tool steps.** Expected and desirable: after a tool result, before the next assistant token, `AwaitingModel` with no new assistant entry re-shows "Planning next moves…". Confirm in U5 it reads as intended, not as a flicker.
- **Binding drift.** The new enum variant must be regenerated into `acp-types.ts`; a hand-edit would diverge from Rust. U6 verifies generation.
- **Removing `agentPanelWaiting` breaks an unrelated consumer.** Mitigation: U4 work-time grep + the debug-lab/question-label carve-outs called out explicitly.
- **Stall/timeout: turn_state does not leave Running.** The `AwaitingModelRefreshStore` fires a session-state snapshot refresh after 5s of stuck `AwaitingModel`. Assumption: this refresh results in an updated activity/turn_state that exits Running, flipping the predicate false and removing the awaiting row. Verify in U1 test: confirm the predicate is false when `turn_state != Running` (the refresh path transitions to Idle or Error). If Rust can remain `Running + AwaitingModel` indefinitely after a stall, the awaiting row would persist forever — document and escalate if found.
- **IPC latency before first viewport push (pre-session gap).** Between the user clicking Send and Rust emitting the first viewport push, there is a brief IPC round-trip. During this window the TS `graph` is null and no viewport rows exist. This is expected behavior for the first send only; U5 quantifies the gap. If the gap is perceivable, mitigations include pre-creating the viewport at session dispatch time (Rust change) or retaining a minimal TS-side blank-state indicator (scope expansion to a future plan). The pre-session `deriveAgentPanelWaiting` branch is retired regardless; its IPC gap behavior is now the acknowledged baseline.

## Scope Boundaries

- **In scope:** Rust ephemeral awaiting row emission (covering both mid-session and initial post-send gaps); TS fallback mapping to `type:"thinking"`; full retirement of the pre-composer stopgap and **both branches** of the TS waiting-derivation (`graph === null` pre-session + post-session `AwaitingModel`); FollowingTail viewport swap test; cancel/tool-step QA; tests + live QA.
- **Out of scope:** Visual redesign of the indicator (the existing in-chat thinking View + shimmer is reused as-is). Broader viewport-authority changes from the rust-owned-transcript-viewport brainstorm. Persisting the placeholder into canonical transcript/history (explicitly rejected — D1). The unrelated `agent-tool-question` waiting label.

## Sequencing

U1 → U2 (canonical row renders in-chat) → U3 (swap correctness) → U4 (retire stopgap, only after in-chat render is verified, to avoid a regression window) → U5 (live QA) → U6 (GOD re-scan + integrity). U1 and U2 land together before U4.
