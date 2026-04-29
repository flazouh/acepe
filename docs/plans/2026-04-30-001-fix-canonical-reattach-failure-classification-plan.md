---
title: "fix: Canonical reattach failure classification"
type: fix
status: active
date: 2026-04-30
deepened: 2026-04-30
---

# fix: Canonical reattach failure classification

## Overview

When a Copilot session is opened after Acepe restarts, the upstream Copilot
ACP server returns `JSON-RPC -32002 Resource not found: Session <id>` because
Copilot does not persist the session across its own restart (or past TTL).
Today, Rust takes that raw transport error string and writes it into the
canonical `lifecycle.errorMessage`, classified as the generic, *retryable*
`FailureReason::ResumeFailed`. The UI then renders the raw JSON-RPC payload as
user-visible copy, shows a Retry button that will deterministically re-fail,
and a parallel TypeScript "permanent reattach failure" gate
(`localPersistedSessionProbeStatus` + `setSessionOpenMissing`) silently loses
the race against canonical truth.

This plan adds canonical classification for `session/load` failures so the
GOD architecture's lifecycle is the *single* authority for both *what* failed
and *how to talk about it*. The TS-side parallel "permanently missing"
machinery is deleted in the same change, restoring the canonical-only
contract.

## Problem Frame

Live reproduction (Tauri MCP, against running Acepe `com.acepe.app` v2026.3.33):

1. Sidebar opens session `1ea29f08-…` (agent: copilot, locally created).
2. `acp_resume_session` runs `session/load` against Copilot CLI.
3. Copilot returns `-32002 Resource not found: Session 1ea29f08-…`.
4. Rust emits `SessionUpdate::ConnectionFailed { error: error.to_string(), … }`.
5. `runtime_registry::apply_update` writes
   `LifecycleState::failed(FailureReason::ResumeFailed, Some(error.clone()))`.
6. TS canonical reader `connectionErrorFromGraphState` returns the raw RPC
   string; `derivePanelErrorInfo` titles it "Connection error".
7. Two error chromes render simultaneously:
   - Big page ("Unable to load session" + RPC text) via
     `viewState.kind === "error"`.
   - Inline red card ("Connection error") with auto-minted local Reference ID,
     Retry / Create issue / Dismiss.
8. The TS-side fallback (`localCreatedReattachUnavailableMessage`,
   `setSessionOpenMissing`) never reaches the user because Rust has already
   won the canonical projection with raw text.

This violates the GOD invariants we just finished establishing in
`2026-04-29-002-refactor-canonical-operation-authority-plan.md`: the
canonical layer must be the sole authority for user-facing session truth, and
TS must not maintain a parallel projection for the same concern.

## Requirements Trace

- R1. Canonical lifecycle distinguishes "session permanently gone upstream"
  from generic resume failure, so actionability (`canRetry`) reflects reality.
- R2. The canonical `FailureReason` taxonomy (Rust) and the
  `(agentId, failureReason) → English copy` mapping (TS) together
  produce the user-facing message in the canonical reader; raw JSON-RPC
  text never reaches default UI surfaces.
- R3. The parallel TS `localPersistedSessionProbeStatus` /
  `setSessionOpenMissing` / `localCreatedReattachUnavailableMessage` gate is
  removed. There is one source of truth for session-gone state.
- R4. The agent panel renders exactly one error surface for a given canonical
  failure (no big-page + inline-card duplication).
- R5. Retry affordance is driven by canonical
  `lifecycle.actionability.canRetry`, not by the mere presence of
  `errorInfo.showError`.
- R6. Auto-minted local Reference IDs are not generated for upstream-classified
  permanent failures (Reference IDs are for opaque internal errors only).
- R7. Behavior covered by Rust unit tests (classifier + lifecycle update) and
  TS materializer/UI tests (panel error info + view state).

## Scope Boundaries

- **In scope:** `session/load` (resume) failures classified as upstream
  "session not found". Rust classifier (taxonomy only, no copy),
  lifecycle authority, TS canonical readers (compose copy here), panel
  view-state, deletion of TS parallel gate.
- **Out of scope:** Copilot CLI session persistence/TTL changes; bringing
  back deleted sessions; rebinding to a different upstream id (that is the
  Cursor rebind brainstorm at
  `docs/brainstorms/2026-04-29-cursor-session-rebind-requirements.md`).
- **Out of scope:** Other failure modes (timeout, panic, transport drop)
  beyond reclassifying their *retryability* if it is already wrong. No new
  copy or behavior for them in this plan.
- **Out of scope:** Cursor's "session created in Acepe never linked to disk"
  problem — different mechanism (id mismatch, not session-gone).

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs:1240-1310` —
  resume completion paths emit `SessionUpdate::ConnectionFailed { error: error.to_string() }`.
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs:535-595` —
  `apply_update` writes `LifecycleState::failed(FailureReason::ResumeFailed, Some(error))`.
- `packages/desktop/src-tauri/src/acp/lifecycle/state.rs:28-36` —
  `FailureReason` enum (extension target).
- `packages/desktop/src-tauri/src/acp/session_state_engine/selectors.rs:127-146` —
  `is_retryable_failure` and `actionability_for_lifecycle`; `canRetry`
  derives from the failure reason.
- `packages/desktop/src-tauri/src/acp/client_errors.rs` — already extracts
  structured error info from JSON-RPC payloads (existing pattern for
  inspecting transport errors before classification).
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts:897-910,1319-1325` —
  `connectionErrorFromGraphState` returns canonical lifecycle error message.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/connection-ui.ts` —
  `derivePanelErrorInfo`; currently keys on presence of any
  `sessionConnectionError` string.
- `packages/desktop/src/lib/acp/logic/panel-visibility.ts` —
  `derivePanelViewState`; produces `kind: "error"` whenever
  `errorInfo.showError && entriesCount === 0`.
- `packages/desktop/src/lib/components/main-app-view/logic/open-persisted-session.ts` —
  hosts the doomed parallel "permanent-reattach-failure" gate
  (`PERMANENT_LOCAL_REATTACH_ERROR_MARKERS`,
  `setLocalPersistedSessionProbeStatus`, `localCreatedReattachUnavailableMessage`,
  `setSessionOpenMissing`). All targeted for deletion.
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts:1812` —
  `setSessionOpenMissing` — targeted for deletion along with its callers and
  related `SessionTransientProjection` field.

### Institutional Learnings

- `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md` —
  establishes the principle that structured ACP failures must be preserved
  with `kind`, `sessionId`, `retryable`. Collapsing them to generic
  connection errors "breaks retry decisions and makes async creation
  failures opaque." This plan extends that principle to *resume* failures.
- `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md` —
  explicitly calls out `localPersistedSessionProbeStatus` as a "pre-canonical
  local-created reattach gate" residing in `SessionTransientProjection`.
  This plan retires it now that canonical lifecycle can carry the
  permanently-missing classification.
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` and
  `docs/solutions/architectural/god-architecture-verification-2026-04-25.md` —
  the canonical-only authority contract this plan upholds.
- `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md` —
  prior fix in the same neighborhood; warns against "special-casing Cursor or
  Copilot session-not-found errors in the resume path." That warning was
  about *bypassing* the resume path; this plan does the opposite — it
  preserves the path and classifies its outcome canonically.

### External References

Not used. The fix is fully grounded in existing repo patterns and the GOD
architecture contract.

## Key Technical Decisions

- **New canonical failure reason: `FailureReason::SessionGoneUpstream`.**
  Distinct from `ResumeFailed` (transient/transport) and
  `ProviderSessionMismatch` (id mismatch). Excluded from
  `is_retryable_failure` so `actionability.canRetry` becomes `false`.
- **Classification happens at the resume boundary in Rust**, not in
  `apply_update`. The classifier inspects the structured ACP error (typed
  `AcpError` variant + JSON-RPC body) before constructing the
  `ConnectionFailed` envelope, so the envelope itself carries
  `failure_reason`. The raw provider text continues to flow through the
  `error` field unchanged — the canonical TS reader composes the
  user-facing English copy from `(agentId, failureReason)`. This keeps
  `apply_update` a pure projection step **and** keeps user-visible
  language out of the systems layer.
- **Consolidate session-not-found detection at the client layer.** Extend
  the existing `client_errors::is_session_not_found_error` helper to match
  Copilot's `-32002 Resource not found: Session` payload in addition to the
  `-32602 Session … not found` form it already handles. After the
  extension, all session-not-found errors (Copilot, Claude Code, anything
  else) reach `session_commands.rs` as `AcpError::SessionNotFound(_)`. The
  classifier then matches that single typed variant — no duplicate
  substring-matching logic at the resume boundary.
- **`SessionUpdate::ConnectionFailed` gains a `failure_reason: FailureReason`
  field** alongside `error`. Existing emit sites (timeout, panic, generic
  error, activation-path fallback) explicitly set `ResumeFailed`. The new
  classifier picks `SessionGoneUpstream` for `AcpError::SessionNotFound(_)`.
- **Curated copy is assembled in Rust**, keyed on `(agent_id, failure_reason)`,
  and stored in `lifecycle.error_message`. TS treats it as opaque presentation
  text. The agent-aware Copilot string ("This GitHub Copilot session is no
  longer available to reopen…") moves from
  `open-persisted-session.ts` to Rust.
- **Delete the TS parallel system in the same change.** Per Acepe
  architecture rule (no migration / coexistence): remove
  `localPersistedSessionProbeStatus`, `setSessionOpenMissing`,
  `setLocalPersistedSessionProbeStatus`, `getLocalPersistedSessionProbeStatus`,
  `localCreatedReattachUnavailableMessage`,
  `PERMANENT_LOCAL_REATTACH_ERROR_MARKERS`, and the corresponding
  `SessionTransientProjection` field. `open-persisted-session.ts` simply
  calls `connectSession` and lets canonical lifecycle carry the failure.
- **Single error surface.** `derivePanelViewState` returns
  `kind: "error"` only when canonical lifecycle is in a terminal failure
  state with no entries. The inline `showInlineErrorCard` is suppressed
  when `viewState.kind === "error"` so the page shows one error treatment,
  not two.
- **Reference ID generation gated on classification.** The fallback inline
  Reference ID is only minted when `errorInfo` represents an opaque internal
  error (no `failureReason`). Classified upstream failures do not get a
  local reference id or "Create issue" affordance; they get "Start a new
  session" / "Dismiss".
- **Retry button is driven by `actionability.canRetry`.** The agent panel
  reads the canonical actionability flag instead of unconditionally rendering
  Retry whenever an error is shown.

## Open Questions

### Resolved During Planning

- *Should we attempt automatic recovery (e.g., transparently start a new
  session)?* No. The session is bound to a project + provider history; auto-
  starting a new one would silently reset the conversation context. We
  surface "Start a new session" as user-driven action.
- *Should we add this distinction to `DetachedReason` instead of
  `FailureReason`?* No. `Detached` is for sessions that *can* be resumed
  later. `SessionGoneUpstream` is permanently terminal — `Failed` is the
  correct lifecycle status.
- *Does `DetachedReason::RestoredRequiresAttach` cover this?* No. That
  reason describes a session waiting for our reattach call; here, our
  reattach already happened and the upstream said "no such session."

### Deferred to Implementation

- Exact JSON-RPC matching strategy: parse with `serde_json::Value` for
  `code === -32002` and message body, or rely on existing
  `client_errors.rs` helpers. Decide while implementing the classifier.
- Whether `client_trait::resume_session` should return a typed error variant
  for upstream-not-found, or if classification stays inside the resume
  command. Lean toward the typed return only if the existing trait can
  carry it without a wider refactor.
- Whether to preserve the original raw RPC text in a new
  `lifecycle.diagnosticsText` field for log/debug surfaces (out of scope as
  user-facing copy, but operators may want it). Decide based on whether any
  in-app diagnostics surface needs it; default is no new field.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for
> review, not implementation specification. The implementing agent should
> treat it as context, not code to reproduce.*

```
                ┌─────────────────────────────┐
                │ acp_resume_session (Rust)   │
                └──────────────┬──────────────┘
                               │ session/load
                               ▼
                       upstream Copilot ACP
                               │
                ┌──────────────┴───────────────┐
                ▼                              ▼
        Ok(connection)                 Err(json_rpc_error)
                │                              │
                ▼                              ▼
   ConnectionComplete envelope    ┌─ classify_resume_error ─┐
                                  │  AcpError::SessionNotFound│
                                  │  → SessionGoneUpstream  │
                                  │  (taxonomy only, no copy)│
                                  │                         │
                                  │  else                   │
                                  │  → ResumeFailed         │
                                  │  (existing behavior)    │
                                  └────────┬────────────────┘
                                           ▼
                       SessionUpdate::ConnectionFailed {
                         error, failure_reason
                       }
                                           ▼
                       runtime_registry::apply_update
                                           ▼
              SessionGraphLifecycle::failed(reason, Some(raw_error))
                                           ▼
                           emit canonical envelope to TS
                                           ▼
              CanonicalSessionProjection.lifecycle (single source)
                                           ▼
                ┌──────────────────────────┴──────────────────────────┐
                ▼                                                     ▼
        connectionErrorFromGraphState                    actionability.canRetry
                ▼                                                     ▼
        derivePanelErrorInfo  ───────────────────►  derivePanelViewState
                                                                      ▼
                                                          one error surface
```

The TS reattach path becomes:

```
open-persisted-session
        │
        ▼
sessionStore.connectSession(id)            (no probe gate, no fallback copy)
        │
        ▼
canonical envelope arrives → lifecycle.failed(SessionGoneUpstream, "...")
        │
        ▼
panel reads canonical projection only
```

## Implementation Units

- [ ] **Unit 1: Add `SessionGoneUpstream` failure reason and exclude it from retry**

**Goal:** Extend the canonical failure taxonomy to express "upstream said the
session is gone" as a non-retryable terminal state.

**Requirements:** R1, R5

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/lifecycle/state.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/selectors.rs`
- Modify: `packages/desktop/src-tauri/src/acp/lifecycle/tests.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_state_engine/selectors.rs`
  (collocated unit tests) and `packages/desktop/src-tauri/src/acp/lifecycle/tests.rs`

**Approach:**
- Add `SessionGoneUpstream` to `FailureReason`.
- Leave `is_retryable_failure` matching only `ActivationFailed` and
  `ResumeFailed`, so `actionability.canRetry` is `false` for the new variant.
- Confirm `actionability_for_lifecycle` produces a sensible
  `recommended_action` for the new variant (likely
  "Start a new session" / archive — pick whichever option the existing enum
  already exposes; otherwise leave `recommended_action` unchanged for
  `Failed` and let UI key on `failure_reason`).
- **Regenerate Specta TS bindings** by running
  `cargo test --lib session_jsonl::export_types::tests::export_types` and
  commit the regenerated `acp-types.ts` as part of this unit's commit.
  (This is an explicit step — the build script `build.rs` only runs
  `tauri_build::build()`; Specta export is wired through a `#[test]` in
  `session_jsonl/export_types.rs`.)

**Patterns to follow:**
- Existing `FailureReason` variants and the `is_retryable_failure` pattern.

**Test scenarios:**
- Happy path: `LifecycleState::failed(SessionGoneUpstream, Some("…"))`
  produces `actionability.can_retry == false`, `actionability.can_send == false`,
  `actionability.can_archive == true`.
- Edge case: existing `ResumeFailed` continues to produce `can_retry == true`
  (regression guard for pre-existing behavior).
- Edge case: `SessionGoneUpstream` round-trips through serde
  (`serde_json::to_value` → `from_value`) preserving the variant.

**Verification:**
- `cargo test -p acepe lifecycle` and the selectors tests pass; new variant
  is reachable from `LifecycleState::failed`.

---

- [ ] **Unit 2: Classify resume errors before emitting `ConnectionFailed`**

**Goal:** Inspect the structured error returned by `session/load` at the
resume boundary and produce a `failure_reason` (taxonomy only, no copy)
before constructing the canonical envelope.

**Requirements:** R1, R2

**Dependencies:** Unit 1

**Files:**
- Create: `packages/desktop/src-tauri/src/acp/resume_failure_classifier.rs`
- Modify: `packages/desktop/src-tauri/src/acp/mod.rs` (module declaration)
- Modify: `packages/desktop/src-tauri/src/acp/session_update.rs` (or wherever
  `SessionUpdate::ConnectionFailed` is defined) to add
  `failure_reason: FailureReason`
- Modify: `packages/desktop/src-tauri/src/acp/client_errors.rs`
  (extend `is_session_not_found_error` to also match
  `-32002` + `Resource not found: Session`; add a fixture for the Copilot
  payload)
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
  (three `ConnectionFailed` emit sites: ok-err, timeout, panic-guard;
  invoke the classifier on the ok-err path; explicit `ResumeFailed` for
  timeout/panic)
- Modify: `packages/desktop/src-tauri/src/acp/commands/interaction_commands.rs`
  (one `ConnectionFailed` construction at line ~527 — activation-path
  fallback inside `acp_send_prompt`. Set `failure_reason: ResumeFailed`;
  do **not** invoke the classifier here. This is not a resume boundary.)
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
  (test helper `create_connection_failed_update` at line ~1195 and inline
  test fixture at line ~1309 — both need `failure_reason: ResumeFailed`
  added so `cargo test` continues to compile)
- Modify: `packages/desktop/src-tauri/src/acp/commands/tests.rs`
  (inline `ConnectionFailed` fixture at line ~2321 needs the new field;
  the existing -32002 assertion at line ~751 should be updated to assert
  raw provider text in `error` and `failure_reason: SessionGoneUpstream`)
- Test: `packages/desktop/src-tauri/src/acp/resume_failure_classifier.rs`
  (collocated `#[cfg(test)] mod tests`)

**Execution note:** Test-first. Begin with a failing classifier test for the
`-32002 Resource not found: Session` payload before wiring the
`SessionUpdate` shape changes. The pre-existing test asserting the raw error
string at `packages/desktop/src-tauri/src/acp/commands/tests.rs:751` is the
characterization seam to update once the classifier exists.

**Approach:**
- Extend `client_errors::is_session_not_found_error` to also recognize
  `-32002` + `Resource not found: Session` so the client layer converts
  Copilot's variant into the existing typed `AcpError::SessionNotFound`,
  same as it already does for the `-32602` form.
- `classify_resume_error(agent_id: &CanonicalAgentId, error: &SerializableAcpError) -> ClassifiedResumeFailure`
  returns `{ failure_reason }` only — **no curated user copy**. The
  signature uses `SerializableAcpError` because that is the actual type
  at the `Ok(Err(error))` emit sites in `session_commands.rs`.
  (Architectural decision: Rust owns the `FailureReason` taxonomy; TS
  owns the user-facing English copy keyed on `(agentId, failureReason)`
  in Unit 5. This preserves the existing layer boundary and leaves a
  single place to add i18n later.)
- Match on `SerializableAcpError::SessionNotFound { .. }` as the primary
  positive case → `SessionGoneUpstream`. Also keep a defensive
  `SerializableAcpError::JsonRpcError { message }` arm that re-runs the
  substring guard (`-32002` + `Resource not found: Session`) in case a
  future code path emits the raw form before client-layer conversion.
- The raw provider text continues to flow into
  `lifecycle.error_message` (preserved verbatim) so debug surfaces and
  logs see the original payload. Default UI never shows it.
- Default branch returns `ResumeFailed` (preserves existing behavior for
  unrelated failures); `lifecycle.error_message` keeps the raw
  `error.to_string()`.
- Emit a `tracing::warn!` line when the classifier sees a `-32002` error
  whose body does **not** match the known patterns, so future provider
  format changes are observable in operator logs instead of silently
  degrading UX.
- Update three emit sites in `session_commands.rs` to pass the classifier
  output. Timeout and panic sites get explicit `ResumeFailed`.
- The `interaction_commands.rs:527` site is an activation-path fallback
  inside `acp_send_prompt`'s Reserved-lifecycle branch — it explicitly
  sets `ResumeFailed`. The classifier is **not** invoked here.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/client_errors.rs` —
  `extract_error_message` and `is_low_fd_error_message`.

**Test scenarios:**
- Happy path: `is_session_not_found_error` returns `true` for the Copilot
  `-32002` + `Resource not found: Session` payload (extends the existing
  `-32602` test in `client_errors.rs:127` with a sibling case).
- Happy path: classifier given `SerializableAcpError::SessionNotFound { .. }`
  returns `failure_reason: SessionGoneUpstream` (test runs once per agent
  variant — Copilot, Cursor, ClaudeCode — to lock the agent-agnostic
  behavior).
- Edge case: `-32002` with a different message body (e.g.,
  `Resource not found: Project`) does **not** classify as
  `SessionGoneUpstream`; falls through to `ResumeFailed` + raw text, and
  emits the `tracing::warn!` for unrecognized `-32002`.
- Edge case: a `SerializableAcpError::JsonRpcError` carrying `-32002` +
  `Resource not found: Session` (defensive arm — should not normally reach
  the classifier post-conversion) classifies as `SessionGoneUpstream`.
- Edge case: non-JSON error variant falls through to `ResumeFailed`.
- Error path: malformed JSON-RPC body classifies as `ResumeFailed` without
  panicking.
- Integration: `async_resume_session_work`'s error branch produces a
  `SessionUpdate::ConnectionFailed` whose `failure_reason` is
  `SessionGoneUpstream` and whose `error` field carries the raw provider
  text (test against existing `commands/tests.rs:751` fixture, updated
  to assert the new `failure_reason: SessionGoneUpstream` field; the
  curated English copy is asserted in TS tests in Unit 5, not here).

**Verification:**
- Existing `commands/tests.rs` cases pass with assertions updated to the
  new `failure_reason` field (raw text remains in `error`).
- `cargo clippy --all-targets -- -D warnings` clean for the new module.

---

- [ ] **Unit 3: Apply classified failure in the canonical projection**

**Goal:** Make `runtime_registry::apply_update` use the
`failure_reason` from the envelope instead of hard-coding
`FailureReason::ResumeFailed`.

**Requirements:** R1, R2

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
  (collocated tests)

**Approach:**
- In the `SessionUpdate::ConnectionFailed { error, failure_reason, .. }`
  arm, replace the hard-coded `ResumeFailed` with the envelope's
  `failure_reason`. The `error` field carries the raw provider text
  verbatim into `lifecycle.error_message` for log/debug surfaces; the
  user-facing English copy is composed downstream in TS (Unit 5).

**Patterns to follow:**
- The existing `SessionUpdate::TurnError` arm already keys behavior on
  variant content — same shape.

**Test scenarios:**
- Happy path: applying a
  `ConnectionFailed { failure_reason: SessionGoneUpstream, error: "<raw>" }`
  yields `lifecycle.status == Failed`,
  `lifecycle.failure_reason == Some(SessionGoneUpstream)`,
  `lifecycle.error_message == Some("<raw>")` (raw text preserved for
  debug surfaces),
  `actionability.can_retry == false`.
- Regression: `ConnectionFailed { failure_reason: ResumeFailed, error: "raw" }`
  preserves existing behavior (`can_retry == true`).

**Verification:**
- Materializer parity tests (per
  `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md`)
  still pass.

---

- [ ] **Unit 4: Delete the TS-side parallel "permanent reattach failure" gate**

**Goal:** Remove `localPersistedSessionProbeStatus`,
`setSessionOpenMissing`, and the doomed friendly-message fallback so
canonical lifecycle is the single source of truth for session-gone state.

**Requirements:** R3

**Dependencies:** Unit 3 (canonical now carries the structured
`failureReason` that lets TS compose user copy itself; Unit 5 then
deletes the user-visible need for the parallel gate)

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/open-persisted-session.ts`
  (remove `PERMANENT_LOCAL_REATTACH_ERROR_MARKERS`,
  `localCreatedReattachUnavailableMessage`,
  `setLocalReattachFailureIfPermanent`, `isPermanentLocalReattachFailure`,
  and the conditional probe-status branches; reduce the local-created path
  to a plain `connectSession` call; drop deleted `SessionOpenStore`
  members from type imports)
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
  (delete `setSessionOpenMissing`, `setLocalPersistedSessionProbeStatus`,
  `getLocalPersistedSessionProbeStatus`)
- Modify: `packages/desktop/src/lib/acp/session-state/...` —
  `SessionTransientProjection` field
  `localPersistedSessionProbeStatus` and any apply paths that read/write it
- Modify: `packages/desktop/src/lib/acp/store/__tests__/session-transient-projection-store.vitest.ts`
  (drop assertions on `localPersistedSessionProbeStatus` after the field
  is removed from `SessionTransientProjection` — at least two cases
  currently assert it)
- Modify: `packages/desktop/src/lib/components/main-app-view/tests/open-persisted-session.test.ts`
  (rewrite tests against canonical-lifecycle outcomes)
- Test: the same vitest files plus any session-store tests that asserted
  the deleted methods

**Approach:**
- The local-created branch becomes:
  1. mark loading,
  2. call `connectSession`,
  3. on success, `setLocalCreatedSessionLoaded`,
  4. on failure, log and let canonical lifecycle drive the UI (no extra
     probe-status writes, no `setSessionOpenMissing` call).
- Remove the `permanent-reattach-failure` short-circuit at the top — the
  canonical lifecycle handles "do not retry" via `actionability.canRetry`.
- Update tests: prior tests asserted the friendly fallback string and the
  probe-status side effects; rewrite to assert that on `connectSession`
  rejection the function does not call any deleted methods, and that
  canonical-lifecycle-driven UI handles the rest.

**Patterns to follow:**
- The canonical-only reader pattern in
  `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md`'s
  "Residual hot-state allowlist" — `localPersistedSessionProbeStatus` was
  explicitly listed there as pre-canonical and slated for retirement.

**Test scenarios:**
- Happy path: `connectSession` resolves → `setLocalCreatedSessionLoaded` is
  called and no probe-status write occurs.
- Error path (behavioral): `connectSession` rejects with a canonical
  `SessionGoneUpstream` lifecycle outcome → `open-persisted-session` writes
  no transient-projection state, and the session store reports
  `lifecycle.status === "failed"` and
  `lifecycle.failureReason === "sessionGoneUpstream"` to canonical readers
  (assert via the canonical projection accessors, not via deleted methods).
- Error path (structural): the function does not reference
  `setSessionOpenMissing` or `setLocalPersistedSessionProbeStatus` (compile-
  time guarantee — these symbols are gone).
- Edge case: re-opening the same panel id within the in-flight window is
  still deduped by `inflightPanelIds`.

**Verification:**
- `bun run check` passes after deletions (TypeScript surfaces all dangling
  references).
- Affected tests pass without referencing deleted methods.

---

- [ ] **Unit 5: Plumb canonical `failureReason` into TS panel error info**

**Goal:** Carry `lifecycle.failureReason` into the TS canonical reader so
the panel can distinguish opaque internal errors from classified upstream
failures. Curated user copy is assembled in TS, keyed on
`(agentId, failureReason)` — Rust owns the taxonomy, TS owns the words.
Reference-id minting becomes a pure projection (`$derived`), removing the
existing `$effect` violation.

**Requirements:** R5, R6

**Dependencies:** Unit 3, Unit 4

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
  (extend `connectionErrorFromGraphState` to return
  `{ message, failureReason, rawMessage } | null` where `message` is
  curated copy and `rawMessage` is the raw provider text; add
  `getSessionLifecycleFailureReason` accessor)
- Create: `packages/desktop/src/lib/acp/components/agent-panel/logic/failure-copy.ts`
  (single mapper `failureCopy(agentId: CanonicalAgentId, reason: FailureReason): string`
  with `(copilot, sessionGoneUpstream) → "This GitHub Copilot session is no longer available to reopen. Start a new session to continue."`,
  `(_, sessionGoneUpstream) → "This saved session is no longer available to reopen. Start a new session to continue."`,
  default returns `null` so the canonical reader falls back to raw text
  for unclassified failures)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/connection-ui.ts`
  (add `failureReason: FailureReason | null` to `PanelErrorInfo` and
  `PanelErrorInputs`; preserve raw message under `details` for unclassified
  cases; expose `referenceIdAllowed` derived from
  `failureReason === null` so callers can mint deterministic ids without
  effects)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
  (replace the existing `$effect` at lines 491-515 that mints
  `fallbackInlineErrorReferenceId` with a `$derived` expression; gate
  retry/issue affordances off `actionability.canRetry`; show
  "Start a new session" CTA when
  `failureReason === "sessionGoneUpstream"`)
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/connection-ui.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/failure-copy.test.ts`

**Approach:**
- **Layer split (GOD):** Rust owns `FailureReason` + `agent_id`; TS owns
  curated copy. The classifier in Unit 2 returns *only* `failure_reason`
  (no English message), and the raw provider text continues to flow
  through `lifecycle.error_message` for debug surfaces. The canonical TS
  reader then composes the user-facing string from
  `(agentId, failureReason)`. This keeps the layer boundary intact and
  leaves a single place to add i18n later.
- TS canonical projection already carries `lifecycle.failureReason` via
  specta-generated types — Unit 1's regen step makes the new variant
  available before this unit lands.
- `derivePanelErrorInfo` keeps title generation and adds
  `failureReason: FailureReason | null`; `details` is the curated copy
  when `failureReason !== null`, raw text otherwise.
- **Refactor `fallbackInlineErrorReferenceId` from `$effect` to
  `$derived`.** New form (illustrative):
  ```
  const fallbackInlineErrorReferenceId = $derived(
    errorInfo.failureReason !== null
      ? null
      : deterministicReferenceId(panelId, errorInfo.details)
  );
  ```
  The id is a pure projection of `(panelId, details)` — no state
  mutation, no effect ordering, no `localStorage` writes. Project rule
  compliance: `$effect` is forbidden; this conversion turns a write-back
  effect into a derived value, which is the canonical Svelte 5 pattern
  for this codebase.
- Drive Retry / Create-issue affordances off `actionability.canRetry`
  (false for `SessionGoneUpstream` because `is_retryable_failure`
  doesn't list it). Replace Retry with "Start a new session" CTA when
  `failureReason === "sessionGoneUpstream"`.

**Patterns to follow:**
- Existing canonical-reader pattern in `session-store.svelte.ts`
  (`getSessionTurnState`, `getSessionConnectionError`).
- `$derived` over `$effect` everywhere — see
  `.agent-guides/svelte.md` for the rationale and equality-guard escape
  hatch (not needed here because the derivation is pure).

**Test scenarios:**
- `failureCopy(copilot, sessionGoneUpstream)` returns the Copilot string.
- `failureCopy(claudeCode, sessionGoneUpstream)` returns the generic
  string.
- `failureCopy(copilot, resumeFailed)` returns `null` (caller falls back
  to raw text).
- `derivePanelErrorInfo` with `sessionConnectionError` carrying curated
  copy and `sessionFailureReason: "sessionGoneUpstream"` returns
  `failureReason: "sessionGoneUpstream"`, `details: "<curated copy>"`,
  `referenceIdAllowed: false`.
- Edge case: opaque error path
  (`sessionConnectionError: "Connection lost"`, `sessionFailureReason: null`)
  preserves existing behavior — `failureReason: null`,
  `referenceIdAllowed: true`.
- Edge case: `panelConnectionError` (non-canonical, e.g., first-send
  wiring failure) still produces `failureReason: null` and a reference
  id is allowed.
- Behavior: rendering `agent-panel.svelte` with
  `failureReason: "sessionGoneUpstream"` and updating `panelId` produces
  `null` reference ids on every render (no effect ordering window).
- Integration: panel-visibility test confirms that with
  `failureReason: sessionGoneUpstream`, `errorInfo.showError === true`
  but the Retry-button gate (driven by `actionability.canRetry`) is
  false.

**Verification:**
- `bun run check` clean.
- Updated `connection-ui.test.ts` asserts the gated reference-id
  behavior.
- New `failure-copy.test.ts` asserts the `(agentId, failureReason)`
  table.
- Confirm the agent-panel file has no `$effect` mentioning
  `fallbackInlineErrorReferenceId` (compile-time grep guard in CI is
  out of scope; visual diff suffices).

---

- [ ] **Unit 6: Collapse duplicate error chrome to a single surface**

**Goal:** When the canonical lifecycle is in a terminal failure with no
entries, render the error treatment exactly once — either the big page or
the inline card, never both.

**Requirements:** R4

**Dependencies:** Unit 5

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/panel-visibility.ts`
  (no contract change — already returns `kind: "error"` in this case;
  confirm the surfaced `details` are the curated copy from the canonical
  TS reader, not raw RPC text)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
  (`showInlineErrorCard` becomes
  `errorInfo.showError && !errorDismissed && viewState.kind !== "error"`)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`
  (the big-page error variant uses `errorInfo.details` directly, which
  is now the TS-composed curated copy from
  `failureCopy(agentId, failureReason)`; verify wording matches)
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/connection-ui.test.ts`
  and any `panel-visibility` test that asserts dual-surface behavior

**Approach:**
- The big-page error remains the primary treatment when there are no
  entries. The inline card is suppressed in that case to avoid the
  observed duplication.
- When entries exist, the inline card continues to be the single surface
  (big-page is not used).
- **`errorDismissed` reset semantics (canonical-driven):** dismissal is a
  pure projection of canonical state. Reset `errorDismissed` whenever
  `(failureReason, errorInfo.details)` changes — a new failure or a
  changed message means a new error, and the previous dismissal no
  longer applies. Implement via `$derived` on a "dismissal key"
  (`${failureReason ?? "none"}::${errorInfo.details ?? ""}`) compared
  against the last-dismissed key in store-backed state, so the
  dismissal survives same-error re-renders but clears for any new
  failure. No `$effect`; the comparison happens in-derivation.

**Test scenarios:**
- Happy path: `entriesCount === 0` + canonical `Failed` lifecycle →
  big-page renders, inline card is suppressed (assert via
  `showInlineErrorCard` derivation in a unit test against agent-panel
  derivations or an integration test).
- Happy path: `entriesCount > 0` + canonical failure on a current turn →
  inline card renders inside the conversation; no big page.
- Edge case: dismissing the error in a conversation view sets
  `errorDismissed` and hides the inline card; big-page case is not
  dismissable (matches current behavior).
- **Reset case:** user dismisses an inline card with
  `failureReason: resumeFailed` + message A; lifecycle then transitions
  to `failureReason: sessionGoneUpstream` with curated message B; the
  inline card re-renders (dismissal cleared by key change).
- **Stable-error case:** user dismisses an inline card; canonical
  re-emits the *same* `(failureReason, details)` (e.g., another retry
  produces an identical error); the inline card stays hidden (dismissal
  preserved by key equality).

**Verification:**
- Manual visual via Tauri MCP: open the failing Copilot session and
  confirm one error surface is rendered with the curated copy.
- Unit tests for `showInlineErrorCard` derivation cover the gate.

---

- [ ] **Unit 7: Update GOD-architecture verification and capture the learning**

**Goal:** Reflect the new canonical contract in the verification doc and
record the institutional learning.

**Requirements:** All — closure step.

**Dependencies:** Units 1–6

**Files:**
- Modify: `docs/concepts/operations.md` and/or `docs/concepts/session-graph.md`
  if the canonical-failure section needs to mention the new variant
- Modify: `docs/solutions/architectural/god-architecture-verification-2026-04-25.md`
  (extend the lifecycle/actionability section with `SessionGoneUpstream`
  evidence; bump `last_updated`)
- Modify: `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md`
  (remove `localPersistedSessionProbeStatus` from the residual hot-state
  allowlist; bump `last_updated`)
- Create: a new entry under `docs/solutions/` once the work lands (handled
  by `/ce:compound`, not pre-written here)

**Test scenarios:**
- Test expectation: none — documentation update.

**Verification:**
- The verification doc accurately states that the canonical TS reader
  composes user copy via `failureCopy(agentId, failureReason)` and that
  `canRetry` reflects classified failure reason; the canonical-projection-widening
  doc no longer lists the deleted hot-state field.

## System-Wide Impact

- **Interaction graph:** `acp_resume_session` is the only resume entry.
  Three internal `ConnectionFailed` emit sites all flow through the same
  classifier. TS canonical readers in `session-store.svelte.ts` are the
  only consumers of the new field. The `connection-ui` derivation is the
  only place gating reference-id and retry affordances.
- **Error propagation:** User-facing English copy lives only in TS,
  composed by `failureCopy(agentId, failureReason)` inside the canonical
  reader. `lifecycle.error_message` carries raw provider text verbatim
  for log/debug surfaces. Raw RPC text is also preserved in tracing logs
  (Rust `tracing::error!`) but never user-facing on default surfaces.
- **State lifecycle risks:** Deleting `localPersistedSessionProbeStatus`
  removes a piece of `SessionTransientProjection` — the apply paths must
  drop the field cleanly so older serialized projections (if any are
  rehydrated) ignore it. Given GOD architecture canonical-only authority,
  no canonical projection re-derivation is needed.
- **API surface parity:** `SessionUpdate::ConnectionFailed` gains a
  required `failure_reason` field. All emit sites are updated in this PR
  (no external consumers).
- **Integration coverage:** Materializer parity test (cold-open vs.
  live-stream) must still produce identical `lifecycle` output for the new
  `SessionGoneUpstream` case.
- **Unchanged invariants:** `LifecycleStatus`, `DetachedReason`, the
  resume command signature, the existing `ConnectionComplete` shape, and
  the canonical-only reader contract all remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Specta-generated TS types fall out of sync with the new `FailureReason` variant. | Confirm `bun run check` and the Specta build step run; commit regenerated bindings as part of Unit 1. |
| Other (non-resume) failure paths that today set `ResumeFailed` get accidentally reclassified. | Classifier is invoked only at the resume boundary; timeout and panic emit sites explicitly pass `ResumeFailed`. Unit-test the explicit paths. |
| Removing `setSessionOpenMissing` breaks a non-Copilot flow that relied on its UI signal. | Search for all callers (cursor history, design-system showcase) and either delete the call or replace with the canonical lifecycle path. Unit 4's TS-check pass enforces this. |
| Curated copy needs translation/localization. | Out of scope — Acepe currently ships English-only strings inline. The TS-side mapper makes future i18n trivial (single keyed table). |
| The classifier's substring match for `Resource not found: Session` is brittle if Copilot's wording changes. | Primary detection routes through `client_errors::is_session_not_found_error` extension, which gates on JSON-RPC `code === -32002` first and `Session` substring second. Classifier itself matches the typed `AcpError::SessionNotFound` in normal flow; substring is only the defensive fallback in the `JsonRpcError` arm. Unrecognized `-32002` is `tracing::warn!`-logged for observability. Add a fixture per known agent variation. |

## Documentation / Operational Notes

- `tracing::error!` log lines in the resume command continue to include the
  raw error string for operator diagnostics.
- No migration steps for users — existing failed sessions auto-pick up
  the new TS-composed copy on next open.

## Sources & References

- Tauri MCP live reproduction (this session, 2026-04-30) against
  `com.acepe.app` v2026.3.33, session `1ea29f08-…`.
- Related code: see "Relevant Code and Patterns" above.
- Related plans:
  - `docs/plans/2026-04-29-002-refactor-canonical-operation-authority-plan.md`
  - `docs/plans/2026-04-26-001-refactor-provider-session-identity-plan.md`
  - `docs/plans/2026-04-20-001-refactor-provider-owned-reconnect-behavior-plan.md`
- Related learnings:
  - `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md`
  - `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md`
  - `docs/solutions/architectural/final-god-architecture-2026-04-25.md`
  - `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md`
