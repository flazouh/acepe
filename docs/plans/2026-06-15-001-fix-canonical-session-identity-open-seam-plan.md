---
status: active
created: 2026-06-15
type: fix
depth: deep
module: acp-session-identity
tags: [god-architecture, panel-store, session-identity, canonical, open-seam, dedup]
problem_type: architecture
---

# Canonicalize agent-session identity at the panel open seam (R1)

## Problem Frame

Two top-level agent panels can end up sharing one session. Closing one panel
disconnects the shared session and leaves the survivor stuck in "loading". This
is the GOD violation behind the reported "closed g7, the g7 behind it hangs" bug.

**Confirmed root cause.** The "is this session already open?" dedup is a raw
string match on the *requested* identifier, not the canonical Acepe session id:

- `main-app-view.svelte:212` `focusOrOpenSessionPanel(sessionId)` →
  `panelStore.getPanelBySessionId(sessionId)` then `panelStore.openSession(sessionId)`.
- `panel-agent-state.svelte.ts:355` `openSession` dedups via
  `topLevelAgentPanelBySessionId.get(sessionId)` (line 359) — again the raw requested id.

The canonical id is only resolved *later*, in the hydrator:
`session-open-hydrator.ts:139` calls `updatePanelSession(panelId, found.canonicalSessionId)`
with no check that another panel already holds that canonical session.

So when a session that is already open under its canonical id `C` is opened again
under a different identifier (an alias `A` ≠ `C`):

1. `getPanelBySessionId(A)` / `openSession(A)` miss the dedup (panel A is keyed under `C`).
2. A second panel (`panel2`) is spawned.
3. The hydrator runs `updatePanelSession(panel2, C)`.
4. The 1:1 index `topLevelAgentPanelBySessionId` is rebuilt last-wins
   (`syncTopLevelAgentPanelIndex`, `panel-agent-state.svelte.ts:98-102`; also the
   silent `.set()` at `:173` and `:195`) — index[`C`] now points at `panel2`, but
   `topLevelAgentPanelList` (the render source) still contains **both** the
   original panel and `panel2`.
5. Result: two panels render for one session. Closing one disconnects the shared
   session (`panel-handler.ts:47-48` → `acp_close_session`); the survivor hangs in
   "loading".

The startup remap (`initialization-manager.ts:487-503` `remapAliasedPanelSessionIds`
+ `aliasRemaps`) exists precisely because panels can carry provider ids; it
collapses identifiers *too late* — after both panels already exist.

**GOD verdict.** Panels are TypeScript-owned UI state, but the *identity* they
key on is canonical session truth owned by Rust. The fix is to make the canonical
Acepe session id the single identity authority for panel↔session binding, resolved
*before* the open/dedup/spawn decision. This is consuming canonical facts upstream,
not repairing provider quirks downstream.

## Scope

### Stated (in scope)
- Resolve requested→canonical session id **before** the panel dedup/spawn decision
  at the open seam (`focusOrOpenSessionPanel`, `openSession`).
- Key the panel↔session binding (`topLevelAgentPanelBySessionId` and
  `updatePanelSession`) on canonical id, and make the 1:1 index a true invariant:
  binding a second panel onto an already-held canonical session must collapse to one
  panel, never silently overwrite the index while orphaning a duplicate in the list.
- Retire the late alias-remap machinery (`remapAliasedPanelSessionIds` +
  `aliasRemaps` consumption) as the steady-state collapse mechanism, replaced by a
  one-time, dedup-safe startup canonicalization that heals legacy persisted alias
  panel ids by reusing the same guarded bind.
- Verify and lock (regression test) the already-implemented promotion-on-open so a
  discovered session opened via resume gets its `sequence_id` badge.

### Inferred (in scope, follows from the above)
- A read-only canonical-identity resolver surfaced from the session store to the
  panel layer (`requestedId → canonicalId | null`), fed by the canonical
  `SessionStateGraph` (`isAlias` / `canonicalSessionId`) the store already consumes.
- Diagnostics (not silent remap) for any persisted alias that cannot be resolved to
  a canonical id at startup.

### Out of scope (explicitly rejected / deferred)
- **Downstream panel-list dedup** ("filter the render list so duplicates don't
  show"). Explicitly rejected as symptom-patching — it leaves the duplicate-birth
  producer alive.
- Reintroducing a durable `provider_session_id` / alias column on `session_metadata`
  (deliberately removed; see origin learnings below). Identity stays provider-owned.
- Building promotion-on-open — **it already exists** (see Keystone Correction).
- The ~30 pre-existing failing `panel-store` test stubs and the in-flight
  `sessionStore.read.*` / `.connection.*` wiring WIP on this branch. Pre-existing
  branch debt; not a regression from this work. New tests must be authored against
  the *current* wiring.

## Keystone Correction (read before implementing)

The pre-investigation hypothesis was "promotion-on-open is the keystone we must
build, because `acp_resume_session` never promotes." **This is stale.** Promotion
on open already exists and was committed 2026-06-14 (`5e06858a1`):

- `resume.rs:111` calls `persist_session_metadata_for_cwd` →
  `metadata.rs:39` `SessionMetadataRepository::ensure_exists_and_promote`.
- The in-code comment (`resume.rs:103-110`) states opening a discovered session
  promotes it to Acepe-managed, assigns `sequence_id`, and is idempotent for
  already-managed sessions; the freshly-assigned `sequence_id` rides the snapshot
  envelope so the badge updates live.

Consequence: this plan does **not** build promotion-on-open. It (a) verifies and
regression-tests it (IU5), and (b) centers on the panel-identity canonicalization
that the duplicate-panel hang actually needs (IU1–IU4). Promotion-on-open being in
place also guarantees the resolver in IU1 has canonical truth to read: every opened
session is canonical in Rust, and the canonical id arrives in the UI via the
snapshot `SessionStateGraph` (`resume.rs:145-160`).

## Origin / Institutional Context

Carried from `docs/solutions/` (verified relevant):

- `architectural/provider-owned-session-identity-2026-04-27.md` — canonical model is
  decided: completed `session_metadata.id` **is** the provider-owned canonical id;
  there is no steady-state alias column. The frontend already has the collapse
  primitive: `ensureSessionFromStateGraph` materializes "by `requestedSessionId`
  when `graph.isAlias`, inserting under `canonicalSessionId`"
  (`session-open-snapshot-applier.svelte.ts:205`). **Reuse this; do not build a
  parallel UI remap.** Startup alias migration is conflict-prone (unique
  `file_path`), so legacy heal must diagnose unresolved rows, not silently remap.
- `logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md` — the
  appear/disappear/reappear flicker class; warns against `canonical ?? hotState`
  fallback. Canonical identity must be present before the dedup/spawn decision so no
  window reads hot/local fallback.
- `architectural/historical-session-reconnect-frontier-2026-05-16.md` —
  `openPersistedSession` already dedups against **`canonicalSessionId`** while the
  reconnect token claim is in flight. The one-panel-per-session guarantee should
  fold into canonical-id dedup, not a separate layer.
- `architectural/canonical-projection-widening-2026-04-28.md` — `acpSessionId` is a
  sanctioned residual hot-state field "for local provider-session id mapping."
  Resolve *through* known canonical surfaces; no new alias structure.

## Correctness Argument (why resolving at the seam is sufficient)

The duplicate-panel hang *requires* the session to already be open (panel A under
canonical `C`). At the moment of the second open, the session store therefore
already holds `C` and the requested→canonical mapping (materialized via
`ensureSessionFromStateGraph` when the first open's `SessionStateGraph` arrived). So
a synchronous resolver consulted by the panel open seam *has the answer* exactly in
the failure scenario.

For a cold open where the session is not yet materialized, a discovered/new session
is canonical by definition (`requestedId == canonicalId`, `isAlias == false` —
promotion-on-open makes `session_metadata.id` the provider id), so dedup on the
requested id is already correct. The alias case only matters when the canonical
session already exists in the store — which is precisely when the resolver resolves.
This bounds the fix: no async round-trip is needed at the seam.

## Implementation Units

### IU1 — Canonical session-identity resolver (read surface)
**Goal.** Expose a synchronous, read-only `resolveCanonicalSessionId(requestedId):
string | null` from the session store, backed by the canonical identity index the
store already builds from `SessionStateGraph` (`isAlias` / `canonicalSessionId`).

**Files (implementation).**
- `src/lib/acp/store/session-open-snapshot-applier.svelte.ts` — already collapses
  alias→canonical in `ensureSessionFromStateGraph` (:205); capture the
  requested→canonical mapping here as the authority for the resolver.
- `src/lib/acp/store/session-store.svelte.ts` + the store read facade — add the
  read accessor (no new write path; consumes existing canonical state).

**Test file.** `src/lib/acp/store/__tests__/session-identity-resolver.vitest.ts`
**Scenarios.**
1. After a `SessionStateGraph` with `isAlias=true`, `requestedSessionId=A`,
   `canonicalSessionId=C` is applied, `resolveCanonicalSessionId(A) === C`.
2. `resolveCanonicalSessionId(C) === C` (canonical resolves to itself).
3. Unknown id → `null` (never throws, never fabricates).
4. A non-alias graph (`isAlias=false`) maps the id to itself.

**GOD.** Read-only projection of Rust-owned identity; no fallback, no repair.

### IU2 — Canonical-keyed dedup at the open seam
**Goal.** `focusOrOpenSessionPanel` and `openSession` resolve requested→canonical
via IU1 before the dedup/spawn decision and key on canonical id.

**Files.**
- `src/lib/components/main-app-view.svelte:212` `focusOrOpenSessionPanel` — resolve
  canonical, then `getPanelBySessionId(canonical)` / `openSession(canonical)`.
- `src/lib/acp/store/panel-agent-state.svelte.ts:355` `openSession` — dedup on the
  resolved canonical id (line 359). When the resolver returns a canonical id that
  differs from the requested id and a panel already holds it, return that panel.

**Test file.** `src/lib/acp/store/__tests__/panel-open-canonical-dedup.vitest.ts`
**Scenarios.**
1. Session open under canonical `C`; opening again under alias `A` (resolver: A→C)
   focuses the existing panel and spawns **no** second panel.
2. Opening under canonical `C` twice focuses the existing panel (regression guard
   for today's behavior).
3. Opening a genuinely new id (resolver → null) spawns exactly one panel.

### IU3 — One-panel-per-canonical bind invariant
**Goal.** Make the 1:1 index a real invariant. Binding a panel to a canonical
session that another panel already holds must collapse to one panel (keep/focus the
incumbent, dispose the duplicate) — never silently overwrite the index while
leaving a duplicate in `topLevelAgentPanelList`.

**Files.**
- `src/lib/acp/store/panel-agent-state.svelte.ts` — `updatePanelSession` (:463),
  and the index mutation seams: `syncTopLevelAgentPanelIndex` (:98-102),
  `patchTopLevelAgentPanel` (:173), `insertTopLevelAgentPanel` (:195). The bind path
  must detect an existing different panel holding the target session id and collapse
  rather than overwrite.
- `src/lib/acp/store/services/session-open-hydrator.ts:139` — the producer
  (`updatePanelSession(panelId, found.canonicalSessionId)`) routes through the
  guarded bind; when the canonical session is already bound elsewhere, the second
  panel collapses instead of orphaning a list entry.

**Test file.** `src/lib/acp/store/__tests__/panel-bind-uniqueness.vitest.ts`
**Scenarios.**
1. Panel A holds canonical `C`; `updatePanelSession(panel2, C)` collapses to one
   panel in `topLevelAgentPanelList` (no orphaned duplicate), index[`C`] stable.
2. Hydrator attaching `C` to a freshly-spawned `panel2` while A holds `C` yields one
   rendered panel for `C`.
3. Closing the surviving panel after a collapse disconnects the session exactly once
   and leaves no panel stuck in "loading" (the reported bug, asserted dead).

**GOD.** Invariant enforced on TS-owned panel state keyed by canonical Rust truth.

### IU4 — Retire late alias-remap; one-time dedup-safe startup heal
**Goal.** Remove `remapAliasedPanelSessionIds` as the steady-state collapse path.
Replace with a one-time startup canonicalization that resolves each persisted
panel's id via IU1 / the Rust startup `aliasRemaps` and binds through the guarded
IU3 bind, so legacy duplicates collapse instead of overwriting. Unresolved aliases
are logged as diagnostics, not silently remapped.

**Files.**
- `src/lib/components/main-app-view/logic/managers/initialization-manager.ts` —
  remove `remapAliasedPanelSessionIds` (:487-503) consumption at :429-438; replace
  with the one-time heal that routes through the guarded bind.
- `src/lib/acp/store/services/session-repository.ts:359-403` — the `aliasRemaps`
  producer (Rust-resolved) stays as the data source for the one-time heal; its
  consumer changes only.

**Test file.**
`src/lib/components/main-app-view/logic/managers/tests/startup-canonicalization.test.ts`
**Scenarios.**
1. Two persisted panels resolving to the same canonical id collapse to one panel at
   startup (reuse-not-create — no duplicate births).
2. A persisted alias with a known `aliasRemaps` entry binds to its canonical id.
3. A persisted alias with **no** resolution is left as-is and emits a diagnostic
   (no silent remap, no fabricated canonical id).

**Risk note.** This is the *only* place new duplicates could still arise (per origin
learnings — conflict-prone migration). The heal must reuse the IU3 guarded bind so
collapse is the only outcome; never create a panel during heal.

### IU5 — Promotion-on-open badge regression lock
**Goal.** Verify the already-present promotion-on-open assigns `sequence_id` for a
discovered session opened via resume, and lock it with a regression test (so the
duplicate-fix refactor cannot silently regress the badge).

**Files.**
- `src-tauri/src/acp/commands/session_commands/resume.rs:111`,
  `metadata.rs:31-60`, `db/repository/session_metadata.rs`
  (`ensure_exists_and_promote`, `mark_session_as_acepe_tracked`) — verify only.

**Test file.** `src-tauri/src/acp/commands/session_commands/tests.rs` (extend).
**Scenarios.**
1. Resuming a discovered (`is_acepe_managed=0`, `sequence_id=NULL`) session promotes
   it: `is_acepe_managed=1` and a per-project `sequence_id` is assigned.
2. Resuming an already-managed session is idempotent (same `sequence_id`, no leak).

## Sequencing & Dependencies

```
IU1 (resolver)
  └─> IU2 (canonical dedup)  ─┐
  └─> IU3 (bind invariant)   ─┴─> IU4 (startup heal, uses IU1 + IU3 guarded bind)
IU5 (badge regression)  — independent, can land first as a safety net
```

- IU1 is the foundation; IU2 and IU3 both depend on it.
- IU4 depends on IU1 (resolver) and IU3 (guarded bind).
- IU5 is independent; landing it first gives a regression net before the refactor.

## Execution Posture

- **TDD (bug fix).** Each IU lands its failing test first (red), then the minimal
  change to green. IU3 scenario 3 is the end-to-end characterization of the reported
  bug — write it red against current `main`/branch behavior first.
- **GOD gate.** Re-run `god-architecture-check` before implementing IU1–IU4 and
  before commit. No `canonical ?? hotState` fallback for identity; no UI repair of
  order/identity; resolver is read-only.
- **Run conventions.** `bun test ./src/...vitest.ts` (path form) with `AGENT=1`;
  `bun run check` after TS changes; `cargo test` for IU5; `cargo clippy` in
  `src-tauri/`.
- **Visual QA.** After the panel-behavior change, run the `acepe-dev-app-qa` pass
  (`bun run qa doctor` → `observe` → `inspect` on the panel selector →
  `screenshot`) and assert no duplicate panel and no stuck-loading survivor.

## Risks

1. **Startup heal as a new duplicate source (highest).** Mitigated by routing the
   heal exclusively through the IU3 guarded bind (collapse-only) and diagnosing
   unresolved aliases instead of remapping. Covered by IU4 scenarios 1 & 3.
2. **Resolver availability timing.** The correctness argument shows canonical is
   known exactly in the failure scenario; for cold opens the requested id is already
   canonical. If a future provider returns an alias on a *cold* first open, the IU3
   bind invariant still collapses the late rebind — defense in depth.
3. **Branch debt noise.** ~30 pre-existing panel-store stub failures and the
   `sessionStore.read.*` wiring WIP can mask/contaminate new test runs. Author new
   tests against current wiring; report new failures separately from the known set.
4. **Multiple index seams.** The 1:1 index is mutated in three places
   (`:98-102`, `:173`, `:195`); the invariant must hold at all three, not just the
   hydrator path. IU3 must cover each.

## Acceptance

- Opening an already-open session under any identifier (alias or canonical) never
  produces a second top-level panel.
- Closing a panel disconnects its session exactly once; no survivor hangs in
  "loading".
- A discovered session opened via resume shows its per-project `sequence_id` badge.
- `remapAliasedPanelSessionIds` no longer runs as steady-state; legacy persisted
  aliases heal once at startup with collapse-only semantics and diagnostics for
  unresolved rows.
- All new tests green; `bun run check`, `cargo clippy`, and the QA DOM pass clean.
```
