# Claude Provider Session ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude-provided `session_id` the canonical persisted/resumable identity while preserving a stable local UI session identity and avoiding user-visible session startup delay.

**Architecture:** Keep panel/UI creation immediate with a stable local Acepe session identity for frontend maps and panel references, but capture Claude's real `session_id` from the first `cc-sdk` stream event and persist it as the canonical provider identity used for resume and history. Replace the current optimistic placeholder flow with explicit identity binding so frontend state stays stable while backend persistence and restart logic use Claude's durable session id.

**Tech Stack:** Rust, Tauri 2, SvelteKit 2, Svelte 5, SeaORM, SQLite, cc-sdk 0.7.0, neverthrow

---

## File Structure

**Persistence invariants**
- `session_metadata.id` remains the stable local Acepe session identity used by frontend state, panel linkage, and O(1) local lookups.
- `session_metadata.provider_session_id` stores Claude's canonical durable `session_id` and is the only id used for Claude restart/resume and history binding once resolved.
- `SessionMetadataRepository::get_by_id` continues to mean local Acepe session id lookup.
- Claude history rows and resume logic must bind through `provider_session_id`; unresolved rows are explicitly non-resumable.

**Modify backend identity and persistence flow**
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs` - capture Claude `session_id` from the first provider message and bind it to the stable local Acepe session id
- `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs` - surface first provider session id as a distinct session update/event instead of masking it
- `packages/desktop/src-tauri/src/acp/session_update/types/session_update.rs` - add a session identity resolved update/event type
- `packages/desktop/src-tauri/src/acp/session_registry.rs` - keep live clients keyed by stable local id while recording canonical provider session id for resume/history
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs` - use provider session id for Claude resume and reject unresolved sessions safely
- `packages/desktop/src-tauri/src/db/entities/session_metadata.rs` - add explicit local/provider identity fields
- `packages/desktop/src-tauri/src/db/migrations/m20260325_000001_add_provider_identity_to_session_metadata.rs` - add schema for local/provider identity binding
- `packages/desktop/src-tauri/src/db/migrations/mod.rs` - register the new migration
- `packages/desktop/src-tauri/src/db/repository.rs` - replace placeholder-only identity model with explicit local-to-provider binding and promotion
- `packages/desktop/src-tauri/src/history/commands/session_loading.rs` - load Claude sessions via canonical provider id and treat unresolved local ids as non-durable

**Modify frontend/provider contract and startup behavior**
- `packages/desktop/src/lib/services/converted-session-types.ts` - generated contract output for new session update type
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts` - attach provider session id without mutating immutable local session identity
- `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts` - carry provider identity resolution without losing event ordering
- `packages/desktop/src/lib/acp/store/session-connection-service.svelte.ts` - audit stable identity assumptions for connect/resume
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts` - bind provider session identity to existing session state without rekeying local ids
- `packages/desktop/src/lib/acp/store/panel-store.svelte.ts` - remain unchanged in identity semantics; prove that panel linkage stays stable
- `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts` - do not eagerly reconnect unresolved Claude sessions on app startup

**Tests**
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs` - backend unit tests for provider id capture and binding
- `packages/desktop/src-tauri/src/acp/commands/tests.rs` - backend integration tests for resolved/unresolved restart behavior
- `packages/desktop/src-tauri/src/db/repository_test.rs` - repository tests for identity binding, promotion, and no-duplicate guarantees
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.test.ts` - frontend provider identity binding flow
- `packages/desktop/src/lib/acp/store/__tests__/panel-store-workspace-panels.vitest.ts` - panel linkage remains stable under provider identity binding
- `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts` - startup handling for unresolved and resolved Claude sessions

### Task 1: Add a backend provider-identity resolution event

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_update/types/session_update.rs`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs`
- Modify: `packages/desktop/src/lib/services/converted-session-types.ts`
- Test: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs`

- [ ] **Step 1: Write the failing Rust test for provider session id capture**

Add a test in `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs` that feeds a `cc_sdk::Message::StreamEvent` with `session_id = "claude-real-id"` through the bridge path and asserts the backend produces a session identity resolution update that binds the stable local Acepe id to Claude's canonical provider id.

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk cargo test --lib acp::client::cc_sdk_client::tests::captures_provider_session_id_from_first_stream_event`

Expected: FAIL because no identity resolution update exists yet.

- [ ] **Step 3: Add a dedicated session identity resolved update type**

In `packages/desktop/src-tauri/src/acp/session_update/types/session_update.rs`, add a new update variant carrying:

```rust
pub struct SessionIdentityResolvedData {
    pub local_session_id: String,
    pub provider_session_id: String,
}
```

Then emit that variant from `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs` when the first non-empty `sdk_sid` differs from the stable local id.

- [ ] **Step 4: Update generated frontend contract in the same task**

Run the actual specta generation workflow instead of editing generated files manually:

Run from `packages/desktop/src-tauri`:

`cargo test --lib session_jsonl::export_types::tests::export_types`

This updates `packages/desktop/src/lib/services/converted-session-types.ts` so the frontend can safely deserialize the new update without a broken intermediate state.

- [ ] **Step 5: Run the test to verify it passes**

Run: `rtk cargo test --lib acp::client::cc_sdk_client::tests::captures_provider_session_id_from_first_stream_event`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/acp/session_update/types/session_update.rs packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs packages/desktop/src/lib/services/converted-session-types.ts
git commit -m "fix: surface Claude provider session identity"
```

### Task 2: Bind provider identity in the live stream/client path without rekeying local ids

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_registry.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Test: `packages/desktop/src-tauri/src/acp/commands/tests.rs`

- [ ] **Step 1: Write the failing Rust test for provider identity binding**

Add a test in `packages/desktop/src-tauri/src/acp/commands/tests.rs` that creates a Claude client under a stable local Acepe id, binds it to `claude-real-id`, and verifies:
- the live client remains addressable by local Acepe id
- canonical Claude provider id is recorded for resume
- restart resume path uses provider id, not local Acepe id

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk cargo test --lib acp::commands::tests::binds_claude_provider_session_id_to_live_client`

Expected: FAIL because `SessionRegistry` cannot bind a provider session id separately yet.

- [ ] **Step 3: Implement provider identity binding in the registry**

Add a method in `packages/desktop/src-tauri/src/acp/session_registry.rs` like:

```rust
pub fn bind_provider_session_id(&self, local_id: &str, provider_id: &str) -> Result<(), String>
```

It should keep the live client under the local Acepe id while recording the canonical provider id for restart/resume.

- [ ] **Step 4: Trigger provider-id binding in the stream/client path**

In `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs` / `run_streaming_bridge(...)`, handle the first identity resolution event by binding the canonical Claude id to the stable local Acepe session entry. Treat `session_commands.rs` as resume-time consumption only.

- [ ] **Step 5: Run the test to verify it passes**

Run from `packages/desktop/src-tauri`: `cargo test --lib acp::commands::tests::binds_claude_provider_session_id_to_live_client`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/acp/session_registry.rs packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs packages/desktop/src-tauri/src/acp/commands/session_commands.rs packages/desktop/src-tauri/src/acp/commands/tests.rs
git commit -m "fix: bind live Claude clients to provider session ids"
```

### Task 3: Replace placeholder-only persistence with explicit local/provider identity binding

**Files:**
- Create: `packages/desktop/src-tauri/src/db/migrations/m20260325_000001_add_provider_identity_to_session_metadata.rs`
- Modify: `packages/desktop/src-tauri/src/db/migrations/mod.rs`
- Modify: `packages/desktop/src-tauri/src/db/entities/session_metadata.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository.rs`
- Test: `packages/desktop/src-tauri/src/db/repository_test.rs`

- [ ] **Step 1: Write the failing repository tests for identity binding and promotion**

Add tests in `packages/desktop/src-tauri/src/db/repository_test.rs` that:
- insert a temporary Claude worktree session metadata row
- bind it to a canonical Claude provider session id
- verify no duplicate durable records are created
- verify `file_path` uniqueness still holds during promotion
- verify later history index upsert enriches the same durable row instead of creating a second record
- verify worktree/project metadata is preserved

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/desktop/src-tauri`: `cargo test --lib db::repository_test::binds_claude_provider_identity_without_duplicates`

Expected: FAIL because no explicit provider-id binding/promotion path exists.

- [ ] **Step 3: Add schema for local/provider identity tracking**

Create a migration that adds fields needed to distinguish unresolved local id from canonical provider id. Preferred shape:

```rust
local_session_id: Option<String>
provider_session_id: Option<String>
identity_state: String // unresolved | resolved
```

Do not overload `id` with ambiguous meaning during transition.

- [ ] **Step 4: Implement metadata binding and promotion in repository**

In `packages/desktop/src-tauri/src/db/repository.rs`, add repository methods that:
- create unresolved Claude rows safely
- bind a canonical provider session id when first observed
- promote history-backed metadata onto the same durable session record

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk cargo test --lib db::repository_test::binds_claude_provider_identity_without_duplicates`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/db/migrations packages/desktop/src-tauri/src/db/entities/session_metadata.rs packages/desktop/src-tauri/src/db/repository.rs packages/desktop/src-tauri/src/db/repository_test.rs
git commit -m "fix: persist Claude provider identity separately from local session ids"
```

### Task 4: Bind frontend provider identity without mutating immutable local session ids

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-connection-service.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`
- Test: `packages/desktop/src/lib/acp/store/services/session-connection-manager.test.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/panel-store-workspace-panels.vitest.ts`

- [ ] **Step 1: Write the failing frontend test for provider identity binding**

Add a test in `packages/desktop/src/lib/acp/store/services/session-connection-manager.test.ts` that:
- starts a session under stable local Acepe id
- receives session identity resolved event with Claude provider id
- verifies hot state, capabilities, pending events, and panel linkage remain under the local id
- verifies provider identity is attached for future resume/persistence

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/desktop`: `bun test src/lib/acp/store/services/session-connection-manager.test.ts`

Expected: FAIL because frontend stores cannot attach provider identity today.

- [ ] **Step 3: Add explicit provider identity binding to store/services**

Implement a `bindProviderSessionIdentity(localId, providerId)` flow across:
- session store
- event service buffers
- hot/cold state
- capabilities store

Do not mutate `SessionIdentity.id`; keep local session identity immutable and store provider identity separately.

- [ ] **Step 4: Keep panel store behavior unchanged but prove it**

Add/extend `packages/desktop/src/lib/acp/store/__tests__/panel-store-workspace-panels.vitest.ts` to verify panel linkage remains unchanged because frontend local session identity does not change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/desktop/src/lib/acp/store/services/session-connection-manager.test.ts`

Run from `packages/desktop`: `bun test src/lib/acp/store/__tests__/panel-store-workspace-panels.vitest.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/lib/acp/store/session-store.svelte.ts packages/desktop/src/lib/acp/store/session-event-service.svelte.ts packages/desktop/src/lib/acp/store/session-connection-service.svelte.ts packages/desktop/src/lib/acp/store/services/session-connection-manager.ts packages/desktop/src/lib/acp/store/panel-store.svelte.ts packages/desktop/src/lib/acp/store/services/session-connection-manager.test.ts packages/desktop/src/lib/acp/store/__tests__/panel-store-workspace-panels.vitest.ts
git commit -m "fix: bind frontend Claude provider identity without session rekey"
```

### Task 5: Make startup/restart behavior safe for unresolved and resolved Claude sessions

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Test: `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`
- Test: `packages/desktop/src-tauri/src/acp/commands/tests.rs`

- [ ] **Step 1: Write the failing tests for unresolved and resolved Claude sessions after restart**

Add tests that assert:
- startup does not call `acp_resume_session` for unresolved temporary Claude sessions
- backend rejects resume for unresolved temporary Claude ids with a clear non-resumable error
- startup does call `acp_resume_session` for resolved Claude sessions using `provider_session_id`
- backend resume succeeds for already-resolved Claude sessions after restart

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/desktop`: `bun test src/lib/components/main-app-view/tests/initialization-manager.test.ts`

Run from `packages/desktop/src-tauri`: `cargo test --lib acp::commands::tests::rejects_resume_for_unresolved_and_uses_provider_id_for_resolved_claude_sessions`

Expected: FAIL

- [ ] **Step 3: Implement explicit restart guard and happy-path resume**

In frontend initialization, skip eager reconnect for unresolved Claude sessions.

In backend `acp_resume_session`, use provider session id for resolved Claude sessions and reject unresolved local ids before attempting provider resume.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`

Run: `rtk cargo test --lib acp::commands::tests::rejects_resume_for_unresolved_and_uses_provider_id_for_resolved_claude_sessions`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts packages/desktop/src-tauri/src/history/commands/session_loading.rs packages/desktop/src-tauri/src/acp/commands/session_commands.rs packages/desktop/src-tauri/src/acp/commands/tests.rs
git commit -m "fix: resume Claude sessions via provider identity"
```

### Task 6: Final verification and manual runtime proof

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs`
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`

- [ ] **Step 1: Add targeted debug logs for provider identity binding**

Ensure logs clearly show:
- stable local Acepe id
- first observed Claude provider id
- registry binding result
- DB identity binding result
- frontend provider identity binding result

- [ ] **Step 2: Run targeted Rust tests**

Run from `packages/desktop/src-tauri`: `cargo test --lib acp::client::cc_sdk_client`

Run from `packages/desktop/src-tauri`: `cargo test --lib acp::commands::tests`

Run from `packages/desktop/src-tauri`: `cargo test --lib db::repository_test`

Expected: PASS

- [ ] **Step 3: Run targeted frontend tests**

Run from `packages/desktop`: `bun test src/lib/acp/store/services/session-connection-manager.test.ts`

Run from `packages/desktop`: `bun test src/lib/components/main-app-view/tests/initialization-manager.test.ts`

Expected: PASS

- [ ] **Step 4: Run required repo checks**

Run from `packages/desktop`: `bun run check`

Run from `packages/desktop/src-tauri`: `cargo clippy`

Expected: no TypeScript errors; Clippy with no errors

- [ ] **Step 5: Manually verify in an already running dev app session**

Manual verification checklist:
- create a fresh Claude worktree session
- confirm panel appears immediately
- confirm first provider event binds the local session to Claude provider id without UI flicker
- restart app
- confirm same session resumes successfully using canonical Claude id
- confirm worktree path still resolves correctly

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs packages/desktop/src/lib/acp/store/services/session-connection-manager.ts
git commit -m "fix: adopt Claude provider session ids for persistence and resume"
```
