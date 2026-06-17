---
status: complete
type: refactor
created: 2026-06-11
document_reviewed: 2026-06-11
completed: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture 2026-06-11 run 2, candidate 7)
---

# refactor: One home per Provider adapter

## Summary

A Provider's quirks currently live in up to four places: its `AgentProvider` impl (`acp/providers/<name>.rs`), enrichment side-files (`cursor_session_update_enrichment.rs`, 29.7K), its classification table (`acp/reconciler/providers/<name>.rs`), and history-restore converters (`session_converter/`). The documented Cursor ID-normalization bug recurred *because* each ingress edge had its own copy of the logic. Restructure each provider into one module directory that names its ingress edges, so adding or auditing a provider is one place, not a scavenger hunt. Cursor — the worst offender and the documented bug source — is the template; the rest follow mechanically.

**Sequencing:** after plan `2026-06-11-001` (explicit agent identity) and plan `2026-06-11-009` (tool identity authority, which settles where classification tables live).

---

## Problem Frame

Cursor today:

- `acp/providers/cursor.rs` (27.5K) — `AgentProvider` impl: spawn, modes, reconciliation policy, replay context, calls `enrich_cursor_session_update`.
- `acp/providers/cursor_session_update_enrichment.rs` (29.7K) — JSONL-history-backed tool-use index (`SessionToolUseCache` behind `LazyLock`/`DashMap`), backfilling args/titles/locations.
- `acp/reconciler/providers/cursor.rs` — classification table **plus** `is_web_search_tool_call_id` (an asymmetry no other provider has).
- `session_converter/` cursor paths — history restore that once bypassed live-parser helpers and re-introduced unnormalized IDs (`docs/solutions/integration-issues/2026-04-30-cursor-acp-tool-call-id-normalization-and-enrichment-path.md`, severity high).

That learning's prevention list is this plan's requirements source: one normalization function shared by all paths; audit reopen/history converters separately from live parsers; idempotent multi-boundary helpers.

Other providers have the same split in milder form (`claude_code.rs` + catalog + settings files; `codex.rs`; `copilot.rs` + catalog/settings; `opencode.rs` + settings). The seam (`AgentProvider` trait, `acp/provider.rs:279`, ~22 methods) is real — six adapters justify it; the *homes* are fragmented.

---

## Requirements

- R1. Each provider's code lives under one module directory (`acp/providers/<name>/`), with named submodules per concern (provider impl, enrichment, settings/catalog) — no provider-named side-files floating beside it.
- R2. Every multi-edge helper a provider uses across ingress paths (live parse, history restore, enrichment, snapshot rehydration) is defined once in that provider's module and provably idempotent where it normalizes identifiers.
- R3. The four ingress edges are named in the provider module's doc header, with pointers to where each enters (parser, converter, enrichment, rehydration) — the audit map the Cursor bug lacked.
- R4. No behavior change; existing provider conformance and regression suites green (`parsers/tests/provider_conformance.rs`, `cursor.rs`, `provider_composition_boundary.rs`, cursor enrichment tests).
- R5. Classification tables stay where plan 009 put them (`reconciler/providers/`), referenced from the provider module's edge map — moving them is explicitly out of scope unless 009's outcome dictates otherwise.

---

## Scope Boundaries

**Not changing:**
- The `AgentProvider` trait surface or `parser_agent_type()` bridge.
- `AgentType` (`acp/parsers/types.rs:24`) or its `from_canonical` carve-outs (plan 001 territory).
- Classification behavior or table contents (plan 009 territory).
- `session_converter/` module ownership — converters keep their home; R3 maps them, R2 makes them share the provider's helpers.

### Deferred to Follow-Up Work
- A shared provider-module template/lint (enforcing the directory shape) — write up if the manual restructure shows a stable shape worth enforcing.
- Resolving the `is_web_search_tool_call_id` asymmetry semantically (should other providers detect web-search IDs?) — product question, not structure.

---

## Context & Research

### Relevant Code and Patterns
- `acp/provider.rs:279` — `AgentProvider` trait (~22 methods).
- `acp/providers/` — `claude_code.rs` (+ `claude_code_model_catalog.rs` 46K, `claude_code_settings.rs`), `codex.rs`, `copilot.rs` (+ catalog/settings), `cursor.rs`, `cursor_session_update_enrichment.rs`, `opencode.rs` (+ settings), `custom.rs`, `forge.rs`, `mod.rs`.
- `tool_call_presentation::{merge_tool_arguments, synthesize_locations, synthesize_title}` — shared (non-provider) helpers the enrichment uses; they stay shared.
- Rust module convention: directory module with `mod.rs` re-exporting the public type (existing pattern across `acp/`).

### Institutional Learnings
- `docs/solutions/integration-issues/2026-04-30-cursor-acp-tool-call-id-normalization-and-enrichment-path.md` — the motivating incident; per-edge drift, non-idempotent normalize (`%`→`%25` double-escape) silently corrupted keys. Idempotence tests are mandatory for any normalizer this plan touches.
- `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md` — behavior-through-repositories testing; regression checklist style for identity-adjacent refactors.
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` — all four ingress edges must emit the same canonical-safe IDs before projection; the restructure must not weaken any edge's normalization.

---

## Key Technical Decisions

- **Directory-per-provider, Cursor first.** `acp/providers/cursor/{mod.rs, provider.rs, enrichment.rs, …}` with `mod.rs` re-exporting today's public names — callers see no path change beyond `use` statements the compiler walks us through.
- **Edge map as doc, helpers as code.** R3's ingress-edge map is a module-header table (cheap, durable); R2's shared helpers are the structural fix. Converters and parsers import the provider module's helper instead of local copies.
- **Mechanical fan-out after the template.** Claude Code (catalog + settings consolidation), Copilot, OpenCode follow the proven shape in one mechanical unit; `custom.rs`/`forge.rs` are thin and may stay single-file inside the convention (a directory is not mandatory below a size threshold — cohesion rules, not ceremony).
- **No new trait.** The deepening is locality, not abstraction; the existing trait + match dispatch stays.

---

## Implementation Units

### U1. Characterize Cursor's four ingress edges

**Goal:** Pin edge behavior before moving files; build the edge map.
**Requirements:** R3, R4
**Dependencies:** plans 001 and 009 landed
**Files:**
- Test: `packages/desktop/src-tauri/src/acp/parsers/tests/cursor.rs` (audit/extend)
- Test: cursor enrichment inline tests (audit)

**Approach:** Trace each edge (live parse, history restore via `session_converter`, enrichment index, snapshot rehydration) and verify a test pins ID normalization and tool-use backfill on each. Add idempotence pins for every normalizer found (`normalize(normalize(x)) == normalize(x)`).
**Execution note:** Characterization-first.
**Test scenarios:**
- Same provider tool-call ID entering via live parse and via history restore produces the same canonical ID (cross-edge parity — the 2026-04-30 bug class).
- Normalizer idempotence on already-normalized input, including the `%`-escape case.
- Enrichment backfill on a sparse tool call yields today's args/title/locations.

**Verification:** Edge map drafted; all four edges have parity + idempotence pins.

### U2. Restructure Cursor into `providers/cursor/`

**Goal:** One home; shared helpers defined once; edge map in the header.
**Requirements:** R1, R2, R3
**Dependencies:** U1
**Files:**
- Create: `packages/desktop/src-tauri/src/acp/providers/cursor/` (`mod.rs`, `provider.rs`, `enrichment.rs`)
- Modify: `packages/desktop/src-tauri/src/acp/providers/mod.rs`
- Modify: `session_converter/` cursor paths + any parser-side cursor helpers (import the module's shared normalizer)

**Approach:** Move `cursor.rs` → `cursor/provider.rs`, `cursor_session_update_enrichment.rs` → `cursor/enrichment.rs`; hoist any duplicated edge helper into the module root; write the edge-map header. `mod.rs` re-exports preserve public names.
**Test scenarios:**
- U1 pins green unchanged (primary gate).
- Boundary suites green: `provider_conformance.rs`, `provider_composition_boundary.rs`.

**Verification:** `ls src-tauri/src/acp/providers/` shows no `cursor_*.rs` side-files; `rg` finds exactly one definition site per shared cursor helper.

### U3. Fan out the shape to the remaining providers

**Goal:** Consistent homes across Claude Code, Copilot, OpenCode, Codex (Custom/Forge by size judgment).
**Requirements:** R1, R3
**Dependencies:** U2
**Files:**
- Create: `packages/desktop/src-tauri/src/acp/providers/{claude_code,copilot,opencode,codex}/` directories
- Modify: `packages/desktop/src-tauri/src/acp/providers/mod.rs`

**Approach:** Mechanical, one provider per commit where practical: provider impl + catalog + settings files move under their directory; edge-map headers written per provider (most have fewer live edges than Cursor — say so explicitly in the header rather than padding). Land Claude Code first (largest catalog surface), then Copilot/OpenCode/Codex.
**Test scenarios:**
- Test expectation: none new — file moves with re-exports; full provider and parser suites are the regression net.

**Verification:** Every provider resolves from one directory (or one deliberate single file for thin ones); `cargo clippy` + full suite green.

### U4. Clearance and durable capture

**Goal:** Keep the homes honest.
**Requirements:** R2, R3
**Dependencies:** U3
**Files:**
- Modify: `CONTEXT.md` (sharpen the Adapter entry: one module home per provider, edge map convention)
- Modify: `docs/solutions/integration-issues/2026-04-30-cursor-acp-tool-call-id-normalization-and-enrichment-path.md` (note the structural fix)

**Approach:** Grep clearance for provider-named files outside provider directories; update glossary and the motivating learning doc.
**Test scenarios:**
- Test expectation: none — documentation and clearance unit.

**Verification:** Clearance grep clean; docs updated.

**Clearance (U4, 2026-06-11):** From repo root, no provider-named `.rs` files under `acp/providers/` outside their directory homes:

```bash
rg --files -g '*claude_code*.rs' packages/desktop/src-tauri/src/acp/providers/ | rg -v '/claude_code/'
rg --files -g '*cursor*.rs'     packages/desktop/src-tauri/src/acp/providers/ | rg -v '/cursor/'
rg --files -g '*copilot*.rs'    packages/desktop/src-tauri/src/acp/providers/ | rg -v '/copilot/'
rg --files -g '*opencode*.rs'   packages/desktop/src-tauri/src/acp/providers/ | rg -v '/opencode/'
rg --files -g '*codex*.rs'      packages/desktop/src-tauri/src/acp/providers/ | rg -v '/codex/'
```

Result: **clean** (zero leaks). Deliberate carve-outs at `acp/providers/` root: `custom.rs`, `forge.rs`, `mod.rs`, plus shared `fixtures/` for catalog tests. Ingress parsers (`acp/parsers/*_parser.rs`), reconciler tables (`acp/reconciler/providers/`), and converters (`session_converter/`) remain separate homes per R5; edge maps in each provider `mod.rs` point to them.

---

## System-Wide Impact

- **Plans 001 / 009** — hard predecessors (identity threading; classification-table home). This plan's U1 re-checks their landed shapes.
- **Parsers and converters** — `use`-path changes only; behavior pinned in U1.
- **Future providers** — the directory shape plus edge-map header becomes the onboarding checklist.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| File moves hide a behavior change in review | Move-only commits separated from helper-hoisting commits; U1 pins gate both |
| A converter keeps a private copy of a normalizer | U2 explicitly hunts duplicates per helper; idempotence pins catch drift |
| 009's outcome moves classification tables differently than assumed | R5 keeps tables out of scope; U1 re-scopes against 009's landed state |
| Speculative-tier overreach (ceremony for thin providers) | Size-judgment carve-out for `custom.rs`/`forge.rs`; cohesion over uniformity |

---

## Sources & References

- Architecture review 2026-06-11 run 2, candidate 7
- `docs/solutions/integration-issues/2026-04-30-cursor-acp-tool-call-id-normalization-and-enrichment-path.md` (motivating incident)
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md`
- Related plans: `2026-06-11-001`, `2026-06-11-009` (hard predecessors)
