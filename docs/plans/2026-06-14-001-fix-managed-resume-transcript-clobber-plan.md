---
title: "fix: Managed session resume must publish canonical transcript truth, not a fabricated-empty transcript"
type: fix
status: active
date: 2026-06-14
depth: deep
---

# fix: Managed session resume must publish canonical transcript truth, not a fabricated-empty transcript

## Summary

Restored **managed** sessions (`is_acepe_managed = 1`, e.g. the "G7" session) render the empty
"Ready to assist" placeholder despite having rich, completed history. The proximate cause is a **canonical-producer
ordering defect in Rust**: `acp_resume_session` publishes its session-state `Snapshot` envelope **before** it
hydrates the `TranscriptProjectionRegistry` from the provider-owned snapshot. The pre-hydration publish hits
`build_snapshot_envelope`'s empty fallback, which **fabricates an empty transcript** (stamped at
`transcript_revision 0` via the registry-miss `unwrap_or(0)` in `load_live_session_graph_revision`, while
`graph_revision` rides the journal frontier). The frontend applies that canonical `Snapshot` via a **wholesale
`replaceGraph`** (gated only on canonical-session-id + frontier consistency, *not* on transcript-revision
staleness), replacing whatever transcript the FE held with empty.

This plan moves transcript truth upstream: the resume path must hydrate the canonical transcript **before**
publishing any transcript-bearing session-state snapshot. The fix reorders machinery that **already exists inside
the same function** (`load_provider_owned_session_snapshot` + `materialize_provider_owned_thread_snapshot` +
`restore_session_snapshot`, currently at `resume.rs:341-374`, running too late) and hardens the producer so it
can never again synthesize an empty transcript and publish it as canonical truth.

> **⚠️ The producer-only fix may be necessary-but-insufficient.** Document review (2026-06-14) found the causal
> model is under-verified at the **frontend-gate seam**: there are three FE producers that paint this
> session — `replaceSessionOpenSnapshot` (unconditional), `reduceReplaceGraph` (revision-gated), and the
> `refreshCanonicalSessionState` poll (revision-gated) — and whether the corrected resume publish actually wins
> the FE gate depends on revision arithmetic the plan has not empirically pinned. **See `## Open Verification
> Blocker` — this must be resolved before `/ce:work`.**

**This is a GOD-gate canonical-producer fix. No UI repair.** Whether the FE revision-gate is *also* canonically
wrong (treating an equal-revision snapshot whose transcript content differs as "stale") is an open question raised
by review — see the Open Verification Blocker; do not assume "the frontend is correct" as an axiom.

---

## Open Verification Blocker (resolve before `/ce:work`)

Document review (2026-06-14, four personas) accepted the *producer defect* but found the **end-to-end causal
model is not empirically grounded** at the seam where the Rust producer meets the FE revision-gate. Two reviewers
independently traced the FE deeper than the investigation did and surfaced contradictions the plan cannot resolve
by reading code alone. **These must be settled before implementation, because they determine whether the
producer-only fix actually changes the rendered outcome.**

**B-1 — The "managed skips `get_session_open_result`" premise may be false on fresh launch.**
`earlyPreloadPanelSessions` (`initialization-manager.ts:640-667`) calls `openPersistedSession` for **every** panel
on a cold launch — not just non-managed ones. `openPersistedSession` runs `get_session_open_result` (which
hydrates the registry via `restore_session_open_authority`) **and** the unconditional `replaceSessionOpenSnapshot`
*before* `reconnectHydratedSession` fires the resume. If that ordering holds, the registry is *already hydrated*
when resume publishes — which contradicts the Problem Frame's "registry is empty at resume-publish time" and means
the true trigger is **revision arithmetic / a race between three FE producers**, not "managed skips open." The
managed-only asymmetry would then live somewhere else (e.g. preload skipped for managed, or a revision race), and
the producer fix may be necessary-but-insufficient.

**B-2 — The fabricated empty is stamped at `transcript_revision 0`, but the FE was observed at `203`.** Per
feasibility review, `load_live_session_graph_revision` returns `unwrap_or(0)` for the transcript revision on a
registry miss, so the fabricated-empty snapshot carries `transcript_revision 0` — yet the FE graph was observed at
`transcriptRevision: 203`. These cannot both be the same event. Either (a) the clobber is a *wholesale*
`replaceGraph` that ignores transcript-revision (so `203` is a later, separate producer's stamp), or (b) a
different producer empties it. **The plan's revision arithmetic is unverified**, and U1/U3 assertions that hand-feed
`SessionGraphRevision::new(204, 203, 204)` may be testing a revision combination that never occurs in production.

**B-3 — "The frontend is correct" is an unproven axiom (KTD-3).** The recovery path
(`refreshCanonicalSessionState`, revision-gated) treats an equal-revision snapshot whose transcript content
*differs* as stale and refuses it — which is *why* the empty state is sticky. Whether that gate is itself a
canonical defect (content-blind equal-revision rejection) is unexamined. If it is, the deferred FE-recovery item is
not deferrable — it is co-primary.

### Required to clear this blocker

Capture the **actual ordered producer log + FE transcript-revision trace** for one reproduction — the
instrumentation step deferred earlier. Specifically, for a managed provider-backed session on cold launch, log in
order: every `publish_session_state_envelope` (payload kind + `graph_revision` + `transcript_revision` +
entry count) from Rust, and every FE producer that writes `sessionStateGraphs[G7]`
(`replaceSessionOpenSnapshot` / `reduceReplaceGraph` / `refreshCanonicalSessionState`) with the revision it
applied or rejected. That single trace collapses B-1, B-2, and B-3: it shows whether the registry is hydrated at
resume-publish, which producer stamps the empty, at what revision, and which gate makes it sticky.

**Until this trace exists, treat KTD-1/KTD-2 as the leading hypothesis, not settled fact.** The mechanical
corrections below (fixture extraction, None-only guardrail, concrete-type seam) hold regardless; the *test
assertions* (U1/U3 revision values) should be finalized from the trace, not from the assumed `(204, 203, 204)`.

---

## Problem Frame

### Observed behavior

- A completed, content-rich managed session ("G7": project `godmode`, `sequence_id = 7`, `is_acepe_managed = 1`)
  renders the empty `ReadyToAssistPlaceholder` ("Ready to assist / Start typing to begin").
- Non-managed raw-provider sessions (e.g. "What branch are we?") in adjacent panels render their full transcript
  correctly.
- The empty state is **sticky**: clicking G7 does not recover it.

### Evidence chain (settled during investigation)

1. **Rust canonical open authority is correct.** `get_session_open_result(G7)` returns `transcriptSnapshot.entries`
   with 17 entries; `acp_get_session_state(G7)` returns a populated transcript. The persisted JSONL (141 lines) and
   journal (204 events) are intact.
2. **The frontend graph is emptied at a high revision.** The FE canonical graph `sessionStateGraphs[G7]` is present
   but has `entries: 0` at `transcriptRevision: 203`, `graphRevision: 204`, `lifecycle: "ready"`.
3. **Only a `snapshot` envelope can empty a transcript.** `routeSessionStateEnvelope`
   (`packages/desktop/src/lib/acp/session-state/session-state-command-router.ts`) only replaces the transcript via a
   `snapshot` envelope → `replaceGraph`. A `delta` envelope's `applyGraphPatches` cannot touch the transcript. So the
   empty transcript arrived as a canonical `Snapshot` envelope and the FE applied it correctly.
4. **The empty transcript is fabricated in Rust.** `build_snapshot_envelope`
   (`packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs:745-750`) falls back to
   `TranscriptSnapshot { revision: revision.transcript_revision, entries: Vec::new() }` when the
   `TranscriptProjectionRegistry` has no entry for the session. **Note (see Open Verification Blocker B-2):** on a
   registry miss `load_live_session_graph_revision` returns `unwrap_or(0)`, so the fabricated empty is stamped at
   `transcript_revision 0`, **not** the `203` observed in step 2. The relationship between the rev-0 fabrication and
   the observed rev-203 FE state is *not yet reconciled* and must be settled by the instrumentation trace before the
   U1/U3 revision assertions are finalized.
5. **The resume path publishes before it hydrates.** `acp_resume_session`
   (`packages/desktop/src-tauri/src/acp/commands/session_commands/resume.rs:137-160`) computes the live revision and
   **publishes** the snapshot envelope in the synchronous pre-spawn section. The transcript-registry hydration from
   the provider-owned snapshot happens later, inside the spawned task, at `resume.rs:341-374` — **after** the publish.
6. **Managed-only asymmetry.** `restore_session_open_authority`
   (`packages/desktop/src-tauri/src/history/commands/session_loading.rs:759-810`) hydrates the registry, but it runs
   *inside* `get_session_open_result`. Non-managed sessions first contact via `openPersistedSession`
   (`clearSessionEntries` + the **unconditional** `replaceSessionOpenSnapshot` at
   `packages/desktop/src/lib/acp/store/session-store.svelte.ts:1773-1860`), so by the time their resume publishes,
   the registry is already hydrated. Managed sessions auto-resume at startup via `acp_resume_session` **without** a
   preceding `get_session_open_result`, so the early publish hits an empty registry. Once G7 is auto-opened and
   clobbered at startup, clicking it never re-runs `openPersistedSession`, so the unconditional re-hydration that
   would fix it never fires → sticky empty.

### Root cause (leading hypothesis — pending the Open Verification Blocker trace)

`acp_resume_session` publishes a transcript-bearing canonical `Snapshot` envelope before the
`TranscriptProjectionRegistry` is hydrated, so `build_snapshot_envelope` fabricates an empty transcript (at
`transcript_revision 0`) and that empty snapshot clobbers — via a wholesale `replaceGraph` — the real restored
history, which the revision-gated recovery path then refuses to re-apply (sticky empty). The exact producer that
stamps the FE's observed `transcriptRevision 203`, and whether the registry is genuinely unhydrated at
resume-publish on cold launch (vs. already hydrated by `earlyPreloadPanelSessions`), are **unconfirmed** — see the
Open Verification Blocker.

---

## GOD Architecture Attestation

- **Authority surface:** Canonical transcript (Rust provider/history adapters) and `SessionStateGraph` (Rust).
- **Violation classified:** Canonical producer (`build_snapshot_envelope`) synthesizes canonical transcript truth
  from nothing (`entries: Vec::new()` at a real frontier revision), published by the resume path before hydration.
  This is a "fabricate canonical truth downstream" violation, not a reader/UI patch.
- **Direction of fix:** Move truth upstream — hydrate the canonical transcript before the producer emits, and forbid
  the producer from emitting a fabricated-empty transcript-bearing snapshot.
- **What this plan must NOT do:** No UI order/identity repair. No frontend reducer change. No
  `canonical ?? hotState` fallback. The frontend correctly applies a canonical snapshot; the defect is entirely in
  the Rust producer/ordering.

---

## Scope Boundaries

### In scope

- Reorder/guarantee transcript-registry hydration **before** the resume-time session-state snapshot publish.
- Harden `build_snapshot_envelope` so it cannot publish a fabricated-empty transcript-bearing snapshot at a non-zero
  frontier revision (guardrail / defense-in-depth).
- Red-first Rust tests reproducing the managed-resume clobber with a **provider-history-backed** fixture.

### Deferred to Follow-Up Work

- **Frontend revision-gating recovery for already-clobbered sessions.** Today, a managed session that was already
  clobbered in a prior run cannot recover by clicking (re-hydration is gated as stale, and `openPersistedSession`
  is not re-invoked for an already-open session). Once the producer no longer fabricates empty, *new* sessions never
  enter the bad state; but a defensive "user-initiated open is authoritative re-hydration that bypasses live
  revision-gating" correction may still be worth it. Flagged here; **not** part of the primary producer fix. If
  investigation shows existing bad-state sessions are common in practice, split this into its own plan.

### Outside this product's identity

- N/A — this is a correctness fix, not a product-shape change.

---

## Key Technical Decisions

### KTD-1 — Primary fix: hydrate the transcript registry before the early snapshot publish (Option A)

The resume path already loads the provider-owned snapshot and calls `restore_session_snapshot` — it just does so
**after** the early publish (`resume.rs:341-374` runs in the spawned task; the publish is at `resume.rs:137-160`).
The fix ensures the `TranscriptProjectionRegistry` is hydrated from the canonical open-snapshot materialization
**before** the early publish, so `build_snapshot_envelope` reads real entries instead of fabricating empty.

**Rationale:**
- The machinery already exists in-function; this is moving an existing step earlier, not inventing a new path.
- `load_provider_owned_session_snapshot(app, replay_context)` needs only `app` + `replay_context` — **not** the live
  agent client (`create_and_initialize_client`). So the transcript hydration can run before the early publish without
  waiting on (potentially slow) agent connection. The early publish stays early; it just becomes correct.
- It produces a single correct publish — no second "repair" snapshot, so it sidesteps the revision-gating fight that
  a late-correcting snapshot at a lower revision would lose.

**Directional shape (guidance for review, not implementation spec):**

```
acp_resume_session / resume_session_with_app_handle_and_worker:
  1. transition lifecycle -> activating                          (unchanged)
  2. HYDRATE transcript registry from provider-owned snapshot:    (HOISTED — was step 5)
       snapshot = load_provider_owned_session_snapshot(app, replay_context)
       if snapshot: materialize + restore_session_snapshot(session_id, transcript)
       else:        fall back to load_transcript_snapshot_for_resume_with_app (journal)
  3. revision = load_live_session_graph_revision(...)            (unchanged, now over a hydrated registry)
  4. publish build_snapshot_envelope_for_session(...)            (unchanged call — now carries real entries)
  5. spawn work(create_and_initialize_client, ...)              (no longer re-does transcript hydration)
```

**Open implementation question (resolve in `ce-work`, not here):** the exact function boundary — whether the
hydration block currently at `resume.rs:341-374` is inside the spawned `work` closure or the pre-spawn body, and
how much of it (transcript only, vs the projection-registry restore at `resume.rs:376-379`) must move ahead of the
publish. The transcript-registry hydration is the load-bearing part for this bug; the projection-registry restore
may move with it or stay, as long as no behavior regresses. The implementer confirms the boundary against current
code and avoids double-hydration (do not hydrate twice).

### KTD-2 — Guardrail: producer must not fabricate an empty transcript-bearing snapshot (Option B)

Independently of ordering, `build_snapshot_envelope`'s empty fallback (`runtime_registry.rs:745-750`) is a latent
GOD violation: it manufactures `entries: Vec::new()` stamped at the live frontier revision. Even with KTD-1, a
future caller could re-introduce a pre-hydration publish. The guardrail makes the producer refuse to fabricate:
when the registry misses for a session whose persisted state indicates real history exists, the producer must not
emit a transcript-bearing `Snapshot` that asserts an empty transcript at a non-zero frontier revision.

**Decision (settled by review): suppress to `None` only — do NOT emit a lifecycle-only envelope.**
- **(b1)** self-hydrate inside the producer from the canonical materialization — **rejected**: pushes provider IO
  into a hot producer path.
- **(b2-lifecycle)** emit a lifecycle-only envelope on the miss — **rejected** (adversarial F2): a lifecycle-only
  `Snapshot`/envelope still **advances `graph_revision`** (e.g. to 204). That advanced frontier then revision-gates
  out the *later, correct* transcript-bearing snapshot — re-creating the exact clobber-then-gate failure this plan
  exists to kill, just without the empty entries. A guardrail that advances the frontier is not a guardrail.
- **(b2-suppress)** return `None` — **chosen**: on a registry miss where history is expected, publish **nothing**.
  Advance no revision. The FE keeps whatever transcript it has; the correct transcript arrives via the normal
  hydrated path (KTD-1) without any gate to beat.

**Rationale:** the producer must never assert "this session has zero transcript" when it cannot back that claim, and
it must never advance the canonical frontier on a path that carries no real transcript — doing so weaponizes the FE
revision-gate against the subsequent correct snapshot. Suppression is the only honest behavior that does not create
a gate. KTD-1 guarantees the registry is hydrated in the real flow, so suppression only triggers in
genuinely-unhydrated edge cases, where emitting nothing is strictly safer.

> **U3/U4 must assert the no-frontier-advance property:** the guardrail path must not bump `graph_revision` (or any
> revision) such that a later correct snapshot is gated out. Asserting merely "transcript is non-empty / not
> fabricated" is insufficient — a lifecycle-only variant would pass that and still re-create the bug.

**Scope guard:** the empty fallback IS legitimate for a brand-new session that genuinely has no transcript yet
(frontier `transcript_revision == 0`, no journal/provider history). The guardrail must distinguish "no history yet"
(empty is true) from "history exists but registry unhydrated" (empty is a fabrication). Use the persisted signal
already available to the builder (session metadata + the `revision` it is handed) to make this distinction; do not
break the new-session path.

### KTD-3 — Frontend is out of scope and must not change

The frontend correctly applies a canonical snapshot. `routeSessionStateEnvelope` → `replaceGraph` and
`replaceSessionOpenSnapshot` are behaving as designed. No TypeScript change is part of this fix. (The deferred
revision-gating recovery item, if ever taken, is a separate plan.)

### KTD-4 — Test fixtures must be provider-history-backed (close the materialization-completeness trap)

G7's transcript is provider-history-backed (JSONL), merged with journal text at the open seam.
`rebuild_local_transcript_snapshot` (`session_journal.rs:303`) rebuilds from **journal only** and is insufficient —
a journal-only fix would still fail real provider-backed sessions, and a journal-seeded test would be greened by
that incomplete fix. Therefore every red test in this plan sources its transcript from a **provider**
`SessionThreadSnapshot` fixture (via `ProviderOwnedSessionSnapshot::from_thread_snapshot` +
`materialize_provider_owned_thread_snapshot`, using the existing `make_assistant_entry` / `make_user_entry` /
`make_tool_call_entry` builders in `session_open_snapshot/mod.rs` tests), never from journal events alone. A fix that
only consults the journal must not be able to pass these tests.

---

## System-Wide Impact

- **Producer (`build_snapshot_envelope`):** behavior change on registry-miss (KTD-2). Affects every caller that
  builds a snapshot envelope — verify existing snapshot-repair tests (`runtime_registry.rs` tests around lines
  2837-3010) still pass; the new-session/empty-history path must remain unaffected.
- **Resume orchestration (`acp_resume_session`):** ordering change (KTD-1). Verify the early publish still fires for
  the lifecycle/activity signal and that no double-hydration occurs.
- **Frontend:** none (KTD-3).
- **Affected parties:** users resuming managed sessions (primary beneficiaries); developers maintaining the resume
  and snapshot-producer paths.

---

## Implementation Units

Units are dependency-ordered. **TDD red-first is mandatory** (CLAUDE.md Hard Rule 4): the red test unit (U1)
precedes the fix (U2), and the guardrail red test (U3) precedes the guardrail (U4). Confirm RED for the right reason
before each implementation unit.

### U0. Prerequisite — expose provider-fixture builders as `pub(crate)` test support

**Goal:** Make the provider `SessionThreadSnapshot` fixture builders usable from the `resume.rs` and
`runtime_registry.rs` test modules without re-implementing them.

**Why (feasibility F1, high):** `make_provider_thread_snapshot`, `make_assistant_entry`, `make_user_entry`, and
`make_tool_call_entry` currently live **inside** `session_open_snapshot/mod.rs`'s private `#[cfg(test)] mod tests`.
They are **not reachable** from another module's test code as written — U1/U3 as drafted would not compile. This
unit removes that blocker before any red test is authored.

**Dependencies:** none (must land first).

**Files:**
- `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs` (or a new sibling `*_test_support.rs`).

**Approach:**
- Move the fixture builders into a `#[cfg(test)] pub(crate) mod test_support` (or `#[cfg(any(test, feature = ...))]`
  per existing repo convention) so `resume.rs` and `runtime_registry.rs` tests can import them. Do **not** widen them
  to non-test builds. Confirm the existing `session_open_snapshot` tests still consume them unchanged.

**Verification:** `cargo test` for `session_open_snapshot` still green; the builders resolve from the two consumer
test modules (proven when U1/U3 compile).

### U1. Red test — managed resume publishes the restored transcript, not a fabricated-empty one

**Goal:** A failing test proving that, for a provider-history-backed restored session, the resume-time session-state
snapshot carries the restored transcript entries (non-empty) rather than an empty transcript at the frontier
revision.

**Requirements:** Primary bug reproduction (Problem Frame, evidence chain steps 4-6).

**Dependencies:** U0 (fixture builders reachable).

**Files:**
- `packages/desktop/src-tauri/src/acp/commands/session_commands/resume.rs` (test module — extend the existing
  `#[cfg(test)] mod tests`), and/or a focused test helper that drives the resume pre-publish hydrate→build sequence.
- Reuses the `pub(crate)` provider-fixture builders exposed by U0.

**Approach:**
- Build a provider `SessionThreadSnapshot` fixture with several assistant/user/tool entries (provider-backed
  transcript — KTD-4).
- Drive the **resume pre-publish sequence** against an initially-empty `TranscriptProjectionRegistry`. **Derive the
  revision through the real machinery** (`load_live_session_graph_revision` over the test DB), not a hand-fed
  `SessionGraphRevision::new(204, 203, 204)` — see Open Verification Blocker B-2: the assumed `(204, 203, 204)` is
  unverified and may not occur in production. The assertion contrast should be **structural, not numeric**:
  - *Before hydration* (current code path): `build_snapshot_envelope_for_session` yields a transcript-bearing
    snapshot whose `entries` are **empty** (the fabrication) — this is the RED state.
  - *After the U2 hydration runs first*: the same build yields `entries` matching the provider history (count +
    entry identity, in order).
- Assert the post-fix snapshot's `transcript_snapshot.entries` is **non-empty** and matches the fixture, and that the
  carried `transcript_revision` is **coherent with the entries** (not an empty transcript stamped at a frontier
  revision). Pin exact revision numbers only after the B-2 trace confirms them.
- To make the ordering testable without standing up the full Tauri `AppHandle`/worker, target the **extracted
  pre-publish hydration unit** introduced in U2 (the interface is the test surface). That unit must accept an
  **already-loaded provider snapshot (or its `replay_context` + a load seam), not a raw `AppHandle`** (feasibility
  F4 / scope F2) so the test can drive it with a fixture. If U1 is written before U2 exists, reference the intended
  seam so U2 makes it compile-and-fail rather than not-compile.

**Execution note:** Start RED. With current code (publish before hydrate), the captured snapshot transcript is empty
at the frontier revision → assertion fails. Confirm the failure is the empty-transcript assertion, not a setup error.

**Patterns to follow:** Existing envelope-capture tests in `resume.rs` (`AcpEventHubState::new()` + `hub.subscribe()`,
lines ~407-408/506-507/618-619) and provider-fixture construction in `session_open_snapshot/mod.rs` tests.

**Test scenarios:**
- Happy path: provider-backed restored managed session → resume snapshot carries all N restored transcript entries,
  in order, with stable entry identity.
- Regression guard: the published snapshot's transcript revision is coherent with the carried entries (not an empty
  `entries: []` stamped at the frontier `transcript_revision`).
- Negative control: a session with **genuinely no** transcript history (no provider snapshot, no journal text) →
  resume snapshot carries an empty transcript legitimately (proves the fix does not force fake entries onto truly
  empty sessions).

**Verification:** Test fails before U2, for the empty-transcript reason; the negative-control case passes both
before and after.

### U2. Fix — hydrate the transcript registry before the early snapshot publish (KTD-1)

**Goal:** Guarantee the `TranscriptProjectionRegistry` is hydrated from the canonical open-snapshot materialization
before `acp_resume_session` publishes its session-state snapshot.

**Requirements:** KTD-1; turns U1 green.

**Dependencies:** U1.

**Files:**
- `packages/desktop/src-tauri/src/acp/commands/session_commands/resume.rs`

**Approach:**
- Extract the transcript-registry hydration (provider-owned snapshot load → materialize → `restore_session_snapshot`,
  currently at `resume.rs:341-374`) into a named, testable unit (e.g. a `hydrate_resume_transcript_registry`-style
  function) and call it **before** the early publish at `resume.rs:137-160`.
- **Seam shape (feasibility F4 / scope F2):** split the IO from the pure step. The provider-snapshot *load* may take
  `app`/`replay_context`, but the *materialize → restore* unit that U1 drives must accept the **already-loaded
  `ProviderOwnedSessionSnapshot` (or `SessionThreadSnapshot`)**, returning the `TranscriptSnapshot` it restores —
  never a raw `AppHandle`. This keeps the tested unit free of Tauri runtime and lets U1 inject a fixture.
- Preserve the existing journal fallback (`load_transcript_snapshot_for_resume_with_app`) for sessions without a
  provider snapshot.
- Ensure no double-hydration: if the hydration is hoisted, remove/guard the now-redundant later hydration in the
  spawned task. Confirm the projection-registry restore (`resume.rs:376-379`) is handled coherently (move with it or
  leave it, as long as no regression).
- Keep `load_provider_owned_session_snapshot` independent of `create_and_initialize_client` so the early publish is
  not delayed on agent connection.
- **Hoisted-load error contract (adversarial F4):** moving the provider-snapshot load ahead of the publish moves its
  failure mode earlier too. A load `Err` (or absent snapshot) must **not** abort resume before the lifecycle/activity
  signal is emitted — fall back to the journal path (or publish lifecycle-only / suppress per KTD-2) and let resume
  proceed. Specify that the hoisted load failure degrades gracefully rather than short-circuiting the resume.
- **Single `max_event_seq` read (adversarial F8):** if the hoisted hydration and the later projection/replay steps
  both derive from a session's `max_event_seq`, read it once and thread it, so hoisting cannot desync the transcript
  hydration from the projection/replay cursor.

**Execution note:** Smallest change that turns U1 green while keeping all existing resume tests green.

**Patterns to follow:** The existing materialization call sequence at `resume.rs:341-379`; `restore_session_open_authority`
(`session_loading.rs:759-810`) as the canonical hydration shape.

**Test scenarios:**
- U1 now green (restored transcript carried in the resume snapshot).
- Existing resume tests (`replay_buffered_session_state_events*`, sequence-id riding, lifecycle emission) remain green.
- No double-hydration: registry is hydrated exactly once on the resume path (assert via a counting/idempotence check
  or by confirming a single restore for the session).

**Verification:** `cargo test` for the resume module green; U1 green for the right reason; no regression in existing
resume/snapshot tests.

### U3. Red test — producer must not fabricate an empty transcript-bearing snapshot on registry miss (KTD-2)

**Goal:** A failing test pinning the guardrail: `build_snapshot_envelope` must not emit a `Snapshot` asserting an
empty transcript at a non-zero frontier revision when the session has persisted history but the registry is
unhydrated.

**Requirements:** KTD-2.

**Dependencies:** U0 (fixture builders). Independent of U1/U2; can be authored in parallel but landed after U2.

**Files:**
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` (test module).

**Approach:**
- Set up an in-memory DB with session metadata indicating a session that has history, an **empty**
  `TranscriptProjectionRegistry`, and call `build_snapshot_envelope_for_session` at a non-zero frontier revision.
- Assert the **None-only** guardrail (KTD-2, b2-suppress): the result is `None` / no published envelope — **not** a
  `Snapshot` carrying `entries: []`, **and not a lifecycle-only envelope** (the lifecycle-only variant is rejected
  because it advances the frontier).
- **Frontier-advance assertion (adversarial F2 / F5):** assert the guardrail path does **not** advance
  `graph_revision` (or any revision) — i.e. it cannot gate out a subsequent correct transcript-bearing snapshot.
  This assertion is what distinguishes the chosen suppression from the rejected lifecycle-only variant; a fix that
  merely avoids empty entries but still bumps the frontier must FAIL this test.

**Execution note:** Start RED — current code returns a `Snapshot` with the fabricated empty transcript.

**Patterns to follow:** `build_snapshot_envelope` tests in `runtime_registry.rs` (e.g. `tool_call_delta_uses_snapshot_when_frontier_requires_repair`, lines ~2939-2975) for DB/registry setup.

**Test scenarios:**
- Registry-miss + history-present + non-zero frontier revision → **no published snapshot** (None), and **no
  frontier advance**.
- **New-session control:** registry-miss + no history + `transcript_revision == 0` → empty transcript is emitted
  legitimately (guardrail must not break the new-session path).
- Registry-hit → snapshot carries the registry's transcript unchanged (no behavior change on the happy path).

**Verification:** Fails before U4 for the fabrication reason; the new-session control passes before and after.

### U4. Fix — guardrail in `build_snapshot_envelope` (KTD-2)

**Goal:** Make the producer refuse to fabricate an empty transcript-bearing snapshot; distinguish "no history yet"
(empty is true) from "history exists, registry unhydrated" (empty is a fabrication).

**Requirements:** KTD-2; turns U3 green.

**Dependencies:** U3.

**Files:**
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`

**Approach:**
- Replace the unconditional empty fallback at `runtime_registry.rs:745-750` with the KTD-2 (b2-suppress) behavior:
  on registry miss, decide via the persisted signal (metadata + handed `revision`) whether history is expected;
  if expected, **return `None` / suppress** (do **not** emit a lifecycle-only envelope — it advances the frontier and
  re-creates the gate); if genuinely empty/new, keep emitting the legitimate empty transcript.
- Keep the change minimal and local to the fallback decision. Ensure the suppression path advances no revision.

**Execution note:** Smallest change to turn U3 green while keeping all existing snapshot-builder tests green.

**Test scenarios:**
- U3 green (no fabricated-empty snapshot on registry-miss-with-history).
- New-session control green (legitimate empty still emitted).
- Existing snapshot-repair tests in `runtime_registry.rs` remain green.

**Verification:** `cargo test` for the runtime-registry module green; U3 green for the right reason; no regression.

### U5. Verification & QA — managed resume renders restored transcript

**Goal:** Prove the end-to-end fix against the running dev app for a managed, provider-history-backed session.

**Requirements:** Whole-plan acceptance.

**Dependencies:** U2, U4.

**Files:** none (verification only).

**Approach:**
- `cargo clippy` in `packages/desktop/src-tauri/` (clean).
- `cargo test` for the touched modules green.
- `bun run check` (expected no-op — no TS changed; run to confirm the FE was untouched).
- Dev-app QA via the **acepe-dev-app-qa** wrapper (NOT `/Applications/Acepe.app`). Because this is a Rust change,
  confirm the dev binary is rebuilt (skill Step 1b) — the running binary must contain U2/U4 before QA is valid;
  restart the dev process only if the binary is stale, killing specific PIDs only.
- QA evidence: open the managed "G7"-class session and confirm the transcript renders (not the "Ready to assist"
  placeholder); confirm a non-managed session still renders correctly (no regression).

**Test scenarios:** Test expectation: none — verification unit (automated coverage lives in U1/U3).

**Verification:** Managed session shows its restored transcript on resume; non-managed sessions unaffected; clippy +
tests + check all green.

---

## Risks & Mitigations

- **R-1 (highest): hoisting hydration delays the early publish.** The early publish exists to give the FE an
  immediate lifecycle/activity signal. *Mitigation:* hoist only the transcript-registry hydration, which depends on
  `load_provider_owned_session_snapshot` (app + replay_context) and **not** on `create_and_initialize_client`. The
  publish stays early and becomes correct; measure no meaningful added latency before the lifecycle signal.
- **R-2: double-hydration / behavior drift in the resume task.** Hoisting may leave a redundant hydration in the
  spawned task. *Mitigation:* U2 explicitly removes/guards the redundant step and asserts single hydration; existing
  resume tests guard against drift.
- **R-3: guardrail breaks the legitimate new-session empty path.** *Mitigation:* U3's new-session control and U4's
  explicit "no history yet vs unhydrated" distinction; keep the empty path for `transcript_revision == 0` / no history.
- **R-4: materialization-completeness trap (journal-only fix passes a weak test).** *Mitigation:* KTD-4 — all red
  tests use provider-backed fixtures so a journal-only fix cannot green them.
- **R-5: already-clobbered sessions don't recover by clicking.** This fix prevents *new* clobbering but does not
  retroactively heal a session clobbered in a prior run within the same FE session. *Mitigation:* documented as
  Deferred to Follow-Up Work. **Caveat (adversarial F3 / scope F3):** the claim that "a fresh app launch heals it"
  is **unverified** — it assumes the FE does not persist the clobbered (empty, high-revision) graph across launches
  and that the corrected resume snapshot wins the FE gate on the next launch. If the FE persists session graphs, a
  fresh launch may re-apply the stale empty and *not* heal. The Open Verification Blocker trace must confirm cold-launch
  behavior before this mitigation is stated as fact.
- **R-6 (raised by review): the producer fix may not change the rendered outcome.** If B-1/B-2/B-3 resolve such that
  the FE revision-gate (not the producer) is the proximate cause of the *sticky* empty, the producer fix is correct
  but insufficient to fix the user-visible symptom, and the deferred FE-recovery item becomes co-primary.
  *Mitigation:* resolve the Open Verification Blocker before `/ce:work`; if confirmed, re-scope to include the FE
  gate as a canonical correction (its own GOD-gated unit), not a deferral.

---

## Verification Summary

- Per fix unit: red test confirmed failing for the right reason → smallest change to green → existing tests stay green.
- `cargo clippy` clean in `packages/desktop/src-tauri/`.
- `cargo test` green for `resume` and `runtime_registry` modules; U1 and U3 green.
- `bun run check` green (and a no-op diff for TS — proves FE untouched).
- Dev-app QA (rebuilt dev binary, wrapper-only): managed "G7"-class session renders its restored transcript; no
  regression for non-managed sessions.
