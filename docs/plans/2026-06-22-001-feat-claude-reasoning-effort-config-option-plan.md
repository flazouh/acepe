---
title: "feat: Agent-agnostic per-session config-option persistence + Claude reasoning-effort option"
type: feat
status: active
date: 2026-06-22
deepened: 2026-06-22
---

# feat: Agent-agnostic per-session config-option persistence + Claude reasoning-effort option

## Overview

Two coupled changes:

1. **Per-session config-option persistence (agent-agnostic).** A user's config-option selections
   (reasoning effort, fast mode, etc.) are persisted per session in Acepe-owned canonical state and
   restored when the session is reopened — for **every** provider, not just Claude. Persisted
   selections are applied by **replaying them through each provider's own
   `set_session_config_option`** at session open, so there is exactly one canonical application path
   (the same one a user click uses).

2. **Claude reasoning-effort config option.** Claude Code (over `CommunicationMode::CcSdk`) gains a
   compact reasoning widget identical to Codex's, by emitting a canonical `ConfigOptionData`
   (`presentation: CompactReasoning`) and feeding the chosen level into the existing `--effort` CLI
   flag. With change (1) in place, the Claude selection then persists per session automatically.

The persistence mechanism is the cross-cutting core; the Claude option is the first new consumer.
**Codex gains per-session persistence with no Codex-specific code** — it already emits its reasoning
option and implements the setter, so the generic persist + replay covers it.

No TypeScript or `packages/ui` changes are required: the toolbar already consumes canonical
`config_options` generically, and persistence/restore lives entirely in Rust.

## Problem Frame

Diagnosed this session: the reasoning widget is agent-driven. `getToolbarConfigOptions`
(`packages/desktop/src/lib/acp/components/agent-input/logic/toolbar-config-options.ts`) renders only
options whose canonical `presentation` is `compactReasoning`/`compactSpeed`. Codex emits such an
option; the cc_sdk Claude path emits `config_options: vec![]`, so Claude shows nothing.

Separately, config-option selections today are not persisted per session canonically. Codex seeds its
reasoning effort from a config file (global/project), but a per-session choice is not remembered as
Acepe-owned per-session state. The user wants the selection remembered **per session** and for that
to be the **global behavior across all agents**.

## Requirements Trace

- R1. When Claude Code is active, the agent-input toolbar shows a compact reasoning widget
  (`CompactReasoning`), like Codex.
- R2. Selecting a Claude level applies to subsequent turns via the `--effort` CLI flag.
- R3. A config-option selection is persisted **per session** in Acepe-owned canonical state and
  restored when that session is reopened (including after app restart).
- R4. Persistence and restore are **agent-agnostic** — any provider that emits config options and
  implements the setter participates automatically (verified for Claude and Codex).
- R5. The change is canonical/Rust-side only: no `agentId === "claude"` branch in TS/UI, no hot-state
  write of `config_options`, no reader-time `canonical ?? fallback`.
- R6. Default behavior is unchanged for users who never touch a widget (no surprise override of a
  provider's own default).

## Scope Boundaries

- Not exposing a raw thinking-token-budget control for Claude. Effort level only.
- No `packages/ui` / agent-input toolbar changes — the widget already exists and is generic.
- Not migrating Codex's config-file seeding away; the file value remains Codex's **default** when no
  per-session selection exists. Per-session selection becomes authoritative once set (resolved once in
  Rust at open — see Key Technical Decisions).
- Persistence stores config-option selections only (id → value), not transcript or turn state.

### Deferred to Separate Tasks

- Claude thinking-token-budget (`--max-thinking-tokens`) as an advanced option: future iteration.
- Extending the option to other cc_sdk-backed providers (cursor/copilot/opencode): they inherit the
  generic persistence automatically once they emit a config option + setter, but wiring/testing each is
  out of scope here.

## Context & Research

### Relevant Code and Patterns

**Persistence surface (new home — agent-agnostic):**
- `packages/desktop/src-tauri/src/db/entities/acepe_session_state.rs` — Acepe-owned per-session state,
  `session_id` PK = `session_metadata.id`; already holds `pr_link_mode`, `sequence_id`, runtime
  checkpoint. The config-selections store is added here.
- `packages/desktop/src-tauri/src/db/migrations/m20260406_000001_create_acepe_session_state.rs` (table
  origin) and later `add_*` migrations show the column-addition pattern to follow.
- `packages/desktop/src-tauri/src/db/repository/session_metadata.rs` (and the session-state repository)
  — read/write pattern for per-session rows.

**Canonical config-option flow (confirmed this session):**
- `packages/desktop/src-tauri/src/acp/commands/interaction_commands.rs:370-415` — `acp_set_config_option`
  calls `client.set_session_config_option(..)`, then `config_options_from_response` (line 233) extracts
  `{ configOptions }` and writes `capabilities.config_options` via `run_capability_mutation` (the
  canonical envelope path). The optimistic pre-mutation `set_pending_config_option` (line 207) already
  updates `current_value` generically for whichever option id matches — no change needed.
- New/resume responses route `config_options` into capabilities via
  `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/streaming_bridge.rs:813-835`
  (`sanitize_config_options_for_canonical`).

**Provider pattern to mirror (Claude option):**
- `packages/desktop/src-tauri/src/acp/client/codex_native_config.rs` — `CodexNativeConfigState`,
  `build_codex_native_config_options` (emits `ConfigOptionData { presentation: CompactReasoning, .. }`),
  `set_codex_native_config_option` (mutates + returns updated options), constants
  `DEFAULT_REASONING_EFFORT = "high"`, `CODEX_REASONING_OPTIONS`, `REASONING_CONFIG_ID`.
- `packages/desktop/src-tauri/src/acp/client/codex_native_client.rs:573-582` — the trait
  `set_session_config_option` returns `Ok(json!({ "configOptions": config_options }))`.

**Claude / cc_sdk target:**
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs` — `CcSdkClient` (per-session; holds
  `pending_model_id`/`pending_mode_id`, ~line 122); `build_options` (line 259); **four**
  `config_options: vec![]` sites at lines 733, 790, 813, 860; implements `set_session_model`/
  `set_session_mode` (864+) but **not** `set_session_config_option` (inherits the erroring trait
  default at `client_trait.rs:109`).
- `packages/desktop/src-tauri/src/cc_sdk/types/effort.rs` — `Effort { Low, Medium, High, Max }`, lowercase
  `Display`/serde.
- `packages/desktop/src-tauri/src/cc_sdk/types/options.rs` — `effort: Option<Effort>` (line 187) and a
  public `effort(..)` builder (line 621). No options.rs change needed; `query.rs:288` already emits
  `--effort`.

**Canonical presentation classifier:**
- `packages/desktop/src-tauri/src/acp/session_update/types/config.rs:207-234` —
  `classify_config_option_presentation` maps an id/name/category containing `reason`/`thought` to
  `CompactReasoning`. We also set `presentation` explicitly (Codex does) — belt and suspenders.

**UI consumers (no change):**
- `packages/desktop/src/lib/acp/components/agent-input/logic/toolbar-config-options.ts`,
  `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte:158-164`.

### Institutional Learnings

- GOD gate run twice for this work and cleared GREEN. Key constraints honored: `config_options` is
  canonical and forbidden in hot state; persisted selections live in Acepe-owned `acepe_session_state`;
  restore is applied by **replaying through each provider's own canonical setter** (single application
  path, no dual system); Codex's config-file value is resolved to a default once in Rust at session
  open, not via a reader-time fallback.

### External References

- `claude --help` (Claude Code CLI v2.1.185): `--effort <level>` — "Effort level for the current
  session". Exact accepted level set verified in Unit 0.

## Key Technical Decisions

- **Persist in `acepe_session_state`, agent-agnostic, keyed by config id.** Store a small JSON map of
  `config_id → value` (or a dedicated typed column if a single option is preferred initially). Rationale:
  this is the existing Acepe-owned canonical per-session table; a generic id→value map supports any
  provider's options without per-provider schema.
- **Restore by replaying through the provider's own `set_session_config_option`.** At session open, load
  persisted selections and replay each `(id, value)` through the already-connected client. Rationale:
  one canonical application path (identical to a user click), updates both the provider's internal state
  and the emitted `config_options`; no provider-specific restore branching, no dual write.
- **Resolve provider default vs persisted selection once, in Rust, at open.** If a per-session selection
  exists it is authoritative; otherwise the provider's own default applies (for Codex, its config-file
  value). Rationale: avoids a GOD-forbidden reader-time fallback; the merge is a single canonical
  computation.
- **Persist on successful set, in the command layer.** `acp_set_config_option` writes the selection to
  `acepe_session_state` after the client returns the updated options. Rationale: agent-agnostic single
  write point; works for every client implementation.
- **Claude exposes effort level, with a "default/auto" entry that passes no flag.** The option includes
  an explicit default entry mapping to `Option<Effort> = None`; `build_options` omits `--effort` for it,
  preserving the CLI default (R6). Concrete levels (low/medium/high/max — pending Unit 0) map to
  `Some(Effort::_)`. Mirrors the model selector's `default`/`auto` handling.
- **Next-turn application semantics.** Effort applies to the next turn's `build_options`; no mid-turn
  mutation (matches the per-invocation CLI flag and Codex).
- **Claude config id contains "reasoning"** (e.g. `reasoning_effort`) so the classifier independently
  agrees with the explicitly-set `CompactReasoning` presentation.

## Open Questions

### Resolved During Planning

- `claude` CLI supports `--effort`? — Yes (v2.1.185).
- cc_sdk→CLI plumbing present? — Yes (`query.rs:288`); `.effort(..)` builder exists (`options.rs:621`).
- How does a setter result reach the UI canonically? — `acp_set_config_option` →
  `config_options_from_response` → `run_capability_mutation`.
- Where do per-session selections persist canonically? — `acepe_session_state` (Acepe-owned, Rust).
- How is restore applied agent-agnostically? — Replay through `client.set_session_config_option` at open.
- Codex config-file vs per-session conflict? — Per-session authoritative once set; file value is the
  default, resolved once in Rust at open.
- effort vs thinking-budget for Claude? — effort; budget deferred.

### Resolved During Implementation

- **Accepted `--effort` values**: `low, medium, high, xhigh, max` (CLI v2.1.185 help). The `Effort` enum
  was missing `Xhigh` — added it (with a Display test). Claude option list = `auto` (sentinel) + these five.
- **Storage shape**: a **dedicated `session_config_selection` table** keyed by `(session_id, config_id)`,
  not a JSON column on `acepe_session_state`. Reason: `acepe_session_state` rows are optional per session
  (the compose helper takes `Option<&Model>`) and its `relationship`/`project_path` are NOT NULL, so a
  JSON column would force synthesizing partial parent rows at set-time. The dedicated child table (FK to
  `session_metadata`, cascade delete) avoids that and is race-free per `(session_id, config_id)`.
- **Default/auto semantics**: no clear-on-default needed — we always persist the chosen value (including
  `auto`). Replaying `auto` sets effort `None` → no `--effort` flag → CLI default. Users who never touch
  the widget have no row → no replay → provider default (R6).
- **Restore seam**: localized to `ClaudeCcSdkClient::resume_session` (the reopen path), which seeds
  `reasoning_config` via the shared `set_reasoning_effort` before `build_options`/option emission. This
  keeps the GOD-sensitive command lifecycle paths (new/fork) untouched. New sessions have no persisted
  selections, so only resume needs restore.
- Display label for Claude's default entry: "Auto".

### Deferred to Separate Follow-up

- **Codex restore parity**: persistence (Unit 2, command layer) is already agent-agnostic, so Codex
  selections are *written*. Restoring them on Codex resume needs the same one-line
  `apply_persisted_config_selections` hook in `codex_native_client`'s resume path. Small, isolated; not
  wired in this change.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation
> specification. The implementing agent should treat it as context, not code to reproduce.*

```
  USER PICKS LEVEL (any agent)                         SESSION REOPEN (any agent)
        │                                                     │
        ▼                                                     ▼
  acp_set_config_option ─────────────┐         load persisted selections from
        │ client.set_session_config_option     acepe_session_state (Unit 1/3)
        │   • mutate provider state             │
        │   • return { configOptions }          │  for each (id, value):
        ▼                                        ▼     client.set_session_config_option(id, value)   ◄── REPLAY
  config_options_from_response                       (same canonical setter — Unit 3)
  → run_capability_mutation (canonical envelope)     │
        │                                            ▼
        ├─► capabilities.config_options ──► CanonicalSessionProjection ──► UI (read-only)
        │
        └─► PERSIST (id,value) → acepe_session_state (Unit 2)

  PER TURN (Claude): build_options reads provider state → builder.effort(e) → --effort (Unit 5)
  Default resolution at open: persisted selection if present, else provider default (Codex: config file)
```

## Implementation Units

- [ ] **Unit 0: Verify CLI `--effort` contract (pre-implementation gate)**

**Goal:** Pin the exact accepted `--effort` values for the installed `claude` CLI before hardcoding the
option list / `Effort` enum.

**Requirements:** R2.

**Dependencies:** None.

**Files:**
- Modify (only on mismatch): `packages/desktop/src-tauri/src/cc_sdk/types/effort.rs`

**Approach:**
- Determine the authoritative accepted level set (inspect CLI help detail; non-destructive probes).
- Compare to `Effort` (`low/medium/high/max`); adjust variants/`Display` so each emitted token is valid.

**Execution note:** Verification gate — resolve before Units 4-5 hardcode the level list.

**Test scenarios:**
- Test expectation: none unless the enum changes — if modified, assert `Effort::_.to_string()` equals
  each accepted CLI token.

**Verification:** Recorded accepted value list; `Effort` `Display` matches it one-for-one.

- [ ] **Unit 1: Persistence schema + repository for per-session config selections**

**Goal:** Add an Acepe-owned, agent-agnostic per-session store of config-option selections.

**Requirements:** R3, R4.

**Dependencies:** None.

**Files:**
- Create: `packages/desktop/src-tauri/src/db/migrations/<new>_add_config_selections_to_acepe_session_state.rs`
- Modify: `packages/desktop/src-tauri/src/db/entities/acepe_session_state.rs`
- Modify: the acepe-session-state repository (under `packages/desktop/src-tauri/src/db/repository/`)
- Modify: `packages/desktop/src-tauri/src/db/migrations/` migrator registration
- Test: repository unit tests beside the repository (mirror existing session-state repo tests)

**Approach:**
- Add a nullable column holding a serialized `config_id → value` map (JSON text), defaulting to
  empty/absent.
- Add entity field + repository helpers: `get_config_selections(session_id) -> map` and
  `upsert_config_selection(session_id, config_id, value)` (and a clear/remove for the default/auto case
  if a selection is reset).
- Follow the existing `add_*_to_acepe_session_state` migration and repository conventions.

**Patterns to follow:**
- `m20260423_000002_add_pr_link_mode_to_acepe_session_state.rs` (column-addition migration);
  existing `acepe_session_state` read/write in the repository.

**Test scenarios:**
- Happy path: upsert `(session, "reasoning_effort", "high")` then read back returns `{reasoning_effort: high}`.
- Edge case: reading a session with no stored selections returns empty (not error).
- Edge case: upserting the same id twice keeps the latest value (no duplicate keys).
- Edge case: resetting to the default/auto value removes or nulls the entry so provider default re-applies.
- Migration: applies cleanly on an existing DB and is reversible (down migration drops the column).

**Verification:** Migration runs; repository round-trips selections; existing session-state tests pass.

- [ ] **Unit 2: Persist selection on successful set (command layer, agent-agnostic)**

**Goal:** When any config option is set, persist the selection to `acepe_session_state`.

**Requirements:** R3, R4, R5.

**Dependencies:** Unit 1.

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/commands/interaction_commands.rs` (`acp_set_config_option`)
- Test: `packages/desktop/src-tauri/src/acp/commands/tests.rs`

**Approach:**
- After `set_session_config_option` succeeds and the response is reconciled into capabilities, upsert the
  `(config_id, value)` into `acepe_session_state` for the session.
- Keep this in the command layer so it is provider-independent. No hot-state writes; persistence is
  canonical Acepe-owned state.

**Patterns to follow:** existing repository access from command handlers; `run_capability_mutation` usage
already in `acp_set_config_option`.

**Test scenarios:**
- Happy path: calling `acp_set_config_option(session, "reasoning_effort", "high")` writes the selection to
  `acepe_session_state`.
- Integration: after the command, the repository returns the persisted selection (proves command→DB wiring).
- Error path: when the client setter errors, no selection is persisted (write only on success).
- Edge case: setting the default/auto value clears the persisted entry (per Unit 1 semantics).

**Verification:** Setting an option in the running app survives a session reopen (combined with Unit 3).

- [ ] **Unit 3: Restore selections at session open by replaying the canonical setter**

**Goal:** On session open/resume, load persisted selections and apply them through each provider's own
`set_session_config_option`, agent-agnostically.

**Requirements:** R3, R4, R5.

**Dependencies:** Unit 1; Unit 2; (for Claude) Unit 5's setter.

**Files:**
- Modify: the session-open/resume completion path in
  `packages/desktop/src-tauri/src/acp/commands/session_commands/` (e.g. `open_result.rs` / `resume.rs` /
  `new_session.rs`) — the seam after capabilities are materialized and before the first prompt
- Test: `packages/desktop/src-tauri/src/acp/commands/session_commands/tests.rs`

**Approach:**
- After the session is connected and its initial `config_options` are in capabilities, load persisted
  selections for the session and, for each `(id, value)`, invoke `client.set_session_config_option(id,
  value)`, feeding the returned options back through the same canonical capability-mutation path used by
  `acp_set_config_option` (extract a shared helper if needed).
- Skip ids the provider does not currently advertise (defensive: a stored id no longer offered).
- Default resolution is implicit: no persisted selection → no replay → provider default stands.

**Execution note:** Start with a failing integration test that opens a session with a stored selection and
asserts the emitted capabilities reflect it.

**Test scenarios:**
- Integration (agent-agnostic): a session with a stored selection, on open, ends with
  `capabilities.config_options` reflecting the stored `current_value` (test with a fake/Codex client to
  prove agent-independence).
- Integration (Claude): opening a Claude session with stored `reasoning_effort=high` results in the
  client's internal state set to `Some(High)` and the option's `current_value == "high"`.
- Edge case: a stored id the provider no longer advertises is skipped without error.
- Edge case: a session with no stored selections opens unchanged (provider default stands).

**Verification:** Reopen a session (and restart the app) — the previously chosen option is restored in the
widget for both Claude and Codex.

- [ ] **Unit 4: Claude reasoning config state + option builder**

**Goal:** Add a cc_sdk reasoning config state and a pure builder producing the canonical `ConfigOptionData`,
mirroring `codex_native_config.rs`.

**Requirements:** R1, R6.

**Dependencies:** Unit 0.

**Files:**
- Create: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/reasoning_config.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs` (module declaration)
- Test: inline `#[cfg(test)]` in the new file (mirror codex_native_config tests)

**Approach:**
- State struct holding `effort: Option<Effort>` (None = default/auto), default `None`.
- Constants: `REASONING_CONFIG_ID` containing `"reasoning"`; ordered option list `[(value,label)]` with a
  default/auto sentinel + the verified levels.
- `build_cc_sdk_reasoning_config_options(state) -> Vec<ConfigOptionData>`: one option, `option_type:
  "select"`, `presentation: CompactReasoning`, `current_value` reflecting state.
- `parse_effort_value(&str) -> AcpResult<Option<Effort>>` (sentinel → None; known token → Some; else error).
- `set_reasoning_effort(state, value) -> AcpResult<Vec<ConfigOptionData>>` mutating + rebuilding options.

**Patterns to follow:** `build_codex_native_config_options`, `set_codex_native_config_option`,
`normalize_reasoning_effort`.

**Test scenarios:**
- Happy path: default state → one option, id contains `reasoning`, `presentation == CompactReasoning`,
  current_value is the sentinel, option list = default + verified levels.
- Happy path: `set_reasoning_effort(state,"high")` → `Some(High)`, current_value `"high"`.
- Edge case: setting the sentinel resets to `None`.
- Error path: `"bogus"` errors, state unchanged.
- Edge case: every level round-trips to the exact CLI token via `Effort::Display`.

**Verification:** New file compiles; tests pass; option shape matches Codex's `ConfigOptionData` fields.

- [ ] **Unit 5: Wire Claude option into `CcSdkClient` (emit, set, apply)**

**Goal:** Hold the reasoning state on the client, emit the option at all session-response sites, implement
the setter, and feed effort into each turn.

**Requirements:** R1, R2.

**Dependencies:** Unit 4.

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs`
- Test: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/tests.rs`

**Approach:**
- Add a `reasoning_config` field to `CcSdkClient`, default in the constructor (beside
  `pending_model_id`/`pending_mode_id`).
- Replace **all four** `config_options: vec![]` sites — line 733 (`new_session`), lines 790 and 813
  (resume returns), line 860 (fork/new-session return) — with
  `build_cc_sdk_reasoning_config_options(&self.reasoning_config)`.
- Gate emission to the Claude provider (via `self.provider.parser_agent_type()` / provider id) so other
  cc_sdk-backed providers keep `vec![]` until separately enabled.
- Implement `set_session_config_option`: for `REASONING_CONFIG_ID`, call `set_reasoning_effort(&mut
  self.reasoning_config, &value)?` and return `Ok(json!({ "configOptions": options }))`; unknown ids keep
  the trait-default error.
- In `build_options` (line 259): `if let Some(e) = self.reasoning_config.effort { builder =
  builder.effort(e); }` (builder method exists at `options.rs:621`); `None` omits `--effort`.

**Patterns to follow:** `codex_native_client.rs:573-582` (setter shape); existing `build_options`
model/mode handling.

**Test scenarios:**
- Happy path: Claude `new_session` response `config_options` contains exactly the reasoning option with
  the default current_value.
- Happy path: a resume response carries the option reflecting the client's current `reasoning_config`.
- Edge case (provider-gated): a non-Claude cc_sdk provider's `new_session` still returns empty
  `config_options`.
- Happy path: `set_session_config_option(reasoning id, "high")` returns `{ "configOptions": [..] }` with
  current_value `"high"` and mutates state.
- Error path: unknown `config_id` returns the unsupported/method-not-found error.
- Integration: `config_options_from_response` (real helper) extracts a non-empty list from the setter's
  return shape.
- Happy path: with `effort = Some(High)`, `build_options(..)` yields options whose `effort == Some(High)`;
  with `None`, no effort is set.

**Verification:** Selecting Claude shows the reasoning widget (DOM-verified via QA CLI); changing it updates
the displayed value and a subsequent turn passes `--effort <level>`; default/auto passes none.

## System-Wide Impact

- **Interaction graph:** Reuses `acp_set_config_option` + `run_capability_mutation` for sets; restore
  (Unit 3) replays the same setter at open. No new commands/events. Persistence adds one DB write
  (command layer) and one DB read (open layer).
- **Error propagation:** Setter errors prevent persistence (Unit 2); a stored id no longer advertised is
  skipped on restore (Unit 3); invalid effort rejected before state mutation (Unit 4).
- **State lifecycle risks:** Persisted selections live in canonical `acepe_session_state` keyed by
  session_id; restore is idempotent (replay yields the same canonical state). No hot-state writes of
  `config_options`. Default-vs-persisted resolved once at open (no reader-time fallback).
- **API surface parity:** All providers share the persist/restore path. Codex gains persistence with no
  Codex code change (already emits option + setter); other cc_sdk providers inherit it once they emit an
  option + setter.
- **Integration coverage:** Unit 3's agent-agnostic open-replay test and Unit 2's command→DB test prove
  the canonical round-trip mocks alone would not; app-level DOM verification confirms the UI outcome.
- **Unchanged invariants:** Toolbar/selector and all `packages/ui` code untouched; `ConfigOptionData`
  schema and `CompactReasoning` classifier unchanged; no `agentId === "claude"` branch anywhere in TS/UI;
  Codex's config-file seeding still provides its default.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Installed `claude` CLI accepts a different effort set than the `Effort` enum (e.g. `max` invalid). | Unit 0 pins the real set and adjusts the enum before levels are hardcoded. |
| Replay-at-open seam runs before capabilities are materialized or after the first turn starts. | Unit 3 targets the seam between connect and first prompt; integration test asserts capabilities reflect restored values pre-turn. |
| Replaying the setter at open emits redundant capability-mutation envelopes / visible churn. | Replay is idempotent and uses the canonical path; if churn is observed, gate replay to only ids whose persisted value differs from the provider default. |
| `CcSdkClient` is shared across providers; emitting the Claude option for all could surprise them. | Provider-gate emission to Claude; test other providers stay empty. |
| Codex dual-source (config file vs per-session) creates ambiguity. | Resolved once in Rust at open: persisted selection authoritative, else provider default; documented decision. |
| Storage-shape choice (JSON map vs typed column) churns later. | Unit 1 picks a JSON `id→value` map for extensibility, matching repository serialization conventions. |

## Documentation / Operational Notes

- After implementation, run the repo Visual QA flow (QA CLI: `doctor` → `observe` → `inspect
  --selector=<reasoning widget>` → `screenshot`) to DOM-verify the widget appears for Claude and that a
  reopened session restores the selection. Do not rely on tests alone for UI-visible outcomes.
- Primary gates: `cargo clippy` + Rust tests in `src-tauri/`; `bun run check` should still pass (no TS
  changes). New DB migration must apply on existing databases.

## Sources & References

- Diagnosis (this session): cc_sdk transport; `query.rs:288`; `.effort(..)` builder `options.rs:621`;
  empty `config_options` at `cc_sdk_client/mod.rs` lines 733/790/813/860; Codex pattern in
  `codex_native_config.rs`; classifier `session_update/types/config.rs:207-234`; canonical setter flow
  `interaction_commands.rs:207-415`; persistence surface `db/entities/acepe_session_state.rs`.
- GOD architecture gate: run for both the original Claude-option scope and the expanded agent-agnostic
  persistence scope; both cleared GREEN (canonical `acepe_session_state` storage; replay-through-setter
  single application path; default resolved once in Rust).
- CLI: `claude --help` v2.1.185 — `--effort <level>`.
