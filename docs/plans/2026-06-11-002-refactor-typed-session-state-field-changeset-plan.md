---
status: active
type: refactor
created: 2026-06-11
god_gate: not-required
origin: architecture-review (improve-codebase-architecture, candidate 1)
---

# refactor: Type the SessionStateDelta change-set

## Summary

Replace `SessionStateDelta.changed_fields: Vec<String>` — assembled from 74 hand-written camelCase string literals across 7 Rust files and serialized to TS as `changedFields?: string[]` — with a specta-exported `enum SessionStateField`. The compiler then defends the field set on both sides of the canonical Rust → TS seam, and the repeated 5-field base-set collapses to one named constant. Purely additive: no runtime behavior changes.

---

## Problem Frame

`changed_fields` is a consumer hint telling the TS side which fields of the session-state graph changed, so it can skip re-renders. It crosses the seam as `Vec<String>` (serde `rename_all = "camelCase"` → wire key `changedFields`; TS sees `changedFields?: string[]` in `acp-types.ts`). The strings — `"turnState"`, `"operations"`, `"activity"`, `"activeStreamingTail"`, etc. — are constructed at ~74 `.to_string()` sites across `runtime_registry.rs`, `reducer.rs`, `bridge.rs`, `protocol.rs`, `resume.rs`, and `dispatcher.rs`, with the same 5-field base-set repeated verbatim three times in `runtime_registry.rs` alone. Nothing guards the contract: rename a field on the TS model and the only safety net is grep. This is a shallow, stringly-typed seam in the middle of the canonical model.

---

## Requirements

- R1. `changed_fields` is typed as `Vec<SessionStateField>` where `SessionStateField` is a Rust enum deriving `serde::Serialize`, `serde::Deserialize`, and specta `Type`.
- R2. The generated TS type for the field is a string-literal union (or enum), not `string[]`, so TS consumers get exhaustiveness.
- R3. The wire format is unchanged (the serialized values remain the same camelCase tokens under key `changedFields`), so no coordinated deploy is needed and existing persisted/streamed payloads still deserialize.
- R4. The repeated 5-field base-set becomes a single shared constant/helper in Rust.
- R5. No behavior change: the same fields are reported changed for the same updates as today.

---

## Scope Boundaries

- Not changing *which* fields are reported as changed for any update — only their representation.
- Not removing `changed_fields` / the re-render optimization (a separate question; see candidate 8's seam-narrowing discussion).
- Not renaming the serialized wire key `changedFields`.

---

## Context & Research

### Relevant Code and Patterns

- Definition: `packages/desktop/src-tauri/src/acp/session_state_engine/protocol.rs:32` (`struct SessionStateDelta`), field at `:49` (`pub changed_fields: Vec<String>`, serde-renamed to `n`).
- Generated TS: `packages/desktop/src/lib/services/acp-types.ts` → `SessionStateDelta = { …; changedFields?: string[] }`.
- Assembly sites (74): `session_state_engine/runtime_registry.rs` (incl. repeated base-set at ~447, 615, 693), `reducer.rs` (295, 340, 375, 418, 574, 629), `bridge.rs` (147, 295), `protocol.rs`, `commands/session_commands/resume.rs`, `ui_event_dispatcher/dispatcher.rs`.
- **Production consumers:** `session-state-command-router.ts` (delta routing via `changedFields.includes(...)`), `session-state-query-service.ts` (`resolveSessionStateDelta`). Test fixtures also use `changedFields` (e.g., `session-store-projection-state.vitest.ts`, `session-state-command-router.test.ts`).
- specta `Type` derive is already the house mechanism for every type in `acp-types.ts`.

### Institutional Learnings

- CONTEXT.md: canonical truth is Rust-owned; the wire contract is specta-generated and machine-authoritative. A typed enum keeps it that way instead of leaving a stringly hole.

---

## Key Technical Decisions

- **Enum with explicit serde rename to the existing tokens.** `#[serde(rename_all = "camelCase")]` (or per-variant `rename`) so serialized output is byte-identical to today's strings → satisfies R3, makes this a non-breaking change.
- **One base-set constant.** A `fn turn_terminal_change_fields() -> Vec<SessionStateField>` (or `const` slice) replaces the three verbatim 5-field vecs in `runtime_registry.rs`.
- **Migrate consumers to the union.** TS test fixtures and the production consumer switch from string literals to the generated union members; an exhaustive `switch` replaces any `if field === "…"` string compares.

---

## Open Questions

### Resolved During Planning

- Wire-break risk? None — serde rename preserves the exact serialized tokens. Persisted/in-flight payloads continue to deserialize. Resolved.

### Deferred to Implementation

- Whether `session-state-query-service.ts` needs an exhaustive `switch` or can keep `includes` checks once typed — settle during U3 migration.

---

## Implementation Units

### U1. Define `SessionStateField` enum (Rust + specta)

**Goal:** Introduce the typed change-set vocabulary as canonical Rust truth.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src-tauri/src/acp/session_state_engine/session_state_field.rs` (or co-locate in `protocol.rs`)
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/protocol.rs` (field type + module wiring)

**Approach:**
- One variant per existing token: `TranscriptSnapshot`, `Operations`, `Activity`, `TurnState`, `ActiveTurnFailure`, `LastTerminalTurnId`, `ActiveStreamingTail`, `Interactions` (confirm the full set by enumerating the 74 literals first).
- Derive `Serialize, Deserialize, Type, Clone, Copy, PartialEq, Eq, Hash`; rename to camelCase so serialized values match.

**Test scenarios:**
- Happy path: serialize `vec![TurnState, Operations]` → JSON `["turnState","operations"]` (byte-match the old strings).
- Edge case: round-trip deserialize the old string array into the enum vec.

**Verification:** specta regen produces a TS union for the field; serialized tokens identical to pre-change (golden snapshot).

---

### U2. Replace the 74 string-literal assembly sites

**Goal:** Construct `changed_fields` from enum variants everywhere; collapse the repeated base-set.

**Requirements:** R1, R4, R5

**Dependencies:** U1

**Files:**
- Modify: `runtime_registry.rs`, `reducer.rs`, `bridge.rs`, `protocol.rs`, `resume.rs`, `dispatcher.rs` (all assembly sites)
- Create/Modify: shared base-set helper (in `session_state_field.rs`)

**Approach:**
- Mechanical replace of `"x".to_string()` → `SessionStateField::X`. The three verbatim 5-field vecs in `runtime_registry.rs` call the shared helper.

**Execution note:** Enumerate all 74 sites first (`rg '"\w+"\.to_string\(\)' …`) to confirm the variant set is complete before defining the enum in U1.

**Test scenarios:**
- Happy path: existing Rust tests asserting changed-field sets pass unchanged (same logical fields).

**Verification:** `rg '\.to_string\(\)' ` shows no remaining change-field literals; cargo build green.

---

### U3. Migrate TS consumers and fixtures to the generated union

**Goal:** TS side consumes typed members with exhaustiveness, not raw strings.

**Requirements:** R2, R5

**Dependencies:** U1 (regenerated `acp-types.ts`)

**Files:**
- Modify: `packages/desktop/src/lib/services/acp-types.ts` (regenerated — do not hand-edit)
- Modify: `packages/desktop/src/lib/acp/session-state/session-state-command-router.ts`
- Modify: `packages/desktop/src/lib/acp/session-state/session-state-query-service.ts`
- Modify: test fixtures using `changedFields: ["…"]` — `session-store-projection-state.vitest.ts`, `session-store-token-stream.vitest.ts`, `session-state-command-router.test.ts`, `session-event-service-streaming.vitest.ts`

**Approach:**
- Replace string-compare branches with a `switch` over the union; fixtures use the union members.

**Test scenarios:**
- Happy path: existing vitest suites pass against the typed field.
- Edge case (compile-time): an invalid field token fails `bun run check`.

**Verification:** `bun run check` green; vitest suites green; no `string[]` for the field in the generated types.

---

## System-Wide Impact

- **API surface parity:** This is the Rust→TS wire contract. specta regeneration is the source of truth; TS must not hand-edit the type.
- **Unchanged invariants:** Serialized payload bytes, persisted deltas, and which fields are reported changed are all unchanged. Only the static type tightens.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A literal token doesn't map to a planned variant (typo / forgotten field) | Enumerate all 74 first (U2 execution note); enum is defined from the observed set |
| Production consumers (`session-state-command-router`, `session-state-query-service`) break on typed union | Migrate both in U3; covered by `bun run check` exhaustiveness once typed |
| Serialized value drift breaks in-flight/persisted payloads | Golden serialization snapshot in U1; serde rename preserves exact tokens |

---

## Sources & References

- Architecture review candidate 1, verified (74 literals across 7 files; wire key `changedFields`).
- Related code: `session_state_engine/protocol.rs:32,49`; `acp-types.ts` `SessionStateDelta`.
