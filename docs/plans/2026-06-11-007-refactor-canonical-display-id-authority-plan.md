---
status: active
type: refactor
created: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture, candidate 3)
---

# refactor: One display-id authority for the transcript

## Summary

Display-id identity is assigned in three places with three schemes — Path A (history parser `event.display_id`), Path B (stored DB id via `normalize_tool_call_id`), Path C (live streaming `"tool-event-{seq}"`) — and the mismatch is patched downstream by two band-aids: the `ReplaceSnapshot` escape hatch (`transcript_projection/runtime.rs:276`) and the `#dupN` suffix guard (`transcript_viewport/projection.rs:72`). Promote a single **display-id authority** that every source path routes through, so history and live events agree on identity by construction. This is the deepest candidate and the most GOD-load-bearing: it moves transcript identity truth upstream so the downstream repairs become deletable.

---

## Problem Frame

When a session resumes, history is replayed (Path A or B) and then live events arrive (Path C). The three paths synthesize `entry_id` differently, so the *same* tool call can carry `tool-1` (stored) and `tool-event-N` (live). The live path's `tool_entry_ids_by_tool_call_id` then can't match, triggering `ReplaceSnapshot` — a full snapshot re-index. Separately, provider-derived id collisions are masked by appending `#dupN` ordinals in the viewport projection so the WebView keyed-each doesn't break. Both are downstream repairs of an upstream ambiguity: there is no single authority for display id. Per the GOD gate, transcript identity must be corrected canonically, never downstream — so the fix is to unify the authority, not to harden the band-aids. Additionally, `CanonicalTranscriptEvent.source: AgentType` embeds provider identity into canonical display-id derivation (`snapshot.rs`), which couples identity to provider and overlaps with candidate 2.

---

## Requirements

- R1. A single display-id authority assigns `entry_id` for transcript entries regardless of source path (history-canonical, stored, live-streaming).
- R2. History-then-live resume produces *matching* ids for the same logical entry/tool call — no `ReplaceSnapshot` fires for id-scheme mismatch on the resume seam.
- R3. The `#dupN` suffix guard in viewport projection is removed (or proven unreachable) because the authority guarantees unique ids upstream.
- R4. The `ReplaceSnapshot` escape hatch is removed or narrowed to genuine content replacement, not id-mismatch repair.
- R5. Provider identity (`source: AgentType`) is not load-bearing for display-id derivation (coordinate with candidate 2). Display id is Acepe-owned; provider id stays metadata.
- R6. Rendered transcript **order, content, and tool-call mapping** are unchanged; **display id values may change** as paths unify on the authority — fenced by characterization tests across all three paths and the resume seam. WebView keyed-each stability comes from upstream uniqueness, not preserving legacy id strings.

---

## Scope Boundaries

- Not changing the wire transcript-delta contract shape consumed by TS (separate seam; see candidate 8 discussion). The TS reducer continues to apply deltas; only the ids inside become consistent.
- Not redesigning history storage. Path B may keep reading stored rows — but the id it surfaces routes through the authority.
- Not removing `ReplaceSnapshot` as a *content* mechanism if it serves genuine content replacement; only its use as id-mismatch repair.

### Deferred to Follow-Up Work

- Fully unifying Path A and Path B into a single canonical-event replay (always produce `CanonicalTranscriptEvent` from history) — larger storage-path change; this plan unifies the *id authority* first, which is the load-bearing fix. Track the full path-unification as a later refactor.

---

## Context & Research

### Relevant Code and Patterns

- `transcript_projection/runtime.rs` (1,295) — `SessionTranscriptProjection`: `assistant_entry_id_for_chunk`/`current_turn_key`/`assistant_provider_key` (327–336), `ReplaceSnapshot` hatch (276), `tool_entry_ids_by_tool_call_id`, `close_assistant_entry_boundary`, `assistant_boundary_entry_count`.
- `transcript_viewport/projection.rs` (690) — `ensure_unique_display_row_ids` `#dupN` guard (72–81).
- `session_open_snapshot/mod.rs` (2,811) — historical replay; `TranscriptSnapshot::from_canonical_events` (Path A, uses `event.display_id`) and `from_stored_entries` (Path B, DB id via `normalize_tool_call_id`).
- Live path id synthesis: `apply_session_update_inner` (`"user-event-{seq}"`, `"assistant-event-{seq}"`, `"tool-event-{seq}"`).
- `canonical_event.rs` (38) — `CanonicalTranscriptEvent { source: AgentType, display_id, … }`; `transcript_projection/snapshot.rs` builds `entry_id`/`segment_id` from these (test fixtures hardcode `AgentType::ClaudeCode` — decouple in U2).
- **Terminology:** use `display_id` / `entry_id` per CONTEXT.md; `segment_id` where viewport layout requires it. Do not introduce synonyms.
- CONTEXT.md: "Display id — an Acepe-owned identifier for UI identity. Raw provider ids are metadata… unless the canonical model explicitly promotes them."

### Institutional Learnings

- GOD gate (CLAUDE.md): "For transcript bugs, never fix order in the UI. Canonical transcript order, identity, and tool-call mapping must be corrected before display projection." `#dupN` and id-mismatch `ReplaceSnapshot` are exactly the downstream repairs this forbids.
- Related prior work: `2026-05-28-001-refactor-rust-owned-transcript-viewport-plan.md`, `2026-05-29-001-refactor-rust-pushed-viewport-layout-index-plan.md` — establish the Rust-owned viewport the ids feed.

---

## Key Technical Decisions

- **Define a `DisplayId` authority** (a named module/function set) that derives the canonical `entry_id`/`segment_id` for a logical transcript element from canonical facts (turn key + element role + tool_call_id), *independent of source path and provider*. All three paths call it.
- **Resume seam reconciles by construction.** Because live and historical entries derive ids from the same authority over the same canonical keys, the live path's `tool_entry_ids_by_tool_call_id` lookups match — no `ReplaceSnapshot` for id reasons.
- **Decouple from provider (R5).** Stop using `source: AgentType` (and `assistant_provider_key` derived from raw `message_id`/`part_id`) as a load-bearing identity component; use canonical turn + role keys. **Sequence after or alongside plan 001** (`2026-06-11-001`) which removes provider-default leakage at deserialization.
- **Characterization before change.** This is high-risk canonical-identity surgery; a comprehensive characterization net across all three paths + the resume seam comes first.

---

## Open Questions

### Resolved During Planning

- Fix downstream (harden `#dup`/`ReplaceSnapshot`) or upstream? Upstream — GOD gate mandates correcting identity canonically. Resolved.

### Deferred to Implementation

- Whether the authority can fully replace Path B's `normalize_tool_call_id` or must wrap it — determined by reading how stored ids are consumed elsewhere.
- Exact id key composition (turn key + role + tool_call_id vs. event_seq-anchored) — settle against the characterization corpus so historical and live derive identically.
- Whether `ReplaceSnapshot` retains any legitimate content-replacement role after id unification.

---

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```
BEFORE
  history(canonical) ─ display_id ─┐
  history(stored)    ─ db id ───────┼─▶ TranscriptSnapshot ─▶ projection ─▶ #dupN guard
  live stream        ─ "tool-event-{seq}" ┘        │
                                                    └─ id mismatch ─▶ ReplaceSnapshot

AFTER
  history(canonical) ┐
  history(stored)    ┼─▶ DisplayIdAuthority(turn,role,tool_call_id) ─▶ ids agree ─▶ projection
  live stream        ┘                                   (ReplaceSnapshot id-repair + #dupN deleted)
```

---

## Implementation Units

### U1. Characterization net across all three id paths and the resume seam

**Goal:** Pin exact `entry_id`/order/tool-mapping output for Path A, Path B, Path C, and the history→live resume transition.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Test: `transcript_projection/` tests (extend), `session_open_snapshot/` tests
- Create: `transcript_projection/tests/resume_seam_display_id.vitest.rs` (or equivalent) — replay-then-live for a tool call; owned by U1, asserted through U3/U4

**Approach:**
- Build fixtures for: canonical-history replay, stored-history replay, pure live streaming, and resume (history then live event for the *same* tool_call_id). Assert ids, order, and tool-call mapping. Capture where `ReplaceSnapshot` and `#dupN` currently fire.

**Execution note:** Characterization-first — this is the safety net for canonical-identity surgery; do not change behavior here.

**Test scenarios:**
- Happy path: each path's snapshot ids/order recorded as golden.
- Edge case: duplicate provider-derived ids today → `#dupN` fires (record it).
- Integration (resume seam): history tool call + live update for same tool_call_id → record whether `ReplaceSnapshot` fires today.

**Verification:** Green on current code; resume-seam test documents the current id mismatch.

---

### U2. Introduce the `DisplayId` authority and decouple provider identity (R5)

**Goal:** A single module deriving canonical display ids from canonical keys, with no load-bearing `AgentType` input.

**Requirements:** R1, R5

**Dependencies:** U1; coordinate with plan 001 (provider identity must not leak into id derivation)

**Files:**
- Create: `transcript_projection/display_id.rs` (authority + key composition)
- Modify: `transcript_projection/snapshot.rs` (stop using `source: AgentType` for id derivation; update test fixtures)
- Test: `transcript_projection/tests` for the authority in isolation

**Approach:**
- Define id derivation from `(turn_key, element_role, tool_call_id | sequence)` without provider input. Unit-test that the same logical element yields the same id whether described in historical or live terms. Authority is unit-tested here before path routing in U3.

**Test scenarios:**
- Happy path: same `(turn, role, tool_call_id)` → identical id from historical-shaped and live-shaped inputs.
- Edge case: two distinct tool calls in one turn → distinct ids (no collision → `#dup` unnecessary).

**Verification:** Authority unit tests green; ids deterministic and provider-independent.

---

### U3. Route Path C (live) and Path A/B (history) through the authority

**Goal:** All three paths assign ids via the authority; resume seam ids match.

**Requirements:** R1, R2

**Dependencies:** U2

**Files:**
- Modify: `transcript_projection/runtime.rs` (live id synthesis, `assistant_entry_id_for_chunk`, tool-call id mapping)
- Modify: `session_open_snapshot/mod.rs` (`from_canonical_events`, `from_stored_entries`)

**Approach:**
- Replace `"tool-event-{seq}"` / `display_id` / DB-id assignment with authority calls keyed on canonical facts. Keep `ReplaceSnapshot`/`#dup` in place for now (removed in U4) but confirm via U1 they no longer fire on the resume seam.

**Test scenarios:**
- Integration (resume seam): history then live for same tool_call_id → ids match, `ReplaceSnapshot` does NOT fire (the U1 test flips to asserting no id-repair).
- Happy path: U1 golden snapshots reproduced through the authority.

**Verification:** Resume-seam characterization shows matching ids; all golden snapshots reproduced.

---

### U4. Delete the downstream band-aids

**Goal:** Remove the `#dupN` guard and the id-mismatch use of `ReplaceSnapshot`.

**Requirements:** R3, R4

**Dependencies:** U3

**Files:**
- Modify: `transcript_viewport/projection.rs` (remove `ensure_unique_display_row_ids` `#dupN`)
- Modify: `transcript_projection/runtime.rs` (remove/narrow `ReplaceSnapshot` id-repair at 276)

**Approach:**
- Delete `#dupN`; if any test relied on it firing, the authority should now prevent the collision it masked. Narrow `ReplaceSnapshot` to genuine content replacement or remove if unused.

**Test scenarios:**
- Edge case: the former `#dup` collision fixture now produces unique ids without suffixing.
- Integration: full resume + live stream renders identical rows (order, identity, mapping) to U1 goldens, with no id-repair path taken.

**Verification:** `#dupN` gone; `ReplaceSnapshot` no longer used for id mismatch; full suite green; GOD re-gate documented.

---

## System-Wide Impact

- **Interaction graph:** Touches live streaming, both history replay paths, and viewport projection — the entire transcript identity surface. Coordinate with candidate 2 (provider decoupling) and the Rust-owned viewport plans.
- **State lifecycle risks:** Resume is the highest-risk moment (history meets live). The U1 resume-seam characterization is the primary guard.
- **API surface parity:** TS receives consistent ids; the wire delta shape is unchanged. WebView keyed-each stability now comes from upstream uniqueness, not `#dup`.
- **Unchanged invariants:** Transcript order, content, and tool-call mapping are preserved; only id derivation is unified.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Unifying ids changes a previously-distinct id and breaks keyed-each | Med | High | Golden snapshots (U1) across all paths; authority tested for collision-freedom (U2) |
| A stored session created under the old scheme resumes under the new one and mismatches | Med | High | Resume-seam characterization includes old-scheme stored fixtures; authority derives from stable canonical keys, not persisted strings |
| `ReplaceSnapshot` had a legitimate content role | Low | Med | U4 narrows rather than blindly deletes; covered by content-replacement tests |
| Overlap/conflict with plan 001 provider work | Med | Med | **Hard sequencing:** land plan 001 U2–U3 before or in parallel with U2 here; both remove provider from canonical identity |
| Plan 008 Phase 2 touches projection apply while this plan changes live ids | Med | Med | Block plan 008 Phase 2 until U3 completes (see plan 008 U5 gate) |

---

## Sources & References

- Architecture review candidate 3 (verified file sizes + band-aid line refs).
- Related plans: `2026-05-28-001-refactor-rust-owned-transcript-viewport-plan.md`, `2026-05-29-001-refactor-rust-pushed-viewport-layout-index-plan.md`.
- CONTEXT.md (Display id; GOD gate); candidate 2 plan (`2026-06-11-001`).
