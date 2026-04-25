---
title: Refactor OpenCode runtime root resolution
type: refactor
status: active
date: 2026-04-04
---

# Refactor OpenCode runtime root resolution

## Overview

Acepe has three verified causes of duplicate OpenCode runtimes and duplicate LSP children:

1. `OpenCodeManagerRegistry::get_or_start(...)` in `packages/desktop/src-tauri/src/acp/opencode/manager.rs` has a TOCTOU race, so concurrent callers can spawn two `opencode serve` subprocesses for the same effective root.
2. OpenCode HTTP requests still post raw per-call `cwd` values in `packages/desktop/src-tauri/src/acp/opencode/http_client/agent_client_impl.rs`, so one backend process can create multiple upstream OpenCode instance identities.
3. The backend does not consistently resolve repo roots, worktree roots, subdirectories, symlinks, and case variants to one effective OpenCode runtime root.

The important constraint is that Acepe does not need a new `workspace` domain concept to fix this. The bug is about choosing the same backend-owned runtime root everywhere that OpenCode is created or addressed.

This plan keeps the existing domain model:

- `project_path`
- `worktree_path`
- `session_id`

and adds one backend-only concept:

- `ResolvedOpenCodeRoot`: the effective directory OpenCode should use for runtime ownership and HTTP `directory` binding

## Goals

- G1. Ship a backend-only fix for duplicate OpenCode runtimes and duplicate LSP subprocesses.
- G2. Preserve correct isolation between a main repo and its git worktrees.
- G3. Keep runtime-root resolution backend-owned; do not introduce a new frontend-facing `workspace` model.
- G4. Continue using `session_id + session_metadata(project_path, worktree_path)` for restore and reconnect.
- G5. Make startup restore robust for canonical Acepe session IDs and provider-owned alias IDs.
- G6. Keep project grouping and panel grouping path-based.
- G7. Surface explicit degraded state when stored worktree paths are no longer valid at startup, rather than silently resuming against a different directory.

## Non-Goals

- Upstream OpenCode changes.
- New `workspace_id` or `workspace` entity in the product model.
- New `workspaceId` fields in `SessionIdentity`, `Panel`, or `Project`.
- `projects.workspace_id` or `session_metadata.workspace_id` columns.
- Idle runtime eviction.
- Mid-session worktree deletion detection.
- Grouping redesign.
- Non-OpenCode runtime architecture.

## Current Code Anchors

### Rust

- OpenCode runtime lifecycle: `packages/desktop/src-tauri/src/acp/opencode/manager.rs`
- OpenCode module wiring: `packages/desktop/src-tauri/src/acp/opencode/mod.rs`
- OpenCode client construction: `packages/desktop/src-tauri/src/acp/client_factory.rs`
- OpenCode HTTP client: `packages/desktop/src-tauri/src/acp/opencode/http_client/mod.rs`
- OpenCode request bodies: `packages/desktop/src-tauri/src/acp/opencode/http_client/agent_client_impl.rs`
- Preconnection commands: `packages/desktop/src-tauri/src/acp/commands/preconnection_commands.rs`
- Session metadata persistence and resume fallback: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- History/startup loading: `packages/desktop/src-tauri/src/history/commands/scanning.rs`
- Session context resolution: `packages/desktop/src-tauri/src/history/session_context.rs`
- Project path validation: `packages/desktop/src-tauri/src/path_safety.rs`
- Git worktree helpers: `packages/desktop/src-tauri/src/git/worktree.rs`
- Session metadata repository: `packages/desktop/src-tauri/src/db/repository.rs`
- Startup DB initialization: `packages/desktop/src-tauri/src/db/mod.rs`
- Startup hydration DTO: `packages/desktop/src-tauri/src/session_jsonl/types.rs`

### TypeScript

- Startup session hydration:
  - `packages/desktop/src/lib/acp/store/services/session-repository.ts`
  - `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`
- Reconnect path:
  - `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Tauri shims:
  - `packages/desktop/src/lib/utils/tauri-client/acp.ts`
  - `packages/desktop/src/lib/utils/tauri-client/history.ts`
- Store types for degraded state only:
  - `packages/desktop/src/lib/acp/store/types.ts`
- Generated types:
  - `packages/desktop/src/lib/services/acp-types.ts`
  - `packages/desktop/src/lib/services/claude-history-types.ts`

## Key Decisions

### 1. The bug is about runtime root resolution, not a new identity model

Acepe already has enough product concepts to restore and reconnect sessions:

- `session_id`
- `project_path`
- `worktree_path`

The missing piece is a single backend resolver that turns those inputs into the effective OpenCode runtime root.

### 2. OpenCode runtime root stays backend-only

The frontend should not learn a new `workspaceId` or `runtimeRootId`. The backend resolves the root, keys the manager registry, binds the HTTP client, and persists existing path fields as needed.

### 3. `project_path` and `worktree_path` stay the persisted location model

The plan does not add new DB columns for runtime ownership. Session metadata continues to store:

- `project_path`
- optional `worktree_path`
- optional provider alias state

That is enough to derive the same effective OpenCode runtime root later.

### 4. Restore remains session-driven

OpenCode restore and reconnect should keep starting from `session_id`, then loading DB metadata. That is already how `acp_resume_session(...)` and `resolve_session_context(...)` are structured.

### 5. Alias remapping is the only required frontend restore change

The meaningful frontend leak today is not runtime identity; it is alias handling. `get_startup_sessions(...)` can find rows by `provider_session_id`, but startup validation still reasons in canonical Acepe session IDs. That needs a targeted startup remap.

### 6. Degraded restore is acceptable when the path inputs no longer validate

If the stored worktree no longer exists, Acepe should not silently resume writable OpenCode activity against a different directory. Read-only fallback may still be acceptable for history.

## Resolved OpenCode Root

`ResolvedOpenCodeRoot` is a backend-only helper result. It is not a new persisted domain object.

Equivalent shape:

```text
ResolvedOpenCodeRoot {
  runtime_root: PathBuf,
  project_root: PathBuf,
  worktree_root: Option<PathBuf>,
}
```

Semantics:

- `runtime_root`
  - the directory that owns the OpenCode manager registry entry
  - the directory posted as OpenCode HTTP `directory`
- `project_root`
  - canonical main repo root for existing grouping and metadata persistence
- `worktree_root`
  - present only when the effective runtime root is a git worktree

### Resolution rules

- If input is inside a git worktree, `runtime_root` is the canonical worktree root.
- Else if input is inside a git repo, `runtime_root` is the canonical main repo root.
- Else `runtime_root` is the validated canonical directory itself.
- Symlinked paths resolve to the real path before choosing the root.
- Case variants on case-insensitive filesystems normalize to the same runtime root key.
- `source_path` never participates in runtime ownership.

## Phases

### Phase 1: Backend runtime fix

**Goal:** ship the OpenCode CPU/process-count fix with no schema changes and no new frontend identity fields.

Phase 1 is split into four sub-phases to limit blast radius and allow safe incremental rollback. Each sub-phase is independently mergeable and testable — a failure in a later sub-phase does not require reverting earlier ones.

**Files (all sub-phases):**

- `packages/desktop/src-tauri/src/acp/opencode/manager.rs`
- `packages/desktop/src-tauri/src/acp/opencode/mod.rs`
- `packages/desktop/src-tauri/src/acp/client_factory.rs`
- `packages/desktop/src-tauri/src/acp/opencode/http_client/mod.rs`
- `packages/desktop/src-tauri/src/acp/opencode/http_client/agent_client_impl.rs`
- `packages/desktop/src-tauri/src/acp/commands/preconnection_commands.rs`
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- `packages/desktop/src-tauri/src/acp/opencode/http_client/catalog.rs`
- `packages/desktop/src-tauri/src/git/worktree.rs`
- `packages/desktop/src-tauri/src/path_safety.rs`
- `packages/desktop/src-tauri/src/db/repository.rs`
- new: `packages/desktop/src-tauri/src/acp/opencode/runtime_root.rs`
- new: `packages/desktop/scripts/verify-no-duplicate-lsp.sh`

#### Phase 1a: Resolver

Add the shared `ResolvedOpenCodeRoot` resolver. No callers are changed yet — this sub-phase only adds the new module and its tests.

**Implementation:**

1. Add one shared backend resolver in `acp/opencode/runtime_root.rs`.
   - Validate the candidate directory with existing path-safety rules.
   - Walk parents upward to detect worktree roots and main repo roots.
   - Reuse existing `.git` parsing behavior instead of keeping separate repo and worktree heuristics in multiple files.
   - Return `ResolvedOpenCodeRoot`.

**TDD / tests:**

- first write failing tests for:
  - subdirectory input resolving to containing repo or worktree root
  - equivalent differently cased paths resolving to one key on case-insensitive filesystems
  - symlinked equivalent paths resolving to one key after canonicalization
  - non-git directory resolving to itself
- then implement the minimal resolver

**Ship gate (1a):**

- all resolver unit tests pass
- `cargo clippy` clean

#### Phase 1b: Registry rewrite

Replace the TOCTOU race in `OpenCodeManagerRegistry` with single-flight `OnceCell` creation. The resolver from 1a is wired into the registry key computation.

**Implementation:**

1. Replace the OpenCode registry race with fallible single-flight creation.
   - Keep the registry keyed by a normalized runtime-root string derived from the Phase 1a resolver.
   - Use a `DashMap<String, Arc<tokio::sync::OnceCell<Arc<TokioMutex<OpenCodeManager>>>>>` (or `RwLock<HashMap<...>>`) so each runtime-root key has its own `OnceCell`.
   - Use `get_or_try_init` to ensure only one caller runs the init closure per cell. On `Err`, the cell stays uninitialized and subsequent callers automatically retry — do **not** remove the cell from the map on failure, because a concurrent caller may already hold a reference to it and would initialize an orphaned cell that is no longer in the registry.
   - The current code has a partial double-check (re-acquires the lock after `ensure_running` and checks for a concurrent insert) but the losing racer's manager is silently dropped without calling `graceful_stop()`, leaking the spawned subprocess. The single-flight `OnceCell` approach eliminates this race entirely; only one manager is ever created per key.
   - Preserve explicit shutdown behavior for initialized managers. For permanent cleanup of a specific key (e.g., user-initiated shutdown), use a dedicated `shutdown_runtime(key)` path that removes the cell from the map after stopping the manager.

2. **Permanent failure handling:** `get_or_try_init` retries automatically after transient failures (cell stays uninitialized on `Err`). For failures that are likely permanent for a given key (e.g., binary not found, directory does not exist), the init closure should classify the error. If the error is terminal, store a `Result<Arc<TokioMutex<OpenCodeManager>>, PermanentInitError>` in the cell instead of leaving it uninitialized, so subsequent callers fail fast with a diagnostic message rather than retrying indefinitely. Transient errors (port conflict, temporary I/O failure) should leave the cell uninitialized for automatic retry. The classification heuristic:
   - **Terminal:** binary not found, directory does not exist, path-safety rejection.
   - **Transient:** port bind failure, process spawn timeout, I/O error on an existing directory.

3. **Concurrent shutdown safety:** `shutdown_all()` must coordinate with in-progress `get_or_try_init` calls. The approach:
   - Set an `AtomicBool` shutdown flag before draining the map.
   - The init closure checks the flag before spawning a subprocess and returns `Err` if shutdown is in progress.
   - After draining, `shutdown_all()` waits briefly (e.g., 100ms) and re-drains to catch any init that raced past the flag check.
   - `shutdown_runtime(key)` for single-key cleanup should remove the cell from the map **and** stop the manager. If the cell is mid-init (not yet initialized), removing it from the map is sufficient — the init closure will complete but its result is discarded since no one holds a reference to the orphaned cell anymore.

**TDD / tests:**

- first write failing tests for:
  - concurrent `get_or_start(...)` on the same effective root spawning exactly one runtime
  - failed initialization allowing a later retry (transient error)
  - permanent failure (binary not found) failing fast on subsequent calls
  - `shutdown_all()` during concurrent init does not leak a subprocess
- then implement the minimal fix

**Ship gate (1b):**

- concurrent-load tests pass — one runtime per effective root
- `cargo test opencode::manager` clean

#### Phase 1c: HTTP client binding

Bind `OpenCodeHttpClient` to the resolved runtime root at construction. Remove mutable `current_directory` routing.

**Implementation:**

1. Bind `OpenCodeHttpClient` to one resolved runtime root at construction.
   - Store the resolved `runtime_root` in the client.
   - Remove mutable `current_directory` routing behavior from all mutation sites: `new_session(...)`, `resume_session(...)`, and `list_preconnection_commands(...)`.
   - Replace all `current_directory` reads with the bound `runtime_root`:
     - `send_prompt(...)` — builds the `"directory"` field in the prompt request body
     - `cancel(...)` — builds the `"directory"` field in the abort request body
     - `fetch_available_commands(...)` in `catalog.rs` — sends `directory` as a query parameter
   - Keep the agent trait signature unchanged if that is the smallest repo-fit path, but OpenCode should ignore per-call `cwd` once the client is constructed.
   - OpenCode HTTP `directory` should always be the client's bound `runtime_root`; per-call `cwd` remains only for interface compatibility.

2. **Directory scope verification (ship gate — not a side-note):** This sub-phase changes the `directory` value from a per-call subdirectory to the resolved repo or worktree root. If OpenCode scopes file context or tool access based on this parameter, users who previously initiated sessions from a subdirectory may see broader agent file scope. This is the intended behavior — the resolved root is the correct ownership boundary. Before shipping 1c, the implementer **must**:
   - Read the OpenCode source or documentation to confirm how `directory` is used for scoping.
   - If OpenCode restricts tool access to `directory`, confirm that broadening to the repo root is acceptable product behavior.
   - If it is not acceptable, add a `subdirectory_hint` field alongside `directory` and file a follow-up issue. Do not ship 1c without resolving this question.

3. Use the same resolver for every OpenCode entry point.
   - `create_client(...)`
   - `acp_list_preconnection_commands(...)`
   - `persist_session_metadata_for_cwd(...)`

**TDD / tests:**

- preconnection commands and session creation binding the same resolved root
- `send_prompt` and `cancel` use the bound root, not the per-call cwd
- existing agent trait signature tests still pass

**Ship gate (1c):**

- raw per-call `cwd` no longer creates multiple upstream OpenCode instance identities
- OpenCode `directory` scope behavior is verified and documented

#### Phase 1d: Metadata persistence and cache fix

Fix `session_metadata_context_from_cwd` and `VALIDATED_PATHS` cache keying.

**Implementation:**

1. Replace the root-only metadata helper.
   - `session_metadata_context_from_cwd(...)` currently only checks `.git` at the exact cwd level with no upward walk. Replace it with a call to the new `runtime_root.rs` resolver so subdirectory inputs persist the correct `project_path` and `worktree_path` — do not duplicate the parent-walk logic.
   - **Backward compatibility:** existing `session_metadata` rows persisted before this change may store a subdirectory as `project_path` (e.g., `/repo/src` instead of `/repo`). These rows will no longer match the canonical root used by `get_for_projects(...)`. Accept this as a data break: subdirectory-as-project-path was always incorrect behavior, and affected rows are rare (requires a user to have opened a subdirectory directly). Add a note to the changelog.

2. Ensure path_safety validation cache keys by canonical path.
   - The existing `VALIDATED_PATHS` cache in `path_safety.rs` is keyed by the original input path, not the canonical path. The new resolver canonicalizes first, then validates, creating split cache entries for the same physical directory. Change the cache to key by canonical path (canonicalize before cache lookup) so the resolver and direct callers share entries.

**TDD / tests:**

- subdirectory cwd persists the containing repo root as `project_path`
- worktree subdirectory cwd persists correct `project_path` and `worktree_path`
- cache hit rate: two differently-cased paths for the same directory produce one cache entry

**Ship gate (1d):**

- metadata persistence tests pass
- the manual LSP-count verification stays flat for equivalent paths

#### Phase 1 overall ship gate

Phase 1 (all sub-phases) is done when:

- one effective root produces one OpenCode runtime under concurrent load
- raw per-call `cwd` no longer creates multiple upstream OpenCode instance identities
- the manual LSP-count verification stays flat for equivalent paths
- OpenCode `directory` scope behavior is verified and accepted

### Phase 2: Restore correctness and alias remap

**Goal:** tighten startup restore without leaking backend runtime-root logic into general frontend models.

**Known limitation until Phase 2 ships:** after Phase 1 lands, runtime root resolution is correct, but alias-restored panels may still be cleared by `validateRestoredSessions()` when the panel stores a provider alias ID that doesn't match the canonical session ID in the store. This is the existing alias bug — Phase 1 does not make it worse, but does not fix it either. Phase 2 should follow Phase 1 closely.

**Files:**

- `packages/desktop/src-tauri/src/history/commands/scanning.rs`
- `packages/desktop/src-tauri/src/session_jsonl/types.rs`
- `packages/desktop/src/lib/acp/store/services/session-repository.ts`
- `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`
- `packages/desktop/src/lib/utils/tauri-client/history.ts`
- generated `packages/desktop/src/lib/services/claude-history-types.ts`

**Implementation:**

1. Extend startup hydration to report canonical session identity when lookup matched by alias.
   - Return a `requested_id → canonical_id` mapping alongside the `HistoryEntry` list. The Rust side should track which input session IDs matched via `provider_session_id` rather than primary `id`, and include those remappings in the response.
   - The startup sort-order logic in `scanning.rs` currently builds an order map from the input `session_ids` (line 96-100) — this breaks when the returned entry's `id` differs from the requested alias. The sort should use the remap to find the correct order index.
   - The goal is only to let startup code distinguish:
     - requested session ID from persisted UI state
     - canonical Acepe session ID loaded into the store

2. **Rust response shape change.** The current `get_startup_sessions` command returns `Vec<HistoryEntry>`. Change the return type to a wrapper struct:

   ```text
   StartupSessionsResponse {
     entries: Vec<HistoryEntry>,
     alias_remaps: HashMap<String, String>,  // requested_alias_id → canonical_id
   }
   ```

   - In `scanning.rs`, after `get_for_session_ids`, compare each returned row's `id` against the requested `session_ids`. When a row was matched by `provider_session_id` (the row's `id` differs from the requested ID), insert the mapping into `alias_remaps`.
   - The `HistoryEntry` struct itself does not change — it always carries the canonical `id`.
   - Add `#[derive(Serialize, specta::Type)]` to the new wrapper so Specta generates the TypeScript type into `claude-history-types.ts`.

3. **Tauri shim update.** In `packages/desktop/src/lib/utils/tauri-client/history.ts`, change `getStartupSessions` to return `ResultAsync<StartupSessionsResponse, AppError>` instead of `ResultAsync<HistoryEntry[], AppError>`. The wrapper type will be auto-generated by Specta.

4. **Session repository consumption.** In `packages/desktop/src/lib/acp/store/services/session-repository.ts`, the `loadStartupSessions` call (around line 309) currently maps over `HistoryEntry[]`. Update it to:
   - Destructure `{ entries, aliasRemaps }` from the response.
   - Pass `aliasRemaps` through to the caller (or store it as a return value alongside the hydrated sessions).

5. **Remap restored panel references before validation.** In `initialization-manager.ts`:
   - After `loadStartupSessions()` resolves, receive the `aliasRemaps` map.
   - Before calling `validateRestoredSessions()` (line 390), iterate all restored panels. For each panel whose `sessionId` appears as a key in `aliasRemaps`, rewrite `panel.sessionId` to the canonical value.
   - This ensures `validateRestoredSessions()` (line 444) finds the session in the store when it calls `getSessionCold(panel.sessionId)`.

6. Keep reconnect path unchanged from a domain-model perspective.
   - `connectSession(...)` still starts from `session_id` and the existing session DTOs.
   - No `workspaceId` or runtime-root field is added to frontend session identity.

**TDD / tests:**

- Rust: `get_startup_sessions` with a mix of canonical and alias IDs returns correct `alias_remaps` and preserves sort order
- Rust: `get_startup_sessions` with only canonical IDs returns empty `alias_remaps`
- TS: `session-repository` destructures the new response shape and passes alias remaps through
- TS: `initialization-manager` rewrites panel session IDs from alias remaps before validation
- TS: panels are not cleared when startup hydration found the row by alias
- TS: legacy restored panels (no alias involved) continue to work unchanged

### Phase 3: Explicit degraded restore for invalid worktree paths

**Goal:** make invalid stored worktree state explicit without inventing a new identity system.

**Scope note:** Phase 3 is optional hardening. The core duplicate-runtime fix is complete at Phase 1 and the alias-remap fix at Phase 2. Phase 3 can be deferred or cut without undermining those fixes. It should only ship if degraded restore is a confirmed product need (users have reported confusion from silent worktree fallback).

**Files:**

- `packages/desktop/src-tauri/src/acp/client_session.rs`
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- `packages/desktop/src-tauri/src/history/session_context.rs`
- generated `packages/desktop/src/lib/services/acp-types.ts`
- `packages/desktop/src/lib/acp/store/types.ts`
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`

**Implementation:**

1. Extend `ResumeSessionResponse` with optional degraded restore metadata.

2. Make the authority order explicit for OpenCode resume.
   - DB `worktree_path` if it still exists and validates
   - otherwise caller `cwd` resolved through the backend runtime-root resolver as a fallback input only, not as a new persisted identity source
   - otherwise degraded restore, not silent writable fallback

3. Degraded reasons:
   - `missing_worktree`
   - `no_valid_restore_input`

4. Frontend behavior:
   - degraded status lives in hot state only
   - retry uses a dedicated `revalidateAndReconnectSession(sessionId)` path
   - regular `connectSession(...)` should not loop degraded sessions
   - **Mid-session fence:** the retry path is only available on sessions that entered degraded state during startup hydration. Sessions that become invalid mid-session (worktree deleted while Acepe is running) are not covered — that is the non-goal "Mid-session worktree deletion detection."

5. Read-only history fallback remains explicit.
   - Missing worktree may still allow safe history loading.
   - Writable OpenCode resume must not silently downgrade from a deleted worktree to the main repo.

6. Degraded UX treatment (proposed — subject to design review, not a Phase 3 ship gate):
   - The agent panel shows an inline banner (not a toast) with the degraded reason: "Worktree no longer exists" or "Session directory is no longer valid."
   - A "Retry" button appears below the banner, wired to `revalidateAndReconnectSession(sessionId)`.
   - While degraded, the panel renders prior conversation history as read-only: the user can scroll, read messages, and copy code blocks, but the message input is disabled and no new prompts can be sent.
   - The panel header shows a warning icon next to the session name.
   - The final UX treatment should be validated with product/design before implementation. The backend contract (degraded reason enum and read-only flag) is the Phase 3 deliverable; the visual presentation may evolve independently.
   - Regenerating the generated types (`acp-types.ts`) is required after extending `ResumeSessionResponse`.

**TDD / tests:**

- deleted worktree returns `missing_worktree` and blocks writable resume
- retry path single-flights repeated clicks
- retry button routes to revalidation only for degraded sessions

### Phase 4: Regression coverage and manual verification

**Goal:** prove the narrower architecture holds.

**Files:**

- `packages/desktop/src-tauri/src/acp/opencode/http_client/tests.rs`
- `packages/desktop/src-tauri/src/acp/commands/tests.rs`
- relevant history/startup tests under `packages/desktop/src-tauri/src/`
- relevant frontend tests under `packages/desktop/src/lib/acp/store/services/__tests__/`
- `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`
- `packages/desktop/scripts/verify-no-duplicate-lsp.sh`

**Scenarios:**

- same effective root under concurrent load -> one OpenCode runtime
- startup failure during manager creation -> later retry succeeds
- same repo via differently cased paths -> one runtime on case-insensitive filesystems
- repo root and worktree root -> distinct runtimes
- subdirectory input -> containing repo or worktree runtime
- startup restore via provider-owned session ID -> canonical remap before panel validation
- deleted worktree -> degraded restore, no writable resume

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Single-flight init failure poisons a runtime-root key | `get_or_try_init` leaves the cell uninitialized on transient `Err`, so subsequent callers automatically retry. Terminal failures (binary not found, directory missing) store a `PermanentInitError` in the cell so callers fail fast. Do not evict cells from the map on failure — eviction creates a second TOCTOU where a concurrent caller initializes an orphaned cell. Use a dedicated `shutdown_runtime(key)` path for permanent cleanup. |
| Resolver drift across call sites | Centralize the resolver in one backend helper and reuse it everywhere OpenCode is entered |
| Frontend model contamination | Keep runtime-root logic backend-only; only expose degraded state and alias remap data |
| Missing worktree resumes against the wrong checkout | Degrade instead of silently downgrading writable resume to the main repo |
| Startup hydration finds rows by alias but panels still point at old IDs | Return alias-aware startup hydration data (`StartupSessionsResponse.alias_remaps`) and rewrite panel references before validation |
| `shutdown_all()` races with in-progress `get_or_try_init` | Shutdown sets an `AtomicBool` flag before draining, init closure checks flag before spawning, double-drain after brief delay catches stragglers |
| `directory` scope broadening weakens OpenCode's file boundary | Promoted to Phase 1c ship gate — must verify OpenCode's scoping behavior before shipping; if unacceptable, add `subdirectory_hint` field and file follow-up |
| Phase 1 regression requires painful multi-file revert | Sub-phases (1a–1d) are independently mergeable and revertible; see Rollback Strategy below |

## Rollback Strategy

Each phase and sub-phase is designed for independent rollback. The rollback path for each:

### Phase 1 sub-phases

- **1a (resolver):** Pure addition — no callers changed. Revert by removing `runtime_root.rs` and its test module. Zero impact on existing behavior.
- **1b (registry rewrite):** Revert restores the original `TokioMutex<HashMap<...>>` registry. The resolver from 1a remains available but unused by the registry. Existing behavior is fully restored.
- **1c (HTTP client binding):** Revert restores mutable `current_directory` routing. The registry from 1b continues working with the old per-call `cwd` behavior. The duplicate-identity bug returns, but the TOCTOU race fix from 1b is preserved.
- **1d (metadata + cache fix):** Revert restores the old `session_metadata_context_from_cwd` (no parent walk) and original cache keying. Subdirectory-as-project-path bug returns, but runtime fixes from 1b/1c are preserved.

### Phase 2

- Revert changes the `get_startup_sessions` return type back to `Vec<HistoryEntry>`, removes alias remap logic from `initialization-manager.ts`, and regenerates Specta types. Alias panels resume being cleared by `validateRestoredSessions()` — the pre-existing behavior.

### Phase 3

- Phase 3 is explicitly optional. Revert removes the degraded restore metadata from `ResumeSessionResponse` and the frontend degraded UX. Sessions with deleted worktrees resume the pre-existing silent fallback behavior.

### General rollback rules

- Each sub-phase should be a single squashed commit (or a small, clean PR) so `git revert` produces a clean result.
- No database schema migrations are introduced in any phase, so there are no migration rollback concerns.
- After reverting any sub-phase, run `cargo test --lib` and `bun run check` to confirm clean state.

## Verification

### Phase 1a

```bash
cd packages/desktop/src-tauri && cargo test runtime_root
cd packages/desktop/src-tauri && cargo clippy
```

### Phase 1b

```bash
cd packages/desktop/src-tauri && cargo test opencode::manager
```

### Phase 1c

```bash
cd packages/desktop/src-tauri && cargo test opencode::http_client
```

Manual:

1. Verify OpenCode `directory` scoping behavior against OpenCode source or documentation.
2. Confirm that broadening `directory` to repo root does not restrict expected tool access.

### Phase 1d

```bash
cd packages/desktop/src-tauri && cargo test session_commands
cd packages/desktop/src-tauri && cargo test path_safety
bash packages/desktop/scripts/verify-no-duplicate-lsp.sh
```

### Phase 2

```bash
cd packages/desktop && bun test session-repository-startup-sessions initialization-manager
cd packages/desktop && bun run check
```

Manual:

1. Restore a panel whose stored session ID is a provider alias.
2. Verify the panel is rewritten to the canonical session ID before validation clears anything.

### Phase 3

```bash
cd packages/desktop && bun test session-connection-manager agent-panel
cd packages/desktop && bun run check
```

Manual:

1. Delete a worktree externally, restart Acepe, and verify degraded read-only state.
2. Click retry and verify explicit revalidation runs.

### End-to-end

1. Open the same repo through equivalent paths and verify one OpenCode process.
2. Open one repo plus two worktrees and verify three OpenCode processes.
3. Trigger Svelte edits from two equivalent-path sessions and verify `svelte-language-server` count stays constant.
4. Restart mid-session and verify worktree sessions reconnect to the correct runtime root.

## Out of Scope

- new `workspace` or `workspace_id` concepts
- DB schema changes for runtime identity
- project-row deduplication
- non-git durable same-path recreation identity
- mid-session filesystem watchers for worktree deletion
- changing non-OpenCode agents to use the same runtime-root architecture
