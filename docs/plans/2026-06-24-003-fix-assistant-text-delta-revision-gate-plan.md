---
title: "fix: Restore token-reveal by applying assistant-text-deltas on transcript-revision contiguity"
type: fix
status: active
created: 2026-06-24
depth: deep
god_check: passed (violation = consumers cross-comparing distinct canonical revision counters; fix = correct ordering authority + type-harden)
related:
  - docs/solutions/ui-bugs/assistant-text-reveal-streaming-block.md
---

# fix: Restore token-reveal by applying assistant-text-deltas on transcript-revision contiguity

## Summary

Token-reveal (the per-word streaming animation) is **dormant for Claude Code turns**: the canonical `RowTokenStream` and `clockAnchor` are never populated, so `buildTokenRevealCss` always returns `undefined` and assistant text renders as raw ~470ms transcript-delta blocks ("block-by-block reveal"). Root cause: `applyAssistantTextDelta` envelopes are **dropped whenever the three revision counters diverge** — the normal case — because two consumers cross-compare distinct canonical counters:

1. The router frontier gate requires `graph_revision === transcript_revision === last_event_seq`.
2. The reducer guards `transcript_revision <= graph_revision`.

The fix corrects the assistant-text-delta apply path to use **transcript-revision contiguity** (what the delta actually versions), mirroring the transcript-delta path and relying on the reducer's already-correct same-counter guards. Then we **type-harden** the three counters so a cross-kind comparison can't compile, killing the footgun that bit both consumers.

This is a confirmed, deterministically reproduced bug (red test already in the tree). Bug #2 (the "Planning next moves" placeholder during streaming) is a separate, already-fixed issue on this branch and is preserved, not re-opened.

---

## Problem Frame

### Confirmed mechanism

- **Live recorder** (temporary, removed) across a real Claude turn: `getRowTokenStreamByRowId` and `getClockAnchor` returned `null` for the entire turn → `buildTokenRevealCss` returned `undefined` → no token-reveal. The transcript still updated (text appeared in blocks), proving transcript deltas apply while assistant-text-deltas do not — from the *same* provider chunk.
- **Deterministic repro** (in tree, red): `SessionStore assistantTextDelta revision gate (bug #1 repro)` in `packages/desktop/src/lib/acp/store/__tests__/session-store-token-stream.vitest.ts` drives the real `SessionStore` with a snapshot at revision `{graphRevision: 5, transcriptRevision: 2, lastEventSeq: 8}` then a valid contiguous delta (`delta.revision: 3`, envelope `graphRevision: 6 / lastEventSeq: 9`). The token stream stays `null` — the delta is dropped.

### Why the counters diverge (normal case)

`SessionGraphRevision` (`packages/desktop/src-tauri/src/acp/session_state_engine/revision.rs`) holds three independent counters:

- `last_event_seq` — increments on **every** domain event (the canonical order authority per `CONTEXT.md` / GOD doc).
- `transcript_revision` — increments when a transcript entry changes.
- `graph_revision` — increments on lifecycle/activity/operation/turn changes.

By the time streaming text arrives, lifecycle/activity/turn events have already advanced `graph_revision` and `last_event_seq` past `transcript_revision`. So `graph_revision === transcript_revision === last_event_seq` is rare, and `transcript_revision <= graph_revision` is the norm.

### The two cross-counter comparisons (root cause)

- `packages/desktop/src/lib/acp/session-state/session-state-command-router.ts` — `envelopeFrontierMatchesAssistantTextDelta` requires `envelope.graphRevision === delta.revision && envelope.lastEventSeq === delta.revision`; on mismatch the router emits `refreshSnapshot` instead of `applyAssistantTextDelta`.
- `packages/desktop/src/lib/acp/store/envelope-reducer/reduce-command.ts` — `reduceApplyAssistantTextDelta` guards `if (delta.revision <= projection.revision.graphRevision) return [];`.

The reducer's **same-counter** guards are correct and must stay: `delta.revision < previousRow.revision` (stale per-row drop) and `delta.charOffset !== currentText.length` (append contiguity).

### Canonical precedent

`ViewportBufferDelta` already orders correctly: `packages/desktop/src-tauri/src/acp/session_state_engine/protocol.rs` documents that a monotonic `emission_seq` is the apply-ordering authority and the revision fields are diagnostics. The assistant-text-delta path is the one that drifted. The transcript-delta path (`session-state-command-router.ts`, the `transcriptDelta` case) gates on graph-revision *contiguity against the current frontier* and applies correctly — that is the shape to mirror, using `transcript_revision`.

---

## Key Technical Decisions

- **Ordering authority = transcript-revision contiguity** (Fork A, user-selected). The assistant-text-delta versions the transcript, so apply-ordering keys on `transcript_revision` measured against the store's current transcript frontier: apply when contiguous, drop when stale, `refreshSnapshot` on a forward gap. We do **not** introduce a new per-stream `emission_seq` (no Rust emission change needed for the core fix) and do **not** use `last_event_seq` (too coarse for a per-row text stream). Rationale: the delta is a transcript-frontier concept; the reducer's per-row + charOffset guards already provide ordering/idempotency, so the router only needs gap detection.
- **Reducer is the same-counter authority.** Remove only the cross-counter `delta.revision <= graph_revision` guard; keep the per-row revision and charOffset guards. If a forward gap is detectable in the reducer (charOffset mismatch), it should surface a refresh rather than silently returning `[]`, so a dropped middle delta cannot permanently stall the stream.
- **Type-harden the three counters** (Fork B, user-selected): brand them in TypeScript so `graphRevision === transcriptRevision` (and similar cross-kind comparisons) fail to compile. This is the durable fix — it caught two sites and would catch the next. Scoped to TS (where the bug lives); Rust newtypes deferred (see Scope Boundaries).
- **Rust changes allowed but not required** (Fork C). The core fix is TS-only; Rust stays as the correct emitter. The plan keeps the door open for a Rust-side type/alignment change only if type-hardening surfaces a genuine need.
- **Un-mask the test helper.** `createAssistantTextDeltaEnvelope` in the token-stream test forces `graphRevision = lastEventSeq = delta.revision`, which hid the bug. Add a divergent-revision variant so future tests exercise realistic frontiers.

---

## High-Level Technical Design

Apply-path contiguity (directional guidance for review, not implementation spec — treat as context, not code to reproduce):

```text
Router (assistantTextDelta envelope):
  let frontier = current transcript revision known to the store
  if delta.revision > frontier + 1   -> refreshSnapshot          // TRUE forward gap only
  else                               -> applyAssistantTextDelta   // incl. at/just-after frontier
  // Compare ONLY transcript_revision; graph_revision & last_event_seq are diagnostics.
  // Do NOT drop deltas at the current frontier: real streaming can emit several
  // char-appends that share one transcript_revision. The router only detects gaps;
  // the reducer's charOffset + per-row guards are the fine ordering/idempotency
  // authority within a revision.

Reducer (reduceApplyAssistantTextDelta):
  keep: delta.revision < previousRow.revision            -> drop (stale, same counter)
  keep: delta.charOffset !== currentText.length          -> not contiguous
        (surface refresh instead of silent [] on a true forward gap)
  remove: delta.revision <= projection.revision.graphRevision   // cross-counter — DELETE
```

Type-hardening (TS):

```text
type GraphRevisionNum      = number & { readonly __brand: "graphRevision" }
type TranscriptRevisionNum = number & { readonly __brand: "transcriptRevision" }
type EventSeqNum           = number & { readonly __brand: "lastEventSeq" }
// SessionGraphRevision fields adopt these; cross-kind `===` no longer typechecks.
```

---

## System-Wide Impact

- **Streaming reveal** activates for all providers whose envelopes have divergent revisions (i.e., realistic streaming), not just Claude. Verify no provider regresses (Codex/Cursor) — they share the same apply path.
- **Idempotency / ordering** must not regress: replayed envelopes, stale duplicates, and genuine gaps still need the same outcomes (drop / refresh). The existing replay/idempotency tests in `session-store-token-stream.vitest.ts` are the guard.
- **Type-hardening** touches every site that constructs/compares `SessionGraphRevision` fields — a compile-surface change (mechanical, but wide). `bun run check` enumerates the fallout.

---

## Implementation Units

### U1. Router: apply assistant-text-delta on transcript-revision contiguity

**Goal:** Replace the `graph_revision === transcript_revision === last_event_seq` equality gate with a transcript-revision contiguity check against the current frontier, so valid streaming deltas route to `applyAssistantTextDelta` instead of `refreshSnapshot`.

**Requirements:** Fixes root cause #1. Half of the repro fix (repro greens after U1 + U2).

**Dependencies:** none.

**Files:**
- `packages/desktop/src/lib/acp/session-state/session-state-command-router.ts` (replace `envelopeFrontierMatchesAssistantTextDelta` logic / the `assistantTextDelta` case).
- `packages/desktop/src/lib/acp/session-state/__tests__/` — router-level test (create if absent; mirror existing router test location/pattern).

**Approach:** Mirror the `transcriptDelta` case's "contiguity against current frontier" shape, but key on `transcript_revision`. Refresh (`refreshSnapshot`) only on a **true forward gap** (`delta.revision > currentTranscriptRevision + 1`); otherwise `applyAssistantTextDelta` — including at/just-after the frontier, since real streaming emits several char-appends sharing one `transcript_revision` and the reducer's `charOffset` + per-row guards are the within-revision authority. Stop reading `envelope.graphRevision` / `envelope.lastEventSeq` for this decision (they remain diagnostics). Determine where the router obtains the current transcript frontier (the `transcriptDelta` case already reads current revision — reuse that source).

**Patterns to follow:** the `transcriptDelta` case in the same file (`currentRevision` / `currentGraphRevisionFrom` usage, gap→`refreshSnapshot`).

**Test scenarios:**
- Divergent revisions, contiguous transcript step (snapshot transcript 2, delta.revision 3, envelope graph 6 / seq 9) → emits `applyAssistantTextDelta` (not refresh).
- Additional delta at the current frontier (delta.revision == current transcript revision — a same-revision char-append) → still emits `applyAssistantTextDelta` (router does not drop; reducer's charOffset orders it).
- True forward gap (delta.revision > current transcript revision + 1) → emits `refreshSnapshot`.
- Equal-revisions case (graph == transcript == seq, today's masked shape) → still applies (no regression).

**Verification:** router unit tests pass; the store repro test is still red (reducer guard remains) but now fails *only* at the reducer stage.

---

### U2. Reducer: drop the cross-counter guard, keep same-counter ordering

**Goal:** Remove `delta.revision <= projection.revision.graphRevision` from `reduceApplyAssistantTextDelta`; rely on the per-row revision and charOffset guards, surfacing a refresh on a true forward gap rather than a silent drop.

**Requirements:** Fixes root cause #2. Completes the repro fix (store repro greens after U1 + U2).

**Dependencies:** U1.

**Files:**
- `packages/desktop/src/lib/acp/store/envelope-reducer/reduce-command.ts` (`reduceApplyAssistantTextDelta`).
- `packages/desktop/src/lib/acp/store/envelope-reducer/__tests__/reduce-command.vitest.ts` (extend).

**Approach:** Delete the cross-counter guard. Keep `delta.revision < previousRow.revision` (stale) and `delta.charOffset !== currentText.length` (contiguity). For a charOffset mismatch that indicates a missed middle delta, prefer emitting a refresh signal (consistent with the router's gap handling) over a silent `[]`, so the stream cannot permanently stall. Confirm `clockAnchor` is set on the first applied delta (it is, today) so reveal activates.

**Patterns to follow:** existing guards in `reduceApplyAssistantTextDelta`; the refresh command shape used by `reduceRefreshSnapshot`.

**Test scenarios:**
- First valid delta with divergent revisions (graph 5 ahead of transcript 2) → token stream + `clockAnchor` populated (the previously-dropped case).
- Stale per-row delta (`delta.revision < previousRow.revision`) → dropped.
- charOffset mismatch (gap) → does not corrupt `accumulatedText`; surfaces refresh rather than silent loss.
- Replayed identical delta → idempotent (no double-append), matching existing replay tests.

**Verification:** `reduce-command.vitest.ts` passes; the store repro test (`SessionStore assistantTextDelta revision gate`) now **passes** (token stream + clock anchor non-null).

---

### U3. Type-harden the three revision counters

**Goal:** Brand `graphRevision`, `transcriptRevision`, `lastEventSeq` in TypeScript so cross-kind comparison/assignment fails to compile, preventing recurrence of the cross-counter bug.

**Requirements:** Durable prevention (the deepening). Per `god-architecture-check`: move to one unambiguous authority and make misuse impossible.

**Dependencies:** U1, U2 (the corrected comparisons must compile under the new types).

**Files:**
- `packages/desktop/src/lib/services/acp-types.ts` (or wherever `SessionGraphRevision` is declared in TS) — introduce branded types and adopt them on the three fields.
- All TS sites that construct or compare these fields (enumerated by `bun run check`): router, reducer, projection, store, test factories.

**Approach:** Define nominal/branded numeric types per counter and apply to `SessionGraphRevision`. Provide minimal constructors/coercion at the Rust→TS envelope boundary (where raw numbers enter). Fix the compile fallout; each fix should make the intended counter explicit. Do not weaken the brands with broad `as` casts — only coerce at the system boundary where untyped numbers arrive.

**Patterns to follow:** existing branded-type usage in the codebase if present; otherwise the standard `number & { readonly __brand }` idiom.

**Test scenarios:**
- Test expectation: none for the type change itself (compile-time). Behavioral coverage comes from U1/U2 tests.
- Add one negative compile guard if the repo has a type-test pattern (e.g., `tsd`/`expect-error`) asserting `graphRevision === transcriptRevision` does not typecheck; otherwise note it as a compile-time invariant in the unit description.

**Verification:** `bun run check` passes with the brands in place; attempting a cross-kind comparison is a compile error (verified manually or via type-test).

**Execution note:** mechanical compile-driven refactor — let `bun run check` drive the change surface.

---

### U4. Reveal integration coverage + live verification

**Goal:** Prove end-to-end that a streaming turn with realistic divergent revisions now activates token-reveal, and verify live that a Claude turn reveals continuously while bug #2's placeholder fix still holds.

**Requirements:** End-to-end confirmation; guards against silent regression of the whole reveal pipeline.

**Dependencies:** U1, U2.

**Files:**
- `packages/desktop/src/lib/acp/store/__tests__/session-store-token-stream.vitest.ts` (keep the repro green; add a divergent-revision variant of `createAssistantTextDeltaEnvelope` so realistic frontiers are exercised, and un-mask the forced-equal helper).
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/agent-panel-pipeline-integration.test.ts` (extend: drive a streaming sequence and assert `buildTokenRevealCss` returns defined CSS once deltas apply — reveal is no longer dormant).

**Approach:** At the store seam, assert that after applying divergent-revision deltas the `RowTokenStream` and `clockAnchor` populate and `buildTokenRevealCss` yields a defined `TokenRevealCss` with `mode: "smooth"` (reduced-motion off). Keep bug #2's `agent-panel-pipeline-integration.test.ts` placeholder assertions intact. Then live-verify per `acepe-dev-app-qa`: drive a Claude streaming turn and DOM-confirm continuous word reveal and absence of the "Planning next moves" leak.

**Test scenarios:**
- Store: divergent-revision delta sequence → `buildTokenRevealCss` returns defined CSS (reveal active). Covers the end-to-end fix.
- Store: reduced-motion / instant mode still yields instant (no regression).
- Integration: placeholder still absent while message text streams (bug #2 preserved).
- Live QA (evidence, not unit test): continuous reveal + no placeholder; recorded via the QA CLI.

**Verification:** integration + store suites green; live QA evidence captured. Note: the dev app showed relaunch churn earlier (managed-CLI auto-updater writing `*.tmp` under `src-tauri/`); stabilize before live QA if it recurs.

---

## Risk Analysis & Mitigation

- **Idempotency/ordering regression.** Relaxing the gate could let stale or out-of-order deltas through. Mitigation: U2 keeps same-counter guards; U1 preserves stale-drop + gap→refresh; existing replay/idempotency tests (`session-store-token-stream.vitest.ts`) must stay green.
- **Gap handling.** A missed middle delta must trigger refresh, not silent stall. Mitigation: U2 surfaces refresh on charOffset gaps; U1 refreshes on forward transcript gaps.
- **Type-hardening blast radius.** Branding three widely-used fields can touch many files. Mitigation: `bun run check` enumerates; if the surface is larger than expected, U3 may split (brand types first, adopt incrementally) — but the bug fix (U1+U2) does not depend on U3.
- **Other providers.** The fix changes a shared path. Mitigation: U4 asserts reduced-motion/instant unaffected; live-verify at least one non-Claude provider if feasible.
- **Live QA instability.** Dev-app relaunch churn blocked earlier verification. Mitigation: U4 notes stabilization (ignore `*.tmp` in `.taurignore`, or verify once churn settles).

---

## Scope Boundaries

In scope: the assistant-text-delta apply path (router gate + reducer guard), TS type-hardening of the three counters, and reveal integration/live verification.

### Deferred to Follow-Up Work
- **Rust newtypes** for `SessionGraphRevision` counters (revision.rs) — prevents a hypothetical Rust-side recurrence; no evidence one exists today, and it's a wide Rust rollout.
- **Per-stream `emission_seq`** for assistant-text-delta (the viewport-style authority) — only if transcript-revision contiguity proves insufficient in practice.
- Stabilizing the dev-app `*.tmp` relaunch churn (separate dev-env issue).

Out of scope: Rust envelope emission (already emits the correct three counters), the transcript-delta and viewport-delta paths (already correct), and bug #2 (the planning placeholder — already fixed on this branch via `session-status-mapper` `hasActiveStreamingTail` gating; preserved by U4).

---

## Test Strategy & Execution Posture

Execution note (all behavioral units): test-first. The end-to-end red repro already exists (`SessionStore assistantTextDelta revision gate`). Add router-level (U1) and reducer-level (U2) failing tests at their seams before changing each, then make them green; the store repro greens after U2. U3 is compile-driven. U4 closes with mandatory live DOM QA. Keep all existing `session-store-token-stream.vitest.ts` replay/idempotency tests green throughout.
