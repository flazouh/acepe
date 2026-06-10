---
status: active
type: refactor
created: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture, candidate 2 — top recommendation)
---

# refactor: Lift provider identity out of canonical deserialization

## Summary

Make `AgentType` a guaranteed input at the adapter seam instead of ambient task-local state with a silent `ClaudeCode` fallback. Every site that constructs canonical data from provider bytes must run inside a `with_agent(...)` scope, and `current_agent()` must hard-error (or take an explicit agent) rather than `unwrap_or(AgentType::ClaudeCode)`. This closes a GOD-gate leak: a provider quirk (the wrong-agent default) currently lives inside the Serde contract of canonical wire types.

---

## Problem Frame

`agent_context.rs` exposes `current_agent() -> Option<AgentType>` backed by a `tokio::task_local!`. Throughout deserialization the value is read as `current_agent().unwrap_or(AgentType::ClaudeCode)`. Provider identity is therefore *part of the Serde `Deserialize` contract* of `SessionUpdate` and `ToolCallData`: deserialize one of those types outside a `with_agent` scope and it silently parses as Claude Code, producing wrong `ToolKind`/parser assignments. This is provider-specific branching embedded in canonical construction — exactly what the GOD gate says belongs at the adapter edge, made explicit, never defaulted. The codebase already half-enforces this: `parsers/tests/provider_composition_boundary.rs:226` asserts certain source must not contain `unwrap_or(AgentType::ClaudeCode)`, and one site (`deserialize.rs:334`) already uses the hard-error `ok_or_else` form. This plan finishes that job.

---

## Requirements

- R1. No production code path constructs canonical data with a silently-defaulted `AgentType`. The `unwrap_or(AgentType::ClaudeCode)` fallback is removed from all non-test sites.
- R2. Every entry point that deserializes/parses provider session updates into canonical form is provably wrapped in a `with_agent(...)` scope (or threads an explicit `AgentType`).
- R3. Missing agent context becomes a loud failure (Serde error / `Result::Err`), not a wrong-but-silent Claude Code parse.
- R4. The `provider_composition_boundary` test net is extended to cover all the files the fallback previously lived in, so the leak cannot silently return.
- R5. No behavior change for correctly-scoped callers (the common path already sets the agent) — verified by characterization tests before the fallback is removed.

---

## Scope Boundaries

- Not removing the `task_local!` mechanism itself. `with_agent` scoping across `await` points is the right carrier for an ambient-but-required value; the fix is making absence an error, not making the value a positional parameter on every Serde impl (Serde can't carry one cleanly).
- Not re-architecting the per-provider parsers (`parsers/*`) — only how the active `AgentType` reaches them.
- Not touching the TypeScript side — provider identity never legitimately crosses to TS as identity (it is metadata per CONTEXT.md).

### Deferred to Follow-Up Work

- Promoting `current_agent()` to return `AgentType` (non-`Option`) globally: only after every call site is proven scoped. Tracked as a possible Phase 2 once the hard-error form has soaked.

---

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/acp/agent_context.rs` — `with_agent` (sync_scope) + `current_agent()` (`try_with`). Tests already prove scope nesting and cross-`await` retention.
- Fallback sites to remove: `session_update/deserialize.rs:329,371`; `session_update/tool_calls.rs:50,98,512,692`; `session_update/types/tool_calls.rs:551`; `streaming_accumulator.rs:367`; `session_update_parser.rs:96`.
- Existing hard-error form to mirror: `session_update/deserialize.rs:334` (`current_agent().ok_or_else(|| serde::de::Error::custom(...))`).
- Existing explicit-agent seam already present: `parse_tool_call_from_acp_with_agent(data, agent)` and the tests `codex_streaming_update_prefers_explicit_agent_seed_over_current_agent` (`tool_calls.rs:847`), `assistant_tool_use_prefers_explicit_agent_parser_over_current_agent` (`parsers/cc_sdk_bridge.rs:1725`).
- Boundary test to extend: `parsers/tests/provider_composition_boundary.rs:226`.

### Institutional Learnings

- CONTEXT.md / GOD gate: "Raw provider data is input, not product truth. Provider quirks belong in Rust adapters/history parsers." A defaulted `AgentType` inside Serde is provider branching that has slipped downstream of the adapter.
- ADR-0001: errors are values — the Serde-error / `Result` form is the house pattern for "absence is a failure."

---

## Key Technical Decisions

- **Absence is an error, not a default.** Replace every `current_agent().unwrap_or(AgentType::ClaudeCode)` with the `ok_or_else`/`Result` form at Serde boundaries, and with an explicit threaded `AgentType` where the call is plain Rust (not a `Deserialize` impl).
- **Prefer the existing explicit `_with_agent` variants** for the parser call sites (`tool_calls.rs:50,512,692`) — pass the resolved agent down rather than re-reading the task-local deep in the stack.
- **Guarantee the scope at the seam.** Audit the command/event entry points that drive session-update ingestion and ensure each wraps ingestion in `with_agent(session.agent, …)`. The hard-error form will surface any unscoped path during the characterization run.

---

## Open Questions

### Resolved During Planning

- Should `AgentType` become a positional parameter everywhere? No — Serde `Deserialize` cannot carry it cleanly; the task-local + mandatory scope is the right seam. Resolution: make absence an error.

### Deferred to Implementation

- Exact set of ingestion entry points needing a `with_agent` wrapper: discovered by running the hard-error build + characterization suite and following the failures. Enumerated at execution time, not guessed here.

---

## Implementation Units

### U1. Characterize current agent-resolution behavior

**Goal:** Lock in the behavior of correctly-scoped deserialization before removing the fallback, so R5 is provable.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Test: `packages/desktop/src-tauri/src/acp/session_update/tests.rs` (extend)
- Test: `packages/desktop/src-tauri/src/acp/agent_context.rs` (already has scope tests)

**Approach:**
- Add characterization tests asserting that, *inside* `with_agent(agent, …)`, `SessionUpdate` / `ToolCallData` deserialization produces the same canonical output it does today for each `AgentType` variant (Claude, Codex, Cursor).

**Execution note:** Characterization-first — capture existing behavior before changing the fallback.

**Test scenarios:**
- Happy path: deserialize a tool-call update under `with_agent(Codex)` → Codex parser/`ToolKind`, not Claude.
- Edge case: nested `with_agent` scopes resolve to the innermost agent (already covered in `agent_context.rs`; add the deserialize-level equivalent).

**Verification:** Suite green on current code; each test names the agent and the resulting canonical assignment.

---

### U2. Replace the silent fallback with hard-error / explicit-agent resolution

**Goal:** Remove every `unwrap_or(AgentType::ClaudeCode)` from production deserialization and parsing.

**Requirements:** R1, R3

**Dependencies:** U1

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_update/deserialize.rs` (329, 371)
- Modify: `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs` (50, 98, 512, 692)
- Modify: `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs` (551)
- Modify: `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs` (367)
- Modify: `packages/desktop/src-tauri/src/acp/session_update_parser.rs` (96)

**Approach:**
- Serde-context sites → `current_agent().ok_or_else(|| Error::custom("missing agent context for <type>"))`, mirroring `deserialize.rs:334`.
- Plain-Rust sites that already have an explicit-agent variant → call the `_with_agent` form with the resolved agent threaded from the caller.

**Execution note:** Expect new compile/test failures from any unscoped ingestion path — that is the point (U3 fixes them).

**Test scenarios:**
- Error path: deserialize a tool-call update with **no** active agent scope → `Err` (Serde custom error), not a Claude Code parse.
- Happy path: all U1 characterization tests still green (scoped callers unaffected).

**Verification:** No `unwrap_or(AgentType::ClaudeCode)` remains in non-test Rust (`rg` clean); cargo build + tests green after U3.

---

### U3. Guarantee `with_agent` scoping at every ingestion entry point

**Goal:** Ensure each canonical-construction entry runs inside a `with_agent(session.agent, …)` scope, so U2's hard error never fires in production.

**Requirements:** R2

**Dependencies:** U2

**Files:**
- Modify: ingestion entry points surfaced by U2 failures (e.g., session-update command handlers, event dispatch, resume/replay). Exact list discovered at execution time.

**Approach:**
- For each failing path, wrap the deserialize/parse in `with_agent(agent, …)` using the session's known `AgentType`. The session already knows its provider; this just makes the carrier explicit at the seam.

**Test scenarios:**
- Integration: drive a full session-update ingest for a non-Claude provider end-to-end → canonical output reflects the real provider, no error.

**Verification:** Full Rust test suite green with the fallback gone; manual smoke on a Codex/Cursor session shows correct tool kinds.

---

### U4. Extend the composition-boundary test net

**Goal:** Make the leak unable to return silently.

**Requirements:** R4

**Dependencies:** U2

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/parsers/tests/provider_composition_boundary.rs`

**Approach:**
- Extend the existing source-assertion (line 226) to cover every file U2 touched, asserting none contains `unwrap_or(AgentType::ClaudeCode)`. This is the one sanctioned structural test — it guards an architectural invariant, not behavior. (Note for reviewers: this is a deliberate, narrowly-scoped exception to the "no source-reading structural tests" rule, consistent with the existing boundary test it extends.)

**Test scenarios:**
- Edge case: reintroducing the fallback in any covered file fails the boundary test.

**Verification:** Boundary test green; a scratch reintroduction of the fallback turns it red.

---

## System-Wide Impact

- **Interaction graph:** Every session-update ingestion path (live streaming, resume/replay, tool-call parsing) reads the active agent. Making absence an error surfaces any path that forgot to scope.
- **Error propagation:** Missing agent context now travels as a Serde/`Result` error to the ingest boundary instead of silently mis-parsing. Ensure the ingest boundary logs/handles it rather than dropping.
- **Unchanged invariants:** Correctly-scoped callers (the production norm) see identical canonical output — guarded by U1 characterization.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| An unscoped production path exists that relied on the Claude default | U1 characterization + U3 surface it as a loud failure during the change, not in prod after |
| Hard error degrades a currently-working non-Claude path that depended on the default by accident | Smoke-test Codex/Cursor sessions in U3; the default was wrong for them anyway |
| Boundary test becomes brittle source-string matching | Scope it to the exact `unwrap_or(AgentType::ClaudeCode)` token in a fixed file set; it guards an invariant the team already chose to enforce |

---

## Sources & References

- Architecture review candidate 2 (top recommendation), verified against tree.
- Related code: `agent_context.rs`, `session_update/deserialize.rs`, `session_update/tool_calls.rs`, `provider_composition_boundary.rs:226`.
- CONTEXT.md GOD gate; ADR-0001 (errors as values).
