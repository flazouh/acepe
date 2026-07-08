---
date: 2026-07-03
topic: god-startup-snapshot
---

# GOD Startup Snapshot — Instant Shell State at First Paint

## Problem Frame

Acepe's webview boots with empty stores and hydrates them asynchronously. Nothing in the architecture forbids rendering before hydration, so first paint can observe "async empty" state and make wrong, sticky decisions from it.

Verified instance (2026-07-03): `EmptyStates` mounts before `projectManager.loadProjects()` runs (projects load in the initialization manager's *background* phase, after `initializationComplete` flips true). Its `onMount` sees `projects.length === 0` and latches `projectImportFlowActive = true` — a one-way latch reset only after a manual import completes. Result: users with 4+ imported projects (visible in the sidebar, same `projectManager.projects` list) are stuck on the "Choose a project to start" import chooser (`packages/desktop/src/lib/components/main-app-view/components/content/empty-states.svelte`, `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`).

This is a *class* of bugs, not one bug: any component that reads store state at mount can capture the un-hydrated snapshot. A stale-while-revalidate mitigation already exists but is ad hoc — six independent `localStorage` hot caches (projects, workspace, settings, splash-seen, composer machine, session connection), each hand-rolled in TypeScript, none guaranteed to hydrate before first render. Truth lives downstream, per-domain, unguaranteed — the anti-GOD shape.

Target: one canonical, Rust-owned **Startup Snapshot** of shell state that is synchronously available to the webview at first paint. Reading it costs well under 1ms (in-memory), so the UI never has an "async empty" frame; background revalidation reconciles afterwards. Startup becomes structurally incapable of this bug class.

```
Today:   webview boots → stores empty → first paint (wrong) → async invokes → hydrate → repaint
Target:  Rust composes snapshot → injected before app JS runs → stores hydrate synchronously
         → first paint (correct, <1ms state read) → background revalidation reconciles
```

## Requirements

**Canonical Startup Snapshot (Rust-owned)**

- R1. Rust owns a single canonical Startup Snapshot covering full shell state: imported projects registry, session cold index (sidebar list), workspace/panel restoration state, and user settings/preferences needed for first paint.
- R2. The snapshot is the only startup source for this state. The six ad-hoc TypeScript `localStorage` hot caches for shell state are retired, not wrapped.
- R3. Snapshot content is canonical facts (Acepe-owned ids, canonical ordering), consistent with the GOD gate — no provider quirks, no TS-side repair.
- R4. "Startup Snapshot" is added to `CONTEXT.md` as a glossary concept, and this data path is GOD-gated.

**First-Paint Guarantee**

- R5. The snapshot is synchronously readable by the webview before any application JS executes (delivered with webview creation, not fetched by it).
- R6. No frame ever renders shell UI from un-hydrated state: first render already reflects the snapshot. Reading the snapshot at first render completes in under 1ms (in-memory read, no IPC round-trip, no disk read on the render path).
- R7. Cold start with an empty/missing/corrupt or schema-mismatched snapshot degrades safely: the app boots via the current async path with an explicit "hydrating" UI state — never by silently rendering empty data as truth.

**Hydration Discipline (make "not loaded" unrepresentable)**

- R8. Stores expose data-shaped state (e.g. `projects: Project[]`) only after hydration. Pre-hydration reads are impossible by construction (type/lifecycle), so "latch on empty at mount" cannot be written again.
- R9. UI logic must distinguish "empty because truly empty" from "not yet known". Empty-state UI (like the project chooser) may only key off canonical emptiness.
- R10. The `projectImportFlowActive` latch is removed or re-derived from canonical state; the chooser condition becomes purely reactive to hydrated project count plus explicit user intent to import.

**Freshness & Revalidation**

- R11. Rust keeps the persisted snapshot fresh via write-through on canonical mutations (project import/remove/reorder, session create/archive, workspace layout changes, settings changes) — not via periodic rebuilds.
- R12. After first paint, background revalidation reconciles the snapshot against durable storage/scans using existing event paths; discrepancies update the UI in place without full re-render or navigation reset.
- R13. Snapshot staleness is bounded and observable: the app can tell (and log) when first paint used a stale snapshot and what changed on reconcile.

**Observability & Acceptance**

- R14. Startup emits simple measurable marks: snapshot-read duration, first-paint-hydrated (boolean), time-to-first-correct-paint, reconcile-delta count. These make the sub-1ms budget and "no async-empty frame" claims testable.
- R15. The verified chooser bug becomes the acceptance case: with ≥1 imported project, the "Choose a project to start" chooser can never appear at startup — proven by a red test written at the real seam before the fix (per repo TDD protocol).

## Success Criteria

- With imported projects and sessions, first paint shows the correct shell (sidebar projects, sessions, restored workspace) with zero empty-state flash — verified by the R14 marks and live QA.
- Snapshot read at first render measures < 1ms; no startup IPC round-trip is on the first-paint critical path for shell state.
- The chooser-latch bug is impossible: its red test passes, and the latch code path is gone.
- All six ad-hoc shell hot caches are deleted; grep shows no `localStorage` shell-state caches remaining.
- Kill-class check: a new component reading shell stores at mount cannot observe un-hydrated state (enforced by R8's typing/lifecycle, demonstrated by test).

## Scope Boundaries

- **Not** transcript/session *content*: the snapshot carries the session cold index (list metadata), not transcript bodies, tool operations, or hot session state — those keep their existing GOD paths (session open snapshot, viewport buffers).
- **Not** process/webview boot-time optimization: OS process spawn, WebKit init, and bundle load are out of scope; "sub-1ms" applies to state availability at first render, not cold-boot wall clock.
- **Not** provider connect/resume: agent reconnection stays background work per the instant-interaction-paths requirements (R16–R18 there already demand cached-over-empty; this work makes startup structurally obey them).
- **Not** multi-window generalization beyond the main window (may be noted in planning, not required for v1).

## Key Decisions

- **Rust-owned snapshot injected before app JS, over formalizing the TS localStorage tier**: the localStorage tier keeps truth downstream, per-domain, and unguaranteed — fencing the bug class instead of killing it. Moving composition upstream into Rust is the GOD-compliant deepening. (Alternative A rejected as symptom-fencing.)
- **"Not loaded" made unrepresentable (R8) rather than policed by convention**: conventions decay; types and lifecycle gates don't. This is what makes the fix a class-kill.
- **Full shell scope in v1** (user decision, 2026-07-03): projects + session cold index + workspace restoration + settings. Partial coverage would leave the same bug class alive in uncovered domains.
- **Write-through freshness over rebuild-on-quit**: crash-safe by construction; a snapshot that's only written on clean exit is stale exactly when users notice.

## Dependencies / Assumptions

- Builds on existing canonical Rust state (projects storage, session registry/cold scan, workspace persistence) — the snapshot composes what Rust already owns; it does not invent new truth.
- Assumes a Tauri mechanism to deliver data to the webview before app JS runs (initialization script or equivalent). Verified available in Tauri 2 at the API level; exact transport is a planning decision.
- The existing `2026-05-07-instant-interaction-paths` requirements remain in force; this document is the startup-specific structural enforcement of its R16–R18.

## Outstanding Questions

### Resolve Before Planning
- (none)

### Deferred to Planning
- [Affects R5][Technical] Exact transport: Tauri initialization script injecting serialized state vs. synchronous custom-protocol read at boot; size limits and serialization cost at realistic project/session counts.
- [Affects R1][Technical] Snapshot schema + versioning strategy (schema hash vs. version int) and the R7 mismatch → safe-degrade path.
- [Affects R8][Technical] Store lifecycle mechanics in Svelte 5 for unrepresentable pre-hydration state (construction-time hydration vs. gated store accessors) without violating the no-`$effect` convention.
- [Affects R11][Technical] Enumerate all canonical mutation points needing write-through; decide debounce/coalescing.
- [Affects R12][Needs research] Reconcile strategy when disk truth diverges from snapshot (e.g. sessions deleted externally) — reuse of the existing startup-scan placeholder-reconciliation path.
- [Affects R14][Technical] Where startup marks live (Rust tracing vs. `performance.mark`) and how QA asserts them.

## Next Steps
-> `/ce:plan` for structured implementation planning (Deep plan posture per repo rules; `god-architecture-check` gate applies to the implementation).
