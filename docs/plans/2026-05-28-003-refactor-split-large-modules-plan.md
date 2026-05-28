---
status: active
type: refactor
created: 2026-05-28
plan_depth: Deep
---

# refactor: Split Large Source Files Into Focused Sub-Modules

## Execution Progress

- ✅ **U4** `db/repository.rs` (3,451 lines) → `db/repository/` (8 repository sub-modules + mod.rs). `cargo build` clean, imports pruned.
- ✅ **U5** `cc_sdk/types.rs` (2,883 lines) → `cc_sdk/types/` (11 sub-modules). `cargo check` green.
- ✅ **U6** `panel-store.svelte.ts` → extracted `panel-store-equality.ts`, `panel-store-array-patches.ts`. `bun run check` exit 0.
- ✅ **U7** `agent-panel-display-model.ts` → extracted `-assistant-content.ts`, `-equality.ts`. `bun run check` exit 0; 51 identity tests pass.
- ✅ **U8** `agent-panel.svelte` → extracted `agent-panel-pure-helpers.ts` (buildTokenRevealCss, hasStreamingPreviewContent). `bun run check` exit 0. Conservative: only pure helpers; reactive handlers left in place.
- 🟡 **U2** `session_commands.rs` (3,518) — **partially split**. Extracted `state_lookup.rs` (state-lookup helpers) + `open_token.rs` (claim_open_token_reservation) into `session_commands/`. `cargo build` clean. Methodology established: sub-modules use both `use super::super::*` (reaches `commands`, = original `use super::*`) and `use super::*` (reaches `session_commands` mod for sibling privates). Remaining clusters (emit-lifecycle, replay, projection-lookup, autonomous, creation helpers) deferred — each needs careful range work.
- ⏳ **U1** `cc_sdk_client.rs` (7,733), **U3** `ui_event_dispatcher.rs` (3,458) — pending. Both heavily interleaved; warrant dedicated per-file sessions. The proven `super::super::*` + `super::*` pattern from U2 applies.
- ⛔ **U9** `agent-input-ui.svelte` — **deferred**. Low extractable surface: nearly all functions are reactive event handlers; file already delegates to extracted state classes. Would need risky factory-pattern handler extraction for little structural gain.

Nothing committed yet — all changes in working tree for review.

## Summary

Several source files in the Acepe codebase have grown past 2,000 lines, making them hard for agents (and humans) to navigate, modify safely, and reason about. This plan breaks the largest "safe" targets — files that are **not** actively modified on `refactor/rust-owned-transcript-viewport` — into focused co-located sub-modules. Every split preserves the public API surface of the original file: callers do not change. Each unit is independently verifiable (`cargo clippy` / `bun run check` / `bun test`) and lands as one atomic commit.

The 5 files actively modified on the current branch (`projections/mod.rs`, `session-store.svelte.ts`, `runtime_registry.rs`, `agent-panel-graph-materializer.ts`, `session_open_snapshot/mod.rs`) are explicitly **out of scope** — they will be handled by a follow-up plan after the branch merges. See `### Deferred to Follow-Up Work`.

---

## Problem Frame

Files in the priority list range from 2,000 to 7,733 lines. They mix multiple distinct concerns under one module, so:

- Agent tools that read whole files spend more context per query than they should.
- Edit operations on these files have high blast radius — touching one concern can accidentally touch unrelated ones.
- Cross-cutting refactors (the kind already happening on the active branch) leave large merge surfaces.
- Module boundaries that exist conceptually (e.g., one `impl ClaudeCcSdkClient` has 500+ lines of permission logic, 600+ of streaming, 400+ of tool tracking) are not reflected in the file structure.

**Scope criterion:** This is a structural split. It is **not** a behavioral refactor. No function bodies are rewritten, no logic is changed, no APIs are renamed. The deliverable is the same code, organized differently.

---

## Requirements

- **R1.** Every public symbol exported by the original file remains exported with the same name and signature.
- **R2.** Every call site continues to compile and pass tests with no changes.
- **R3.** Each resulting sub-module is focused on one cohesive concern (single-responsibility at the module level).
- **R4.** No new circular imports between the new sub-modules.
- **R5.** Tests live next to the code they cover (Rust `#[cfg(test)] mod tests` blocks stay with their split-out code; TS `__tests__` files split alongside their source).
- **R6.** Each unit is independently verifiable and revertable — one unit = one commit.
- **R7.** No file modified by `refactor/rust-owned-transcript-viewport` is touched. This is checked by `git diff --name-only main...refactor/rust-owned-transcript-viewport` before each unit.

---

## Scope Boundaries

### In scope (9 files)

| File | Lines | Domain |
|---|---|---|
| `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs` | 7,733 | Rust |
| `packages/desktop/src-tauri/src/acp/commands/session_commands.rs` | 3,518 | Rust |
| `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs` | 3,458 | Rust |
| `packages/desktop/src-tauri/src/db/repository.rs` | 3,451 | Rust |
| `packages/desktop/src-tauri/src/cc_sdk/types.rs` | 2,883 | Rust |
| `packages/desktop/src/lib/acp/store/panel-store.svelte.ts` | 3,250 | TypeScript |
| `packages/desktop/src/lib/acp/components/agent-panel/logic/agent-panel-display-model.ts` | 2,900 | TypeScript |
| `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` | 2,865 | Svelte |
| `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` | 2,037 | Svelte |

### Deferred to Follow-Up Work

Files currently modified by `refactor/rust-owned-transcript-viewport` — defer to a follow-up plan after the branch merges to `main`:

- `packages/desktop/src-tauri/src/acp/projections/mod.rs` (5,439 lines)
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts` (5,220 lines)
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` (3,251 lines)
- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts` (4,169 lines)
- `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs` (2,809 lines)

### Out of scope

- Behavioral changes, API renames, or "while we're here" cleanups.
- Test rewrites. Tests move with their code but are not refactored.
- Trimming dead code (`/knip-deadcode` and similar are separate workflows).
- Build artifacts (`target/`), generated bindings, `node_modules/` — these are automatically excluded.

---

## Key Technical Decisions

### 1. Splitting pattern by language

**Rust (`.rs`):** Promote the target file to a directory module. Move the existing file to `mod.rs` (or use `<name>/mod.rs` from the start), then move logical sub-clusters to sibling files. Re-export public symbols from `mod.rs` so external paths (`crate::acp::client::cc_sdk_client::ClaudeCcSdkClient`) remain stable.

```text
acp/client/cc_sdk_client.rs                  →   acp/client/cc_sdk_client/mod.rs
                                                  acp/client/cc_sdk_client/permissions.rs   (already exists)
                                                  acp/client/cc_sdk_client/tool_tracking.rs (new)
                                                  acp/client/cc_sdk_client/streaming.rs     (new)
                                                  ...
```

**Carve-out:** `acp/client/cc_sdk_client/permissions.rs` already exists as a child of the future module dir. The unit that splits `cc_sdk_client.rs` must coexist with this file.

**TypeScript (`.ts`):** Co-located sibling files. The original file becomes a thin re-export barrel (or, when natural, a slim coordinator). New files use the parent file's slug as prefix.

```text
panel-store.svelte.ts            →   panel-store.svelte.ts  (re-exports + class shell)
                                      panel-store-arrays.ts   (array patch helpers)
                                      panel-store-equality.ts (equality checks)
                                      panel-store-reactive.ts (ReactiveValue helpers)
```

**Svelte (`.svelte`):** Two complementary mechanisms:
1. Extract logic-heavy sections of the `<script>` block to co-located `.ts` helper files.
2. Extract structurally-cohesive markup sections into sibling presentational `.svelte` components (per `Agent Panel MVC Separation` in CLAUDE.md, presentational pieces with cross-package value go in `packages/ui`; desktop-specific controllers stay local).

### 2. Visibility rules

- Items used only within the new module dir become `pub(super)` or `pub(crate)`-narrowed.
- Items previously `pub` outside the file stay `pub` and are re-exported from `mod.rs` / barrel.
- TypeScript: `export` stays on items that are imported from outside the original file; internal helpers lose `export`.

### 3. Test placement

- Rust: each `#[cfg(test)] mod tests { ... }` block moves with the code under test. Where a single test file covers multiple concerns, leave it in `mod.rs/tests.rs` until later — do not split tests speculatively.
- TypeScript: existing `__tests__/<file>.vitest.ts` files split only if the source split makes them >2× the target file size; otherwise leave them whole.

### 4. One commit per unit

Each unit lands as one atomic commit on a branch off `main` (not the current refactor branch). Commit message format: `refactor(<module>): split <file> into focused sub-modules`. This makes each unit independently revertable.

### 5. Verification order per unit

For Rust units: `cargo clippy --workspace --all-targets -- -D warnings` then `cargo test -p acepe-desktop` (or narrower if appropriate). For TS/Svelte units: `bun run check` then `bun test` from `packages/desktop`. Failures abort the unit — do not proceed to the next unit until current is green.

### 6. Branch strategy

Work happens on a **new branch off `main`** (e.g., `refactor/split-large-modules`), not on `refactor/rust-owned-transcript-viewport`. This isolates the refactor from in-progress work and lets it merge independently.

---

## High-Level Technical Design

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Each unit follows the same recipe:

```text
1. Identify cohesive clusters in the target file (by grouping related fns/structs).
2. For each cluster, create a sibling file (TS) or sub-module (Rust).
3. Move the cluster verbatim — no edits to function bodies.
4. Adjust visibility (pub → pub(super) where appropriate).
5. Add re-exports from the original file / mod.rs so external callers don't change.
6. Run language-specific verify command.
7. Commit.
```

The "cohesive cluster" judgment for each file is in the per-unit `Approach` section.

---

## Implementation Units

### U1. Split `cc_sdk_client.rs` (7,733 lines)

**Goal:** Break the monolithic Claude SDK client file into a directory module with focused sub-files.

**Requirements:** R1–R6.

**Dependencies:** None.

**Files:**
- Create directory: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/`
- Move: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs` → `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs`
- Existing: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/permissions.rs` (already split — co-exists)
- Create: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/tool_tracking.rs` — `ToolCallTrackerEntry`, `ToolCallIdTracker`, `PendingApprovalCallbackDiagnostic`, `ApprovalCallbackTracker`, `stable_json_signature`, `tool_name_expects_permission_callback`, `terminal_tool_call_id` (~600 lines)
- Create: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/permission_handler.rs` — `AcepePermissionHandler` impl + `AcepePermissionRequestHook` + helper fns (`auto_accept_reason`, `is_exit_plan_permission`, `build_permission_*`, `parse_permission_suggestions`, `allow_permission_result`) (~1500 lines)
- Create: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/streaming.rs` — `StreamingBridgeContext`, `collect_cc_sdk_updates_for_dispatch`, `dispatch_cc_sdk_update`, `ClaudeToolResultBackfillRequest`, `claude_missing_tool_result_backfill_request`, `missing_claude_tool_result_id`, `spawn_claude_history_tool_result_backfill`, `claude_history_tool_result_update`, `tool_use_result_payload`, `tool_result_content_blocks` (~1000 lines)
- Create: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/permission_mode.rs` — `map_to_claude_permission_mode`, `claude_permission_mode_name`, `PendingQuestionState`, question-handling helpers (`extract_question_answer_map`, `build_question_answer_map`, `build_question_reply_text`, `question_answers_are_empty`, `question_request_binding_*`) (~400 lines)
- Create: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/capabilities.rs` — `promoted_claude_session_capabilities`, `promoted_claude_connection_complete_update`, `provider_session_id_from_message`, `response_outcome_allows`, `selected_option_id` (~250 lines)
- Keep in `mod.rs`: `ClaudeCcSdkClient` struct + `impl ClaudeCcSdkClient` + `impl AgentClient for ClaudeCcSdkClient` + module declarations + `#[cfg(test)] mod tests` block (~3000 lines)

**Approach:**
- Promote `cc_sdk_client.rs` to a directory module containing `mod.rs`. The existing `permissions.rs` already lives in the future directory location — verify this before starting.
- Move clusters verbatim. The struct/impl blocks for `ClaudeCcSdkClient` stay in `mod.rs` because they form the core public surface.
- Helper fns and supporting structs follow their dominant concern.
- After move, add `mod tool_tracking; mod permission_handler;` etc. to `mod.rs`, and `use self::tool_tracking::*;` where needed (or fully-qualify).
- Visibility: free fns and structs not used from outside `cc_sdk_client` become `pub(super)`.

**Patterns to follow:**
- The existing `permissions.rs` already split out shows the directory layout intent.
- See sibling `codex_native_*.rs` files for how a single client is spread across `client.rs`, `config.rs`, `events.rs` — same pattern.

**Test scenarios:**
- `Test expectation: none — this is a structural move with no behavioral change.` Existing `#[cfg(test)] mod tests` block in `mod.rs` continues to pass unchanged.

**Verification:**
- `cargo clippy --workspace --all-targets -- -D warnings` from `packages/desktop/src-tauri/` produces no warnings/errors.
- `cargo test -p acepe-desktop --lib acp::client::cc_sdk_client` passes.
- `grep -r "cc_sdk_client::" packages/desktop/src-tauri/src` shows identical public-symbol references before/after.

---

### U2. Split `session_commands.rs` (3,518 lines)

**Goal:** Group the Tauri commands and their helpers in `session_commands.rs` by concern.

**Requirements:** R1–R6.

**Dependencies:** None (independent of U1).

**Files:**
- Create directory: `packages/desktop/src-tauri/src/acp/commands/session_commands/`
- Move: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs` → `packages/desktop/src-tauri/src/acp/commands/session_commands/mod.rs`
- Create: `packages/desktop/src-tauri/src/acp/commands/session_commands/creation.rs` — `creation_failure`, `capabilities_from_new_session_response`, the create-session `#[tauri::command]` handler(s) and related helpers (~600 lines)
- Create: `packages/desktop/src-tauri/src/acp/commands/session_commands/autonomous_capabilities.rs` — `AutonomousCapabilityEmit`, `publish_autonomous_capability_emit` (~200 lines)
- Create: `packages/desktop/src-tauri/src/acp/commands/session_commands/projection_lookup.rs` — `SessionProjectionLookup`, `StateLookupAuthority`, `resolve_state_lookup_authority`, `projection_snapshot_with_runtime`, `runtime_snapshot_for_refresh`, `projection_has_graph_state`, `warn_unresolved_tool_rows_in_state_lookup`, `unresolved_tool_entry_ids` (~500 lines)
- Create: `packages/desktop/src-tauri/src/acp/commands/session_commands/open_token.rs` — `claim_open_token_reservation` + helpers (~400 lines)
- Create: `packages/desktop/src-tauri/src/acp/commands/session_commands/replay.rs` — `replay_buffered_session_state_events` + helpers (~700 lines)
- Keep in `mod.rs`: the `#[tauri::command]` function definitions that are registered in `commands/mod.rs` (these must stay discoverable as `session_commands::*`).

**Approach:**
- The `#[tauri::command]` fns are part of the public surface used by `commands::registry`. Either keep them all in `mod.rs` or re-export them with full names from sub-files. Prefer keeping `#[tauri::command]` fns in `mod.rs` and moving private helpers out.
- Group helpers by which command they serve.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/commands/` already follows a one-concern-per-file pattern (`file_commands.rs`, `interaction_commands.rs`, `install_commands.rs`). The internal split of `session_commands` mirrors this.

**Test scenarios:**
- `Test expectation: none — structural move only.` Existing tests in `packages/desktop/src-tauri/src/acp/commands/tests.rs` continue to pass.

**Verification:**
- `cargo clippy --workspace --all-targets -- -D warnings` clean.
- `cargo test -p acepe-desktop --lib acp::commands` passes.
- `packages/desktop/src-tauri/src/commands/registry.rs` compiles unchanged — confirms all `#[tauri::command]` fns are still discoverable.

---

### U3. Split `ui_event_dispatcher.rs` (3,458 lines)

**Goal:** Separate the dispatcher state machine from event-construction helpers and persistence policy.

**Requirements:** R1–R6.

**Dependencies:** None.

**Files:**
- Create directory: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher/`
- Move: `ui_event_dispatcher.rs` → `ui_event_dispatcher/mod.rs`
- Create: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher/event_types.rs` — `AcpUiEventPriority`, `AcpUiEventPayload`, `AcpUiEvent`, `AcpUiEvent::*` impls, `DispatchPolicy` (~400 lines)
- Create: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher/stamping.rs` — `stamp_agent_message_chunk_timestamp`, `stamp_session_update_event`, related timestamp helpers (~200 lines)
- Create: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher/state.rs` — `DispatcherState`, `DispatcherTelemetry`, `DispatcherState::*` impls (~600 lines)
- Create: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher/persistence.rs` — `DispatchPersistenceEffects`, `should_publish_raw_event`, `session_domain_event_from_update` (~150 lines)
- Keep in `mod.rs`: `AcpUiEventDispatcher` struct + its main `impl` block (the public dispatcher), module decls, re-exports (~2000 lines).

**Approach:**
- The dispatcher itself stays in `mod.rs` since it's the public surface.
- Supporting types and internal state machinery move to sub-files.
- `pub use` from `mod.rs` to re-export `AcpUiEvent`, `AcpUiEventPayload`, etc.

**Patterns to follow:**
- See `acp/parsers/` (already a directory module): `mod.rs` + concern-specific files.

**Test scenarios:**
- `Test expectation: none — structural move only.`

**Verification:**
- `cargo clippy --workspace --all-targets -- -D warnings` clean.
- `cargo test -p acepe-desktop --lib acp::ui_event_dispatcher` passes.

---

### U4. Split `db/repository.rs` (3,451 lines)

**Goal:** Split the database repository file by repository struct.

**Requirements:** R1–R6.

**Dependencies:** None.

**Files:**
- Create directory: `packages/desktop/src-tauri/src/db/repository/`
- Move: `db/repository.rs` → `db/repository/mod.rs`
- Create: `packages/desktop/src-tauri/src/db/repository/project.rs` — `ProjectRow`, `ProjectRepository` + impl (~340 lines)
- Create: `packages/desktop/src-tauri/src/db/repository/settings.rs` — `SettingsRepository` + impl, `AppSettingsRepository` + impl (~260 lines)
- Create: `packages/desktop/src-tauri/src/db/repository/session_review.rs` — `SessionReviewStateRepository` + impl (~55 lines)
- Create: `packages/desktop/src-tauri/src/db/repository/session_journal.rs` — `SerializedSessionJournalEventRow`, `SessionJournalEventRepository` + impl (~165 lines)
- Create: `packages/desktop/src-tauri/src/db/repository/session_metadata.rs` — `SessionMetadataRow`, `AcepeSessionRelationship` impl, `ProjectSessionsLookup`, `ReservedWorktreeLaunchRow`, `CreationAttemptRow`/`Status`, helpers (`compose_session_metadata_row`, `compose_creation_attempt_row`), `SessionMetadataRepository` + impl (~1750 lines)
- Create: `packages/desktop/src-tauri/src/db/repository/skills.rs` — `SkillRow`, `SkillSyncTargetRow`, `SkillSyncHistoryRow`, `SkillWithSyncStatus`, `SkillsRepository` + impl (~360 lines)
- Create: `packages/desktop/src-tauri/src/db/repository/database_reset.rs` — `DatabaseResetRepository` + impl (~100 lines)
- Create: `packages/desktop/src-tauri/src/db/repository/sql_studio.rs` — `SqlConnectionRow`, `SqlQueryHistoryRow`, `SqlStudioRepository` + impl (~140 lines)
- Keep in `mod.rs`: module decls + `pub use` re-exports for every public type. (~50 lines)

**Approach:**
- Each repository struct is a clear concern boundary — one repo per file.
- `SessionMetadataRepository` is large enough (1750 lines) that a second sub-split may be desirable, but keep it in one file for this pass — defer further breakdown.
- Re-export every `pub` symbol from `mod.rs` so `crate::db::repository::ProjectRepository` etc. still resolves.

**Patterns to follow:**
- `db/entities/` and `db/migrations/` are already directory modules.

**Test scenarios:**
- `Test expectation: none — structural move only.` Tests in `repository_test.rs` continue to pass.

**Verification:**
- `cargo clippy --workspace --all-targets -- -D warnings` clean.
- `cargo test -p acepe-desktop --lib db::repository` passes.
- Every `use db::repository::X` call site still compiles without change.

---

### U5. Split `cc_sdk/types.rs` (2,883 lines)

**Goal:** Group the SDK type definitions by domain.

**Requirements:** R1–R6.

**Dependencies:** None.

**Files:**
- Create directory: `packages/desktop/src-tauri/src/cc_sdk/types/`
- Move: `cc_sdk/types.rs` → `cc_sdk/types/mod.rs`
- Create: `packages/desktop/src-tauri/src/cc_sdk/types/permission.rs` — `PermissionMode`, `PermissionUpdateDestination`, `PermissionBehavior`, `PermissionRuleValue`, `PermissionUpdateType`, `PermissionUpdate`, `ToolPermissionContext`, `PermissionResultAllow`, `PermissionResultDeny`, `PermissionResult` (~250 lines)
- Create: `packages/desktop/src-tauri/src/cc_sdk/types/effort.rs` — `Effort` + Display impl (~30 lines)
- Create: `packages/desktop/src-tauri/src/cc_sdk/types/rate_limit.rs` — `RateLimitStatus`, `RateLimitType`, `RateLimitInfo` (~70 lines)
- Create: `packages/desktop/src-tauri/src/cc_sdk/types/sdk_config.rs` — `AssistantMessageError`, `SdkBeta`, `ToolsConfig`, `ToolsPreset`, `SdkPluginConfig`, `ControlProtocolFormat`, `ThinkingConfig` (~250 lines)
- Create: `packages/desktop/src-tauri/src/cc_sdk/types/sandbox.rs` — `SandboxNetworkConfig`, `SandboxIgnoreViolations`, `SandboxSettings` (~80 lines)
- Create: `packages/desktop/src-tauri/src/cc_sdk/types/mcp.rs` — `McpConnectionStatus`, `McpToolAnnotations`, `McpToolInfo`, `McpServerInfo`, `McpServerStatus`, `McpServerConfig` + Debug/Serialize/Deserialize impls (~290 lines)
- Create: `packages/desktop/src-tauri/src/cc_sdk/types/hooks.rs` — `HookContext`, `BaseHookInput`, all `*HookInput` variants, `HookInput`, `AsyncHookJSONOutput`, `SyncHookJSONOutput`, `HookJSONOutput`, all `*HookSpecificOutput` variants (~1900 lines)
- Keep in `mod.rs`: module decls + `pub use` re-exports (~50 lines).

**Approach:**
- Each sub-file represents one cohesive type cluster.
- The `hooks.rs` cluster is large (~1900 lines) but cohesive — defer further breakdown.
- Re-export every public type from `mod.rs`.

**Patterns to follow:**
- `cc_sdk/transport/` is already a directory module.

**Test scenarios:**
- `Test expectation: none — structural move only.`

**Verification:**
- `cargo clippy --workspace --all-targets -- -D warnings` clean.
- `cargo test -p acepe-desktop --lib cc_sdk` passes.
- All `cc_sdk::types::X` import sites unchanged.

---

### U6. Split `panel-store.svelte.ts` (3,250 lines)

**Goal:** Extract the helper utilities surrounding `PanelStore` into co-located TypeScript modules so the store itself reads as a focused class.

**Requirements:** R1–R6.

**Dependencies:** None.

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/panel-store.svelte.ts` (keep `PanelStore` class + factory + getter, re-export helpers)
- Create: `packages/desktop/src/lib/acp/store/panel-store-reactive.ts` — `ReactiveValueBox`, `createReactiveValue` (~30 lines)
- Create: `packages/desktop/src/lib/acp/store/panel-store-equality.ts` — `areFilePanelListsEqual`, `areBrowserPanelListsEqual`, `areAgentPanelListsEqual`, `areTerminalPanelGroupListsEqual`, `areWorkspacePanelListsEqual`, `arePanelProjectRefListsEqual` (~150 lines)
- Create: `packages/desktop/src/lib/acp/store/panel-store-array-patches.ts` — `createPrependedItemArray`, `createAppendedItemArray`, `createPatchedItemArray`, `createRemovedItemArray`, `findItemIndexById`, `selectPrependedItem`, `selectRemovedItem`, `toArrayIndex`, `createArrayLikeOwnKeys` (~350 lines)
- Create: `packages/desktop/src/lib/acp/store/panel-store-types.ts` — `TopLevelPanelProjectRef`, `isPersistableWorkspacePanel` (~30 lines)
- Keep in `panel-store.svelte.ts`: `class PanelStore`, `createPanelStore`, `getPanelStore`, top-level imports (~2700 lines after extraction)

**Approach:**
- Move helper categories to sibling files. The `PanelStore` class stays in the `.svelte.ts` file because it uses Svelte runes.
- The original file imports the helpers from sibling files.
- Use named exports throughout. No barrel file — the `.svelte.ts` file remains the entry point.

**Patterns to follow:**
- The `agent-panel/logic/` directory already follows this co-located helper pattern.
- See `packages/desktop/src/lib/acp/store/services/` for sibling helper modules.

**Test scenarios:**
- `Test expectation: none — structural move only.` Existing tests in `packages/desktop/src/lib/acp/store/__tests__/` continue to pass.

**Verification:**
- `bun run check` from `packages/desktop/` passes with zero new errors.
- `bun test` from `packages/desktop/` passes.
- `grep -r "from.*panel-store" packages/desktop/src` shows the public import surface is unchanged.

---

### U7. Split `agent-panel-display-model.ts` (2,900 lines)

**Goal:** Co-locate the display row construction, memory, and patch helpers into focused sibling modules.

**Requirements:** R1–R6.

**Dependencies:** None.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/agent-panel-display-model.ts` (slim to core types + entry points + re-exports)
- Create: `agent-panel/logic/agent-panel-display-model-types.ts` — `AgentPanelDisplayRow`, `AgentPanelDisplayInput`, `AgentPanelBaseModel`, `AgentPanelDisplayModel`, `AgentPanelDisplaySceneEntriesReadModel`, `AgentPanelDisplayScenePatch`, `AgentPanelDisplayMemory`, `AgentPanelDisplayResult`, `AgentPanelDisplayRowsProjection`, `AgentPanelDisplayRowsReadModel` (~100 lines)
- Create: `agent-panel/logic/agent-panel-display-model-row-arrays.ts` — `createAppendedDisplayRowArray`, `createAppendedDisplayRowLayout`, `selectAppendedDisplayRow`, `iterateAppendedDisplayRows`, `createTruncatedDisplayRowArray`, `createSplicedDisplayRowArray`, `createPatchedDisplayRowArray`, `toArrayIndex`, `createArrayLikeOwnKeys` (~700 lines)
- Create: `agent-panel/logic/agent-panel-display-model-scene-patches.ts` — `getAgentPanelDisplayScenePatch`, `getAgentPanelDisplayRowArrayPatch`, `getAgentPanelDisplayRowArrayAppendPatch`, `getAgentPanelDisplayRowArrayTruncation`, `getAgentPanelDisplayRowArraySplicePatch`, `markAgentPanelDisplayRowArrayPatch` (~150 lines)
- Create: `agent-panel/logic/agent-panel-display-model-scene-rows.ts` — `createRowsFromScene`, `createRowsFromSceneRange`, `createDisplayRowFromSceneEntry`, `indexDisplayRowsById`, `indexDisplayRowsByIdFrom`, `collectLiveTailRowIds`, `isStableDisplaySceneAppend`, `isStableDisplaySceneTruncation`, `countDisplayRows`, `countDisplayRowsInRange`, `isDisplaySceneEntryStable`, `areDisplayRowsEquivalent`, `areJsonLikeValuesEquivalent` (~500 lines)
- Create: `agent-panel/logic/agent-panel-display-model-memory.ts` — `createAgentPanelDisplayMemory`, `shouldResetMemory`, `applyDisplayTextToRow`, `removeAssistantDisplayTextsForRows`, `applyAgentPanelDisplayMemory`, `mapTurnState`, `isBusy`, `cloneContentBlock`, `createDisplayedAssistantTextChunk`, `isStableDisplayRowAppend` (~700 lines)
- Keep in main file: `buildAgentPanelBaseModel`, `createAgentPanelDisplayRowsReadModel`, public entry points + re-exports (~400 lines)

**Approach:**
- The public entry points (`buildAgentPanelBaseModel`, `createAgentPanelDisplayRowsReadModel`, `applyAgentPanelDisplayMemory`) stay in the main file.
- Internal helpers grouped by concern.
- Re-export types from the main file so existing imports keep working.

**Patterns to follow:**
- See `agent-panel-graph-materializer.ts` (deferred) for a similar pattern of public materializer + private helpers — this split is the same shape.

**Test scenarios:**
- `Test expectation: none — structural move only.` Existing tests under `agent-panel/logic/__tests__/` continue to pass.

**Verification:**
- `bun run check` passes.
- `bun test` passes — note particularly `agent-panel-display-model-identity.vitest.ts` (2,968 lines, exercises this code heavily).

---

### U8. Split `agent-panel.svelte` (2,865 lines)

**Goal:** Extract the script-block logic from the monolithic Svelte component into co-located TypeScript helper modules.

**Requirements:** R1–R6.

**Dependencies:** None.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` (template + reactive shell only)
- Create: `agent-panel/logic/agent-panel-scroll.ts` — `scrollToTop`, `scrollToBottom`, `prepareForNextUserReveal`, `scrollToBottomOnTabSwitch`, `buildTokenRevealCss`, `hasStreamingPreviewContent` (~250 lines)
- Create: `agent-panel/logic/agent-panel-review-handlers.ts` — `handleReviewDialogControlsChange`, `handleEnterReviewMode`, `openReviewDialogAtInitialFile`, `handleOpenReviewDialog`, `handleReviewDialogOpenChange`, `fetchPrDetails` (~250 lines)
- Create: `agent-panel/logic/agent-panel-worktree-handlers.ts` — `requestClosePanelConfirmation`, `handleWorktreeCloseOnly`, `handleWorktreeRemoveAndClose`, `handleWorktreeCloseCancel`, `handlePreparedWorktreeLaunch`, `handlePreSessionWorktreeFailure`, `handleRetryWorktree`, `handleStartInProjectRoot`, `handleWorktreeRenamed`, `handleWorktreeCreated` (~300 lines)
- Create: `agent-panel/logic/agent-panel-project-handlers.ts` — `handleProjectAgentSelected`, `handleProjectSelected`, `handleComposerProjectSelected`, `installAgentThenCreateSession`, `handleSessionCreated` (~150 lines)
- Create: `agent-panel/logic/agent-panel-error-handlers.ts` — `handleRetryConnection`, `handleCancelConnection`, `handleDismissError`, `handleCopyInlineErrorReference`, `createInlineErrorIssueDraft`, `handleIssueFromInlineError` (~150 lines)
- Create: `agent-panel/logic/agent-panel-checkpoint-handlers.ts` — `handleCloseCheckpointTimeline`, `handleCheckpointRevertComplete`, `getTodoMarkdown` (~80 lines)
- Create: `agent-panel/logic/agent-panel-input-handlers.ts` — `handlePanelClick`, `handlePanelKeyDown` (~80 lines)
- Keep in `.svelte`: `<script>` glue (imports, prop/state declarations, `$derived` blocks, lifecycle hooks, snippet definitions) + `<template>` + `<style>` (~1500 lines)

**Approach:**
- The challenge with `.svelte` files is that handler fns often close over reactive state. To extract cleanly, each handler module exports a factory: `createXHandlers({ sessionStore, panelStore, ... })` returning a `{ handleA, handleB }` object. The component instantiates these in its `<script>` block.
- Pure helpers (e.g., `buildTokenRevealCss`, `getTodoMarkdown`) extract as plain fns.
- DO NOT extract `$derived` blocks or `$state` declarations — those must live in the `<script>` block.
- Per CLAUDE.md "Agent Panel MVC Separation": only the desktop-specific controller layer is being split here. No `@acepe/ui` changes.

**Patterns to follow:**
- `agent-input-state.ts` already extracts state logic out of `agent-input-ui.svelte` — the same factory-returning-handlers pattern.
- See `packages/desktop/src/lib/acp/components/agent-panel/logic/` — most helpers in this directory follow the pattern of "pure fn accepting store snapshots".

**Test scenarios:**
- `Test expectation: none for the move itself — structural extraction only.`
- After extraction, the handler modules are testable as plain functions. Adding tests is **out of scope** for this unit.

**Verification:**
- `bun run check` passes.
- `bun test` passes.
- Manual: open the dev app and confirm panel behavior (per CLAUDE.md "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete"). Per the operational guardrail, **do not run `bun dev`** — the user manages the dev server. Flag the manual verification step in the commit body and ask the user to confirm before merging.

---

### U9. Split `agent-input-ui.svelte` (2,037 lines)

**Goal:** Extract logic from the agent input Svelte component into co-located TypeScript helper modules.

**Requirements:** R1–R6.

**Dependencies:** None.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` (template + reactive shell only)
- Investigate first: this file already has co-located logic (`agent-input-state.ts`, `voice-input-state.ts`, etc.). The extraction targets here are smaller — voice toolbar/overlay derivations, send-trace logging, helper fns.
- Create: `agent-input/logic/agent-input-voice-toolbar.ts` — `toVoiceToolbarBinding` adapter + `voiceMicTooltipLabels` builder + `voiceRecordingOverlayPhase` builder + `voiceOverlayActive` builder (factory returning `$derived` inputs) (~200 lines)
- Create: `agent-input/logic/agent-input-token-css.ts` — any pure CSS-building helpers in the `<script>` block (~100 lines)
- Create additional helpers as discovered during extraction (~200 lines combined)
- Keep in `.svelte`: prop/state declarations, `$derived` blocks (with calls to the extracted builders), lifecycle hooks, template, style.

**Approach:**
- This file is more constrained than `agent-panel.svelte` — much logic is already extracted to `agent-input-state.ts` etc. The extraction here is incremental: pull out builder fns that compute derivation inputs.
- Pattern: each builder takes plain values, returns plain values. The `$derived.by(() => builder(...))` stays in the `.svelte` file.

**Patterns to follow:**
- The existing `agent-input/logic/` directory is the destination pattern.
- Pure builder fns + `$derived` wrappers in the component.

**Test scenarios:**
- `Test expectation: none for the move itself — structural extraction only.`

**Verification:**
- `bun run check` passes.
- `bun test` passes.
- Manual UI verification (user-driven, per the operational guardrail).

---

## Sequencing and Parallelism

The 9 units are **fully independent** — none depends on any other. They are suitable for parallel execution by separate agent runs:

- **Rust units (U1–U5)** are pairwise independent and only collide if two agents touch the workspace `Cargo.lock` simultaneously. Run sequentially or with file-level mutex.
- **TS/Svelte units (U6–U9)** are pairwise independent. Each modifies a single file plus its new siblings.
- **Rust vs TS** units never touch the same files — fully parallel.

**Recommended dispatch:**

| Wave | Units | Why batched |
|---|---|---|
| Wave 1 (parallel agents) | U2, U3, U4, U5, U6, U7, U9 | Smallest blast radius, fastest validation. |
| Wave 2 (parallel agents) | U1, U8 | Largest files; isolate to avoid context bleed if a wave-1 agent needs a retry. |

Each agent commits one unit. The orchestrator merges commits onto the refactor branch in dependency-free order.

---

## System-Wide Impact

| Surface | Impact |
|---|---|
| **Public API surface (Rust)** | Zero — `pub use` re-exports preserve every external symbol path. |
| **Public API surface (TS)** | Zero — re-exports preserve every external import path. |
| **Build** | Slight increase in compilation graph nodes; build time unchanged in practice (same total code). |
| **`packages/desktop/scripts/check-transcript-virtualizer-deps.ts`** | This script enforces module-boundary rules. Re-run it after U6–U9 to confirm no new boundary violations. |
| **`packages/desktop/biome.json` lint config** | No changes needed; biome runs on directory globs. |
| **Tests** | All existing tests continue to pass without modification. |
| **CI** | No changes to CI workflows. Pre-push hook (typecheck + tests) covers the verification. |
| **Active branch** | None — the in-scope files are not modified by `refactor/rust-owned-transcript-viewport`. The 5 deferred files are intentionally excluded. |

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Merge conflict with active branch (`refactor/rust-owned-transcript-viewport`) | Low — files are explicitly excluded | Verified at the start of each unit via `git diff --name-only main...refactor/rust-owned-transcript-viewport`. Abort and reclassify the file as deferred if it appears in the diff. |
| Visibility tightening accidentally breaks an external consumer | Medium | Run full workspace build + tests after each unit. Prefer keeping items `pub` and re-exporting from `mod.rs` rather than tightening to `pub(super)`. |
| Module-level re-export shadows a name that was previously used directly | Low | `cargo clippy` catches name clashes. For TS, `bun run check` catches them. |
| `#[tauri::command]` discovery breaks after moving fns to sub-files (U2) | Medium | Keep `#[tauri::command]` fns in `mod.rs`. Verify by checking `commands/registry.rs` still compiles and the command list at the IPC layer is unchanged. |
| Svelte component breaks due to lost reactive context (U8, U9) | Medium | Use factory-pattern extraction: handlers receive store refs as args. Manual UI verification is required and called out in the unit. |
| One unit grows beyond its estimated size and lands as multi-thousand-line commit | Low | Each unit produces a `git diff --shortstat`; if the diff is larger than 4,000 lines, split further before committing. |

---

## Verification Strategy

After **each unit**:
1. `cargo clippy --workspace --all-targets -- -D warnings` (Rust units).
2. `cargo test -p acepe-desktop` scoped to the affected module (Rust units).
3. `bun run check` from `packages/desktop/` (TS/Svelte units).
4. `bun test` from `packages/desktop/` (TS/Svelte units).
5. `git diff --shortstat` — confirm the change is a structural move, not a behavioral rewrite (deletions ≈ additions in moved code).
6. Commit the unit.

After **all units land**:
1. Full `cargo clippy --workspace --all-targets -- -D warnings` clean.
2. Full `cargo test` clean.
3. Full `bun run check` clean.
4. Full `bun test` clean.
5. Pre-push hook (typecheck + tests) clean.
6. Manual sanity check: launch the dev app (user-driven) and exercise the agent panel, agent input, and session lifecycle to confirm no behavioral regression.

---

## Deferred to Implementation

- Final import-path details inside each new file are discovered at implementation time.
- The exact line ranges for cluster boundaries may shift slightly during the move.
- Whether `SessionMetadataRepository` (U4) or `HookInput` types (U5) need further sub-splits in a follow-up plan — decide after these units land.

---

## Done

The plan is complete when:
- All 9 implementation units are landed as separate commits on a single branch off `main`.
- The branch passes `cargo clippy`, `cargo test`, `bun run check`, `bun test`.
- The branch is opened as a single PR titled `refactor: split large source files into focused sub-modules`.
- A follow-up issue is filed to handle the 5 deferred files after `refactor/rust-owned-transcript-viewport` merges.
