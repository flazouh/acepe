---
title: "feat: Claude reasoning-effort config option (cc_sdk provider)"
type: feat
status: active
date: 2026-06-22
---

# feat: Claude reasoning-effort config option (cc_sdk provider)

## Overview

The agent-input toolbar renders a compact "reasoning" widget for any session whose canonical
`config_options` contains an entry with `presentation: CompactReasoning`. Codex surfaces this
today; Claude does not, so the widget disappears when Claude Code is selected.

Acepe's Claude provider runs over `CommunicationMode::CcSdk` — a native Rust transport that drives
the `claude` CLI directly. The cc_sdk options already carry an `effort: Option<Effort>` field and
`cc_sdk/query.rs` already translates it to the `--effort <level>` CLI flag (confirmed present in
`claude` CLI v2.1.185: *"Effort level for the current session"*). The only missing piece is that
`CcSdkClient` emits `config_options: vec![]` and never sets `effort`.

This plan adds a Claude reasoning-effort config option by mirroring the existing Codex pattern
end-to-end on the Rust side: a per-session config state holds the chosen effort, it is emitted as a
canonical `ConfigOptionData` in the new-session and resume responses, the setter mutates it and
returns the updated options through the existing canonical capability-mutation path, and
`build_options` feeds it into each turn's `--effort` flag. **No TypeScript or `packages/ui` changes
are required** — the toolbar already consumes the canonical option generically.

## Problem Frame

Diagnosed this session: the reasoning widget is entirely agent-driven. `getToolbarConfigOptions`
(`packages/desktop/src/lib/acp/components/agent-input/logic/toolbar-config-options.ts`) keeps only
options whose `presentation` is `compactReasoning`/`compactSpeed`. That presentation is produced
canonically in Rust. Codex builds it via `build_codex_native_config_options`; the cc_sdk Claude path
builds none. Result: Claude users cannot control reasoning depth from the UI even though the CLI and
the cc_sdk transport already support it.

## Requirements Trace

- R1. When Claude Code is the active provider, the agent-input toolbar shows a compact reasoning
  widget (presentation `CompactReasoning`), exactly like Codex.
- R2. Selecting a level persists for the session and is applied to subsequent turns via the
  `--effort` CLI flag.
- R3. The selected level survives session resume.
- R4. The change is canonical/Rust-side only: no `agentId === "claude"` branch in TS/UI, no hot-state
  write of `config_options`.
- R5. The default behavior for users who never touch the widget is unchanged (no surprise override of
  the CLI's own default).

## Scope Boundaries

- Not exposing a raw thinking-token-budget control. We expose the `--effort` level only. (See Key
  Technical Decisions.)
- Not changing the agent-input toolbar, selector components, or any `packages/ui` code.
- Not adding reasoning support to other cc_sdk-backed providers in this plan (cursor/copilot/etc.).
  The implementation lives in `CcSdkClient`, so it would become available to any provider that opts
  in, but only Claude is wired and tested here.
- Not persisting the chosen effort to disk / global Claude config. Per-session in-memory only.

### Deferred to Separate Tasks

- Thinking-token-budget (`--max-thinking-tokens`) control as a separate/advanced option: future
  iteration if product wants finer control than the four effort levels.
- Reading a user/global default effort from a Claude settings source (mirror of Codex's
  `load_codex_native_config_state`): future iteration, only if a canonical Claude config source is
  identified.

## Context & Research

### Relevant Code and Patterns

- **Pattern to mirror (authoritative reference):**
  `packages/desktop/src-tauri/src/acp/client/codex_native_config.rs`
  - `CodexNativeConfigState` (`reasoning_effort` field), `default_codex_native_config_state`
  - `build_codex_native_config_options` → emits `ConfigOptionData { presentation: CompactReasoning, .. }`
  - `build_codex_native_new_session_response_with_state` / `..._resume_session_response` embed
    `config_options`
  - `set_codex_native_config_option` mutates state, returns updated `Vec<ConfigOptionData>`
  - Constants: `DEFAULT_REASONING_EFFORT = "high"`, `CODEX_REASONING_OPTIONS`, `REASONING_CONFIG_ID`
- **Codex client trait wiring (mirror for routing):**
  `packages/desktop/src-tauri/src/acp/client/codex_native_client.rs:573` —
  `set_session_config_option` returns `Ok(json!({ "configOptions": config_options }))`; `send_prompt`
  builds turn params from `self.config_state`.
- **Target client:** `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs`
  - struct `CcSdkClient` (per-session; already holds `pending_model_id` / `pending_mode_id`, ~line 122)
  - `build_options` (line 259) — `ClaudeCodeOptions::builder()`; insertion point for `.effort(..)`
  - `new_session` (~line 724, `config_options: vec![]`) and resume paths (~lines 786, 809, 851)
  - implements `set_session_model` / `set_session_mode` (line 864+) but **not**
    `set_session_config_option` (uses trait default that errors)
- **CLI flag translation (already done):** `packages/desktop/src-tauri/src/cc_sdk/query.rs:288` emits
  `--effort <level>` from `options.effort`.
- **Effort enum:** `packages/desktop/src-tauri/src/cc_sdk/types/effort.rs` — `Low | Medium | High | Max`,
  `Display` renders lowercase; serde `rename_all = "lowercase"`.
- **Options builder:** `packages/desktop/src-tauri/src/cc_sdk/types/options.rs` — `effort: Option<Effort>`
  (line 187). Confirm/extend builder method for `.effort(..)` (a `.thinking(..)` builder exists at
  line 638).
- **Canonical presentation classifier:**
  `packages/desktop/src-tauri/src/acp/session_update/types/config.rs:207-234` —
  `classify_config_option_presentation` maps any id/name/category containing `reason` or `thought` to
  `CompactReasoning`. We will also set `presentation` explicitly when constructing `ConfigOptionData`
  (Codex does), so classification is belt-and-suspenders.
- **Canonical setter → envelope flow (confirmed):**
  `packages/desktop/src-tauri/src/acp/commands/interaction_commands.rs:370-415` — `acp_set_config_option`
  calls `client.set_session_config_option(..)`, then `config_options_from_response(response)` extracts
  `{ configOptions }` and writes `capabilities.config_options` through `run_capability_mutation` (the
  canonical capability-mutation envelope path). This is the GOD-approved channel; the return shape must
  be `{ "configOptions": [...] }`.
- **New/resume config_options → capabilities:**
  `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/streaming_bridge.rs:813-835` already routes a
  response's `config_options` through `sanitize_config_options_for_canonical` into capabilities.
- **UI consumer (no change):**
  `packages/desktop/src/lib/acp/components/agent-input/logic/toolbar-config-options.ts`,
  `agent-input/agent-input-ui.svelte:158-164`.

### Institutional Learnings

- The GOD architecture gate was run for this change and cleared GREEN: `config_options` is canonical,
  Rust-owned, consumed read-only by TS/UI. `config_options` is explicitly forbidden in hot state — the
  effort value must travel via the new/resume response and the `run_capability_mutation` path, never a
  parallel hot-state write.

### External References

- `claude --help` (Claude Code CLI v2.1.185): `--effort <level>` — "Effort level for the current
  session". Accepted level set must be verified against the installed CLI (Unit 0).

## Key Technical Decisions

- **Expose effort level, not token budget.** The `--effort` flag maps cleanly to a compact select like
  Codex's reasoning widget and is the smallest, most product-legible control. Token-budget is deferred.
  Rationale: matches the existing UI affordance and the Codex precedent; avoids exposing a raw integer
  spinner the toolbar widget isn't designed for.
- **A "default/auto" choice that passes no flag.** The config option includes an explicit default entry
  representing `Option<Effort> = None`; when selected, `build_options` does **not** emit `--effort`,
  preserving the CLI's own default. Concrete levels (low/medium/high/max — pending Unit 0 verification)
  map to `Some(Effort::_)`. Rationale: satisfies R5 (no surprise override) and mirrors the model
  selector's existing `default`/`auto` handling (`isDefaultChoiceModelId`).
- **Per-session in-memory state on `CcSdkClient`.** `CcSdkClient` is per-session and already holds
  `pending_model_id`/`pending_mode_id`. Add a `config_state` (or `pending_effort`) field rather than a
  global/file-backed store. Rationale: simplest correct scope; resume restoration handled by re-emitting
  config_options from the resume response built from this state.
- **Return shape `{ "configOptions": [...] }` from the setter.** Required by
  `config_options_from_response` so the canonical capability-mutation path picks it up. Mirrors Codex.
- **Next-turn application semantics.** Effort applies to the next turn's `build_options`; we do not
  attempt to mutate an in-flight turn. Rationale: `--effort` is a per-invocation CLI flag; there is no
  mid-turn channel, and Codex behaves analogously.
- **Config id contains "reasoning".** Use an id like `reasoning_effort` so the canonical classifier
  independently agrees with the explicitly-set `CompactReasoning` presentation.

## Open Questions

### Resolved During Planning

- Does the installed `claude` CLI support `--effort`? — Yes (v2.1.185, confirmed via `--help`).
- Is the cc_sdk→CLI plumbing present? — Yes (`query.rs:288`).
- How does a setter result reach the UI canonically? — Via `acp_set_config_option` →
  `config_options_from_response` → `run_capability_mutation` (interaction_commands.rs:370-415).
- Does `CcSdkClient` already implement the setter? — No; it inherits the erroring trait default. We add it.
- effort vs thinking-budget? — effort (see Key Technical Decisions); budget deferred.

### Deferred to Implementation

- **Exact accepted `--effort` value set** (is `max` valid? is there `minimal`/`xhigh`?). Resolved by
  Unit 0's CLI probe before finalizing the option list and any `Effort` enum adjustment.
- Whether `Effort` enum needs new variants or renames to match the CLI's accepted strings — depends on
  Unit 0 findings. The enum's `Display` output must equal the CLI-accepted token exactly.
- The user-facing default's display label ("Auto" vs "Default") — cosmetic, decided at implementation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation
> specification. The implementing agent should treat it as context, not code to reproduce.*

```
                    Toolbar reasoning widget  (NO CHANGE — generic CompactReasoning consumer)
                                 │  user picks level
                                 ▼
        acp_set_config_option  (interaction_commands.rs)         ← existing command
                                 │ client.set_session_config_option(id,value)
                                 ▼
        CcSdkClient.set_session_config_option   ← NEW (mirror Codex)
            • parse value → Option<Effort>  (default/auto → None)
            • store in self.config_state
            • return { "configOptions": build_cc_sdk_config_options(state) }
                                 │
                                 ▼
        config_options_from_response → run_capability_mutation   ← existing canonical envelope path
                                 │ writes capabilities.config_options
                                 ▼
               CanonicalSessionProjection → UI (read-only)

   new_session / resume_session  ← emit config_options from config_state (was vec![])
   build_options (per turn)      ← if config_state.effort = Some(e): builder.effort(e)
                                          else: omit --effort
```

## Implementation Units

- [ ] **Unit 0: Verify CLI `--effort` contract (pre-implementation gate)**

**Goal:** Pin the exact set of accepted `--effort` values for the installed `claude` CLI so the option
list and `Effort` enum are correct before code is written.

**Requirements:** R2 (correct flag values).

**Dependencies:** None.

**Files:**
- Modify (only if mismatch found): `packages/desktop/src-tauri/src/cc_sdk/types/effort.rs`

**Approach:**
- Probe the installed CLI for accepted effort levels (e.g. inspect `claude --help` detail and attempt a
  trivial non-destructive invocation per candidate level), and record the authoritative list.
- Compare against the `Effort` enum (`low/medium/high/max`). If the CLI rejects a variant (e.g. `max`)
  or accepts others, adjust the enum variants and/or `Display` mapping so each emitted token is valid.
- This is a research/verification gate, not a behavioral code change unless a mismatch is found.

**Execution note:** Verification gate — resolve before Units 2-4 hardcode the option list.

**Test scenarios:**
- Test expectation: none unless the enum changes — if `effort.rs` is modified, add a unit test asserting
  `Effort::_.to_string()` equals each CLI-accepted token exactly.

**Verification:**
- A recorded, authoritative list of accepted `--effort` values; `Effort` enum `Display` output matches
  it one-for-one.

- [ ] **Unit 1: Claude reasoning config state + option builder**

**Goal:** Introduce a cc_sdk reasoning config state and a pure builder that produces the canonical
`ConfigOptionData` list, mirroring `codex_native_config.rs`.

**Requirements:** R1, R5.

**Dependencies:** Unit 0 (value list).

**Files:**
- Create: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/reasoning_config.rs` (or a
  `cc_sdk_config.rs` module beside the client; name per local convention)
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs` (module declaration)
- Test: inline `#[cfg(test)]` module in the new file (mirror codex_native_config tests)

**Approach:**
- Define a small state struct holding `effort: Option<Effort>` (None = default/auto) plus a
  `default_*` constructor (default `None`).
- Define constants: a `REASONING_CONFIG_ID` containing `"reasoning"` (e.g. `"reasoning_effort"`), the
  ordered option list `[(value, label)]` where one entry is the default/auto sentinel and the rest are
  the verified levels.
- `build_cc_sdk_reasoning_config_options(state) -> Vec<ConfigOptionData>` returns a single
  `ConfigOptionData` with `option_type: "select"`, `presentation: CompactReasoning`, `current_value`
  reflecting the state (default sentinel when `None`), and the option list.
- A pure `parse_effort_value(value: &str) -> AcpResult<Option<Effort>>` mapping the default sentinel to
  `None` and known tokens to `Some(Effort::_)`, erroring on unknown values (mirror
  `normalize_reasoning_effort`).
- A pure `set_reasoning_effort(state, value) -> AcpResult<Vec<ConfigOptionData>>` that mutates and
  returns the rebuilt options (mirror `set_codex_native_config_option`).

**Patterns to follow:**
- `codex_native_config.rs`: `build_codex_native_config_options`, `set_codex_native_config_option`,
  `normalize_reasoning_effort`, the `CODEX_REASONING_OPTIONS`/`REASONING_CONFIG_ID` constants.

**Test scenarios:**
- Happy path: `build_*` on default state returns exactly one option, id contains `reasoning`,
  `presentation == CompactReasoning`, `current_value` is the default sentinel, option list matches the
  verified levels + default entry.
- Happy path: `set_reasoning_effort(state, "high")` sets `Some(Effort::High)` and the returned option's
  `current_value` reflects `"high"`.
- Edge case: `set_reasoning_effort(state, <default-sentinel>)` resets to `None` and `current_value`
  shows the default sentinel.
- Error path: `set_reasoning_effort(state, "bogus")` returns an error and leaves state unchanged.
- Edge case: `parse_effort_value` round-trips every verified level to the exact CLI token via
  `Effort::Display`.

**Verification:**
- New file compiles; unit tests pass; option shape is byte-compatible with what Codex emits
  (same `ConfigOptionData` fields populated).

- [ ] **Unit 2: Hold state on `CcSdkClient` and emit options in new/resume responses**

**Goal:** Store the reasoning config state on the client and stop emitting `config_options: vec![]` for
new and resumed Claude sessions.

**Requirements:** R1, R3.

**Dependencies:** Unit 1.

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs`
- Test: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/tests.rs`

**Approach:**
- Add a `reasoning_config` (state) field to `CcSdkClient`, initialized to default in the constructor
  (beside `pending_model_id`/`pending_mode_id`).
- In `new_session` (~line 724) and each resume response (~lines 786, 809, 851), replace
  `config_options: vec![]` with `build_cc_sdk_reasoning_config_options(&self.reasoning_config)`.
- Confirm these responses flow through `streaming_bridge.rs` config_options handling (sanitize →
  capabilities) without further change; if resume builds capabilities elsewhere, populate there too.
- Gate emission to the Claude provider if `CcSdkClient` is shared by other providers that should not yet
  expose reasoning (check `self.provider` / `parser_agent_type`). Only Claude returns the option in this
  plan; others keep `vec![]`.

**Patterns to follow:**
- `build_codex_native_new_session_response_with_state` / `build_codex_native_resume_session_response`
  embedding `config_options`.

**Test scenarios:**
- Happy path: a Claude `new_session` response's `config_options` contains exactly the reasoning option
  with the default `current_value`.
- Happy path: a resume response carries the reasoning option reflecting the client's current
  `reasoning_config` (set the state, resume, assert `current_value`). (R3)
- Edge case (if provider-gated): a non-Claude cc_sdk provider's `new_session` still returns empty
  `config_options`.

**Verification:**
- Selecting Claude in the running app shows the reasoning widget (DOM-verified via QA CLI, per repo
  Visual QA rules); new and resumed Claude sessions both show it.

- [ ] **Unit 3: Implement `set_session_config_option` on `CcSdkClient`**

**Goal:** Route the toolbar's config change into the client state and return the canonical updated
options so the existing capability-mutation path refreshes the UI.

**Requirements:** R2, R4.

**Dependencies:** Unit 1, Unit 2.

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs`
- Test: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/tests.rs`

**Approach:**
- Override the trait method (currently the erroring default):
  `set_session_config_option(session_id, config_id, value)`.
- For `config_id` matching `REASONING_CONFIG_ID`, call `set_reasoning_effort(&mut self.reasoning_config,
  &value)?` and return `Ok(json!({ "configOptions": options }))` (exact Codex shape so
  `config_options_from_response` consumes it).
- For unknown `config_id`, preserve the trait default error (or a clear unsupported-option error).
- No hot-state writes; the canonical envelope is produced by `run_capability_mutation` at the command
  layer (existing).

**Patterns to follow:**
- `codex_native_client.rs:573-582` (`set_session_config_option`).

**Test scenarios:**
- Happy path: calling the method with the reasoning id and `"high"` returns
  `{ "configOptions": [..] }` whose option `current_value` is `"high"`, and mutates client state.
- Error path: an unknown `config_id` returns an unsupported/method-not-found-style error.
- Integration: after the call, `config_options_from_response` (the real command-layer helper) extracts a
  non-empty list — assert against the returned JSON shape to prove the contract the command relies on.

**Verification:**
- In the running app, changing the Claude reasoning level updates the widget's displayed value and
  persists for the session (no error toast, capabilities envelope observed).

- [ ] **Unit 4: Feed effort into `build_options` (per-turn flag)**

**Goal:** Apply the chosen effort to each turn so the `claude` CLI receives `--effort <level>` (or
nothing for default/auto).

**Requirements:** R2, R5.

**Dependencies:** Unit 1, Unit 2.

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs` (`build_options`, line 259)
- Modify (if a builder method is missing): `packages/desktop/src-tauri/src/cc_sdk/types/options.rs`
- Test: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/tests.rs`

**Approach:**
- In `build_options`, when `self.reasoning_config.effort` is `Some(e)`, call the builder's effort method
  (`builder = builder.effort(e)`); when `None`, omit it.
- Confirm `ClaudeCodeOptions::builder()` exposes an `.effort(..)` setter; if only the field exists, add a
  builder method beside the existing `.thinking(..)` (options.rs:638).
- Rely on the existing `query.rs:288` translation to emit `--effort`.

**Patterns to follow:**
- Existing `build_options` model/mode handling (`self.pending_model_id` → `builder.model(..)`).
- `codex_native_client.rs` `send_prompt` reading `self.config_state`.

**Test scenarios:**
- Happy path: with `effort = Some(High)`, `build_options(..)` yields `ClaudeCodeOptions` whose `effort`
  is `Some(High)` (assert on the built options struct).
- Edge case: with `effort = None`, the built options carry no effort (default/auto path; no `--effort`).
- Integration (if a thin seam exists): building the CLI command from those options includes
  `--effort high` for `Some(High)` and omits it for `None`. If asserting on argv is impractical, assert
  on the `ClaudeCodeOptions.effort` field and rely on `query.rs`'s existing behavior (already covered by
  cc_sdk tests).

**Verification:**
- A turn started after selecting a level passes `--effort <level>` to the subprocess (observed via
  streaming/debug logs or the command-construction test); default/auto starts a turn with no `--effort`.

## System-Wide Impact

- **Interaction graph:** Reuses the existing `acp_set_config_option` command and
  `run_capability_mutation` path; no new commands or events. The setter's `{ configOptions }` contract is
  the only coupling and is identical to Codex.
- **Error propagation:** Unknown config ids return a clear error from the client and surface through the
  existing command error channel; invalid effort values are rejected in `set_reasoning_effort` before any
  state mutation.
- **State lifecycle risks:** State is per-session in-memory; resume rebuilds the option from the same
  state object. No persistence, cache, or partial-write concerns. No hot-state write of `config_options`
  (GOD constraint honored).
- **API surface parity:** Other cc_sdk-backed providers (cursor/copilot/opencode) share `CcSdkClient`.
  This plan provider-gates emission to Claude so their behavior is unchanged; they remain candidates for
  the same option later.
- **Integration coverage:** Unit 3's contract test (return shape consumed by `config_options_from_response`)
  and the app-level DOM verification prove the canonical round-trip that mocks alone would not.
- **Unchanged invariants:** Toolbar/selector components and all `packages/ui` code are untouched; the
  canonical `ConfigOptionData` schema and `CompactReasoning` classifier are unchanged. No
  `agentId === "claude"` branch anywhere in TS/UI.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Installed `claude` CLI accepts a different effort value set than the `Effort` enum (e.g. `max` invalid). | Unit 0 verification gate pins the real value set and adjusts the enum before option list is hardcoded. |
| `CcSdkClient` is shared across providers; emitting the option for all could surprise non-Claude providers. | Provider-gate emission to Claude (`self.provider`/`parser_agent_type`); test that other providers stay empty. |
| `ClaudeCodeOptions` builder lacks a public `.effort(..)` method (only the field exists). | Add a builder method beside the existing `.thinking(..)` (options.rs:638); covered in Unit 4 files. |
| Resume path builds capabilities differently from new_session and silently drops the option. | Unit 2 explicitly verifies resume response carries the option and traces through `streaming_bridge.rs`. |
| Mid-turn change expectation by users (apply to in-flight turn). | Documented as next-turn semantics (Key Technical Decisions); matches CLI flag reality and Codex. |

## Documentation / Operational Notes

- After implementation, run the repo Visual QA flow (QA CLI: `doctor` → `observe` → `inspect
  --selector=<reasoning widget>` → `screenshot`) to DOM-verify the widget appears for Claude and updates
  on selection. Do not rely on tests alone for the UI-visible outcome.
- `bun run check` (TS) is unaffected (no TS changes) but should still pass; `cargo clippy` + Rust tests
  in `src-tauri/` are the primary gate.

## Sources & References

- Diagnosis (this session): cc_sdk transport, `query.rs:288`, empty `config_options` in
  `cc_sdk_client/mod.rs`, Codex pattern in `codex_native_config.rs`, classifier in
  `session_update/types/config.rs:207-234`, canonical setter flow in
  `interaction_commands.rs:370-415`.
- GOD architecture gate: cleared GREEN for this change (canonical config_options, no hot-state, no UI
  branch).
- CLI: `claude --help` v2.1.185 — `--effort <level>`.
