---
title: "feat: Add GitHub Copilot CLI as a first-class Acepe agent"
type: feature
status: active
date: 2026-03-30
deepened: 2026-03-30
---

# GitHub Copilot CLI Integration Implementation Plan

**Goal:** Add GitHub Copilot CLI as an installable built-in Acepe agent that Acepe can provision, launch through ACP, show in history, and reopen through resume/load without depending on undocumented local transcript files.

**Architecture:** Treat Copilot as a normal ACP provider with three cooperating layers. The install layer downloads the official Copilot CLI release asset and verifies its published checksum. The live-session layer uses Acepe’s existing ACP client against `copilot --acp --stdio`. The history layer uses Copilot ACP `session/list` for authoritative session metadata and `session/load` or `session/resume` for replay, with optional `~/.copilot/session-state/*/workspace.yaml` parsing only for metadata enrichment or fallback discovery.

**Tech Stack:** Rust, Tauri, existing ACP client and registry, existing agent installer, GitHub Releases API, `SHA256SUMS.txt`, shared `~/.copilot` state, Svelte/SvelteKit agent UI

---

## Scope and guardrails

- Use Copilot’s ACP protocol support instead of building a private Copilot integration path.
- Do not promise transcript parsing from undocumented Copilot storage.
- Do not add full in-app Copilot login in this feature.
- Keep Acepe’s supported path as Acepe-managed install from the official Copilot release channel.
- Preserve existing non-Copilot agent behavior.
- Prefer extending generic ACP and installer seams when it reduces future drift, but do not broaden the change more than needed.

## Success criteria

- `copilot` is a built-in Acepe agent with working install, uninstall, selection, and icon rendering.
- Copilot follows the existing Acepe-managed upgrade flow and progress UX.
- Acepe can launch a new Copilot ACP session from the cached binary.
- Missing Copilot auth produces a clear, actionable Acepe error.
- Copilot sessions appear in Acepe history.
- Opening a Copilot history item replays the prior session through ACP `session/load` or `session/resume`.
- Copilot history continues to work even when `~/.copilot/session-state` does not expose transcripts.
- Installer download is checksum-verified against the official release manifest.
- Acepe reuses the existing `~/.copilot` home and does not create a second Copilot state directory.

## Task 1: Add Copilot as a built-in agent identity and provider

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/types.rs`
- Add: `packages/desktop/src-tauri/src/acp/providers/copilot.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/registry.rs`
- Modify: `packages/desktop/src/lib/acp/types/agent-id.ts`
- Modify: `packages/desktop/src/lib/acp/constants/thread-list-constants.ts`

**Goal:** Make Copilot a first-class built-in agent with a stable canonical ID and provider definition.

**Step 1: Add the canonical built-in ID**
- Add `CanonicalAgentId::Copilot` with `copilot` serialization and parsing.
- Keep built-in parsing exhaustive so future agent additions still compile-fail if not handled.

**Step 2: Create the Copilot provider**
- Add a `CopilotProvider` that reports:
  - ID `copilot`
  - name `GitHub Copilot`
  - icon `copilot`
  - ACP subprocess communication mode
- Use `copilot --acp --stdio` as the provider spawn command.
- Prefer Acepe-managed cached binary resolution first.
- Keep environment or PATH override behind explicit debug-only behavior.
- Fail closed in normal product flow when the Acepe-managed binary is missing or unverified rather than silently executing a PATH fallback.

**Step 2.5: Make parser classification explicit**
- Add an explicit Copilot parser classification in the ACP provider and parser-selection seams.
- Either introduce a dedicated Copilot ACP parser type or explicitly reuse an existing generic ACP path, but do not leave live-session and replay parsing to implicit default behavior.

**Step 3: Register Copilot in the built-in agent registry**
- Add Copilot to the built-in provider map and stable built-in order.
- Mark Copilot as `installable` in the UI availability model.

**Step 4: Add frontend built-in ID and icon wiring**
- Add `AGENT_IDS.COPILOT`.
- Map `copilot` to the existing Copilot SVG assets in thread-list and generic agent-icon paths.

**Step 5: Add focused unit tests**
- Cover canonical ID parsing and round-tripping.
- Cover registry ordering and installable availability.
- Cover Copilot provider spawn config resolution and no-panic behavior.

**Expected outcome**
- Acepe has a compile-time-stable Copilot built-in agent identity.
- The provider can be instantiated anywhere the existing providers are used.

## Task 2: Extend the installer for the official Copilot release channel

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/agent_installer.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/install_commands.rs`
- Modify: `packages/desktop/src-tauri/src/acp/registry.rs` if availability/install state assumptions need tightening

**Goal:** Make Acepe install the official Copilot CLI binary safely and predictably.

**Step 0: Open the install and uninstall command gate**
- Add `copilot` to the installable-agent allowlist in `packages/desktop/src-tauri/src/acp/commands/install_commands.rs`.
- Add `copilot` to the uninstall allowlist in the same command layer.
- Keep Copilot on the existing generic install and uninstall flow rather than introducing a one-off command path.

**Step 1: Add Copilot as a GitHub-release-backed install source**
- Resolve Copilot releases from `github/copilot-cli`.
- Map Acepe platforms to Copilot asset names instead of reusing ACP registry platform strings.
- Support the actual Copilot asset layout:
  - macOS: `copilot-darwin-arm64.tar.gz`, `copilot-darwin-x64.tar.gz`
  - Linux: matching tarballs
  - Windows: matching zip assets and `copilot.exe`

**Step 2: Verify the upstream checksum before install**
- Fetch `SHA256SUMS.txt` from the matched release.
- Parse the checksum entry for the resolved asset.
- Compare the official checksum to the downloaded archive hash before extraction.
- Keep the current local `meta.json` hash recording, but do not treat it as sufficient verification.

**Step 3: Keep install safety behavior**
- Preserve URL allowlisting, archive path traversal protection, size limits, and atomic tmp-dir replacement.
- Preserve existing progress events and error propagation.

**Step 4: Add installer tests**
- Add pure tests for:
  - Copilot asset name resolution per platform
  - checksum manifest parsing
  - failure on missing checksum entry
  - failure on unsupported platform naming

**Expected outcome**
- Acepe can install Copilot from the official release channel with checksum verification.
- Copilot install UX matches the current built-in installable agents.

## Task 3: Wire Copilot into ACP startup, auth handling, and runtime errors

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/client/tests.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/tests.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs` if session metadata persistence assumptions need agent-specific handling
- Optionally add: `packages/desktop/src-tauri/tests/acp_session_list_probe.rs`

**Goal:** Make Copilot work in the same ACP client lifecycle as the other agents and fail cleanly when auth is missing.

**Step 1: Validate Copilot ACP initialize behavior**
- Ensure Acepe’s generic ACP initialize payload is accepted by Copilot.
- Preserve auth-method parsing from `initialize` so Copilot’s `copilot-login` metadata remains available for future UX.
- Verify that new-session and resume responses still flow through the normal mode, model, and config-option handling path Acepe already uses for ACP-backed agents.

**Step 2: Normalize auth failure behavior**
- Detect Copilot auth-required responses during initialize/new-session/resume.
- Surface an Acepe error that clearly distinguishes:
  - not installed
  - installed but not logged in
  - logged in but not entitled
- Use `copilot login` guidance only for the logged-out path.
- Add separate user-facing recovery copy for the signed-in but not-entitled path.

**Step 3: Add an ignored live probe**
- Extend or mirror `packages/desktop/src-tauri/tests/acp_session_list_probe.rs` for Copilot.
- Probe:
  - ACP start
  - initialize
  - `session/list`
  - optional `session/load` or `session/resume` against a known session ID when available

**Step 4: Add client-level tests**
- Cover Copilot-specific provider initialize and fallback behavior.
- Cover auth error mapping without breaking the other providers.

**Expected outcome**
- Copilot can join Acepe’s ACP runtime without a provider-specific client fork.
- Auth failures are understandable and actionable.

## Task 4: Add Copilot history indexing using ACP `session/list`

**Files:**
- Modify: `packages/desktop/src-tauri/src/history/indexer.rs`
- Add: `packages/desktop/src-tauri/src/copilot_history/mod.rs`
- Add: `packages/desktop/src-tauri/src/copilot_history/scanner.rs`
- Add: `packages/desktop/src-tauri/src/copilot_history/workspace_yaml.rs` if local metadata enrichment is kept
- Modify: `packages/desktop/src-tauri/src/acp/client_trait.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/session_lifecycle.rs`
- Modify: `packages/desktop/src-tauri/tests/history_integration_test.rs`

**Goal:** Put Copilot sessions into Acepe history without depending on undocumented transcript files.

**Design**
- Use Copilot ACP `session/list` as the primary metadata source.
- Do not make raw `.copilot` transcript parsing a prerequisite.
- Treat local `workspace.yaml` files as non-authoritative enrichment only.
- Keep ACP `session/list` session identity and `cwd` authoritative whenever they are available.
- Do not let `workspace.yaml` override ACP metadata; use it only to enrich project and worktree context or to support an explicitly bounded fallback path.

**Step 1: Close the current ACP pagination gap**
- Extend Acepe’s ACP `session/list` support to accept and forward `cursor`.
- Update the ACP client trait and session lifecycle request shape so callers can pass both `cwd` and `cursor`.
- Add a loop that keeps fetching until `next_cursor` is empty.
- Do not silently cap Copilot history at the first 50 sessions.

**Step 2: Add a Copilot history source**
- Build a `CopilotSource` for the history indexer.
- Spawn a short-lived Copilot ACP client, initialize it, list sessions, and map each `SessionInfo` into `SessionMetadataRecord`.
- Filter to the requested Acepe project paths using the returned `cwd`.
- If history listing fails because Copilot is slow, unavailable, logged out, or not entitled, keep previously indexed Copilot rows and do not tombstone them on that failed sync pass.

**Step 3: Enrich with local metadata only when useful**
- Parse `~/.copilot/session-state/<session-id>/workspace.yaml` only if it materially improves project and worktree reconciliation.
- When it is used, restrict it to:
  - canonicalizing or confirming cwd
  - deriving repo/worktree hints
  - capturing source path for diagnostics
- Reject enrichment-derived associations that conflict with authoritative ACP metadata or fall outside the requested project roots.
- Do not depend on `session-store.db` or any undocumented transcript payload.

**Step 4: Persist stable metadata**
- Store session ID, title fallback, updated timestamp, project path, agent ID `copilot`, and optional local source path.
- Preserve worktree-aware project mapping explicitly so Copilot rows do not drift into the wrong project bucket.
- Preserve missing-session behavior the same way Acepe already preserves other history rows.

**Step 4.5: Define the sync and cache policy**
- Reuse Acepe’s persisted history index as the Copilot metadata cache for this feature rather than introducing a second cache layer.
- Run Copilot ACP listing as a bounded background sync, not as a blocking startup requirement for rendering existing rows.
- Keep the last known Copilot metadata on timeout or auth failure, and only apply deletions when a successful authoritative sync completes.

**Step 5: Add tests**
- Add scanner tests for paginated ACP list handling.
- Add tests for mapping `SessionInfo` into session metadata records.
- Add optional parser tests for `workspace.yaml` if that enrichment path is added.

**Expected outcome**
- Copilot sessions show up in Acepe history.
- History indexing does not rely on undocumented transcript storage.

## Task 5: Load historical Copilot sessions through ACP replay

**Files:**
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Add: `packages/desktop/src-tauri/src/copilot_history/loader.rs`
- Add: `packages/desktop/src-tauri/src/copilot_history/accumulator.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/session_lifecycle.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/tests.rs`

**Goal:** Reopen a Copilot history item by loading the original session through Copilot ACP and converting the replayed events into Acepe’s unified session format.

**Design**
- Do not parse Copilot history from disk.
- Start a short-lived Copilot ACP client for history load.
- Call `session/resume` first and fall back to `session/load` when needed.
- Capture replayed ACP updates and convert them into `ConvertedSession`.

**Step 1: Add a dedicated Copilot history loader**
- Build a loader that can:
  - spawn Copilot provider
  - initialize ACP
  - load or resume a prior session by ID and cwd
  - collect replayed events without attaching the temporary client to a live panel

**Step 2: Convert replayed ACP events into Acepe history entries**
- Reuse Acepe’s existing ACP event normalization and conversion layers where possible, but add a dedicated replay accumulator for Copilot history loading.
- Make that accumulator responsible for:
  - collecting replayed `SessionUpdate` events in order
  - handling chunk aggregation and final message assembly
  - preserving tool-call and question events that should appear in history
  - producing the same `ConvertedSession` shape used by the other history loaders

**Step 3: Add a Copilot branch to unified history loading**
- Extend `get_unified_session()` with `CanonicalAgentId::Copilot`.
- Preserve the current “return empty session instead of dropping history row” behavior when load fails.

**Step 4: Handle missing or deleted sessions cleanly**
- Distinguish:
  - session not found
  - login missing
  - binary unavailable
  - ACP method unavailable on older Copilot versions
- Keep the session row and surface a user-visible failure state.
- Bind each of those outcomes to a concrete frontend failure surface so reopen failures are visible and not confused with empty history.

**Step 5: Add tests**
- Cover session replay conversion using mocked ACP updates where possible.
- Cover history load fallback from `session/resume` to `session/load`.
- Cover not-found and auth-required failure paths.

**Expected outcome**
- Opening a Copilot history item replays the prior session into Acepe without a transcript parser.

## Task 6: Finish frontend agent UX and history presentation

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/agent-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/logic/agent-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/types.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-install-card.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-card/__tests__/agent-card.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/__tests__/agent-panel-component.test.ts` if needed
- Modify: `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts` or related startup tests if built-in ordering assumptions change
- Modify: `packages/desktop/src-tauri/src/history/commands/scanning.rs` if project discovery and session counts need Copilot participation
- Modify: `packages/desktop/src-tauri/src/history/commands/mod.rs` or the backend project-discovery entry points used by the welcome screen, if they currently hardcode the existing agents

**Goal:** Make Copilot feel native in the Acepe UI.

**Step 1: Add Copilot to the built-in agent UI flows**
- Show Copilot in the welcome screen, picker, install card, and any built-in agent strips.
- Use the Copilot icon consistently in panel tabs, history rows, and queue items.
- If welcome-screen or project-selection counts are driven by backend project discovery, add Copilot to those paths so Copilot-only projects remain discoverable.

**Step 2: Keep install and auth states distinct**
- Preserve install CTA before the binary is present.
- After install, if login is missing, show a runtime error rather than reverting to an install prompt.
- Add an explicit UI mapping for:
  - install required
  - login required
  - signed in but not entitled
  - history reopen failed after row selection

**Step 3: Ensure history presentation is stable**
- Display Copilot history rows with the correct agent icon and stored title.
- Keep session rows present even when the latest load attempt fails.
- Ensure Copilot history listing does not silently degrade into an empty state when session listing fails for auth or runtime reasons.

**Step 4: Add UI tests**
- Cover built-in agent ordering including Copilot.
- Cover Copilot icon resolution.
- Cover installable-agent rendering and auth-error rendering where those states are already testable.

**Expected outcome**
- Copilot is visually and behaviorally integrated with the existing Acepe agent UX.

## Task 7: Verification and release readiness

**Files:**
- Modify tests touched above
- Update docs only if install or support text needs a user-facing mention

**Goal:** Prove the full feature works end-to-end without regressing existing agents.

**Step 1: Run focused Rust tests**
Run:
```bash
cd /Users/alex/Documents/acepe/packages/desktop
bun test src/lib/acp/components/agent-card/__tests__/agent-card.test.ts
bun test src/lib/acp/components/agent-panel/__tests__/agent-panel-component.test.ts
cd /Users/alex/Documents/acepe/packages/desktop/src-tauri
cargo test -p acepe acp::client::tests -- --nocapture
cargo test -p acepe acp::commands::tests -- --nocapture
cargo test -p acepe history_integration_test -- --nocapture
```

**Step 2: Run an ignored Copilot probe on a machine with the binary installed**
Run:
```bash
cd /Users/alex/Documents/acepe/packages/desktop/src-tauri
cargo test -p acepe --features manual-test-targets --test acp_session_list_probe -- --ignored --nocapture
```

**Step 3: Run typecheck**
Run:
```bash
cd /Users/alex/Documents/acepe/packages/desktop
bun run check
```

**Step 4: Manual verification**
- Install Copilot from Acepe.
- Upgrade Copilot through Acepe and confirm the normal install progress UX still applies.
- Uninstall Copilot from Acepe and confirm the agent returns to the pre-install state.
- Start a new Copilot session.
- Confirm the missing-login error path on a non-authenticated install, or verify normal session start on an authenticated one.
- Confirm the signed-in but not-entitled path shows distinct recovery guidance instead of generic login instructions.
- Reopen a prior Copilot session from Acepe history.
- Confirm the history row stays visible if load fails.
- Confirm reopen failures are distinguishable for at least login missing, binary unavailable, and session-not-found states.
- Confirm Acepe reuses the existing `~/.copilot` home and does not create a second state directory.

**Expected outcome**
- The Copilot agent works end to end in install, live use, history listing, and history replay.

## Open implementation notes

- The existing ACP client already supports `session/load`, `session/resume`, and `session/list`, but its current `list_sessions()` helper only forwards `cwd`; Copilot likely needs cursor support to avoid truncating history.
- The existing history loader is parser-based for Claude, Cursor, OpenCode, and Codex. Copilot is the first built-in agent that should be ACP-replay-first for history load.
- The current agent availability model is compatible with an Acepe-managed Copilot install and does not require a separate “system-managed” availability kind unless product direction changes later.