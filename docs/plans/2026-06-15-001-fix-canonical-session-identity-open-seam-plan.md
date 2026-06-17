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
on open already exists in the committed tree (the `resume.rs:111` promotion call is
present as of 2026-06-14; `git log -L` attributes the last touch to `5e06858a1`):

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

## Correctness Argument (two-layer guarantee: IU2 best-effort, IU3 authoritative)

The duplicate-panel hang *requires* the session to already be open (panel A under
canonical `C`). The fix has two layers, and **IU3 is the load-bearing guarantee**;
IU2 is a best-effort early dedup that avoids spawning the duplicate at all when the
mapping is already known.

**IU2 (seam dedup) — best-effort.** When the requested→canonical mapping for alias
`A`→`C` is already known to the resolver, the open seam focuses the incumbent and no
second panel is born. But the mapping is learned **asynchronously**: it is only
recorded once the alias open's snapshot (`SessionOpenFound` / `SessionStateGraph`
with `isAlias=true`, `requestedSessionId=A`, `canonicalSessionId=C`) has been
applied — which arrives via a Tauri round-trip / SSE, not synchronously at the first
open. A first-ever open of alias `A` while `C` is already open therefore resolves to
`null` at the seam, IU2 misses, and a second panel spawns. **IU2 cannot be relied on
to close the bug by itself.**

**IU3 (bind invariant) — authoritative.** The duplicate's late rebind to `C`
(`session-open-hydrator.ts:139` `updatePanelSession(panel2, C)`) is the single point
the second panel acquires the shared canonical id. IU3 makes that rebind collapse to
one panel regardless of how the duplicate was born. Because IU3 sits on the binding
chokepoint, it closes the bug whether the duplicate came from a runtime alias open,
the async-open window above, or the startup heal (IU4).

**Cold non-alias opens.** A discovered/new session is canonical by definition
(`requestedId == canonicalId`, `isAlias == false` — promotion-on-open makes
`session_metadata.id` the provider id), so seam dedup on the requested id is already
correct and IU3 is a no-op. The alias case is the only one that exercises IU3.

This framing replaces the earlier (incorrect) claim that the resolver always "has
the answer at the seam." It does not, and the plan does not depend on it.

## Implementation Units

### IU1 — Canonical session-identity resolver (durable alias index)
**Goal.** Expose a synchronous `resolveCanonicalSessionId(requestedId):
string | null` from the session store, backed by a **durable in-memory
alias→canonical index** that records `requestedId → canonicalId` whenever Rust
asserts an alias relationship, and **survives the collapse that removes the alias
session row**.

**Correction (do not skip).** This is a *new write path*, not a pure read over
existing state. The named-but-wrong assumption was that
`ensureSessionFromStateGraph` (`session-open-snapshot-applier.svelte.ts:205`)
already holds the mapping — it does not: it early-returns when the canonical session
already exists, and the sibling snapshot path (`replaceSessionOpenSnapshot`,
~:114-144) calls `removeSession(requestedSessionId)` on collapse (~:142-143), so the
alias row is deleted and no surviving `A→C` mapping remains for a read-only resolver.
IU1 must therefore build and persist its own index that is **not** evicted by
`removeSession(alias)`.

**Files (implementation).**
- `src/lib/acp/store/session-open-snapshot-applier.svelte.ts` — populate the
  alias index from the alias-bearing events where `isAlias` / `requestedSessionId` /
  `canonicalSessionId` are present: `replaceSessionOpenSnapshot` (~:114-144) and the
  non-early-return branches of `ensureSessionFromStateGraph`.
- `src/lib/acp/store/session-store.svelte.ts` + the store read facade — own the
  alias index and expose the read accessor.

**Index lifecycle.** Entry `A→C` is written when Rust asserts the alias. It is
invalidated only when canonical session `C` is genuinely closed/removed (not when the
alias row `A` is collapsed). A stale `A→C` pointing at a disposed panel must never be
returned — covered by scenario 5.

**Test file.** `src/lib/acp/store/__tests__/session-identity-resolver.vitest.ts`
**Scenarios.**
1. After a snapshot with `isAlias=true`, `requestedSessionId=A`,
   `canonicalSessionId=C` is applied, `resolveCanonicalSessionId(A) === C`.
2. `resolveCanonicalSessionId(C) === C` (canonical resolves to itself).
3. Unknown id → `null` (never throws, never fabricates).
4. A non-alias graph (`isAlias=false`) maps the id to itself.
5. After the alias session `A` is removed via collapse (`removeSession(A)`),
   `resolveCanonicalSessionId(A)` **still returns `C`**; after canonical `C` is
   genuinely closed, it returns `null`.

**GOD.** The index is a projection of Rust-asserted identity (`isAlias` truth),
written only from canonical events; never repairs or infers identity the backend
did not assert.

### IU2 — Canonical-keyed dedup at the open seam
**Goal.** Resolve requested→canonical via IU1 before the dedup/spawn decision and
key on canonical id. **Place the resolution inside the store methods, not at a single
caller**, so every entry point inherits it.

**Why centralize.** `focusOrOpenSessionPanel` is not the only opener. Raw
`panelStore.openSession(...)` / `materializeSessionPanel(...)` is also called from at
least: `settings/project-tab.svelte:41`, `settings-page/sections/archived-sessions-section.svelte:44`,
`main-app-view/logic/main-app-view-state.svelte.ts:693`, `session-handler.ts:108` and
`:140`, `app-queue-row.svelte:103`, and `kanban-new-session-handoff.ts:25`. Fixing
only `focusOrOpenSessionPanel` would leave the alias bug reproducible from those
surfaces. Resolving inside `openSession` / `materializeSessionPanel` covers all
callers with one change.

**Files.**
- `src/lib/acp/store/panel-agent-state.svelte.ts:355` `openSession` — resolve the
  requested id to canonical via IU1, then dedup on the canonical id (line 359). Same
  treatment for `materializeSessionPanel` (:395).
- `src/lib/components/main-app-view.svelte:212` `focusOrOpenSessionPanel` — its
  `getPanelBySessionId` lookup also resolves to canonical first (so passive focus
  finds the incumbent), but the authoritative dedup lives in the store method.
- `openingSessionIds` in-flight guard (panel-agent-state.svelte.ts:371-375) — key it
  on the **canonical** id (or add a canonical entry) so a concurrent alias open
  during a cold first-open composes with the guard instead of slipping past it.

**Test file.** `src/lib/acp/store/__tests__/panel-open-canonical-dedup.vitest.ts`
**Scenarios.**
1. Session open under canonical `C`; opening again under alias `A` (resolver: A→C)
   focuses the existing panel and spawns **no** second panel.
2. Opening under canonical `C` twice focuses the existing panel (regression guard
   for today's behavior).
3. Opening a genuinely new id (resolver → null) spawns exactly one panel.
4. `materializeSessionPanel(A)` while `C` is open (resolver: A→C) returns the
   incumbent, spawns no second panel.
5. Concurrent open of alias `A` while canonical `C` is mid-flight in
   `openingSessionIds` does not spawn a second panel (guard keyed on canonical).

### IU3 — One-panel-per-canonical bind invariant (authoritative fix)
**Goal.** Make the 1:1 index a real invariant. Binding a panel to a canonical
session that another panel already holds must collapse to one panel (keep/focus the
incumbent, dispose the duplicate) — never silently overwrite the index while
leaving a duplicate in `topLevelAgentPanelList`.

**Disposal MUST be disconnect-safe (load-bearing).** The reported bug *is* that
closing a panel disconnects the shared session (`panel-handler.ts:47-48`
`closePanel` → `disconnectSession`). Because the duplicate and incumbent share
canonical `C` after the rebind, routing collapse-disposal through
`PanelHandler.closePanel` would disconnect `C` and reproduce the bug *during the
fix*. Collapse disposal MUST use the store-internal pure list-removal
(`panel-agent-state.svelte.ts` `removeAgentPanel`, ~:294-304 / the store-level panel
removal that performs **no** `disconnectSession`) and MUST NOT route through
`PanelHandler.closePanel`. Also cancel/clean the disposed panel's in-flight
hydration (`session-open-hydrator.ts` `activeRequestTokens` / `panelChains` keyed by
the disposed `panelId`) so a late `applyFound` cannot resurrect a duplicate bind.

**Centralize the invariant.** Enforce one-panel-per-canonical at the single bind
chokepoint so every path inherits it, rather than patching each seam separately:
- `src/lib/acp/store/panel-agent-state.svelte.ts` — `updatePanelSession` (:463) and
  `insertTopLevelAgentPanel` (:191-205) are the two ways a panel acquires a session
  id; both `openSession` (:379) and `materializeSessionPanel` (:410) reach the index
  via `insertTopLevelAgentPanel`. Put the "already held by another panel? collapse"
  check there. The downstream index mutators —
  `syncTopLevelAgentPanelIndex` (:98-102), `patchTopLevelAgentPanel` (:173) — must
  not silently last-wins overwrite; assert/repair to the single-holder invariant.
- `src/lib/acp/store/services/session-open-hydrator.ts:139` — the producer
  (`updatePanelSession(panel2, C)`) routes through the guarded bind; when `C` is
  already bound elsewhere, the second panel collapses (disconnect-safe) instead of
  orphaning a list entry.

**Test file.** `src/lib/acp/store/__tests__/panel-bind-uniqueness.vitest.ts`
**Scenarios.**
1. Panel A holds canonical `C`; `updatePanelSession(panel2, C)` collapses to one
   panel in `topLevelAgentPanelList` (no orphaned duplicate), index[`C`] stable.
2. Hydrator attaching `C` to a freshly-spawned `panel2` while A holds `C` yields one
   rendered panel for `C`.
3. **Collapse is disconnect-safe**: collapsing `panel2` onto incumbent A makes
   **zero** `disconnectSession` / `acp_close_session` calls on `C`.
4. `materializeSessionPanel`/`insertTopLevelAgentPanel` adding a second panel for an
   already-held `C` collapses via the same chokepoint.
5. Closing the surviving panel *after* a collapse disconnects the session exactly
   once and leaves no panel stuck in "loading" (the reported bug, asserted dead).

**GOD.** Invariant enforced on TS-owned panel state keyed by canonical Rust truth.

### IU4 — Retire late alias-remap; one-time dedup-safe startup heal
**Goal.** Remove `remapAliasedPanelSessionIds` as the steady-state collapse path.
Replace with a one-time startup canonicalization that resolves each persisted
panel's id via IU1 / the Rust startup `aliasRemaps` and binds through the guarded
IU3 bind, so legacy duplicates collapse instead of overwriting. Unresolved aliases
are logged as diagnostics, not silently remapped.

**What IU4 changes beyond IU3.** Once IU3 makes the bind collapse-safe, much of
`remapAliasedPanelSessionIds` becomes redundant — it already calls
`updatePanelSession`. IU4's residual value is (a) the **ordering** problem: the remap
runs as a separate startup pass relative to `validateRestoredSessions`
(`initialization-manager.ts:518`); a persisted alias Rust cannot resolve must not be
silently cleared as a "missing" session. (b) Replacing the batch alias-remap with a
single-pass heal through the IU3 guarded bind. If IU3 alone proves sufficient for the
duplicate case, IU4 may shrink to "remove the redundant remap pass + add the
unresolved-alias diagnostic" — confirm during implementation.

**`aliasRemaps` has two consumers — only one is retired.** Besides
`remapAliasedPanelSessionIds`, `aliasRemaps` is consumed by
`reconcileAliasedStartupSessions` (`session-repository.ts:585-654`, invoked inside the
producer ~:383), which merges alias session metadata (PR number, link mode, title)
into the canonical row. That consumer **stays**; IU4 retires only the panel-side remap.

**Files.**
- `src/lib/components/main-app-view/logic/managers/initialization-manager.ts` —
  remove the `remapAliasedPanelSessionIds` (:487-504) consumption at :429-438; replace
  with the one-time heal that routes through the guarded bind, ordered so unresolved
  aliases are diagnosed before `validateRestoredSessions` (:518) can clear them.
- `src/lib/acp/store/services/session-repository.ts:359-403` — the `aliasRemaps`
  producer (Rust-resolved) stays as the data source for the one-time heal;
  `reconcileAliasedStartupSessions` (:585-654) is unchanged.

**Test file.**
`src/lib/components/main-app-view/logic/managers/tests/startup-canonicalization.test.ts`
**Scenarios.**
1. Two persisted panels resolving to the same canonical id collapse to one panel at
   startup (reuse-not-create — no duplicate births).
2. A persisted alias with a known `aliasRemaps` entry binds to its canonical id.
3. A persisted alias with **no** resolution is left as-is and emits a diagnostic
   (no silent remap, no fabricated canonical id).
4. An unresolved persisted alias is **not** silently dropped by the subsequent
   `validateRestoredSessions` pass (ordering preserved; the panel does not vanish).

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

**Test files.** `src-tauri/src/acp/commands/session_commands/tests.rs` (extend) for
the Rust DB scenarios; a lightweight TS projection test for the display propagation.
**Scenarios.**
1. (Rust) Resuming a discovered (`is_acepe_managed=0`, `sequence_id=NULL`) session
   promotes it: `is_acepe_managed=1` and a per-project `sequence_id` is assigned.
2. (Rust) Resuming an already-managed session is idempotent (same `sequence_id`, no
   leak).
3. (TS) After a resume snapshot envelope is applied, the session's `sequenceId` in
   the canonical projection is non-null — proving the assigned `sequence_id` rides the
   envelope to the display layer (the badge path the Keystone Correction claims), not
   just that Rust wrote it to the DB.

## Sequencing & Dependencies

```
IU1 (resolver)
  ├─> IU2 (canonical dedup)
  └─> IU3 (bind invariant) ──> IU4 (startup heal, uses IU1 + IU3 guarded bind)
IU5 (badge regression)  — independent, can land first as a safety net
```
IU2 and IU3 both depend on IU1 and are otherwise independent of each other. IU4
depends on IU1 and IU3 (not IU2).

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
2. **Resolver availability timing.** IU2's resolver only resolves *repeat* alias
   opens; a first-ever alias open while canonical is open misses at the seam (the
   mapping arrives async). IU3's collapse-on-rebind is the actual guarantee — see the
   Correctness Argument. IU2 is best-effort; do not weaken IU3.
3. **Collapse disposal is the single most fragile point.** Any route through
   `PanelHandler.closePanel`/`disconnectSession` on the shared canonical session
   reproduces the bug during the fix. IU3 disposal MUST use the disconnect-free
   `removeAgentPanel` path; IU3 scenario 3 asserts zero disconnects on collapse.
4. **Branch debt noise.** ~30 pre-existing panel-store stub failures and the
   `sessionStore.read.*` wiring WIP can mask/contaminate new test runs. Author new
   tests against current wiring; report new failures separately from the known set.
   Note: IU1's resolver accessor lands on the very read facade that is mid-refactor.
5. **Multiple index seams.** The 1:1 index is mutated in several places
   (`:98-102`, `:173`, `:195`) reached via `insertTopLevelAgentPanel` and
   `updatePanelSession`; centralize the invariant at the bind chokepoint so all paths
   (`openSession`, `materializeSessionPanel`, hydrator rebind) inherit it.

## Open Question for Implementation (unresolved by this plan)

**Is the runtime second-open the real producer, or is it startup persisted-alias
rebind?** The adversarial review could not exhibit a concrete *runtime* caller that
opens an already-open canonical session under a *different* alias (sidebar rows are
normally already canonical; same-id concurrent opens are deduped by
`openingSessionIds`). The clearest concrete alias-keyed-panel producer in the code is
the **persisted** path (`remapAliasedPanelSessionIds` rebinding a persisted provider
alias to `C`). If the "closed g7, the g7 behind it hangs" repro is actually a
startup/persisted-alias reattach, then **IU3 + IU4 are the primary fix and IU2 is
defense-in-depth** — the opposite emphasis from a runtime-first reading. This does
not change *what* is built (IU3 closes the bug either way), but it changes test
weighting and which scenario is the canonical red test. Resolve by reproducing the
exact repro at the start of `ce-work` (which entry point spawned the duplicate) before
writing the first red test.

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
