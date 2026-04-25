---
title: Refactor tool result normalization boundary
type: refactor
status: active
date: 2026-04-15
---

# Refactor tool result normalization boundary

## Overview

Move tool result interpretation out of UI projections and into a canonical ACP/store-layer normalization boundary. The store should retain raw tool payloads for debugging and replay fidelity, but all result-bearing tool surfaces should consume typed normalized results instead of reparsing `toolCall.result` in scene mappers and components.

## Problem Frame

Acepe’s current architecture still lets raw provider/runtime result shapes leak above the store boundary. `tool-call-manager.svelte.ts` preserves mostly raw `result`/`rawOutput`, while execute, search, browser, fetch, and web search surfaces re-interpret those raw payloads in scene adapters and detail components. The recent `pwd` bug is the concrete symptom: the runtime emitted an execute completion as `{ content, detailedContent }`, but the execute UI path did not treat that shape as canonical stdout until presentation-layer parsing was patched.

The deeper problem is ownership. Tool result semantics currently live in multiple places instead of one canonical read model. That conflicts with the codebase’s existing direction: provider/runtime quirks should stay below UI projections, and shared surfaces should read typed, canonical state rather than infer meaning from transport-shaped payloads.

## Requirements Trace

- R1. Tool result normalization must happen once below the UI boundary, not separately in scene mappers and tool components.
- R2. The store must preserve raw tool results for debugging, replay fidelity, and future parsers.
- R3. Execute tool rows must consume canonical normalized stdout/stderr/exitCode data instead of reparsing ad hoc payload shapes.
- R4. Other result-bearing tool surfaces that currently parse raw result payloads (`search`, `fetch`, `web_search`, `browser`) must consume canonical normalized results from the same boundary.
- R5. The refactor must preserve existing UX and status behavior while reducing duplicated parsing logic and transport-shape leakage.

## Scope Boundaries

- No Rust ACP wire-format changes; the frontend/store layer adapts to the existing payload contract.
- No transcript or agent-panel visual redesign; this is a data-ownership refactor, not a UI redesign.
- Do not remove raw `toolCall.result`; keep it available for debugging, serialization, and fallback handling.
- Do not force normalization for low-value tool kinds that already render raw or file-path-centric data without custom result parsing.
- **`tool-call-task.svelte` children rendering is explicitly out of scope.** Task-tool children arrive pre-assembled as nested `ToolCall` objects; Unit 4's goal of removing raw result parsing excludes `task` children. Their rendering retains raw result access until a dedicated recursive normalization phase. Unit 4 test scenarios must not assert on task child rendering.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts` already owns canonical tool-call lifecycle mutation and is the correct write-path seam for attaching normalized read data.
- `packages/desktop/src/lib/acp/store/operation-store.svelte.ts` and `packages/desktop/src/lib/acp/store/operation-association.ts` establish the repo’s preferred pattern: keep canonical domain ownership below UI projections, then let multiple surfaces read the same answer.
- `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts` currently reparses raw execute/search/fetch/web-search result payloads during view-model mapping.
- `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts` and multiple `tool-call-*.svelte` components still interpret raw `toolCall.result` directly.
- `packages/desktop/src/lib/acp/components/tool-calls/tool-call-execute/logic/parse-tool-result.ts`
- `packages/desktop/src/lib/acp/components/tool-calls/tool-call-search/logic/parse-grep-output.ts`
- `packages/desktop/src/lib/acp/components/tool-calls/tool-call-web-search/logic/parse-web-search-result.ts`
- `packages/desktop/src/lib/acp/components/tool-calls/browser-tool-display.ts`

### Institutional Learnings

- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` — canonical ownership belongs below the UI boundary; transcript and queue-style surfaces should read shared resolved state instead of reimplementing matching logic.
- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` — runtime/provider semantics must travel in explicit typed contracts rather than being reconstructed from presentation data or local heuristics.

### External References

- None. The codebase already has strong local patterns for this class of refactor.

## Key Technical Decisions

- Add a typed `normalizedResult` field to the local `ToolCall` model rather than mutating the generated Specta payload shape. This keeps normalization frontend-owned while preserving the original adapter contract.
- Introduce a store-layer tool result normalizer service/registry keyed by canonical tool kind. The registry owns all result-shape interpretation for supported kinds.
- Preserve raw `toolCall.result` alongside `normalizedResult`. Raw payloads remain the debugging and serialization source of truth; normalized results become the read model for projections and components.
- Normalize only result-bearing tool kinds that currently require interpretation (`execute`, `search`, `fetch`, `web_search`, `browser`) in this phase. Leave straightforward tools on raw results until they need richer semantics.
- Scene adapters and tool components should consume `normalizedResult` only. Parsing helpers may remain as implementation details of the normalizer layer, but not as dependencies of UI mapping/rendering.
- **Normalized contract must be domain-shaped, not UI-shaped.** Field names and structure follow domain semantics (e.g. `stdout`, `exitCode`, `matchFiles`) not component prop names. Scene adapters are responsible for the domain→prop mapping; the normalized type must not be co-designed with any particular component's interface.
- **`fetch` and `browser` normalization are explicitly in scope.** `fetch` results expose `responseBody` and HTTP metadata. `browser` results expose `content`, `screenshotUrl`, and action outcome. Both must be covered in Unit 1 type design and Unit 4 component migration. Traceability to R4 is explicit.
- **`fetch` has no existing parser module.** Unit 1 must author `parse-fetch-result.ts` from scratch. There is no existing logic to migrate; the domain contract (`responseBody`, `statusCode`, HTTP headers metadata) must be designed and implemented as new code.
- **Phased landing.** Units 1 and 2 (types + store wiring) are the first releasable phase. Units 3 and 4 (scene/component migration) are the second phase. Neither phase should be merged unless all its units are green and type-checked.
- **`normalizedResult` incremental update merge rule.** When an incremental (non-terminal) tool update arrives, `normalizedResult` must only be recomputed when the authoritative raw result field changes. If the update carries no `result` field, the existing `normalizedResult` must be preserved. Clearing or overwriting a valid `normalizedResult` with `null` on a partial update is a defect. Unit 2 must have a test case for this exact scenario.

## Open Questions

### Resolved During Planning

- **Should this refactor replace raw tool results entirely?** No. Keep raw results and add a parallel normalized read model.
- **Where should normalization happen?** In the ACP/store-layer tool lifecycle, specifically on tool create/update paths owned by `tool-call-manager.svelte.ts`.
- **Should this start with execute only?** No. The seam should be introduced generically now, then applied to the currently parsed result-bearing tool kinds in the same refactor so result ownership stops leaking upward immediately.
- **Should parsers remain as component-layer modules or move to the normalizer layer?** Move. Parser helpers (`parse-tool-result.ts`, `parse-grep-output.ts`, `parse-web-search-result.ts`, `browser-tool-display.ts`) become implementation details of the normalizer service and must not be imported from UI mapping or rendering code. Their existing module paths may be preserved for incremental migration, but the public consumers after migration must be the normalizer only.
- **Does the normalized contract risk becoming UI-shaped?** Yes, if field names are chosen to match what the shared Svelte components expect. Fields must be domain-named (e.g. `stdout`, `exitCode`, `matchFiles`, `resultCount`, `summary`, `links`) and must not be named after component props. Scene adapters and components map domain fields to props; they must not have domain fields renamed to match their own prop names.
- **Should the refactor land in a single unit or phased?** Phased. Unit 1 (types/registry) and Unit 2 (store wiring) land first and are independently releasable. Units 3 and 4 (scene/component migration) follow only after Units 1 and 2 are merged and green. This limits blast radius if Unit 3/4 needs more iteration.

### Deferred to Implementation

- **Exact type layout for `NormalizedToolResult` unions.** The plan fixes the ownership boundary, but exact field factoring can be tuned while touching the code.
- **Recursive `taskChildren` normalization.** `tool-call-task.svelte` children are explicitly excluded from Units 1–4 scope (see Scope Boundaries). A follow-up phase will address normalization of nested task children once the boundary pattern is established for the five targeted tool kinds.
- **`tool-kind-ui-registry.ts` helper adapter layer.** After Unit 3 migration, the `search` title function in `tool-kind-ui-registry.ts` (which currently reads `numFiles` from raw result) should also move to normalized reads. This is included in Unit 3 scope (see Unit 3 Files). Whether a shared helper adapter is needed for the remaining raw-title/subtitle fields is deferred to implementation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart LR
    A[Session update / tool_call_update] --> B[ToolCallManager]
    B --> C[Tool result normalizer registry]
    C --> D[ToolCall.result (raw)]
    C --> E[ToolCall.normalizedResult]
    E --> F[Scene mapper / tool registry]
    E --> G[Tool detail components]
    D --> H[Debugging / fallback / replay fidelity]
```

Normalization becomes a canonical store concern. Presentation layers stop asking "what does this raw payload mean?" and instead ask "what normalized result does this tool have?"

## Implementation Units

- [ ] **Unit 1: Introduce canonical normalized tool result types and registry**

**Goal:** Define a typed normalized-result read model for parsed tool kinds and a single normalization service that owns raw-payload interpretation.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src/lib/acp/types/normalized-tool-result.ts`
- Create: `packages/desktop/src/lib/acp/store/services/tool-result-normalizer.ts`
- Create: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-fetch/logic/parse-fetch-result.ts` *(new file — no existing module; authored from scratch)*
- Create: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-fetch/logic/__tests__/parse-fetch-result.test.ts` *(fetch normalizer contract: raw response body + status → `responseBody`/`statusCode`/headers metadata; malformed fallback)*
- Modify: `packages/desktop/src/lib/acp/types/tool-call.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-execute/logic/parse-tool-result.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-search/logic/parse-grep-output.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-web-search/logic/parse-web-search-result.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/browser-tool-display.ts`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-execute/logic/__tests__/parse-tool-result.test.ts` *(Unit 1 scope: execute normalizer contract — `{ content, detailedContent }` and string envelope → `stdout`/`stderr`/`exitCode`)*
- Test: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-search/logic/__tests__/parse-grep-output.test.ts` *(Unit 1 scope: search normalizer contract — raw grep output → structured matches/files)*
- Create: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-web-search/logic/__tests__/parse-web-search-result.test.ts` *(web search normalizer contract: raw result → `summary` + `links`; null/malformed fallback)*

**Approach:**
- Define a discriminated union for normalized result-bearing tool kinds (`execute`, `search`, `fetch`, `web_search`, `browser`) plus a narrow fallback for unsupported/raw cases.
- Reuse existing parser logic as implementation detail inside the new normalization service instead of calling those parsers from presentation code.
- Extend the local `ToolCall` type with `normalizedResult?: NormalizedToolResult | null`, mirroring the existing local-only enrichment pattern used for progressive arguments and normalized todos/questions.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/operation-store.svelte.ts`
- `packages/desktop/src/lib/acp/store/operation-association.ts`
- `packages/desktop/src/lib/acp/types/tool-call.ts`

**Test scenarios:**
- Happy path — execute results with raw string envelopes normalize to `stdout`, `stderr`, and `exitCode`.
- Happy path — execute results shaped as `{ content, detailedContent }` normalize identically to string envelopes.
- Happy path — grep/search result objects normalize into structured matches/files without UI-specific reparsing.
- Happy path — web search results normalize into summary + links.
- Edge case — empty or null raw result yields `normalizedResult: null` without losing the raw payload.
- Error path — malformed structured results fall back predictably without throwing or dropping the tool entry.

**Verification:**
- A single normalizer entry point can derive typed results for all targeted tool kinds using only canonical tool kind plus raw payload.

- [ ] **Unit 2: Attach normalized results to canonical tool lifecycle state**

**Goal:** Populate `normalizedResult` at tool create/update time so the store becomes the canonical read owner for parsed tool semantics.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts` *(type propagation: holds `ToolCall[]` — TS needs the extended type annotation to flow through; no normalization logic added here)*
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts` *(type propagation: same reason as session-entry-store)*
- Modify: `packages/desktop/src/lib/acp/store/services/__tests__/tool-call-manager.test.ts` *(Unit 2 scope: store lifecycle assertions — normalized result populated on create/update, preserved on incremental updates with no result field, cleared correctly on terminal reset)*
- Modify: `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts`

**Approach:**
- On tool create/update, derive `normalizedResult` from canonical tool kind plus the authoritative raw result chosen by the manager (`update.result`, `update.rawOutput`, or content fallback).
- Preserve raw `toolCall.result` exactly as today; attach normalized data in parallel and refresh it whenever result-bearing updates arrive.
- **Merge rule for incremental updates:** Only recompute `normalizedResult` when the incoming update changes the authoritative raw result field. If the update carries no `result` field, preserve the existing `normalizedResult` unchanged. Never clear `normalizedResult` on a partial streaming update.
- **Preload hydration is a Unit 2 hard prerequisite for Phase 2.** When sessions are loaded from persisted history via `storeEntriesAndBuildIndex`, normalized results must be recomputed from the stored raw payload on load. The normalizer service is called with the same raw payload as on live updates. Unit 3 must not merge until a Unit 2 test verifies that the preload/restore path produces the same `normalizedResult` as a live update for targeted tool kinds.
- Ensure terminal and replayed tool updates produce the same normalized state so resumed sessions and live sessions behave identically.

**Execution note:** Start with failing store-level tests that prove normalized results are populated from `tool_call_update` payloads before wiring the manager changes.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts`
- `packages/desktop/src/lib/acp/store/__tests__/operation-store.vitest.ts`
- `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`

**Test scenarios:**
- Happy path — a completed execute tool update stores both raw result and normalized execute fields.
- Happy path — tool creation from update-only flows (missing initial `toolCall`) still gets normalized result data.
- Edge case — streaming-only (incremental) updates do not recompute `normalizedResult` when `result` field is absent; existing `normalizedResult` is preserved.
- Edge case — result enrichment updates replace stale normalized data without regressing status.
- Integration — replayed/resumed session updates rebuild the same normalized tool state as live updates. **(Gate for Unit 3 merge.)**

**Verification:**
- Any `ToolCall` read from the store for targeted tool kinds exposes normalized result data without a presentation layer having to parse raw payloads.

- [ ] **Unit 3: Migrate shared scene mapping and tool registry to normalized reads**

**Goal:** Remove result parsing from shared scene/registry projection paths and make them consume canonical normalized results only.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts`
- Modify: `packages/desktop/src/lib/acp/registry/tool-kind-ui-registry.ts` *(the `search` title function currently reads `numFiles` from raw result; migrate to `normalizedResult`; note: `glob` is out of scope as it is not a targeted tool kind)*
- Modify: `packages/ui/src/components/agent-panel/types.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/build-agent-tool-entry.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.test.ts`

**Approach:**
- Replace direct calls to raw-result parsers in scene/registry code with reads from `toolCall.normalizedResult`.
- Keep projection-layer logic focused on mapping canonical domain fields to shared UI props.
- If necessary, add small narrowing helpers at the projection layer, but keep them type-only; they must not inspect raw payload structure.
- **`tool-definition-registry.ts` status guard scope:** When migrating result-parsing in this registry, update only the result-shape interpretation for the five targeted tool kinds (`execute`, `search`, `fetch`, `web_search`, `browser`). Do NOT change the `toolCall.result !== null` status-inference guard used for non-targeted kinds. For migrated kinds, extend the guard to `toolCall.result !== null || toolCall.normalizedResult !== null` to avoid breaking status display for any tool that has raw result but no `normalizedResult`.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts`
- `packages/ui/src/components/agent-panel/types.ts`

**Test scenarios:**
- Happy path — shared execute entries are built from normalized stdout/stderr/exitCode.
- Happy path — search/fetch/web-search/browser scene entries are built from normalized data without raw-result parsing.
- Edge case — tools with no normalized result still render stable titles/subtitles and do not crash projections.
- Integration — the agent panel scene receives the same typed execute/search/browser/fetch/web-search data regardless of whether the session is live or restored.

**Verification:**
- Shared scene and registry code no longer import raw-result parser helpers for the migrated tool kinds.

- [ ] **Unit 4: Migrate desktop tool detail components and harden boundary tests**

**Goal:** Remove remaining raw-result interpretation from desktop tool components for migrated tool kinds and add regression tests that lock the boundary in place.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** Unit 3

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-execute.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-search.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-fetch.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-web-search.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-browser.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-execute/components/execute-tool-ui.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-execute/components/execute-tool-content.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-definition-registry.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-search/logic/__tests__/parse-grep-output.test.ts` *(Unit 4 scope: boundary invariant tests — search normalizer import path is tool-normalizer-layer only, not used directly from component)*
- Modify: `packages/desktop/src/lib/acp/store/services/__tests__/tool-call-manager.test.ts` *(Unit 4 scope: integration assertions — end-to-end flow from raw update → normalized store state → component reads normalized data)*

**Approach:**
- Move desktop components to render from `normalizedResult`, using raw `result` only as an explicit fallback for unsupported or not-yet-migrated kinds.
- Tighten tests around the architectural invariant: result-shape interpretation belongs to the normalizer boundary, not to UI projections/components.
- Preserve current UX details (collapsed output, result summaries, browser details text) while changing only where those values are computed.

**Patterns to follow:**
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`
- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`

**Test scenarios:**
- Happy path — a fresh `pwd` execute row displays stdout from normalized execute data.
- Happy path — browser/fetch/web-search components render the same content as before using normalized inputs.
- Edge case — unsupported result shapes fall back safely without blanking the tool row.
- Error path — failed execute/search results still surface error output and status consistently.
- Integration — live Tauri transcript rendering shows execute output after a real tool completion without presentation-layer parsing of `{ content, detailedContent }`.

**Verification:**
- Migrated desktop tool components no longer parse raw result payload structure directly for supported tool kinds, and end-to-end UI behavior remains unchanged.

## System-Wide Impact

- **Interaction graph:** `ToolCallManager` remains the canonical mutation owner; scene mappers, tool registry, desktop tool components, transcript rendering, and restored-session projections become pure readers of store-owned normalized data.
- **Error propagation:** Normalizer failures must degrade to `normalizedResult: null` or a narrow fallback instead of throwing through transcript rendering paths.
- **State lifecycle risks:** Tool updates can arrive incrementally, out of order, or replayed after resume; normalized results must track the same authoritative raw result lifecycle as `toolCall.result`.
- **API surface parity:** Shared agent panel scene models and desktop detail components must agree on execute/search/fetch/browser/web-search semantics after the refactor.
- **Integration coverage:** Live session updates, replayed history, and Tauri transcript rendering all need coverage so the normalized boundary works across both streaming and restored surfaces.
- **Unchanged invariants:** Canonical tool kind routing, raw result preservation, tool status computation, and existing UI visuals remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Normalized results drift from raw results during incremental updates | Derive normalized data only in the tool lifecycle manager from the same authoritative raw payload chosen for `toolCall.result` |
| Refactor widens scope into a whole-transcript model rewrite | Keep the change bounded to tool result ownership; do not redesign non-result-bearing tool kinds or transcript structure |
| Shared scene and desktop detail paths diverge during migration | Migrate both to the same `normalizedResult` contract in the same refactor and lock parity with shared tests |
| Unsupported payload shapes become invisible | Preserve raw result and implement explicit fallback behavior when normalization returns null |

## Documentation / Operational Notes

- If the refactor lands cleanly, capture the pattern in `docs/solutions/` as a follow-up learning: canonical tool result normalization belongs below projections, mirroring the existing operation/interaction association guidance.

## Sources & References

- Related code: `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts`
- Related code: `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts`
- Institutional learning: `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`
- Institutional learning: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
