---
status: active
type: refactor
created: 2026-06-08
god_gate: cleared
---

# refactor: Decompose the SessionStore god class into composed sub-stores

Continuation of the session-store decomposition. The **helper layer is done** (7 modules extracted, 5,409 → 3,997 LOC — see commits on `refactor/scene-mapper-decomposition`). What remains is the `SessionStore` class itself (~3,130 LOC, 141 methods, `packages/desktop/src/lib/acp/store/session-store.svelte.ts`) implementing `SessionEventHandler` / `ISessionStateReader` / `ISessionStateWriter`.

This is **not** a mechanical function-extraction (those are exhausted). It is a **structural decomposition of a canonical reactive store** — and therefore a deliberate, GOD-gated, test-net-guarded effort, not a deep-context sweep.

---

## Why a plan (not just more extraction)

The class's reactive state (`sessions`, `liveSessionSyncReferences`, `sessionPaletteReferences` `$state` + per-session projection Maps) is read/written by `this`-bound methods. You cannot relocate those methods into free-function modules without either threading state through every call or breaking encapsulation. The only safe, behavior-preserving decomposition is **extracting cohesive sub-domains into composed sub-stores** that own their slice of state, with `SessionStore` holding instances and delegating.

This is the same pattern that worked for the agent-panel controller (reactive clusters → testable controllers): the parent keeps a thin orchestration surface; each sub-store owns + tests its state.

---

## GOD invariants (gate cleared on the file; these must hold per sub-store)

1. The `CanonicalSessionProjection` stays the **single source of truth** — sub-stores own disjoint slices; no field is owned by two stores, no `canonical ?? hot` fallback, no dual-write.
2. Envelope-router authority preserved: canonical lifecycle/activity/turnState/capabilities continue to flow Rust → envelope → projection. Sub-stores read canonical facts only.
3. No transcript-order repair, no provider branching, no raw-id-as-identity introduced.

---

## Sub-domains (extraction order — least-coupled first)

| # | Sub-store | Owns | ~Methods | Risk |
|---|-----------|------|----------|------|
| 1 | **SessionListState** | `sessions`, `liveSessionSyncReferences`, `sessionPaletteReferences` `$state` + list CRUD / reference rebuilds | ~15 | low — disjoint from per-session projection; ~38 internal read sites |
| 2 | **ViewportProjectionState** | viewport buffer projections, scroll-correction, attachment status (per-session Maps) | ~12 | low — already a clear sub-API (`getTranscriptViewportBufferProjection`, `recoverViewportAttachment`, …) |
| 3 | **SessionExportService** | markdown/json export (already uses extracted `sessionExportContentError`) | ~4 | low — read-only |
| 4 | **CapabilityProjectionState** | per-session capability projection (uses extracted `sanitizeCanonicalCapabilities`, `projectGraphCapabilities`) | ~10 | medium |
| 5 | **SessionProjectionCore** | the per-session `CanonicalSessionProjection` Maps + envelope `applyXxx` handlers | ~60 | **high** — the canonical heart; do last, its own sub-plan |
| — | `SessionStore` (residual) | composition + the public `ISessionStateReader/Writer` facade delegating to the above | thin | — |

---

## Mechanical recipe (per sub-store, one PR each)

1. Create `<sub-store>.svelte.ts` with a class owning the slice's `$state`/Maps + the moved methods (bodies verbatim).
2. In `SessionStore`: replace the moved `$state` with `readonly #<x> = new <SubStore>(deps)`; deps are accessor closures for any cross-slice reads (mirror `AgentPanelSessionController`'s accessor-dep pattern).
3. Rewrite internal call sites (`this.sessions` → `this.#list.sessions`, etc.).
4. Keep the public `ISessionStateReader/Writer` method on `SessionStore` as a one-line delegation (preserves the external contract + the 41 consumer files).
5. Verify: `bun run check` 0 → `session-store-*.test.ts` (bun, deterministic) + store vitest **parity at 503 pass / 6 pre-existing env fails** → commit.

---

## Test net (already baselined)

- Deterministic: `session-store-snapshot-merge.test.ts`, `session-store-transcript-delta.test.ts` (13 pass).
- Behavioral: `session-store-*.vitest.ts` (create-session, projection-state, rename, pr-linking, capabilities-revision, token-stream, cancel-streaming) — **503 pass**; 6 pre-existing env failures (rate-limit/auth/suite-load) confirmed identical on `main`, so any new failure is a real regression.
- Per sub-store, add a focused unit test (construct with stub deps, assert the slice's behavior) — the sub-store pattern makes this finally possible (the logic was untestable inside the monolith).

---

## Sequencing / risk note

Units 1–4 are independently landable, low/medium risk, and meaningfully shrink the class. **Unit 5 (SessionProjectionCore) is the canonical heart** — it should get its own GOD re-gate and likely its own plan; it is the one place a mistake corrupts session/transcript rendering. Do not bundle it with 1–4.

Recommended: execute units 1–4 in a fresh, focused session (full budget, reliable depth), then plan unit 5 separately.
