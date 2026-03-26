# Codebase Concerns — Technical Debt, Bugs, Security, Performance

_Generated: 2026-03-26_

---

## 1. Security Issues (High Priority)

### 1.1 File Index — Path Traversal / Sandbox Escape (P1, Pending)
**Todo:** `todos/001-pending-p1-enforce-project-boundaries-for-file-index-commands.md`

The file index command surface does not reliably confine operations to the project root:
- `packages/desktop/src-tauri/src/file_index/commands.rs:186` — raw path joins that can be bypassed by absolute paths passed from the renderer
- `packages/desktop/src-tauri/src/file_index/commands.rs:546` — lexical `starts_with` style check does not defend against symlink traversal during write operations

A compromised or malicious renderer can read or write files outside the intended project root. No centralized, canonicalized path-containment helper exists.

### 1.2 Permission IDs Are Sequentially Predictable (P1, Marked Complete — Verify)
**Todo:** `todos/005-pending-p1-permission-id-sequential-counter-spoofable.md`

Identified and marked complete — the fix should be verified:
- `cc_sdk_client.rs:50-52` — sequential `AtomicU64` counter starting at 1, `Ordering::Relaxed`
- `cc_sdk_client.rs:418-425` — `respond()` has no session-scoping; any session's permission can be approved with another session's ID
- Pre-approval race window: attacker who knows ID N can call `respond(N, allow=true)` before the UI renders

### 1.3 Sentry Replay With Unmasked Text (Privacy Concern)
**File:** `packages/desktop/src/lib/analytics.ts:37`

```ts
Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false })
```

Session replay captures all user-visible text without masking. In a desktop AI agent app, replays may inadvertently capture sensitive code, credentials, or user data visible in the agent chat panel. Users who have not opted out will have their full UI content transmitted to Sentry.

### 1.4 PR Description Rendered as HTML Without DOMPurify (Low Risk, Desktop-Only)
**File:** `packages/desktop/src/lib/acp/components/pr-status-card/pr-status-card.svelte:62,95`

`prDetails.body` (from GitHub API) is rendered through `renderMarkdownSync` and injected via `{@html descriptionHtml}`. No DOMPurify sanitization is applied before rendering. While the Tauri webview mitigates XSS risk, PR bodies can contain attacker-controlled content. The markdown pipeline (`packages/desktop/src/lib/acp/utils/markdown-renderer.ts`) has no DOMPurify import.

---

## 2. Known Bugs (Pending in todos/)

### 2.1 File Explorer — Stale Preview Race Condition (P2, Pending)
**Todo:** `todos/003-pending-p2-fix-stale-preview-races-in-file-explorer-modal.md`

The file explorer modal can display the wrong preview when search results change quickly or the user navigates faster than preview responses return:
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-modal-state.svelte.ts:101` — `rows` updated without clearing or invalidating `preview`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-modal-state.svelte.ts:123` — preview responses committed with no sequencing guard; an older response can overwrite a newer selection

### 2.2 Agent Availability Mismatch — Runtime Installs Not Shown as Available (P2, Pending)
**Todo:** `todos/001-pending-p2-honor-runtime-agent-availability.md`

The backend `claude_code.rs` provider supports `CLAUDE_CODE_ACP_PATH` env var and `PATH` fallbacks, but `packages/desktop/src-tauri/src/acp/registry.rs:116` sets `available` from `installed` only, ignoring `provider.is_available()`. A Claude install reachable via env var or PATH is shown as "not installed" in the UI, blocking normal selection flows.

### 2.3 Install Failure State Not Scoped to Agent (P2, Pending)
**Todo:** `todos/003-pending-p2-scope-install-failure-state-to-the-active-agent.md`

`packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte:550` tracks install failure with a single boolean `agentInstallFailed`. After one agent fails, switching to a different agent can show the failure UI attached to the wrong agent. The failure flag only resets when a new install starts.

### 2.4 Settings Page — Delete Session and Open in Finder Unimplemented (UX Bug)
**File:** `packages/desktop/src/lib/components/settings/project-tab.svelte:49,54`

The Settings > Projects tab provides session management controls (`handleDelete`, `handleOpenInFinder`) that are completely unimplemented — both log `console.warn("not yet implemented")` and do nothing. The Tauri backend has `delete_session` and the invoker utility (`shell.ts:deleteSession`) already exists; the settings page simply does not wire to them.

### 2.5 Agent Uninstall UI Removed — No Path to Uninstall (P2, Pending)
**Todo:** `todos/002-pending-p2-restore-agent-management-actions-in-settings.md`

`packages/desktop/src/lib/components/settings-page/sections/agents-models-section.svelte:135` renders only a passive "Not installed" label — no install/uninstall buttons. `uninstallAgent` exists in the store (`packages/desktop/src/lib/acp/store/agent-store.svelte.ts:126`) and API (`packages/desktop/src/lib/acp/store/api.ts:243`) but is unreachable from any UI component. Installed agent binaries can accumulate with no way to remove them.

### 2.6 File Explorer Modal — Hidden Open State / Keybinding Context Not Integrated (P2, Pending)
**Todo:** `todos/004-pending-p2-align-file-explorer-open-state-with-modal-contexts.md`

- `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts:684` can set `fileExplorerOpen = true` even when no project context exists
- `packages/desktop/src/lib/components/main-app-view.svelte:856` only renders the modal when a derived project path exists, creating a hidden open state
- File explorer visibility is not fed into the shared `modalOpen` keybinding context (`packages/desktop/src/lib/keybindings/bindings/defaults.ts:169`), allowing background shortcuts to fire while the modal is visible

### 2.7 File Preview — Deleted File Handling Broken, Special File Stall Risk (P2, Pending)
**Todo:** `todos/002-pending-p2-harden-preview-file-reading-and-deleted-file-handling.md`

- `packages/desktop/src-tauri/src/file_index/commands.rs:591` — preview path validation requires the file to exist, blocking typed deleted-file preview paths
- `packages/desktop/src-tauri/src/file_index/explorer.rs:363` — reads files without first rejecting non-regular files (FIFOs, device nodes), risking stall or over-allocation

---

## 3. Performance Concerns

### 3.1 File Index — Full Index Clone and Full Sort on Every Search (P2, Pending)
**Todo:** `todos/006-pending-p2-reduce-search-and-preview-hot-path-overhead.md`

- `packages/desktop/src-tauri/src/file_index/service.rs:54` — clones the entire cached project index for each search or preview call
- `packages/desktop/src-tauri/src/file_index/service.rs:227` — rebuilds a git-status map for every preview lookup
- `packages/desktop/src-tauri/src/file_index/explorer.rs:138` — rescans and fully sorts all matches even though only a small page is displayed (should use top-K selection)
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-preview-pane.svelte:65` — redundant full diff rerenders on theme-only changes

These become noticeable on large repositories or rapid keyboard navigation.

### 3.2 `session_id.clone()` in Streaming Hot Path — 40-50 Allocations/sec (P2, Pending)
**Todo:** `todos/010-pending-p2-session-id-clone-hot-path.md`

- `cc_sdk_client.rs:256-258` — `session_id.clone()` on every streamed message (40-50 heap allocations/sec at typical token rate)
- `cc_sdk_bridge.rs:71,83,107,134,142` — additional clones per content block inside `translate_assistant`
- `cc_sdk_bridge.rs:229,244,259` — `.to_string()` on `&str` from `serde_json::Value` for text content (unnecessary copy of already-owned data)

Recommended fix: change `translate_cc_sdk_message` signature to `Option<&str>` and use `serde_json::from_value::<String>(delta["text"].take())`.

### 3.3 `Arc<Mutex<>>` Wrapping Unnecessary for cc-sdk Client (P2, Pending)
**Todo:** `todos/009-pending-p2-arc-mutex-unnecessary-on-sdk-client.md`

`cc_sdk_client.rs:134` wraps the SDK client in `Arc<Mutex<>>` but all call sites access it through `&mut self`, which already guarantees exclusive access via Rust's borrow checker. `SessionRegistry` wraps the entire `Box<dyn AgentClient>` in another `Arc<TokioMutex<>>` — double wrapping with no benefit and extra lock overhead on every prompt send and cancel.

---

## 4. Fragile / Incorrect Behaviour

### 4.1 `stop()` Does Not Drain InProgress Tool Calls — Spinners Hang Forever (P2, Pending)
**Todo:** `todos/008-pending-p2-stop-doesnt-drain-inprogress-tool-calls.md`

`CcSdkClaudeClient::stop()` at `cc_sdk_client.rs:427-433` calls `task.abort()`, which kills the bridge task before `bridge.drain_all_as_denied()` can run. Any `ToolCall { status: InProgress }` events emitted before `stop()` will leave tool call cards permanently spinning in the UI. The existing `AcpClient::stop()` (the older ACP provider) calls `drain_permissions_as_failed` explicitly — this pattern is absent from the cc-sdk path.

### 4.2 Permission Timeout Mismatch — 60s Backend vs 8s Frontend, No Concurrent Cap (P2, Pending)
**Todo:** `todos/011-pending-p2-permission-timeout-mismatch-no-cap.md`

- `cc_sdk_client.rs:113` waits 60 seconds for frontend approval
- The existing `INBOUND_RESPONSE_TIMEOUT` for ACP is 8 seconds
- After the frontend times out at 8s, the backend Tokio task waits 52 more seconds while holding a task slot
- No `MAX_CONCURRENT_PERMISSIONS` guard — a model that returns many parallel tool calls accumulates N blocked tasks

### 4.3 `ToolCallData` Construction Duplicated — 14-Field Boilerplate in Two Places (P2, Pending)
**Todo:** `todos/012-pending-p2-toolcalldata-construction-duplicated.md`

The same 14-field struct (12 fields identical boilerplate) is constructed in two separate locations:
- `cc_sdk_bridge.rs:87-108` (in `translate_assistant`)
- `cc_sdk_bridge.rs:189-208` (in `translate_stream_event`)

Any future field addition to `ToolCallData` requires updating both sites. A `make_tool_call()` constructor helper was proposed but not yet created.

### 4.4 TEMPORARY Fallback in Multi-Agent Project Discovery (Active Debt, Never Removed)
**File:** `packages/desktop/src-tauri/src/history/commands/projects.rs:420`

A `// TEMPORARY:` comment explicitly marks a fallback to the old single-agent discovery method when only Claude projects are found. This was a regression guard during the multi-agent migration and was never removed after stabilization. The fallback emits a `tracing::warn!` in production on every project list load for Claude-only users.

### 4.5 Cursor History Path Resolution — macOS Only, Silently Fails on Other Platforms
**File:** `packages/desktop/src-tauri/src/cursor_history/parser/storage.rs:81`

```rust
// TODO: Support Windows/Linux paths
```

`get_cursor_app_support_dir()` returns an `Err` on non-macOS platforms. Cursor session history import is silently unavailable to Windows and Linux users even if Cursor is installed. No user-facing message indicates this limitation.

---

## 5. Code Quality / Technical Debt

### 5.1 `$effect` Used Extensively Despite AGENTS.md Prohibition (141 Occurrences)

AGENTS.md states: "NEVER use `$effect` in Svelte 5 components — effects create causal loops when they read and write connected state."

141 occurrences of `$effect` exist in production code across at least 20 source files, including:
- `packages/desktop/src/lib/components/main-app-view.svelte`
- `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte`
- `packages/desktop/src/lib/acp/utils/reactive-box.svelte.ts`
- `packages/desktop/src/lib/components/settings-page/sections/agents-models-section.svelte`
- `packages/desktop/src/lib/components/ui/code-block/file-view.svelte`
- `packages/desktop/src/lib/components/ui/codemirror-editor/codemirror-editor.svelte`

These represent causal-loop risk and should be migrated to `$derived` or event handlers.

### 5.2 Spread Syntax Used Extensively Despite AGENTS.md Prohibition (~375 Occurrences)

AGENTS.md states: "NEVER use spread syntax (`...obj`) — it obscures data flow, makes refactoring error-prone."

Spread is used pervasively throughout the codebase (375+ matches in production code), including in core components and data stores.

### 5.3 Nullish Coalescing (`??` and `||`) Used Despite AGENTS.md Prohibition

AGENTS.md states: "NEVER use `??` or `||` for defaults." The pattern appears 100,000+ times across source files. While much is in generated or UI library code, it is heavily used across store, logic, and component files.

### 5.4 Legacy Backward-Compat Shims Accumulating Without Cleanup Plan

Several backward-compatibility layers remain without a defined removal timeline:
- `packages/desktop/src/lib/acp/types/session-update.ts:23,36` — two `@deprecated` re-exported types
- `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte:33-38` — `legacyModifiedFilesContext` dual-context support alongside new context
- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte:93` — legacy `modifiedFilesState` context maintained for backward compatibility
- `packages/desktop/src/lib/acp/store/types.ts:434,443` — deprecated `viewMode` and `messageDraft` fields in persisted panel state
- `packages/desktop/src/lib/acp/utils/colors.ts:3` and `packages/desktop/src/lib/acp/utils/file-icon.ts:7,21,30` — deprecated re-export wrapper files

### 5.5 Type Generation Test Disabled — Tauri Specta Integration Broken
**File:** `packages/desktop/src-tauri/src/commands/mod.rs:5`

```rust
// TODO: Re-enable when tauri_specta::ts import is fixed
// #[cfg(test)]
// mod tests {
//     // Test temporarily disabled due to tauri_specta::ts import issues
// }
```

The `tauri_specta::ts` import was broken and the test module was commented out entirely with no fix or tracking issue reference. This prevents automated validation of type-safe TypeScript bindings generated from Tauri commands.

### 5.6 `#[allow(dead_code)]` Suppressions in Non-Test Production Code

Production Rust files suppress dead-code warnings rather than removing the unused code:
- `packages/desktop/src-tauri/src/session_converter/codex.rs:4`
- `packages/desktop/src-tauri/src/session_converter/mod.rs:31`
- `packages/desktop/src-tauri/src/session_converter/cursor.rs:11`
- `packages/desktop/src-tauri/src/analytics.rs:163`
- `packages/desktop/src-tauri/src/db/mod.rs:64`
- `packages/desktop/src-tauri/src/commands/names.rs:8,24,43`
- `packages/desktop/src-tauri/src/history/cursor_sqlite_parser.rs:26,30,34,964`

### 5.7 `as any` Type Casts in Data Table Components
**Files:** `packages/desktop/src/lib/components/ui/data-table/data-table.svelte.ts:132`, `flex-render.svelte:31`

`(src as any)[key]` and `content(context as any)` bypass TypeScript's type system in the data table component. AGENTS.md prohibits `any`.

### 5.8 `@deprecated` Event Subscriber `removeAllListeners` — No Call Sites but Still Exported
**File:** `packages/desktop/src/lib/acp/logic/event-subscriber.ts:141`

The deprecated `removeAllListeners()` method (removes ALL listeners, not just the caller's) was replaced by `unsubscribeById` but has not been removed. Its continued export risks accidental misuse.

---

## 6. Accessibility

### 6.1 `aria-activedescendant` Points to Presentation Wrapper, Not the Option Element (P2, Pending)
**Todo:** `todos/005-pending-p2-fix-listbox-active-descendant-accessibility.md`

In the file explorer modal:
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-modal.svelte:197` — `aria-activedescendant` references `file-explorer-row-{index}`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-results-list.svelte:56` — that ID is placed on a `role="presentation"` wrapper, not on an option element
- The actual interactive option lives in `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-result-row.svelte:35`

Screen readers cannot correctly announce keyboard selection changes in the file explorer results list.

---

## 7. API Surface Concerns

### 7.1 Explorer API Has Unused / Over-Broad Types (P3, Pending)
**Todo:** `todos/007-pending-p3-simplify-explorer-api-surface-and-frontend-fallbacks.md`

- `packages/desktop/src-tauri/src/file_index/types.rs:107` — row fields the current modal does not render
- `packages/desktop/src-tauri/src/file_index/types.rs:59` — request wrapper structs not used by the current command interface
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-modal.svelte:41` — fabricates a synthetic fallback preview object on transport failure instead of a clean error state
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-modal-state.svelte.ts:83` — exposes `reset()` method even though state is recreated per modal mount

---

## 8. Rust-Specific Concerns

### 8.1 Production `panic!()` in Session Converter — Latent Crash Risk
**File:** `packages/desktop/src-tauri/src/session_converter/mod.rs`

Multiple `panic!()` calls exist in non-test session converter production code:
- Lines 194, 204, 255, 288 and more — panics on unexpected entry types during session conversion
- `packages/desktop/src-tauri/src/session_converter/cursor.rs:204,215` — panics on unexpected tool call structures

In a desktop app, an unexpected or malformed session format will crash the Tauri backend process rather than return an error.

### 8.2 `unwrap()` in Production File Index Command
**File:** `packages/desktop/src-tauri/src/file_index/commands.rs:291`

```rust
1 => Ok(matches.into_iter().next().unwrap()),
```

This `unwrap()` in production code will panic if `matches` is empty despite the length guard — a defensive boundary condition that could be hit under unexpected state.

### 8.3 `unwrap()` in Checkpoint Manager Path Stripping
**File:** `packages/desktop/src-tauri/src/checkpoint/manager.rs:80,87`

```rust
let relative = abs.strip_prefix(wt_canon).unwrap();
```

These `unwrap()` calls will panic if a file path is outside the expected prefix — possible with race conditions or symlinks during checkpoint creation.

### 8.4 `Ordering::Relaxed` in Event Sequencer — Potential Ordering Bug on ARM
**File:** `packages/desktop/src-tauri/src/acp/event_hub.rs:66`

```rust
let seq = self.next_seq.fetch_add(1, Ordering::Relaxed) + 1;
```

`Ordering::Relaxed` provides no cross-thread ordering guarantees. On ARM / Apple Silicon, a consumer reading this sequence number may observe out-of-order values. `Ordering::AcqRel` is appropriate for a counter used to sequence events across threads.

---

## 9. Summary Table

| # | Category | Severity | Key File(s) | Status |
|---|----------|----------|-------------|--------|
| 1.1 | Security: path traversal in file index | P1 | `file_index/commands.rs:186,546` | Pending |
| 1.2 | Security: sequential permission IDs | P1 | `cc_sdk_client.rs:50-52` | Marked complete — verify |
| 1.3 | Privacy: Sentry replay unmasked text | Medium | `analytics.ts:37` | Open |
| 1.4 | Security: PR body HTML without sanitization | Low | `pr-status-card.svelte:95` | Open |
| 2.1 | Bug: stale file preview race | P2 | `file-explorer-modal-state.svelte.ts:101,123` | Pending |
| 2.2 | Bug: agent availability mismatch | P2 | `registry.rs:116` | Pending |
| 2.3 | Bug: install failure state wrong agent | P2 | `agent-panel.svelte:550` | Pending |
| 2.4 | Bug: delete/FinderOpen unimplemented | UX | `project-tab.svelte:49,54` | Open |
| 2.5 | Bug: uninstall UI removed | P2 | `agents-models-section.svelte:135` | Pending |
| 2.6 | Bug: file explorer hidden open state | P2 | `main-app-view-state.svelte.ts:684` | Pending |
| 2.7 | Bug: deleted file preview broken + FIFO stall | P2 | `file_index/commands.rs:591` | Pending |
| 3.1 | Perf: full index clone per search | P2 | `file_index/service.rs:54` | Pending |
| 3.2 | Perf: session_id clone in streaming loop | P2 | `cc_sdk_client.rs:256` | Pending |
| 3.3 | Perf: unnecessary Arc<Mutex<>> | P2 | `cc_sdk_client.rs:134` | Pending |
| 4.1 | Fragile: stop() leaves tool cards spinning | P2 | `cc_sdk_client.rs:427` | Pending |
| 4.2 | Fragile: permission timeout mismatch | P2 | `cc_sdk_client.rs:113` | Pending |
| 4.3 | Debt: ToolCallData construction duplicated | P2 | `cc_sdk_bridge.rs:87,189` | Pending |
| 4.4 | Debt: TEMPORARY fallback never removed | Active | `history/commands/projects.rs:420` | Open |
| 4.5 | Gap: Cursor history macOS-only | Platform | `cursor_history/parser/storage.rs:81` | Open |
| 5.1 | Debt: $effect in Svelte (141 uses) | Style | Multiple | Open |
| 5.2 | Debt: spread syntax (375+ uses) | Style | Multiple | Open |
| 5.5 | Debt: disabled type generation test | Blocked | `commands/mod.rs:5` | Open |
| 5.6 | Debt: #[allow(dead_code)] in production | Quality | Multiple `.rs` | Open |
| 6.1 | A11y: aria-activedescendant miswired | P2 | `file-explorer-modal.svelte:197` | Pending |
| 8.1 | Crash: panic!() in session converter | Risk | `session_converter/mod.rs` | Open |
| 8.2 | Crash: unwrap() in file index command | Risk | `file_index/commands.rs:291` | Open |
| 8.3 | Crash: unwrap() in checkpoint manager | Risk | `checkpoint/manager.rs:80,87` | Open |
| 8.4 | Correctness: Relaxed ordering in event seq | Risk | `acp/event_hub.rs:66` | Open |
