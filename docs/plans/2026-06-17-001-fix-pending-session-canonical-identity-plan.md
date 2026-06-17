---
title: "fix: Pending first-send session is a first-class canonical session"
type: fix
status: active
created: 2026-06-17
depth: deep
plan_id: 2026-06-17-001
branch: refactor/retire-agent-panel-display-model
tags: [session-identity, creation-attempt, god-architecture, claude-code, first-send]
---

# fix: Pending first-send session is a first-class canonical session

## Summary

Five user-visible bugs in a fresh Claude Code first-send session share one structural root cause: the **deferred-creation path** (Claude Code = `CommunicationMode::CcSdk`) returns a `kind: "pending"` session that **drops the canonical identity Rust already owns** and **never carries the user's explicit model/mode selection** across the deferred-creation → promotion boundary. The connecting view then renders this stub as a loading shell rather than as a real session.

This plan makes the optimistic/pending first-send session a **first-class canonical session**:
- it carries the canonical sequence id + project identity Rust already assigns (badge shows immediately);
- it persists the explicit model/mode selection on the `creation_attempt` row and applies it canonically at promotion (Sonnet honored, not defaulted to Opus);
- the connecting state presents as a real session — footer present, no warming/connecting loading spinners.

Per the GOD architecture gate: every fix moves truth **upstream** into Rust-owned canonical data or projects an existing canonical fact. No reader-level fallback, no UI order/identity repair, no post-promotion `setModel` patch in TypeScript.

---

## Problem Frame

A fresh Claude Code session created by typing a message and pressing send ("first send") goes through **deferred creation**: `acp_new_session` (`packages/desktop/src-tauri/src/acp/commands/session_commands/new_session.rs`) creates a `creation_attempt` row before any provider-owned canonical session id exists, returns `deferred_creation: true`, and the TypeScript `createSession` (`packages/desktop/src/lib/acp/store/services/session-connection-manager.ts:393-439`) returns `{ kind: "pending" }`. The session is promoted later, once the provider session id is known, via `promote_creation_attempt` (`packages/desktop/src-tauri/src/db/repository/session_metadata.rs:404-562`).

Five symptoms, one defect (the pending result drops canonical facts and the connecting view treats it as a loading shell):

| Bug | Symptom | Mechanism | Canonical class |
|-----|---------|-----------|-----------------|
| 1 | No number badge | For a plain first-send (no launch token), the `creation_attempt` is created with `sequence_id = NULL` — the sequence id is only assigned later at `promote_creation_attempt` (`next_sequence_id_for_project`). So `NewSessionResponse.sequence_id` is `None` (`new_session.rs:172-173`) and the pending `CreatedSessionResult` carries only `creationAttemptId` — never `sequenceId` / project identity / managed flag. Badge gate `session-item.svelte:601` (`sequenceId != null && projectName != null && projectColor != null`) fails until promotion. | Canonical fact **assigned too late + not projected** |
| 5 | Opus selected instead of explicit Sonnet | Deferred branch never carries/applies `options.initialModelId`; the explicit-selection logic lives only in the non-deferred branch (`session-connection-manager.ts:476-512`). `creation_attempt` has **no model/mode column**, so the selection has nowhere canonical to survive. On promotion/connect the canonical current model defaults to `availableModels[0]` = Opus. | Canonical fact **missing entirely** |
| 4 | Footer disappears | Footer snippet gate at `agent-panel.svelte:1679-1682` is `(viewState.kind === "conversation" \|\| viewState.kind === "ready" \|\| viewState.kind === "error") && worktreeToggleProjectPath && panelId`. **The boolean is correct** (each clause is a full comparison — no JS gotcha). The footer vanishes because one of the *other* inputs goes false during the pending → connected handoff: `worktreeToggleProjectPath` (`agent-panel.svelte:353`, via `resolveWorktreeToggleProjectPath` keyed on `hasSession`/`sessionProjectPath`/`selectedProjectPath`) or `derivePanelViewState` transiently returning a non-chrome kind (`project_selection`). | View-state of a real session |
| 2 | Spinner in agent header | `session-status-indicator.svelte` renders `<Spinner>` for canonical `status === "warming"`. | Presentational |
| 3 | Spinner in model selector | `composerView.selectorsLoading` (`composer-view-controller.svelte.ts:529`, consumed at `agent-input-ui.svelte:1572`) is true while connecting, replacing the pre-connection selection with a spinner. | Presentational |

### GOD authority classification (gate already run)

- **`SessionStateGraph` / canonical session identity** owns lifecycle, activity, status, current model, sequence id, project identity. Rust is the owner; TS projects.
- Bug 1: `sequence_id` + project identity = **canonical-owned, must-be-projected** (currently dropped at the pending boundary).
- Bug 5: explicit initial model/mode = **to-be-widened** — persist on `creation_attempt`, apply canonically at promotion. A post-promotion TS `setModel` repair is **forbidden**.
- Bug 4: footer presence = view-state of a real session; fix the gate + ensure the connecting session derives a session-chrome kind. No order/identity repair.
- Bugs 2/3: **truly-local presentational** — read canonical status, render no loading affordance during warming/connecting; keep the canonical/prior selection visible.

All three open call-outs were resolved **the canonical GOD way** (user directive): persist model/mode on `creation_attempt`; project the canonical sequence id onto the pending session (badge immediate); the view reads canonical status and renders the real session (no spinner, selector keeps canonical selection).

---

## Requirements & Success Criteria

- **R1 (bug 5):** A user who explicitly selects a model (e.g. Sonnet 4.6) before first send sees that model active on the resulting Claude Code session — never silently replaced by the provider default. Verified at the Rust creation/promotion seam, not patched in TS.
- **R2 (bug 1):** The pending first-send session shows its number badge immediately, using the sequence id Rust already assigned to the `creation_attempt`.
- **R3 (bug 4):** The agent panel footer remains present throughout the pending → connected handoff.
- **R4 (bug 2):** No loading spinner appears in the agent header during `warming`.
- **R5 (bug 3):** The model selector keeps the canonical/pre-connection selection visible during connecting with no loading spinner.
- **R6 (architecture):** No reader-side `canonical ?? hotState` fallback, no UI identity/order repair, no provider-specific TS branch, no post-promotion `setModel` repair. The explicit selection and the sequence id flow through canonical Rust-owned data.
- **R7 (no regression):** Non-deferred providers (e.g. Cursor, OpenCode) and the explicit-selection logic at `session-connection-manager.ts:476-512` keep working unchanged. Mode selection (`initialModeId`) is carried with the model so the existing mode-aware model resolution is preserved.

**Out of scope:** the cancel-bug fix (already implemented this session, awaiting commit); the unrelated Cursor "Planning next moves" stuck-turn issue; any broader redesign of the discovered/unmanaged-session badge policy beyond what first-send sessions need.

---

## High-Level Technical Design

This illustrates the intended approach and is **directional guidance for review, not implementation specification**. The implementing agent should treat it as context, not code to reproduce.

```text
First send (Claude Code, deferred creation)
  TS createSession({ initialModelId, initialModeId })   ← explicit Sonnet pick
        │
        ▼
  api.newSession(cwd, agentId, launchToken, { modelId, modeId })   (NEW params)
        │
        ▼
  acp_new_session  ── create_creation_attempt(..., model_id, mode_id)   (NEW columns)
        │                         │
        │                         ▼  creation_attempts row:
        │                            { sequence_id, model_id, mode_id, ... }  ← canonical carrier
        ▼
  pending CreatedSessionResult  ──► carries sequenceId + projectName + projectColor + managed
        │                                         │
        │                                         ▼  session-list projection → badge renders NOW
        ▼
  acp_new_session: bind_pending_creation_attempt(client, attempt)
        │   ALSO seed client.pending_model_id / pending_mode_id from the persisted attempt  (NEW)
        ▼
  first prompt → connect_pending_session_with_initial_prompt → build_options()
        │   reads self.pending_model_id / pending_mode_id  (EXISTING seam)
        ▼
  cc_sdk connection opens with Sonnet from the FIRST turn   ← no TS repair, applied pre-connect
        ▼
  ... provider session id arrives mid-stream → promote_creation_attempt (DB only: managed, sequence_id) ...
```

**Why pre-connect, not at promotion:** `promote_creation_attempt` is a pure DB method (no provider-client handle) and runs from the streaming bridge *after* the first turn's connection is already open on the default model. The model/mode must be seeded into the cc_sdk client's `pending_model_id`/`pending_mode_id` **before** `connect_pending_session_with_initial_prompt`, where `build_options` already consumes them — so the first turn runs on the user's pick.

The connecting-state view changes are independent and presentational: `derivePanelViewState` yields a session-chrome kind for the connecting session, the footer gate inputs stay populated, and the header/selector read canonical status to render no loading affordance.

---

## Implementation Units

Grouped into three phases. Phase A (bug 5) and Phase B (bug 1) are the canonical widening; Phase C is the connecting-state presentation (bugs 4, 2, 3) and can land in parallel. The independent fixes (U4 badge, U5 footer, U6/U7 presentation) do not gate on Phase A's outcome.

### Phase A — Canonical model/mode carry (bug 5)

### U1. Add `model_id` / `mode_id` columns to `creation_attempts`

**Goal:** Give the explicit initial model/mode selection a canonical, durable home that survives the deferred-creation → promotion boundary (and app restart / async promotion).

**Requirements:** R1, R6.

**Dependencies:** none.

**Files:**
- `packages/desktop/src-tauri/src/db/migrations/` — new migration `mXXXXXXXX_add_creation_attempt_model_mode.rs` (follow the `m20260427_000001_create_creation_attempts.rs` naming/structure).
- `packages/desktop/src-tauri/src/db/migrations/mod.rs` — register the migration.
- `packages/desktop/src-tauri/src/db/entities/creation_attempt.rs` — add `pub model_id: Option<String>` and `pub mode_id: Option<String>`.

**Approach:** Two nullable text columns, `model_id` and `mode_id`, on `creation_attempts`. Nullable because non-explicit-selection creations leave them unset, and existing rows backfill to `NULL`. No index needed — these are read by primary key during promotion.

**Patterns to follow:** existing creation-attempt migration and entity; nullable-column migrations elsewhere under `db/migrations/`.

**Test scenarios:**
- Migration `up` on a populated `creation_attempts` table: existing rows get `NULL` for both new columns, no data loss. (No `down` round-trip test — prior migrations in this repo do not implement meaningful reversibility; a nullable-column add does not warrant it.)
- Entity round-trip: insert with `Some(model_id)/Some(mode_id)`, read back equal; insert with `None`, read back `None`.

**Verification:** migrations run clean on a fresh DB and on a DB with pre-existing creation attempts; `cargo clippy` clean.

---

### U2. Persist the explicit model/mode on the creation attempt

**Goal:** Thread the explicit `initialModelId` / `initialModeId` from the TS composer through `acp_new_session` into the persisted `creation_attempt` row.

**Requirements:** R1, R6, R7.

**Dependencies:** U1.

**Files:**
- `packages/desktop/src-tauri/src/db/repository/session_metadata.rs` — extend `create_creation_attempt` / `insert_creation_attempt(_in_transaction)` to accept and set `model_id` / `mode_id`.
- `packages/desktop/src-tauri/src/acp/commands/session_commands/new_session.rs` — add optional `initial_model_id` / `initial_mode_id` params to `acp_new_session`; pass through to `create_creation_attempt`. Account for the `launch_token` (reserved-worktree) branch where the attempt already exists — persist the selection onto the reserved attempt in that path too.
- `packages/desktop/src/lib/utils/tauri-client/acp.ts` — extend `newSession` signature with optional `initialModelId` / `initialModeId`.
- `packages/desktop/src/lib/acp/store/api.ts` — thread the new args through `newSession`.
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts` — in `createSession`, pass `options.initialModelId` / `options.initialModeId` into `api.newSession` (so the deferred branch persists them); the non-deferred branch keeps applying them as today (do not double-apply).

**Approach:** The explicit selection is captured at the `acp_new_session` boundary and written onto the canonical `creation_attempt` row. The deferred branch no longer needs to "apply" the model itself — it is now a persisted canonical fact that U3 seeds into the client pre-connect.

**Verify the captured value is the user's *explicit* pick (root of bug 5).** Today the first-send caller threads `host.getInitialModelIdForNewSession()` → `resolveInitialModelIdForNewSession({ displayedModelId: composerView.effectiveCurrentModelId })` (`agent-input-state.svelte.ts:516-517`, `toolbar-state.ts:67-75`). `effectiveCurrentModelId` is a `$derived` of displayed/provisional state. **Before relying on it, confirm it equals the user's explicit selection at send time** — if it can reflect a default/cached value (e.g. before capabilities resolve), persisting it would make bug 5 *durable*. If it does not reliably reflect the explicit pick, capture the selection at the pick event instead of re-deriving at send.

**Specta regeneration:** `acp_new_session` is a `#[specta::specta]` command; adding params changes the generated TS bindings. Pin the exact regeneration step in execution — find the specta export harness/test that writes `bindings.ts`, run it, commit the diff, and confirm whether `bun run check` catches binding drift (Tauri matches args by snake_case→camelCase name, so a stale binding is a silent arg mismatch, not a type error).

**Patterns to follow:** existing optional-param threading through `acp.ts` → `api.ts` → Tauri command; `validate_session_cwd` / param handling in `new_session.rs`.

**Execution note:** Start with a failing Rust repository test asserting `create_creation_attempt` persists model/mode, then a failing TS test asserting the deferred `createSession` call forwards `initialModelId`/`initialModeId` to `api.newSession`.

**Test scenarios:**
- Rust: `create_creation_attempt` with `Some` model/mode persists them on the row; with `None` leaves them null.
- Rust: `acp_new_session` with explicit model/mode persists them on the created attempt (including the `launch_token`/reserved-worktree branch).
- TS: a user who *explicitly* selects Sonnet while the derived/default would be Opus → `getInitialModelIdForNewSession()` returns Sonnet (proves the captured source is the explicit pick, not the default). **Covers R1 at its root.**
- TS (`session-connection-manager.test.ts`): deferred-creation `createSession({ initialModelId: "claude-sonnet-4-6", initialModeId })` calls `api.newSession` with those values forwarded.
- TS: non-deferred `createSession` is unchanged — still applies explicit selection via `setMode`/`setModel` (R7 regression guard).
- TS: `createSession` without an explicit selection forwards `undefined`/`null` and does not call setModel pre-creation.

**Verification:** Rust + TS tests green; `bun run check` clean; specta bindings regenerated and committed; `cargo clippy` clean.

---

### U3. Seed the persisted model/mode into the cc_sdk client *before* connect

**Goal:** A deferred Claude Code session runs its **first turn** on the user's explicit model — by seeding the persisted `creation_attempt` model/mode into the cc_sdk client before the connection is opened. No TypeScript repair.

**Requirements:** R1, R6, R7.

**Dependencies:** U1, U2.

**Correct seam (verified):** The model/mode is consumed at connect time in `cc_sdk_client/mod.rs` `build_options` (reads `self.pending_model_id` / `self.pending_mode_id`), which runs inside `connect_pending_session_with_initial_prompt` when the first prompt is sent. `promote_creation_attempt` is a pure DB method with **no client handle**, and it fires from the streaming bridge (`streaming_bridge.rs`) *after* the connection is already open on the default model — so applying there is both impossible (no client) and too late (first turn already on Opus). The fix must seed the client's pending fields at **bind time**.

**Files:**
- `packages/desktop/src-tauri/src/acp/commands/session_commands/new_session.rs:90-92` — where `client.bind_pending_creation_attempt(Some(attempt_id))` is called for deferred providers, also seed the client's `pending_model_id` / `pending_mode_id` from the persisted attempt (read it back via `get_creation_attempt`, or pass model/mode into the bind call).
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs` — `bind_pending_creation_attempt` (or a sibling setter) accepts and stores the seeded `pending_model_id` / `pending_mode_id`; `build_options` already consumes them (no change to `build_options` logic).
- `packages/desktop/src-tauri/src/db/repository/session_metadata.rs` — expose `model_id` / `mode_id` on `get_creation_attempt` / the attempt row so the bind site can read them.

**Approach:** The canonical carrier is the `creation_attempt` row (U2). At bind time (before the first prompt opens the connection), Rust reads the persisted selection and seeds the client's pending model/mode, so `build_options` opens the connection on the user's pick and the **first** turn + first canonical envelope already report it. **Decision:** seed in Rust at bind time — not promotion, not a TS `setModel`. If no model was persisted (`NULL`), leave the client's pending fields at their default behavior (R7).

**Model-validity guard (preserve the non-deferred safety net):** the non-deferred branch applies the explicit model only after `availableModels.find((m) => m.id === options.initialModelId)` and falls through to default if absent (`session-connection-manager.ts:479-481`). Seeding bypasses that check, so a stale/invalid persisted id (model renamed, plan downgrade, app restart between persist and connect) could open the connection on an invalid model. Define the failure behavior: an invalid/absent persisted model must fall through to the provider default — it must **not** fail session creation. Where models are not known until after connect, ensure an invalid seed degrades gracefully rather than erroring the connection.

**Patterns to follow:** existing `pending_model_id`/`pending_mode_id` usage in `build_options`; the explicit-selection ordering (mode before model) in `session-connection-manager.ts:476-512`; the non-deferred `availableModels.find` validity guard.

**Execution note:** Failing test first asserting that a deferred session created with a persisted model opens/reports that model on the **first** turn (not the provider default).

**Test scenarios:**
- Deferred creation with persisted `model_id = claude-sonnet-4-6` → the first-turn connection (and first canonical envelope) reports Sonnet, not `availableModels[0]` (Opus). **Covers R1 for the first send.**
- Deferred creation with persisted `mode_id` → mode seeded alongside model (ordering preserved where the SDK distinguishes).
- Deferred creation with no persisted model/mode → provider default unchanged (R7 regression guard).
- Persisted model id **not present** in the connected session's available models → falls through to provider default; session creation succeeds (does not fail/`fail_pending_creation_attempt`).
- Bind/seed is idempotent / does not error when the attempt has null model/mode.

**Verification:** Rust tests green; manual QA (Phase QA below) confirms Sonnet is active from the first turn end-to-end; `cargo clippy` clean.

---

### Phase B — Canonical identity projection (bug 1)

### U4. Assign the sequence id at creation and project identity onto the pending session

**Goal:** The pending first-send session carries a canonical sequence id plus project name/color and the managed flag, so the number badge renders immediately during the pending phase.

**Requirements:** R2, R6.

**Dependencies:** none (independent of Phase A; can run in parallel).

**Two-part fix.** (a) Rust must assign the sequence id **at `creation_attempt` creation time** for all deferred creations — today the plain first-send path passes `None` (`new_session.rs` → `create_creation_attempt(..., None)`) and the sequence id is only assigned later at promotion. (b) TS must project that sequence id + project identity onto the pending session.

**Files:**
- `packages/desktop/src-tauri/src/db/repository/session_metadata.rs` — `create_creation_attempt` (and `insert_creation_attempt_in_transaction`) assigns `next_sequence_id_for_project` within the insert transaction so the attempt is born with a `sequence_id`. **Wrap it in the same `for _ in 0..5` retry-on-`is_sequence_constraint_violation` loop that `reserve_worktree_launch` / `insert_acepe_tracked_session` already use** — two concurrent first-sends in the same project both read the same MAX and would otherwise collide (same badge number, or a failed creation). `next_sequence_id_for_project` already includes `creation_attempts` in its `MAX` (so abandoned-attempt ids are not recycled). `promote_creation_attempt:453` already reuses `attempt.sequence_id` when present, so no double-assign.
- `packages/desktop/src-tauri/src/acp/commands/session_commands/new_session.rs:137-174` — return the attempt's now-populated `sequence_id` in the deferred `NewSessionResponse` for the plain (non-launch-token) path (currently returns `None` at line 172-173). `NewSessionResponse.sequence_id` already exists (line 63).
- `packages/desktop/src/lib/acp/types/new-session-response.ts` — confirm `sequenceId` is carried (the field exists on the deferred response; verify it is read).
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts:431-439` — the pending `CreatedSessionResult` carries `sequenceId` (from the response), `projectName`/`projectColor` (derive from `projectPath` via the same source the session-list projection uses), and a managed flag.
- `packages/desktop/src/lib/acp/store/session-creation-coordinator.svelte.ts` — `beginPendingCreation` stores the projected identity so the optimistic session entry exposes it.
- `packages/desktop/src/lib/acp/store/session-connection-facade.ts:53-79` — `materializePendingCreationSession`'s `addSession` carries `sequenceId` / managed (today it omits them). **Update the list entry in place at promotion — do not remove-and-re-add** — so the badge does not flicker across the pending → promoted transition (the sequence id is identical; the entry identity must be stable).
- Session-list projection feeding `session-item.svelte` (the sidebar list item that reads `session.sequenceId` / `projectName` / `projectColor`) — confirm it reads the pending session's projected identity. `session-item.svelte:601` badge gate stays as-is (it is correct once the data is present).

**Approach:** Make the sequence id canonical **from birth** of the deferred attempt, then project it. The managed flag reflects that this is an Acepe-created (not discovered) session, matching `is_acepe_managed = 1` that `promote_creation_attempt` sets. No `canonical ?? hotState` fallback — if the pending result lacks the sequence id, fix the producer (creation-time assignment + the response), not the badge gate. Early assignment means an abandoned attempt leaves a sequence-id gap; sequence ids already tolerate gaps (see Risks).

**Patterns to follow:** `next_sequence_id_for_project` / reserved-worktree sequence assignment in `session_metadata.rs`; project identity assembly in `session-table-logic.ts` and `panel-grouping.ts`; `is_acepe_managed` semantics in `session_metadata.rs`.

**Execution note:** Failing Rust test first asserting `create_creation_attempt` assigns a non-null per-project sequence id; then a failing TS test asserting the pending `CreatedSessionResult` / optimistic entry exposes `sequenceId` + project identity + managed.

**Test scenarios:**
- Rust: `create_creation_attempt` for a project assigns the next per-project sequence id (two sequential attempts in the same project get distinct, increasing ids).
- Rust (concurrency): two `create_creation_attempt` calls interleaved in the same project both succeed with **distinct** sequence ids (exercises the retry loop / no same-badge collision).
- Rust: `create_creation_attempt` after an attempt was abandoned/expired does not recycle the abandoned id (no collision with the lingering row).
- Rust: `promote_creation_attempt` reuses the attempt's existing `sequence_id` (no reassignment) when present.
- Rust: deferred `acp_new_session` (no launch token) returns `NewSessionResponse.sequence_id = Some(..)`.
- TS: deferred `createSession` returns a pending result carrying `sequenceId`, `projectName`, `projectColor`, and managed = true. **Covers R2.**
- TS: session-list projection for a pending session yields a `session` object that satisfies the `session-item.svelte:601` badge gate (all three fields non-null) → badge renders.
- TS: `materializePendingCreationSession` preserves `sequenceId` / managed onto the persisted session (no flip to unbadged on promotion).
- A discovered/unmanaged session (not first-send) is unaffected — managed flag stays false, existing behavior preserved.

**Verification:** Rust + TS tests green; `bun run check` clean; `cargo clippy` clean; QA confirms the badge appears on first send before connection completes.

---

### Phase C — Connecting-state presentation (bugs 4, 2, 3)

### U5. Keep the agent-panel footer present during connecting

**Goal:** The footer remains visible throughout the pending → connected handoff.

**Requirements:** R3, R6.

**Dependencies:** none (U4 helps ensure identity inputs are present, but the gate fix is independent).

**The footer gate boolean is already correct** (`agent-panel.svelte:1682` — each clause is a full `=== "literal"` comparison; there is no always-truthy bug). The footer vanishes because an *input* goes false during the handoff. **Find which one before editing anything** — instrument `viewState.kind`, `worktreeToggleProjectPath` (`agent-panel.svelte:353`, `resolveWorktreeToggleProjectPath`), and `panelId` during the failing pending → connected transition. Likely candidates: `worktreeToggleProjectPath` becomes null when `sessionProjectPath` is null for the pending session and no project is selected; or `derivePanelViewState` transiently returns a non-chrome kind.

**Files (scope to the confirmed cause):**
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte:353` — if `resolveWorktreeToggleProjectPath` returns null during pending, source the project path from the pending/canonical session identity (which U4 now carries) so it stays populated.
- `packages/desktop/src/lib/acp/logic/panel-visibility.ts` — `derivePanelViewState`: only if instrumentation shows it returns a non-chrome kind for a connecting/pending session with known identity, ensure it returns a session-chrome kind. If the footer loss is purely `worktreeToggleProjectPath`, this file may need **no** change — confirm before editing the discriminator (do not risk the `project_selection` regression).

**Approach:** Do not "fix the boolean." Trace the false input, fix that input at its source (canonical/pending identity), and leave `derivePanelViewState` untouched unless instrumentation proves it is the cause.

**Patterns to follow:** `resolveWorktreeToggleProjectPath` and the existing `derivePanelViewState` kind discrimination in `panel-visibility.ts`.

**Execution note:** Instrument first to identify the false input; then a failing pure-function test on whichever resolver/derivation is actually at fault for a connecting/pending input snapshot.

**Test scenarios:**
- The resolver actually at fault (likely `resolveWorktreeToggleProjectPath`) returns a non-null value for a connecting/pending session with known project identity. **Covers R3.**
- If `derivePanelViewState` is touched: it returns a session-chrome kind for a connecting/pending session with identity, and still returns `project_selection` (footer hidden) for the no-session empty state (regression guard).
- Footer remains rendered across a pending → connected transition with stable `panelId` and `projectPath`.

**Verification:** TS tests green; `bun run check` clean; QA confirms footer stays present from first send through connection.

---

### U6. No warming spinner in the agent header status indicator

**Goal:** During canonical `status === "warming"`, the agent header shows no loading spinner.

**Requirements:** R4, R6.

**Dependencies:** none.

**Files:**
- `packages/desktop/src/lib/acp/components/session-status-indicator.svelte` — read canonical `status`; for `warming`, render no spinner (no loading affordance), matching the user's intent that the connecting session is presented as the pre-connection session.

**Specify the substitute content (not just "no spinner").** Decide and state what occupies the `warming` slot: render nothing (empty), or fall through to the pre-connection/connected presentation. The confirmed end state is **no loading affordance**; pin the exact branch so the implementer does not guess.

**Preserve the failure signal (do not hide a stuck/failed connection).** Removing the warming spinner must not erase the user's only signal that something went wrong. The `error` status branch (and any timeout/stall path) must still render its affordance. **Confirm `status === "error"` is a distinct branch from `warming`** and is untouched; deferred-creation promotion has real failure exits (`fail_pending_creation_attempt`, DB-unavailable, provider-id mismatch). Only the transient `warming` state loses its affordance — `error` keeps one.

**Approach:** Presentational change driven by canonical status (read-only). The component keeps rendering connected/error/other states as today; only the `warming` branch stops emitting `<Spinner>`. Extract the status→presentation decision into a small pure helper if it eases testing.

**Patterns to follow:** existing status discrimination in `session-status-indicator.svelte`; pure view-state helpers (`*-state.ts`) elsewhere in `agent-input/logic`.

**Test scenarios:**
- `warming` status → no spinner element rendered; the specified substitute content is shown (assert on the presentation decision, not a `readFileSync` of source).
- `error` status → affordance still rendered (regression guard — failure stays visible).
- `connected` status → existing affordance unchanged.
- Other statuses unchanged.

**Verification:** test green; `bun run check` clean; QA screenshot of the header during warming shows no spinner.

---

### U7. Model selector keeps the canonical selection during connecting (no spinner)

**Goal:** While the session is connecting, the model selector keeps showing the canonical / pre-connection selection with no loading spinner.

**Requirements:** R5, R6, R7.

**Dependencies:** none (independent; complements U3 which makes the eventual canonical model correct).

**Verify the actual failing input first.** `resolveSelectorsLoading` (`agent-input/logic/toolbar-loading.ts`) already returns false when `hasToolbarData` is true even while connecting (loading is gated on `!hasToolbarData`). So the connecting-with-cache case may already work — the real failing input is likely that `hasToolbarData` is false because the cache/capabilities are not yet populated for the brand-new pending session. Confirm which input is false before rewriting the predicate.

**Files:**
- `packages/desktop/src/lib/acp/components/agent-input/state/composer-view-controller.svelte.ts:529` — the `selectorsLoading` derivation inputs (e.g. whether the user's `initialModelId` / cached selection counts toward "has data to show").
- `packages/desktop/src/lib/acp/components/agent-input/logic/toolbar-loading.ts` — `resolveSelectorsLoading`: ensure a resolvable selection during connecting yields `hasToolbarData`/`false`-loading.
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte:1572` — consumes `isLoading={composerView.selectorsLoading}`; no change beyond the derivation fix.

**Define "resolvable selection" precisely:** a selection is resolvable (so the selector shows it, no spinner) when the user has provided an `initialModelId` (pending/connecting case) **or** `isCacheLoaded && availableModelsCount > 0`. This is the exact predicate the implementer writes. The selector then shows the explicit/cached label during the connecting window rather than a spinner.

**Approach:** The selector's loading state should reflect "we have nothing to show yet", not "we are connecting." Keep genuine loading only when there is truly no resolvable selection (no `initialModelId`, no cache, no models). Reads canonical/cached selection state; does not fabricate a model.

**Execution note:** Failing pure-function test first on `resolveSelectorsLoading` for the connecting-with-resolvable-selection case.

**Test scenarios:**
- Connecting + a resolvable selection (user `initialModelId` present, or cache loaded + models present) → `selectorsLoading` is false; the selector keeps its label. **Covers R5.**
- Connecting + nothing resolvable (no `initialModelId`, cache not loaded, no models) → still loading (genuine empty state preserved, R7 guard).
- Connected → unchanged behavior.

**Verification:** test green; `bun run check` clean; QA confirms the selector keeps the chosen model visible (Sonnet) during connecting with no spinner.

---

### Phase QA — End-to-end verification (not a code unit)

After Phases A–C, run the mandatory dev-app QA pass (per `acepe-dev-app-qa`) on a fresh Claude Code first-send with an explicit Sonnet selection:
1. `bun run qa doctor` → `bun run qa observe`.
2. Inspect the session-list item selector → badge present (bug 1).
3. Inspect the agent header during warming → no spinner (bug 2).
4. Inspect the model selector during connecting → Sonnet label, no spinner (bugs 3, 5).
5. Inspect the footer (`[aria-label='Toggle terminal']` / footer region) → present throughout (bug 4).
6. Confirm post-connection the canonical current model is Sonnet (bug 5).

Restart the dev binary first if any Rust unit (U1–U4) is newer than the running binary (Step 1b of the QA skill).

---

## System-Wide Impact

- **Affected surfaces:** session creation (`acp_new_session`), creation-attempt persistence (Rust repository), the cc_sdk client bind/`build_options` seam, the deferred `NewSessionResponse` contract, the pending `CreatedSessionResult` / creation coordinator, the session-list projection (badge), the agent panel footer-input resolver, the status indicator, and the composer model-selector loading derivation.
- **Stakeholders:** end users (correct model, immediate badge, stable chrome); future agent work that relies on the pending session being a first-class canonical session.
- **Contract change:** `acp_new_session` gains optional params and the deferred `NewSessionResponse` may gain `sequenceId`. Regenerate specta/Tauri bindings; keep params optional so non-explicit-selection callers are unaffected.
- **Migration:** additive nullable columns on `creation_attempts`; safe forward/backward.

---

## Key Technical Decisions

1. **Canonical carrier for the explicit selection = the `creation_attempt` row (not in-memory).** Durable across restart and async promotion; the GOD-correct single source of truth for "what the user picked before the session existed." No existing per-session/per-mode model store exists today (verified — model selection is applied transiently and cached in preferences), so this is not a parallel authority. (Resolves call-out 1.)
2. **Seed the persisted selection into the cc_sdk client at *bind time*, before connect — not at promotion, not via TS `setModel`.** `build_options` consumes `pending_model_id`/`pending_mode_id` when the connection opens, so the **first** turn runs on the user's pick. Promotion is too late (post-connect, mid-first-turn) and has no client handle. (R6, R1.)
3. **Badge is a projection of an existing canonical fact (`creation_attempt.sequence_id`), assigned at creation and shown immediately.** The pending session is flagged managed so the existing badge gate passes; the list entry updates in place at promotion (no flicker). (Resolves call-out 2.)
4. **Connecting state is presented as a real session.** Footer-input source fixed (the gate boolean was already correct); header/selector read canonical status and show no loading affordance, keeping the pre-connection selection — while the `error` path keeps its affordance so failures stay visible. (Resolves call-out 3.)
5. **One explicit-selection concept, two carriers.** The non-deferred branch validates the explicit model against `availableModels` and falls through to default if absent; U3 preserves that safety net (invalid persisted model → default, never a failed session) rather than introducing an unguarded apply.

---

## Risks & Mitigations

- **Risk: applying the model too late means the first turn runs on the default (Opus).** This is exactly why U3 seeds at bind time (pre-connect), not at promotion. Assert via test that the **first** turn/envelope reflects the persisted model.
- **Risk: a stale/invalid persisted model id (model renamed, plan downgrade, restart between persist and connect).** Mitigate by preserving the non-deferred `availableModels.find` guard in U3 — invalid → fall through to default, never fail session creation.
- **Risk: the wrong source value is persisted (displayed/derived model instead of the user's explicit pick).** This would make bug 5 durable. Mitigate with the U2 test asserting `getInitialModelIdForNewSession()` returns the explicit pick when the derived default would differ.
- **Risk: concurrent first-sends in the same project collide on `sequence_id` (same badge, or failed creation).** Mitigate with the U4 retry loop + concurrency test.
- **Risk: removing warming/connecting affordances hides a stuck or failed connection.** Mitigate by keeping the `error` status affordance (U6) and QA-testing a failed promotion, not just the happy path.
- **Risk: `derivePanelViewState` change unintentionally shows session chrome for the empty/project-selection state.** Mitigate by changing it only if instrumentation proves it is the footer cause, with explicit regression scenarios (U5) covering `project_selection`.
- **Risk: `selectorsLoading` change hides a genuine loading state.** Mitigate by preserving loading when nothing is resolvable (U7 regression scenario).
- **Risk: specta binding drift after `acp_new_session` signature change.** Regenerate bindings and run `bun run check` + `cargo clippy`.
- **Risk: interaction with in-flight `refactor/retire-agent-panel-display-model`.** This plan reads canonical facts and projects them; it does not reintroduce a display model. Verify `derivePanelViewState` / panel projection changes stay consistent with that refactor.
- **Risk: assigning sequence ids at creation time (U4) leaves gaps when an attempt is abandoned/expired.** Sequence ids already tolerate gaps (deletions, the existing expiry path `expire_stale_creation_attempts`). Accept the gap; do not reclaim. Confirm `next_sequence_id_for_project` is monotonic and the per-project uniqueness check in `promote_creation_attempt` (`sequence_id_taken_by_other_session`) still holds with early assignment.

---

## Scope Boundaries

**In scope:** the five bugs above, via canonical widening (Phases A, B) and connecting-state presentation (Phase C).

### Deferred to Follow-Up Work
- A generalized non-spinner "connecting" affordance, if product later wants one (this plan ships *no* affordance during warming per the confirmed end state).
- Broader badge policy for discovered/unmanaged sessions (memory notes an existing product gap) — only first-send managed sessions are addressed here.
- **Durable per-session model persistence after promotion.** This plan carries the explicit selection *across the deferred boundary* (one-shot, into the first connection). Whether the session's model should also persist as a durable per-session/per-mode preference for later reconnects is a separate concern, deliberately not solved here.
- **A non-spinner "connecting" / timeout affordance.** This plan ships *no* affordance during transient `warming` (per the confirmed end state) while keeping the `error` affordance. If product later wants a positive "connecting…" or stall-timeout signal, that is follow-up — flagged because U6/U7 remove the current loading cue.

**Outside this change:** the cancel-bug fix (done, awaiting commit) and the Cursor "Planning next moves" stuck-turn issue.

---

## Dependencies & Sequencing

```text
U1 ─► U2 ─► U3        (Phase A, bug 5: migrate → persist → seed pre-connect)
U4                    (Phase B, bug 1 — parallel)
U5   U6   U7          (Phase C, bugs 4/2/3 — parallel)
            └─ U5 benefits from U4's identity but does not block on it
```

Land Phase A in order (migration → persist → seed-at-bind). Phases B and C are independent and can interleave. Run Phase QA last. Note: U5 and U7 both begin with **instrumentation to confirm the actual failing input** before any edit.
