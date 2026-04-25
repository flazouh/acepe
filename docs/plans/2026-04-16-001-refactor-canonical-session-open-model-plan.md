---
title: refactor: canonical backend session-open model
type: refactor
status: completed
date: 2026-04-16
deepened: 2026-04-18
---

# refactor: canonical backend session-open model

## Overview

Replace the remaining hybrid session-open architecture with one backend-owned canonical session model that covers thread content, operations, interactions, identity, and reconnect boundaries for **all** sessions, including sessions that originated outside Acepe.

## Problem Frame

Acepe already moved session-open architecture partway toward backend ownership: projections, operations, interactions, and monotonic runtime sequencing now live in Rust, and the last refactor defined the shape of a single `SessionOpenResult` contract. But the system still opens historical sessions through a transcript-shaped side channel.

Today the backend provider loaders return `ConvertedSession`, the frontend loads that transcript through `SessionRepository.preloadSessionDetails()`, then a second path hydrates runtime projection state through `SessionProjectionHydrator`. In parallel, reconnect logic still carries replay-suppression semantics because the frontend sometimes expects historical events from the live stream and sometimes expects preloaded thread entries from disk.

That means Acepe still has a split truth model:

- thread content is transcript-derived;
- operations/interactions are projection-derived;
- reconnect correctness depends on suppressing replay into a store that already preloaded history;
- sessions that originated outside Acepe are parsed into frontend-facing transcript types instead of being materialized into the same backend model Acepe-managed sessions use.

The clean architecture is stricter: the UI opens every session from one backend-authored session snapshot, and provider-specific historical parsing becomes an ingestion/materialization concern behind that contract rather than a second open path.

Two distinct provider-policy axes must stay explicit in that architecture:

- persisted reconstruction/materialization policy decides how Acepe reconstructs canonical state from on-disk or provider-owned history sources;
- live reconnect policy decides which ACP reconnect verb (`resume_session` vs `load_session`) is sent to a running agent process after the snapshot opens.

Today Acepe only models the first axis explicitly. The second still leaks through hardcoded Copilot-specific branching in reconnect paths on both the Rust and frontend sides. Finishing the canonical session-open cutover requires giving that reconnect policy a backend-owned, provider-declared home instead of leaving it as shared-layer agent-name branching.

## Requirements Trace

- R1. Every session entry point uses one backend-owned session-open contract: fresh Acepe session creation, restored reopen, manual persisted-session open, and externally-originated/provider-owned sessions.
- R2. Thread content, operations, interactions, identity metadata, and reconnect cutoff come from one canonical backend model rather than separate transcript and projection paths.
- R3. Sessions that originated outside Acepe are materialized into the same canonical model before the UI opens them; the frontend never opens them from `ConvertedSession`.
- R4. Provider-owned replay identity remains backend-owned via descriptor/history metadata such as `history_session_id`; Acepe-local session id remains the only frontend session identity key.
- R5. The canonical session-open result carries one monotonic reconnect boundary (`last_event_seq`), and reconnect applies only post-snapshot deltas at the Acepe boundary regardless of which provider reconnect verb is required underneath.
- R6. The frontend hydrates session state from one atomic backend snapshot and removes replay-suppression/open-time merge heuristics.
- R7. Open outcomes remain explicit (`found | missing | error`) and preserve worktree/source-path identity across restore.
- R8. Legacy transcript-open APIs become non-authoritative and are deleted once the canonical path is proven.
- R9. Live reconnect policy is backend-owned and provider-declared, separate from persisted reconstruction policy; no shared-layer provider-name branch remains in session-open or reconnect flows.

## User-Visible Success Criteria

- Reopened and restored sessions render one stable thread on first paint instead of reshaping after projection hydrate or replay suppression.
- Externally-originated sessions open through the same UI path as Acepe-managed sessions and no longer require later scan repair to recover identity or content.
- Reconnect after open appends only new deltas after the snapshot frontier and does not duplicate historical thread content.
- Failure states stay explicit: proven absence yields `missing`, materialization/connect faults yield `error`, and neither path leaves half-hydrated session content in the panel.

## Scope Boundaries

- In scope is the backend contract and data model for canonical session open.
- In scope is materializing external/provider-origin sessions into the same canonical model before first render.
- In scope is the frontend cutover to a single open hydrator and delta-only reconnect.
- In scope is deleting the old transcript-open/replay-suppression path after cutover.
- Not in scope is a redesign of the agent panel UI shell.
- Not in scope is changing the SSE transport itself.
- Not in scope is broad provider feature redesign beyond the history/materialization boundary needed for canonical session open.

### Deferred to Separate Tasks

- UX improvements beyond representing `found | missing | error` cleanly inside the current panel shell.
- Any optimization pass on canonical-history import latency after the unified model is correct.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/history/commands/session_loading.rs` still serves `get_unified_session()` as `ConvertedSession | null`, applies title/current-mode metadata, and falls back to `ConvertedSession::empty(...)`.
- `packages/desktop/src-tauri/src/acp/provider.rs` defines `load_provider_owned_session(...) -> Result<Option<ConvertedSession>, String>`, making `ConvertedSession` the provider-owned history boundary.
- `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs` already owns `SessionOpenResult`, explicit open outcomes, open-token reservation, and the backend snapshot assembly path the cutover should finish rather than replace.
- `packages/desktop/src-tauri/src/acp/providers/claude_code.rs` and `packages/desktop/src-tauri/src/acp/providers/cursor.rs` load provider history and immediately convert it into `ConvertedSession`.
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs` still routes historical runtime projection through `ProjectionRegistry::project_thread_snapshot(...)` / transcript projection seams, proving runtime projection is still being reconstructed from transcript-shaped data rather than opened from one canonical session-open model.
- `packages/desktop/src-tauri/src/acp/projections/mod.rs` already owns canonical runtime projection state (`SessionProjectionSnapshot`, `last_event_seq`) but does not own thread content.
- `packages/desktop/src-tauri/src/acp/commands/client_ops.rs` still hardcodes live reconnect policy through `should_load_session(...)`, routing Copilot through `load_session()` outside the provider capability/trait seam.
- `packages/desktop/src-tauri/src/session_converter/`, `packages/desktop/src-tauri/src/session_jsonl/commands.rs`, `packages/desktop/src-tauri/src/session_jsonl/parser/convert.rs`, `packages/desktop/src-tauri/src/cursor_history/commands.rs`, and `packages/desktop/src-tauri/src/opencode_history/{commands,parser}.rs` still produce or route `ConvertedSession`, so the cutover must include those deeper producers instead of only provider wrapper files.
- `packages/desktop/src-tauri/src/acp/session_thread_snapshot.rs` already bridges between `ConvertedSession` and a thread snapshot model, which makes it a required transition seam during canonical cutover rather than an unrelated helper.
- `packages/desktop/src/lib/acp/store/services/session-repository.ts` preloads thread entries from `api.getSession(...)`, converts `StoredEntry` into `SessionEntry`, and stores them independently from runtime projection state.
- `packages/desktop/src/lib/acp/store/services/session-projection-hydrator.ts` performs a second open-time fetch for runtime projection state.
- `packages/desktop/src/lib/components/main-app-view/logic/open-persisted-session.ts` and its callers can hydrate a backend snapshot today, but the returned `openToken` is not yet threaded into the later reconnect call.
- `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts` still restores sessions by chaining preload, projection hydrate, connect, then a second hydrate.
- restore/open orchestration currently lives across `open-persisted-session.ts`, `session-handler.ts`, and `initialization-manager.ts`; there is no standalone `session-preload-connect.ts` seam to update.
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts` still carries a Copilot-specific resume-launch-mode guard, proving reconnect policy still leaks into the shared frontend layer.

### Institutional Learnings

- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` — provider identity and replay policy belong in backend contracts, not UI-facing projections or local heuristics.
- `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md` — restore bugs must be fixed at the earliest identity boundary, not by later scan/repair passes.
- `docs/solutions/best-practices/autonomous-mode-as-rust-side-policy-hook-2026-04-11.md` — once backend projection state is authoritative, the frontend should render it rather than re-enforcing policy.
- `docs/solutions/best-practices/reactive-state-async-callbacks-svelte-2026-04-15.md` — open-time panel/session identity must be captured before async boundaries and guarded against stale completions.

### Related Prior Plans

- `docs/plans/2026-04-15-001-refactor-projection-first-session-startup-plan.md` — established the snapshot-plus-delta session-open target but still assumed thread entries could ride through transcript-derived content.
- `docs/brainstorms/2026-04-12-async-session-resume-requirements.md` — established Rust-owned async resume and a single authoritative reconnect timeout.

### External References

- None. The codebase already has sufficient local patterns and recent learnings for this refactor.

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| Make `SessionOpenResult` the only session-open result across create/open/restore/external import. | The prior refactor already identified the right contract shape; the missing piece is making thread content canonical too. |
| Replace `ConvertedSession` as the provider-owned history return type with a backend materialization input, not a frontend-open type. | The pure architecture requires provider loaders to feed backend canonicalization rather than leaking transcript-shaped data across IPC. |
| Materialize external/provider-origin sessions into the same canonical persisted model before first render. | If external sessions stay transcript-derived at open time, Acepe preserves two architectures forever. |
| Keep Acepe-local session id as the only frontend identity key; provider session ids remain descriptor-owned replay metadata. | This preserves alias/canonical rewrite rules and avoids UI identity drift across restart, reconnect, and provider differences. |
| Extend the backend session-open snapshot to own thread content alongside runtime projection state. | Operations/interactions are already canonical; the missing cut is making message/thread content canonical at the same boundary. |
| Use journal-backed `last_event_seq` as the only reconnect frontier visible to the frontend. | A single monotonic revision is required for gap-free reconnect and for deleting replay-suppression heuristics. |
| Treat persisted reconstruction policy and live reconnect policy as separate provider-owned seams. | `HistoryReplayPolicy` answers how Acepe reconstructs canonical state from history, while reconnect policy answers which ACP verb a running provider needs. Conflating them would keep Copilot-specific branching alive in shared layers. |
| Move live reconnect verb selection into provider-owned Rust capability/trait declarations instead of hardcoded agent-id checks. | Agent-agnostic architecture requires `load_session` vs `resume_session` decisions to live beside other provider contracts, not in `matches!(agent_id, Copilot)` branches. |
| Deliver the session-open result through one explicit open-time IPC contract, not through `connectionComplete`. | The async resume path should keep streaming capabilities/lifecycle events; canonical thread content must arrive through a dedicated open result that the hydrator can request synchronously before connect. |
| Persist canonical thread content as a Rust-owned session-content snapshot, written atomically with descriptor/projection updates. | A dedicated persisted snapshot is the cleanest way to make thread content backend-owned without forcing journal rows to impersonate provider transcript history. |
| Establish the external-session reconnect frontier by writing a materialization barrier journal event after atomic snapshot persistence. | External sessions need a real journal-backed `last_event_seq`; the barrier event creates one without replaying the imported transcript as live journal history. |
| Make external-session materialization idempotent via stored source fingerprints and descriptor metadata. | Re-opening the same external session must not duplicate history or silently ignore upstream provider changes. |
| Delete preload/projection dual-fetch semantics rather than preserving them as fallback. | Keeping both paths would preserve the very split-brain architecture this plan is meant to remove. |
| Keep provider normalization at adapter/materialization edges. | Sparse or provider-specific historical event shapes must be normalized before canonical session-open assembly, not in the frontend. |

## Open Questions

### Resolved During Planning

- **Should sessions that originated outside Acepe use the same canonical model before UI open?** Yes. This is the defining scope boundary for the plan.
- **Where should provider-owned replay identity remain authoritative?** In backend descriptor/history metadata such as `history_session_id`; never as a frontend session key.
- **Should the canonical model extend existing projection state or remain a parallel transcript type?** Extend the backend-owned session-open snapshot so thread content and runtime state cross the UI boundary together.
- **Should external session parsing stay ephemeral until connect succeeds?** No. The cleaner cut is to materialize canonical persisted state before UI open so create/open/restore all observe the same backend truth.
- **How does the canonical session-open result reach the frontend?** Through one explicit open-time IPC contract: restored/manual opens call a dedicated Rust command that returns `SessionOpenResult`, while fresh session creation returns the same result inline from `acp_new_session`. `connectionComplete` remains a live-capabilities event and does not carry thread content.
- **What storage model owns canonical thread content?** A Rust-owned persisted session-content snapshot stored alongside descriptor/projection state. This avoids keeping transcript truth in provider files or forcing imported transcript rows into the live journal model.
- **How does an external session get a real `last_event_seq`?** After atomic materialization of descriptor + canonical thread snapshot + runtime projection snapshot, the backend writes one materialization-barrier journal event and uses that persisted event sequence as the returned frontier.
- **What is the provider-agnostic intermediate type between adapters and the shared materializer?** Providers emit a normalized historical materialization batch in Rust (provider-neutral entries plus descriptor metadata), and only that batch crosses into shared materialization code.
- **How is re-materialization prevented or triggered?** Descriptor metadata stores provider replay identity plus a source fingerprint (provider session id + source identity + provider revision/mtime signal). Reopen skips materialization when the fingerprint matches and re-materializes atomically when it changes.
- **Where does `history_session_id` live after materialization?** In backend descriptor/session metadata storage, persisted with the canonical session identity and reopened before any provider-specific replay/resume call.
- **What proves the canonical path before Unit 5 deletion starts?** A backend integration test proves external-session materialization + barrier frontier + delta reconnect, and a frontend integration test proves create/open/restore/reconnect all use the canonical hydrator path without relying on transcript-open helpers. Static callsite/grep checks are cleanup signals, not the primary deletion gate.
- **Should legacy transcript APIs remain as compatibility paths after cutover?** No. They may exist transiently during implementation, but the finished architecture deletes them as open-time authorities.
- **Should live reconnect policy be modeled separately from history reconstruction policy?** Yes. Reconstruction remains a history/materialization contract, while reconnect verb selection becomes a provider-owned runtime contract in Rust; neither shared frontend code nor `client_ops.rs` should infer it from provider names.

### Deferred to Implementation

- **Exact module split between `acp/session_open_snapshot` and history/materialization helpers** — the architectural boundary is fixed, but final Rust file factoring can follow implementation ergonomics.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
             provider history / files / replay ids
                           |
                           v
               provider-owned parser / adapter
                           |
                           v
                backend materialization boundary
          (normalize provider history into canonical state)
                           |
                           v
           canonical session-open snapshot + last_event_seq
         (thread + operations + interactions + identity metadata)
                            |
                            v
                   single frontend session-open hydrator
                            |
                            v
             provider-owned reconnect verb + openToken handoff
            (`resume_session` or `load_session`, backend-declared)
                            |
                            v
                   live deltas with event_seq > snapshot
```

## Implementation Units

- [ ] **Unit 1: Define the canonical session-open domain in Rust**

**Goal:** Introduce the backend-owned session-open types that can carry canonical thread content and runtime state together for any session-open path.

**Requirements:** R1, R2, R4, R5, R7

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/projections/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Modify: `packages/desktop/src-tauri/src/session_jsonl/export_types.rs`
- Modify: `packages/desktop/src/lib/services/acp-types.ts`
- Test: `packages/desktop/src-tauri/src/acp/commands/tests.rs`
- Test: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Test: `packages/desktop/src-tauri/src/acp/projections/mod.rs`

**Approach:**
- Define one Rust-owned session-open result that includes explicit open outcome, canonical session identity, worktree/source metadata, canonical thread snapshot, runtime projection state, and `last_event_seq`.
- Make thread content a first-class backend snapshot concept rather than an inferred frontend conversion product.
- Reuse the existing projection/journal monotonic revision spine so the new thread model and current operation/interaction model share the same open boundary.
- Define the canonical thread snapshot schema explicitly in Rust so the backend, not the frontend, owns message/block/tool normalization.
- Treat `session_open_snapshot/mod.rs` as the existing canonical seam to finish, not a greenfield replacement. This unit should audit the current `SessionOpenResult`/`SessionOpenFound` shape against R2/R5/R7 and extend it only where the existing contract is still missing canonical content or metadata.
- Introduce one explicit IPC delivery path for the session-open result; this unit defines the contract surface that Unit 4 hydrates.
- Carry `openToken` as a typed, non-lossy field in the Rust-owned open result for every non-error open outcome so the frontend can thread it directly into the subsequent reconnect call without re-fetching or re-deriving it.
- Keep generated TypeScript types sourced from Rust ownership; the frontend should consume the new exported types instead of `ConvertedSession`.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/projections/mod.rs`
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`

**Test scenarios:**
- Happy path: a canonical session-open result contains thread content, operations, interactions, identity metadata, and `last_event_seq` in one payload.
- Happy path: a fresh Acepe-created session returns the same envelope shape as a restored or manually opened session.
- Edge case: alias-keyed open returns requested and canonical ids without changing the frontend identity contract.
- Edge case: worktree-backed sessions preserve `worktreePath` and `sourcePath` in the open result.
- Error path: missing persisted content yields `missing`, while storage/materialization failure yields `error`.
- Integration: the dedicated IPC delivery path returns the session-open result before live reconnect and `connectionComplete` remains live-capability-only.
- Integration: the exported TypeScript contract matches the Rust-owned canonical shape without requiring `ConvertedSession`.
- Integration: the open result carries any metadata needed for later `openToken`-backed reconnect without forcing the frontend to infer provider-specific reconnect policy.
- Integration: every non-error open result includes a typed `openToken` field that survives Rust-to-TypeScript contract generation intact.

**Verification:**
- The backend can describe a whole opened session without a second transcript-specific API.

- [ ] **Unit 2: Replace `ConvertedSession` provider loading with backend materialization inputs**

**Goal:** Move provider-owned history loading from frontend-facing transcript output to backend materialization inputs that can feed the canonical session-open model.

**Requirements:** R2, R3, R4, R8, R9

**Dependencies:** Unit 1

**Files:**
- Create: `packages/desktop/src-tauri/src/history/session_materialization.rs`
- Modify: `packages/desktop/src-tauri/src/history/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/provider.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client_trait.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/client_ops.rs`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/provider_capabilities.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_thread_snapshot.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/claude_code.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/cursor.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/copilot.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/codex.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/opencode.rs`
- Modify: `packages/desktop/src-tauri/src/session_converter/mod.rs`
- Modify: `packages/desktop/src-tauri/src/session_converter/claude.rs`
- Modify: `packages/desktop/src-tauri/src/session_converter/cursor.rs`
- Modify: `packages/desktop/src-tauri/src/session_converter/codex.rs`
- Modify: `packages/desktop/src-tauri/src/session_converter/fullsession.rs`
- Modify: `packages/desktop/src-tauri/src/session_converter/opencode.rs`
- Modify: `packages/desktop/src-tauri/src/copilot_history/mod.rs`
- Modify: `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- Modify: `packages/desktop/src-tauri/src/codex_history/parser.rs`
- Modify: `packages/desktop/src-tauri/src/cursor_history/commands.rs`
- Modify: `packages/desktop/src-tauri/src/opencode_history/commands.rs`
- Modify: `packages/desktop/src-tauri/src/opencode_history/parser.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/scanning.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/mod.rs`
- Modify: `packages/desktop/src-tauri/src/session_jsonl/commands.rs`
- Modify: `packages/desktop/src-tauri/src/session_jsonl/parser/convert.rs`
- Modify: `packages/desktop/src-tauri/src/session_jsonl/types.rs`
- Test: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Test: `packages/desktop/src-tauri/src/acp/commands/client_ops.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_journal.rs`
- Test: `packages/desktop/src-tauri/src/acp/providers/cursor.rs`
- Test: `packages/desktop/src-tauri/src/acp/providers/claude_code.rs`
- Test: `packages/desktop/src-tauri/src/acp/providers/copilot.rs`

**Approach:**
- Change the provider-owned history seam so providers return one normalized historical materialization batch in Rust rather than `ConvertedSession`.
- Keep provider-specific normalization at the adapter edge; the shared materializer should receive already-normalized, provider-agnostic historical data.
- Preserve provider-owned replay identity via `history_session_id` and related descriptor metadata; only the materialized Acepe-local session is exposed to the session-open contract.
- Add a separate provider-owned reconnect contract in Rust so the backend, not shared code, declares whether a running provider reconnects through `resume_session` or `load_session`.
- Replace `should_load_session(...)` and other agent-name reconnect branching with capability/trait-driven lookup. History reconstruction stays independent from reconnect verb selection even when both are provider-owned.
- Convert the deeper `ConvertedSession` producers, not just the provider wrapper seams. `session_converter`, `session_jsonl`, cursor/opencode/codex history parsers, scan ingestion, and `session_thread_snapshot` must either emit the new materialization batch or be demoted to explicitly non-open-time utilities.
- Eliminate `ConvertedSession::empty(...)` as an open-time fallback authority and replace it with explicit open outcomes or canonical empty snapshots.

**Execution note:** Start with characterization coverage around existing provider-owned loaders so the refactor preserves lookup semantics while changing the return contract.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/provider.rs`
- `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`

**Test scenarios:**
- Happy path: Claude, Cursor, Copilot, Codex, and OpenCode provider-owned history loaders feed the backend materializer without emitting `ConvertedSession`.
- Happy path: provider-owned lookup still keys off `history_session_id`, not the Acepe-local session id.
- Edge case: sessions found by alias/provider id still materialize under the canonical Acepe-local session id.
- Edge case: provider-specific sparse or missing historical fields are normalized before shared materialization.
- Edge case: a canonical empty snapshot for a new or history-empty session is encoded explicitly in the Rust-owned contract instead of via `ConvertedSession::empty(...)`.
- Error path: provider parse failure surfaces as `error`, not a partially transcript-shaped open result.
- Integration: `get_unified_session()` characterization coverage captures any legacy semantics that must survive until Unit 5 deletes the old path.
- Integration: no provider-owned history loader remains typed as `Result<Option<ConvertedSession>, String>`.
- Integration: reconnect verb selection comes from provider-owned Rust policy rather than `matches!(agent_id, Copilot)` or other hardcoded shared-layer checks.
- Integration: existing journal rows that require provider-family-aware decoding still deserialize correctly after the reconstruction/materialization refactor.

**Verification:**
- Provider history parsing becomes a backend ingestion seam instead of a frontend-open contract, and reconnect policy has a provider-owned home outside shared-layer agent-name branching.

- [ ] **Unit 3: Materialize external and legacy sessions into canonical persisted state**

**Goal:** Ensure externally-originated and legacy sessions are imported/materialized into the same canonical state model Acepe-managed sessions use before the UI opens them.

**Requirements:** R1, R2, R3, R4, R5, R7

**Dependencies:** Units 1-2

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Modify: `packages/desktop/src-tauri/src/acp/projections/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_journal.rs`
- Modify: `packages/desktop/src-tauri/src/db/entities/session_thread_snapshot.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository_test.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Test: `packages/desktop/src-tauri/src/acp/commands/tests.rs`
- Test: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Test: `packages/desktop/src-tauri/src/db/repository_test.rs`

**Approach:**
- Build on the existing canonical-materialization/barrier seams rather than re-creating them: replace the current transcript/thread-snapshot projection bridge (`ProjectionRegistry::project_thread_snapshot(...)` and related transcript projection seams) with canonical persisted state that the new session-open contract can read directly.
- Make imported external sessions land on the same canonical thread/runtime model and revision frontier as Acepe-managed sessions.
- Add a lazy-upgrade path for existing Acepe-managed sessions that predate canonical thread snapshots: if a reopened Acepe-native session has descriptor/projection state but no canonical thread snapshot, reconstruct that snapshot once from existing persisted history before returning `SessionOpenResult`.
- Persist descriptor metadata, canonical thread snapshot, and runtime projection snapshot in one DB transaction so open-time reads are all-or-nothing.
- After atomic materialization, write one materialization-barrier journal event and use its persisted `event_seq` as the returned `last_event_seq` for reconnect.
- Persist a descriptor-owned materialization completion marker (or equivalent durable sentinel) so restart/open can distinguish a fully materialized snapshot from a stranded pre-barrier write and retry safely from a clean state.
- Store provider replay identity and source fingerprints in descriptor/session metadata so re-open can detect whether materialization is already current or must run again.
- Preserve user-set title overrides and stored session metadata when external/legacy content is materialized.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- `packages/desktop/src-tauri/src/acp/session_journal.rs`
- `packages/desktop/src-tauri/src/db/repository.rs`
- `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md`

**Test scenarios:**
- Happy path: an externally-originated session materializes into canonical persisted state and opens with the same session-open contract as an Acepe-managed session.
- Happy path: imported canonical state includes both thread content and runtime projection state at one revision frontier.
- Happy path: the materialization-barrier event produces the reconnect frontier and live deltas after that barrier are delivered exactly once.
- Edge case: an existing Acepe-managed session without a canonical thread snapshot lazily reconstructs that snapshot on first reopen after cutover and then opens normally on subsequent opens.
- Edge case: legacy sessions without a stored projection snapshot are rebuilt into canonical state and reopened without transcript/projection mismatch.
- Edge case: reopening an already-materialized external session with an unchanged fingerprint skips re-materialization and reuses the canonical snapshot.
- Edge case: reopening after provider history changed re-materializes once and does not duplicate prior imported content.
- Edge case: materialized external session exposes only the Acepe-local session id to the session-open contract; provider-owned ids remain descriptor metadata.
- Edge case: title overrides and worktree/source-path metadata survive materialization.
- Edge case: reopening the same external session from cold persisted state with an unchanged fingerprint skips re-materialization and returns the same reconnect frontier.
- Error path: partial import/materialization does not leave half-canonical state that the UI could open.
- Error path: a failure before the atomic snapshot transaction commits returns `error` and leaves no partial canonical state.
- Error path: a failure after snapshot commit but before barrier publication is detected through the persisted materialization sentinel and retried from a clean state on the next open rather than returning a partial snapshot.
- Integration: reconnect after materialized external open delivers only deltas after the returned `last_event_seq`.
- Integration: the materialized open result produces an `openToken` reservation that can be claimed exactly once during reconnect; duplicate or stale claims fail loudly.

**Verification:**
- Sessions that originated outside Acepe no longer require a transcript-only open path.

- [ ] **Unit 4: Cut the frontend over to a single session-open hydrator**

**Goal:** Make the frontend open every session from one backend-owned snapshot and delete open-time transcript conversion as a source of truth.

**Requirements:** R1, R2, R5, R6, R7, R9

**Dependencies:** Units 1-3

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/session-open-hydrator.ts`
- Modify: `packages/desktop/src/lib/acp/store/api.ts`
- Modify: `packages/desktop/src/lib/utils/tauri-client/history.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/open-persisted-session.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/managers/session-handler.ts`
- Test: `packages/desktop/src/lib/components/main-app-view/tests/open-persisted-session.test.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/session-open-hydrator.test.ts`
- Test: `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`
- Test: `packages/desktop/src/lib/components/main-app-view/tests/main-app-view-state.vitest.ts`
- Test: `packages/desktop/src/lib/components/main-app-view/tests/session-handler.test.ts`

**Approach:**
- Establish the `openToken` threading contract before any other frontend cutover work. `SessionOpenHydrationResult.openToken` must survive `hydrateFound(...)` and be passed into the subsequent `connectSession(..., { openToken })` call for restore/manual-open flows instead of being dropped between those phases.
- Add one frontend hydrator that applies canonical thread content, projection state, identity rewrite, and revision guards in one batched store replacement so the UI never observes half-hydrated open state.
- Implement that replacement through a single snapshot boundary compatible with Svelte 5 fine-grained reactivity (for example one snapshot object feeding `$derived` consumers), rather than sequential writes that can expose partial state between updates.
- Capture panel/session/open-attempt identity before the first open-result await, store it as a per-panel open epoch, and reject stale completions when a panel is closed, retargeted, or retried.
- Route restored open, manual persisted open, and fresh session creation through the same hydrator API.
- Remove any assumption that `SessionRepository.preloadSessionDetails()` is an open-time authority; historical transcript conversion becomes a non-open concern and is scheduled for deletion in Unit 5.
- Make `session-entry-store.svelte.ts` accept canonical thread snapshot replacement directly, rather than rebuilding entries from `StoredEntry`.
- Remove shared frontend reconnect-policy branching such as the Copilot-specific resume-launch-mode guard. After this unit, the frontend passes backend-owned reconnect inputs and never infers reconnect semantics from provider identity.

**Execution note:** Begin with failing characterization tests for restored open, manual open, and fresh create so the replacement path proves one hydrator now owns all open-time state assembly.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/services/session-projection-hydrator.ts`
- `docs/solutions/best-practices/reactive-state-async-callbacks-svelte-2026-04-15.md`

**Test scenarios:**
- Happy path: restored reopen hydrates canonical thread and runtime state in one pass before connect.
- Happy path: manual persisted-session open and fresh session creation both use the same hydrator path.
- Edge case: a stale open result is ignored after panel retarget, close, or retry.
- Edge case: alias-to-canonical rewrite occurs before store mutation and panel validation.
- Error path: `missing` and `error` outcomes update lifecycle/UI state without partial hydrate.
- Integration: the frontend batched replacement prevents partial render between thread replacement and projection replacement.
- Integration: the frontend no longer needs `StoredEntry -> SessionEntry` conversion to open a session.
- Integration: `openToken` returned by the open result is threaded through the frontend open flow and claimed during the subsequent reconnect so buffered post-snapshot events replay exactly once.
- Integration: no frontend reconnect step derives behavior from `agentId === "copilot"` or equivalent provider-name guards.

**Verification:**
- Create/open/restore now share one frontend session-open path.

- [ ] **Unit 5: Delete legacy transcript-open and replay-suppression architecture**

**Goal:** Remove the old dual-path architecture so canonical session open remains the only durable way sessions enter the UI.

**Requirements:** R5, R6, R8

**Dependencies:** Units 1-4

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/session-repository.ts`
- Delete: `packages/desktop/src/lib/acp/store/services/session-projection-hydrator.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
- Delete: `packages/desktop/src/lib/acp/converters/stored-entry-converter.ts`
- Delete: `packages/desktop/src/lib/acp/converters/stored-entry-converter.test.ts`
- Modify: `packages/desktop/src/lib/services/claude-history.ts`
- Modify: `packages/desktop/src/lib/services/converted-session-types.ts`
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Modify: `packages/desktop/src-tauri/src/session_jsonl/types.rs`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/session-repository-preload-details.test.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/session-projection-hydrator.test.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-store-load-title.vitest.ts`

**Approach:**
- Remove replay-suppression logic that only exists because the frontend previously mixed preloaded history and streamed replay.
- Delete transcript-open helpers that still expose `ConvertedSession`, `StoredEntry`, or `get_unified_session()` as session-open authorities.
- Retain only non-open history APIs that serve unrelated features (for example plan-document loading) and document that boundary explicitly in the surviving service module.
- Clean up legacy label/conversion heuristics that were compensating for provider-specific transcript shapes on the frontend.
- Migrate any still-valuable behavioral coverage from deleted preload/projection helpers into canonical session-open hydrator tests before removing the old test files.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/services/session-repository.ts`
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- `docs/solutions/best-practices/autonomous-mode-as-rust-side-policy-hook-2026-04-11.md`

**Test scenarios:**
- Happy path: reconnect after canonical open does not require replay suppression and only applies live deltas after the snapshot frontier.
- Edge case: update-only live events do not create ghost rows because open-time thread state is already canonical.
- Edge case: external sessions reopened after app restart use the same canonical path without later scan repair.
- Error path: removed transcript-open APIs fail loudly in tests if any session-open path still calls them.
- Integration: no session-open codepath depends on `ConvertedSession`, `StoredEntry`, or transcript preload as an authority.
- Integration: a full create/open/restore/reconnect flow passes end-to-end using only canonical session-open APIs before any transcript-open helper is deleted.

**Verification:**
- No session-open callsite can reach the old preload + projection + replay-suppression architecture.

## System-Wide Impact

- **Interaction graph:** session descriptor/provider identity, provider history loading, canonical session materialization, journal/projection persistence, session-open IPC contract, frontend store hydration, and reconnect delivery all move under one session-open graph.
- **Policy separation:** persisted reconstruction/materialization policy and live reconnect policy remain distinct provider-owned seams even after the canonical cutover; `HistoryReplayPolicy` must not become a disguised reconnect switch.
- **Error propagation:** provider parse/materialization failures must surface as backend `error` outcomes rather than partial frontend transcript state.
- **State lifecycle risks:** imported external sessions create data-lifecycle risk if partially materialized state is persisted; transaction boundaries or equivalent consistency guarantees are required.
- **API surface parity:** `acp_new_session`, restored reopen, manual persisted open, and external-session open must all emit the same contract shape.
- **Integration coverage:** provider-owned loaders, canonical materialization, session-open IPC, hydrate, and reconnect must be covered together because mocks alone will not prove the cutover.
- **Runtime handoff boundary:** open-token reservation, reconnect claim, and post-snapshot buffered-event replay are part of the canonical open contract; dropping the token anywhere in the frontend restore path reintroduces split-brain behavior.
- **Journal compatibility:** journal deserialization continues to depend on provider-family context for existing persisted rows; refactoring reconstruction/materialization must preserve that non-open-time compatibility path.
- **Unchanged invariants:** Acepe-local session id remains the only frontend session identity key; provider-specific ids remain backend descriptor metadata.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| External-session materialization creates partially canonical state | Failures before the atomic snapshot transaction commits return `error` and roll back cleanly; failures after commit but before barrier publication leave an explicit incomplete-materialization marker that the next open detects and rebuilds safely |
| Frontend cutover leaves one stray transcript-open path alive | Add fail-fast contract assertions during cutover and remove legacy entry points in the final cleanup unit |
| Provider-specific sparse history payloads break shared canonicalization | Normalize provider data at adapter edges before shared materialization |
| Reconnect ordering regresses during the cutover | Preserve `last_event_seq` as the only frontend-visible ordering frontier and cover attach/delta flows with integration tests |
| Restore identity regresses for worktree or alias sessions | Keep identity metadata in the canonical open result and add restore-focused regression coverage |
| Open flow still drops `openToken` before reconnect | Make token threading an explicit Unit 4 contract and cover the claim/replay path with an end-to-end integration test |
| Provider `load_session` semantics overlap awkwardly with the canonical snapshot frontier | Move reconnect verb selection into provider-owned Rust policy, then prove delta-only frontend behavior for both `resume_session` and `load_session` providers |
| Refactoring `HistoryReplayFamily` for materialization accidentally breaks journal reads for existing persisted events | Preserve the journal deserialization compatibility path explicitly and add regression coverage around provider-context event decoding |

## Documentation / Operational Notes

- Update any architecture explanations that still describe historical session open as transcript preload plus projection hydrate.
- Treat generated TypeScript contract files as build artifacts of the Rust-owned session-open model, not handwritten frontend APIs.

## Sources & References

- Related plan: `docs/plans/2026-04-15-001-refactor-projection-first-session-startup-plan.md`
- Related brainstorm: `docs/brainstorms/2026-04-12-async-session-resume-requirements.md`
- Relevant learning: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
- Relevant learning: `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md`
- Relevant learning: `docs/solutions/best-practices/autonomous-mode-as-rust-side-policy-hook-2026-04-11.md`
- Relevant learning: `docs/solutions/best-practices/reactive-state-async-callbacks-svelte-2026-04-15.md`
- Related code: `packages/desktop/src-tauri/src/acp/commands/client_ops.rs`
- Related code: `packages/desktop/src/lib/components/main-app-view/logic/open-persisted-session.ts`
