---
status: active
type: refactor
created: 2026-06-20
depth: deep
---

# refactor: Replace per-agent "Autonomous" mode-gating with agent-agnostic "Auto-approve" permission toggle

## Summary

Today Acepe exposes an **Autonomous** toggle whose *enable-ability* is gated, in the UI, by a per-agent capability (`autonomous_supported_mode_ids`) that lists which of the agent's modes "support" autonomous operation (e.g. Claude Code only lists `bypassPermissions`). The actual runtime behavior in Rust does **not** consult that list at all — it simply auto-allows every incoming ACP permission request when the per-session `autonomous` policy flag is on (exempting `Question` / `ExitPlanMode`). The mode-gating is therefore a vestigial UI restriction that makes the toggle un-enable-able in the common case (default mode), even though the underlying behavior is agent-agnostic.

This plan:
1. **Deletes** the vestigial gate: `autonomous_supported_mode_ids` (Rust registry/providers + TS `Agent` type) and the TS support-state derivation (`autoModeSupportState`, `autonomous-support.ts`). The toggle becomes always-available, disabled only during an in-flight transition.
2. **Fully renames** the canonical concept `autonomous` → `auto_approve` (`auto-approve` / `autoApprove` per language casing) across Rust and TypeScript, including the canonical `SessionGraphCapabilities` field, the Tauri command, and all TS deriveds.
3. **Rebrands** the control to **Auto-approve** with the phosphor **ShieldCheck** icon and a new tooltip.

The Rust auto-allow behavior is **preserved** — only renamed. No change to which requests are exempted, no new permission policy, and the agents' own permission modes (e.g. Claude's `bypassPermissions`) remain selectable and become orthogonal to this toggle.

---

## Problem Frame

- **What's wrong:** The Auto-approve concept is modeled as a per-agent, per-mode capability when it is actually a single Acepe-side session policy ("auto-allow permission requests"). The mismatch surfaces as a toggle that is disabled in the new-thread card for Claude Code in `default` mode (`disabledReason: "unsupported-mode"`), confusing users and contradicting the real behavior.
- **Why now:** Surfaced while building the new-thread setup card; the user wants the concept simplified and renamed to reflect what it does.
- **GOD verdict (pre-run, GREEN):** The canonical auto-allow truth already lives in Rust (`acp/inbound_request_router/permission_handlers.rs`, mirrored in the Codex and Claude SDK clients) and is fed by the Rust-owned `SessionPolicyRegistry` + canonical `SessionGraphCapabilities`. This change **deletes** downstream-influencing cruft and **renames** a canonical field — it does not introduce dual-system, UI repair, or provider-branching. No reader-level patching.

---

## Scope Boundaries

**In scope**
- Delete `autonomous_supported_mode_ids` everywhere it is declared, populated, mapped, or asserted.
- Delete the TS UI gate (`autonomous-support.ts`, `autoModeSupportState`, mode-dependency in `autonomousDisabled`).
- Rename canonical `autonomous` → `auto_approve` across Rust + TS + wire/canonical types + tests.
- Rebrand UI: label "Auto-approve", phosphor `ShieldCheck` icon, new tooltip, everywhere the toggle/label appears (new-thread card, attach menu, mode menu/selector, sr-only status text).

**Out of scope (non-goals)**
- Changing which requests are exempted from auto-allow (`Question` / `ExitPlanMode` still surface to the user).
- Adding new permission policies or per-tool granularity.
- Removing or altering the agents' native permission modes — Claude's `bypassPermissions` stays in `visible_mode_ids` and remains user-selectable, now orthogonal to Auto-approve.
- Any change to the auto-allow runtime semantics beyond renaming.

### Deferred to Follow-Up Work
- Consider whether `bypassPermissions` should remain a *visible* Claude mode at all now that Auto-approve is the canonical "stop asking" control. Left as-is for this PR (orthogonal modes); revisit if it proves redundant.

---

## Key Technical Decisions

1. **Keep the Rust auto-allow seam; rename only.** `permission_handlers.rs` already returns the auto-allow outcome when `session_policy.is_auto_approve(session_id)`. The reason string `"autonomous"` becomes `"auto_approve"`. Rationale: behavior is correct and canonical; this is a naming change.
2. **No mode coupling exists — confirmed.** `acp_set_session_autonomous` (`commands/session_commands/basic.rs`) only sets the policy flag and emits a canonical capability update; it never calls `set_session_mode`. So Auto-approve already does not change the agent's mode. Nothing to decouple.
3. **`autonomousDisabled` collapses to transition-busy only.** After deleting `autoModeSupportState`, the toggle is disabled solely while `autoApproveToggleBusy` (rename of `autonomousToggleBusy`) is true. Pre-session it is always enabled.
4. **Canonical field rename touches `SessionGraphCapabilities`.** `autonomous_enabled` is a canonical capability (not hot state). Rename to `auto_approve_enabled` in the Rust struct, the envelope/capability emit, `CanonicalSessionProjection`, and the session-store router — single source of truth preserved, no parallel field.
5. **Full rename casing convention:** Rust `auto_approve` / `auto_approve_enabled`; TS `autoApprove*` (e.g. `autoApproveToggleActive`, `autoApproveToggleBusy`, `autoApproveDisabled`, `sessionAutoApproveEnabled`, `provisionalAutoApproveEnabled`, `autoApproveTransition`); wire/serde fields follow the existing serialization style of each struct (verify serde rename attributes at implementation time).
6. **Icon source:** `ShieldCheck` from `phosphor-svelte`, matching the existing import style in the new-thread card. The app-wide autonomous icon (currently `Lightning` in `packages/ui/.../agent-input-autonomous-toggle.svelte` and the mode-icon) is rebranded to `ShieldCheck` as well, so the concept reads consistently everywhere.

---

## System-Wide Impact

| Surface | Change |
|---|---|
| Rust ACP registry / providers | Delete `autonomous_supported_mode_ids`; rename autonomous→auto_approve where present |
| Rust session policy + permission handlers (3 clients) | Rename flag + reason string; behavior unchanged |
| Rust commands + canonical capabilities + envelope | Rename `autonomous_enabled`→`auto_approve_enabled`; command name + payload |
| TS store types / agent-store | Remove `autonomous_supported_mode_ids`; rename canonical field |
| TS composer-view-controller | Delete `autoModeSupportState`; rename all `autonomous*` deriveds; simplify `*Disabled` |
| TS canonical projection / session-store router | Rename canonical capability field + applier |
| UI (desktop + `@acepe/ui`) | Rebrand label/icon/tooltip; rename props in new-thread card, attach menu, mode selector |
| Tests (Rust + TS) | Rename/keep behavior tests; delete gate tests; update fixtures |

---

## Implementation Units

> Sequencing: rename the canonical bottom (Rust) first so wire/type names settle, then TS canonical projection/store, then controller, then UI. Deletions of the gate (U2/U6) can land alongside their layer. Each unit is intended as one atomic commit.

### U1. Delete `autonomous_supported_mode_ids` from the Rust agent registry & providers

**Goal:** Remove the vestigial capability field and its provider plumbing so the canonical agent capability model no longer carries per-mode autonomous support.
**Dependencies:** none
**Files:**
- `packages/desktop/src-tauri/src/acp/registry.rs` (remove field from `AgentInfo`; remove the two population sites)
- `packages/desktop/src-tauri/src/acp/provider.rs` (remove the trait default method `autonomous_supported_mode_ids`)
- `packages/desktop/src-tauri/src/acp/providers/claude_code/provider.rs`
- `packages/desktop/src-tauri/src/acp/providers/cursor/provider.rs`
- `packages/desktop/src-tauri/src/acp/providers/copilot/provider.rs`
- Rust test sites asserting the field (e.g. `claude_provider_reports_autonomous_support_for_bypass_permissions_only` and any registry serialization tests)
**Approach:** Pure deletion. Confirm `AgentInfo`'s serde/frontend projection (`frontend_projection`) drops the field cleanly so the TS `Agent` type no longer receives it. Keep `visible_mode_ids` and `default_session_modes` intact (Claude's `bypassPermissions` mode stays).
**Patterns to follow:** existing provider trait method removal; mirror how other capability-less providers are shaped.
**Test scenarios:**
- Remove the provider test that asserts `bypassPermissions`-only autonomous support (behavior no longer exists).
- Registry: an `AgentInfo` for each built-in agent serializes without an `autonomous_supported_mode_ids` field (update/keep a registry serialization test to assert the field is absent).
- `cargo clippy` clean; no remaining references to the removed method.
**Verification:** Rust compiles; no symbol `autonomous_supported_mode_ids` remains in `src-tauri`.

### U2. Remove `autonomous_supported_mode_ids` from the TS agent model + delete the UI support gate

**Goal:** Drop the field from the TS `Agent` model and delete the mode-gating derivation so the toggle is no longer mode-restricted.
**Dependencies:** U1
**Files:**
- `packages/desktop/src/lib/acp/store/api.ts` (remove field ~238)
- `packages/desktop/src/lib/acp/store/types.ts` (remove field ~448)
- `packages/desktop/src/lib/acp/store/agent-store.svelte.ts` (remove mapping ~85)
- `packages/desktop/src/lib/acp/components/agent-input/logic/autonomous-support.ts` → **delete**
- `packages/desktop/src/lib/acp/components/agent-input/logic/autonomous-support.test.ts` → **delete**
- `packages/desktop/src/lib/components/settings-page/sections/agents-models-section.logic.test.ts` (remove field from fixtures)
**Approach:** Delete the file and its consumers; the controller change (U3) removes the last importer. Ensure no `import ... autonomous-support` remains.
**Test scenarios:** `Test expectation: none -- deletion of vestigial gate; behavior coverage moves to U3 (toggle no longer mode-gated) and U7 (Rust auto-allow unchanged).`
**Verification:** `bun run check` passes; no import of `autonomous-support` remains.

### U3. Rename + simplify the composer-view-controller auto-approve deriveds

**Goal:** Rename every `autonomous*` derived to `autoApprove*`, delete `autoModeSupportState`, and collapse the disabled state to busy-only.
**Dependencies:** U2
**Files:**
- `packages/desktop/src/lib/acp/components/agent-input/state/composer-view-controller.svelte.ts`
- `packages/desktop/src/lib/acp/components/agent-input/state/composer-view-controller.*.test.ts` (rename assertions; add the busy-only disabled test)
**Approach:** Rename `autonomousToggleActive`→`autoApproveToggleActive`, `autonomousToggleBusy`→`autoApproveToggleBusy`, `autonomousDisabled`→`autoApproveDisabled` (now `= autoApproveToggleBusy`), `sessionAutonomousEnabled`→`sessionAutoApproveEnabled`, `panelProvisionalAutonomousEnabled`→`panelProvisionalAutoApproveEnabled`. Delete `autoModeSupportState` and its `resolveAutonomousSupport` import. Update `resolveSelectedModeMenuOptionId({ autonomousEnabled })` call-site param name if the helper is renamed (see U5).
**Execution note:** Add the failing controller test first — assert `autoApproveDisabled` is `false` pre-session for Claude Code in `default` mode (it is currently `true`), and `true` only while a transition is busy.
**Test scenarios:**
- Pre-session, Claude Code, default mode: `autoApproveDisabled === false` (was the bug).
- During an in-flight transition: `autoApproveDisabled === true`.
- `autoApproveToggleActive` reflects provisional/session flag exactly as the old `autonomousToggleActive` did (characterization — rename must not change semantics).
**Verification:** `bun run check`; controller tests green; no `autoModeSupportState` / `resolveAutonomousSupport` references remain.

### U4. Rename the canonical capability field + Tauri command (Rust → TS wire)

**Goal:** Rename the canonical `autonomous_enabled` capability and the `acp_set_session_autonomous` command/flow to `auto_approve`, preserving single-source-of-truth.
**Dependencies:** U1 (independent of U2/U3 but shares the rename; sequence after U1 so Rust settles)
**Files (Rust):**
- `packages/desktop/src-tauri/src/acp/session_policy.rs` (`autonomous` AtomicBool, `is_autonomous`/`set_autonomous` → `auto_approve`/`is_auto_approve`/`set_auto_approve`)
- `packages/desktop/src-tauri/src/acp/inbound_request_router/permission_handlers.rs` (reason string `"autonomous"`→`"auto_approve"`, predicate call)
- `packages/desktop/src-tauri/src/client/codex_native_client.rs` (predicate call + test names)
- `packages/desktop/src-tauri/src/client/cc_sdk_client/permission_handler.rs` (+ `streaming_bridge.rs`, `tests.rs`)
- `packages/desktop/src-tauri/src/commands/session_commands/basic.rs` (`acp_set_session_autonomous`→`acp_set_session_auto_approve`, `AutonomousCapabilityEmit`→`AutoApproveCapabilityEmit`, `prepare_/publish_autonomous_capability_emit`)
- `packages/desktop/src-tauri/src/commands/session_commands/open_result.rs`, `resume.rs` (`autonomous_enabled` field)
- canonical `SessionGraphCapabilities` struct + capability envelope/emit (search `autonomous_enabled` in `session_state_engine`)
- `packages/desktop/src-tauri/src/commands/registry.rs` (command registration name)
**Files (TS wire):**
- `packages/desktop/src/lib/acp/store/canonical-session-projection.ts` (capability field)
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts` + `session-state-command-router.ts` applier
- the connection method `setAutonomousEnabled` (invoke name) — `agent-input-ui.svelte` + its connection-layer definition
**Approach:** Mechanical rename keeping wire compatibility internal (no external consumers). Update `invoke("acp_set_session_autonomous")` and the command's `#[tauri::command]` name together. Verify serde field names on `SessionGraphCapabilities` (add/adjust `#[serde(rename)]` only if the projection expects a specific JSON key) so Rust↔TS stay aligned.
**Execution note:** Keep the existing Rust auto-allow test (rename `auto_responds_when_session_policy_is_autonomous` → `..._auto_approve`) green throughout — it is the behavior guard.
**Test scenarios:**
- `permission_handlers`: when `set_auto_approve(session,true)`, an incoming permission request is auto-allowed; `Question`/`ExitPlanMode` still surface (characterization, renamed).
- Codex + cc_sdk client: same auto-allow characterization, renamed.
- Command round-trip: `acp_set_session_auto_approve` sets the policy and emits a canonical capability update with `auto_approve_enabled` reflecting the new value.
- TS projection: a capability envelope carrying `auto_approve_enabled` maps onto `CanonicalSessionProjection` (rename of existing test).
**Verification:** `cargo clippy` + Rust tests; `bun run check`; grep shows no `autonomous` symbol in renamed Rust/TS wire paths.

### U5. Rename remaining TS app-layer auto-approve references (handlers, mode menu, attach menu)

**Goal:** Finish the TS rename outside the controller — toggle handlers, mode-menu option resolution, attach-menu entry, sr-only status text.
**Dependencies:** U3, U4
**Files:**
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` (`handleAutonomousToggle`→`handleAutoApproveToggle`, `setAutonomousEnabled`→`setAutoApproveEnabled`, `newThreadContext` autonomous props, the attach-menu autonomous entry, `autonomousStatusMessage`/sr-only text)
- mode-menu helper `resolveSelectedModeMenuOptionId` (param `autonomousEnabled`→`autoApproveEnabled`) + its tests
- any `composer-controller.ts` autonomous references
- related `.test.ts` files
**Approach:** Mechanical rename; keep the attach-menu entry behavior (it is the duplicate surface of the toggle) but relabel to "Auto-approve" (copy lives here as a literal — see U6 for the shared card).
**Test scenarios:**
- Mode-menu option resolution returns the same selected option for the renamed `autoApproveEnabled` input (characterization).
- `handleAutoApproveToggle` flips the provisional/session flag (characterization).
**Verification:** `bun run check`; `AGENT=1 bun test` for affected suites; no `autonomous`/`Autonomous` identifiers remain in TS app layer.

### U6. Rebrand the toggle UI: ShieldCheck icon + "Auto-approve" label/tooltip

**Goal:** Replace the Lightning icon with `ShieldCheck`, relabel to "Auto-approve", and rewrite the tooltip to describe auto-approval of permission requests, in the new-thread card and the shared toggle.
**Dependencies:** U5 (prop names settle first)
**Files:**
- `packages/ui/src/components/agent-panel/agent-input-new-thread-options.svelte` (Lightning→ShieldCheck; rename `autonomous*` props → `autoApprove*`; tooltip copy; `aria-label`/`title` "Auto-approve")
- `packages/ui/src/components/agent-panel/agent-input-autonomous-toggle.svelte` → rename file/component to `agent-input-auto-approve-toggle.svelte`; Lightning→ShieldCheck; update `packages/ui/src/components/agent-panel/index.ts` export
- mode-icon component that maps the autonomous mode to an icon (Lightning→ShieldCheck)
- `packages/website` mock usage if it references the renamed export
**Approach:** Presentational only. New tooltip copy (directional): title **Auto-approve**, body — "Acepe automatically approves every permission request from the agent (file edits, commands, etc.) without asking. Questions and plan reviews still surface. When off, you approve each request yourself." Keep the on-state coloring (ShieldCheck filled, `text-primary` or `--success` — match the worktree-green precedent only if desired; default keep `text-primary`).
**Test scenarios:**
- `@acepe/ui` agent-panel render/boundary tests still pass with renamed props (update prop names in any test harness/mock).
- `Test expectation: none for icon swap` beyond the existing render smoke + boundary import guard.
**Verification:** `bun run check`; `AGENT=1 bun test packages/ui/...`; DOM verification in the dev app (per project QA rule, DOM not screenshots): toggle shows ShieldCheck, `aria-label="Auto-approve"`, tooltip text present, and is **enabled** pre-session for Claude Code.

### U7. Full-surface sweep + dead-reference check

**Goal:** Guarantee no `autonomous` identifier or copy remains (outside intentional history), and the behavior guard tests are green end-to-end.
**Dependencies:** U1–U6
**Files:** repo-wide (Rust `src-tauri/src`, `packages/desktop/src`, `packages/ui/src`, `packages/website`)
**Approach:** `grep -ri "autonomous" packages/desktop/src-tauri/src packages/desktop/src packages/ui/src` → expect zero (or only deliberate, e.g. unrelated comments). Resolve stragglers. Run the dead-code tooling if applicable.
**Test scenarios:** `Test expectation: none -- verification unit.`
**Verification:** full `cargo clippy`, `cargo test` (Rust), `bun run check`, `AGENT=1 bun test` all green; grep sweep clean.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Missed wire-name mismatch (Rust serde key vs TS field) breaks capability projection silently | Med | U4 round-trip test asserts `auto_approve_enabled` flows Rust→TS; verify serde rename attrs explicitly |
| Renamed Tauri command name not updated at an `invoke` call-site → runtime error | Med | U4 updates command registration + all `invoke()` sites together; U7 grep sweep |
| Deleting the gate changes behavior unexpectedly | Low | Behavior lives only in Rust auto-allow (unchanged); the gate was UI-only. Controller test (U3) proves the toggle simply becomes enabled |
| `bypassPermissions` mode interactions now feel redundant with Auto-approve | Low | Out of scope; noted in Deferred follow-up |
| Large rename churn obscures a real logic change in review | Med | Keep deletions (U1/U2) and renames (U4/U5) in separate atomic commits; characterization tests prove semantics preserved |

---

## Verification Strategy

- **Behavior preserved:** Rust auto-allow characterization tests (renamed) stay green across U1, U4, U7 — they are the guardrail proving Auto-approve still auto-accepts permissions agent-agnostically.
- **Bug fixed:** U3 controller test proves the toggle is enabled pre-session in `default` mode (was disabled).
- **No regressions:** `cargo clippy` + `cargo test`; `bun run check`; `AGENT=1 bun test`.
- **UI:** DOM verification in the running dev app (ShieldCheck present, `aria-label="Auto-approve"`, tooltip text, enabled state) — per project rule, DOM facts not screenshots.
- **Cleanliness:** U7 grep sweep returns no `autonomous` identifiers.

---

## Deferred to Implementation

- Exact serde `#[serde(rename = ...)]` attributes on `SessionGraphCapabilities` — confirm against the actual projection key at implementation time.
- Final on-state color for the ShieldCheck icon (keep `text-primary`, or adopt the worktree `--success` green) — decide visually during U6 DOM QA.
- Whether `composer-controller.ts` (non-svelte) carries autonomous references — confirm during U5 and include if present.
