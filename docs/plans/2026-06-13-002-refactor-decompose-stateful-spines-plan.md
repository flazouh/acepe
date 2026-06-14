---
title: "refactor: Decompose stateful spines into owned, testable controllers"
type: refactor
status: active
date: 2026-06-13
---

# refactor: Decompose stateful spines into owned, testable controllers

## Overview

Four architecture-deepening candidates from the 2026-06-13 architecture review share one root: **pure predicates are deep-tested, but the stateful spine that calls them — Svelte `$effect` blocks, non-reactive mirror `let` flags, async listener lifecycles — holds the real bugs with no locality and no test surface.** Several mirrors additionally breach the GOD gate by paralleling canonical Rust truth.

Each phase moves calling-context state into an owned, testable module whose interface *is* the canonical intent. Phases are independently shippable and reviewable. The cross-cutting rule: **never keep old and new authority alive across a phase commit** — each phase deletes the path it replaces before it ships. No-coexistence is enforced at **phase-commit granularity**, not per-unit: red-test-first (e.g. U5 before U7) necessarily means the new controller exists for a unit or two before the old spine is deleted; that intermediate, uncommitted state is expected and allowed. The phase does not ship until the old path — its `$effect`, its mirror `let`s — is gone.

Origin: the 2026-06-13 architecture review, rendered to a **transient** report at `$TMPDIR/architecture-review-20260613-192205.html` (an OS-temp artifact by design — it is intentionally not checked into the repo; 4 candidate cards, top recommendation = Phase 1).

## Problem Frame

The deletion test exposes the pattern. Delete `transcript-viewport-scroll-controller.ts` (pure predicates) and the complexity reappears — it earns its keep. But the *bugs* don't live there; they live in `scene-content-viewport.svelte`'s 14 local mirror `let`s and 5 pin emitters that gate on those mirrors instead of canonical `mode.kind`. The predicate is deep-tested; its caller is untestable and wrong. Same shape recurs in voice (generation-counter race in the host component), connection (subscription `$effect` writing public setters), and drag-drop (async teardown race in a class body).

This is the architecture review's unifying thesis, and it is corroborated by institutional learnings:

- `docs/solutions/workflow-issues/transcript-viewport-fast-scroll-qa-2026-05-31.md` codifies the exact invariant Phase 1 completes: *"Keep exactly one physical DOM scroll actuator; all other paths should emit typed scroll commands"* and *"Multiple Svelte paths wrote scrollTop directly, so fast scroll could make stale targets, recovery clamps, and follow-tail pinning fight each other."* It also states the generalization Phase 2 needs: *"Request generations must be per-session store state, not local component state."*
- `docs/adr/` ADR-0002 establishes the target shape: a sub-store/controller owns a disjoint slice + its methods; the host becomes a thin composition spine; cross-slice reads go through accessor-closure dependencies. Local mirror state contradicting canonical is named there as a GOD hazard.

## Requirements Trace

- **R1.** **Settled** pin/detach authority is canonical `bufferProjection.mode.kind` (`"detached" | "followingTail"`). No emitter gates a *settled* pin/detach decision on a local mirror of canonical mode. The reproduced teleport/flicker — which lives in the contradiction between **settled** local mirrors and canonical mode — is gone. (Phase 1; GOD-gated) **Non-goal:** removing client-side live-input transients (see R2 bucket c) is explicitly out of scope; those are legitimately TS-local and were never the GOD violation.
- **R2.** The local scroll `let`s at `scene-content-viewport.svelte:162-184` are reclassified into three buckets and handled accordingly: **(a) derivable from canonical `mode.kind`** (settled mirrors of detached/following state, e.g. `locallyPinnedToBottom` as a settled latch) → **deleted**; **(b) non-derivable but settle-able per session** (e.g. request generations, jump-in-flight) → **moved to the per-session `transcript-viewport-store`**, not component locals; **(c) live-DOM gesture transients read synchronously inside `handleScroll`** (`userScrollingAwayFromTail`, the pre-dispatch live `locallyDetachedFromTail` flip, the `bottomJumpPinRequested` multi-frame latch) → **kept TS-local**, with a comment documenting why they cannot move (the store push is async relative to the DOM event; these are not canonical facts and do not belong in Rust). U1 must produce the explicit per-variable bucket assignment before U2 deletes anything. (Phase 1)
- **R3.** Temporary instrumentation (`__scrollDebug` / `__scrollCmdLog` / `recordScrollCommandDebug`, the `declare global` block, and temp `scroll-*.mts` scripts) is removed; the canonical `__ACEPE_TRANSCRIPT_VIEWPORT_TRACE__` facility (`transcript-viewport-flight-recorder.ts`) remains the sole trace path. (Phase 1)
- **R4.** Voice behavior is owned by one `VoiceSessionController` that holds **one owner with two coordinated mechanisms** — a per-init generation token captured at listen-dispatch time (cross-flip identity) **and** a per-instance disposed flag (late-callback rejection). These are not collapsed to a single guard (they close different races); the win is *locality and testability*, both mechanisms living in one tested controller, not count reduction. The host (`agent-input-ui.svelte`) holds one reactive input (`effectiveVoiceSessionId`) + one `ready` derived; the 4 local mirror vars and the in-component init/dispose/generation logic are deleted. `VoiceInputState` remains a first-class exported class (see Scope Boundaries — `git-panel.svelte`). (Phase 2)
- **R5.** `ConnectionController` owns its connection-store subscription. Public `state` / `error` / `dismissedErrorKey` setters are removed; the component no longer drives the controller via an `$effect`. The deep retry core is unchanged. (Phase 3)
- **R6.** Tauri drag-drop lifecycle is owned by a `TauriDragDropController` with an `isDestroyed` guard and a **test-injection seam** (a minimal `listen`-signature dependency with a real Tauri impl + an in-memory fake). The teardown guard logic already exists inline (`isDestroyed` + `registerResolvedDragDropListener` at `agent-input-state.svelte.ts:349-351`); Phase 4 is **testability/locality deepening — not a new bug fix** — it makes that already-correct guard reachable by a deterministic test. Optimistic-entry set/rollback gains **characterization coverage of the existing `neverthrow` chain** (`:636-687`, around `createPendingUserEntry`); a new transaction module is extracted **only if a second consumer justifies it** (deletion test — see Phase 4 note). (Phase 4)
- **R7.** Every phase ships with behavior tests written red-first; no `readFileSync`-source-string structural tests. (All phases)

## Scope Boundaries

- **TS-only for Phase 1 by default.** The canonical buffer projection already exposes `mode.kind` (`"detached" | "followingTail"`, `lib/services/acp-types.ts:519`, owned by the Rust Viewport ledger per `CONTEXT.md`); the established fix direction is "settled pin/detach reads canonical mode; non-derivable-but-settle-able state moves to the per-session store; live-input transients stay local." No Rust widening is planned. **Three-branch escalation contract** when U1 bucketing hits a fact that `mode.kind` cannot drive an emitter from: **(1)** the fact is a settle-able per-session value → put it on `transcript-viewport-store` (no escalation); **(2)** the fact is a legitimate client-side **live-input transient** read synchronously in `handleScroll` and is not a canonical fact → keep it TS-local, document why, no Rust widening; **(3)** only if the fact is genuinely *canonical* (describes what the session/viewport ledger settled on) yet absent from `mode.kind` → stop and flag the user before widening Rust. The original two-way "TS-or-Rust" fork was a false dichotomy: most non-derivable state is branch (1)/(2), not (3).
- The single physical actuator (`queuePhysicalScrollCommand`, RAF-coalesced) is **kept**, including its RAF-pending / sequence-bookkeeping `let`s (`scrollIntentRafPending`, `*RafPending`, `lastApplied*EmissionSeq`, etc.). These are actuator-coalescing state, **not** canonical-mode mirrors — U2 must not delete them. Phase 1 changes what *feeds* the actuator, not the actuator itself.
- Pure predicate modules (`transcript-viewport-scroll-controller.ts`, `voice-state-lifecycle.ts`, `voice-ui-state.ts`, etc.) keep their tested interfaces; they become *internals* of the new controllers where appropriate, not rewrites.
- **`git-panel.svelte` voice lifecycle is out of scope.** `git-panel.svelte` instantiates `VoiceInputState` directly with its own `onTranscriptionReady` callback and lifecycle (~`:219-246`), independent of `agent-input-ui.svelte`. Phase 2 must keep `VoiceInputState` a first-class **exported** class; it does NOT migrate or hide it. `VoiceSessionController` *consumes* the voice fragments, it does not exclusive-own them. Migrating git-panel onto `VoiceSessionController` is a separate future task.
- No change to the Rust Viewport ledger, `SessionStateGraph`, or any canonical envelope in Phases 1–4 (subject to the Phase 1 escalation contract branch 3).
- No new shared `@acepe/ui` components are required; these are desktop-layer controller refactors. If any extraction touches `@acepe/ui`, invoke `extract-to-ui-package` first.

### Deferred to Separate Tasks

- The session-promotion-on-open fix (`resume.rs`, already in tree, +11 lines) — separate concern, awaiting live QA + commit.
- Any broader virtua/native renderer-adapter rework from the superseded 2026-05-13 controller architecture — out of scope.

## Key Technical Decisions

1. **Canonical `mode.kind` is the *settled* scroll-intent authority; live-input transients stay local (Phase 1).** The emitters gate their *settled* pin/detach decisions on canonical `mode.kind`, not on settled local mirrors. Non-derivable-but-settle-able facts (jump-in-flight, request generations) become per-session fields on `transcript-viewport-store`. Live-DOM gesture facts read synchronously inside `handleScroll` (`userScrollingAwayFromTail`, the pre-dispatch `locallyDetachedFromTail` flip, `bottomJumpPinRequested`) **remain TS-local** — they are pre-canonical, frame-synchronous, and not Rust facts. Rationale: applies the 05-31 "one actuator / generations in store" invariant and the GOD no-*settled*-dual-authority rule, **without** misclassifying client-side live input as canonical truth.
2. **One owner, two coordinated mechanisms (Phase 2).** `VoiceSessionController` owns the FSM (`voice-transitions`) + async `listen`/`dispose`. It keeps **both** race mechanisms because they close different races: a per-init generation token captured at listen-dispatch time arbitrates *cross-instance identity* across a rapid session flip (today's host `voiceStateInitGeneration`), while a per-instance disposed flag rejects *intra-instance late callbacks* (today's `VoiceInputState.isDisposed`, ~15 guard sites). Relocating both into one tested controller delivers locality and testability; it does **not** reduce two-to-one. Predicate fragments (`voice-state-lifecycle`, `voice-ui-state`, `voice-toolbar-binding`) become internals the controller consumes. Rationale: ADR-0002 sub-store shape; removes the host-resident race without re-opening it.
3. **Controller owns its subscription (Phase 3).** The load-bearing act is **relocating the `connectionStore` subscription out of the `agent-panel.svelte` `$effect` into `ConnectionController`** (constructor deps: `connectionStore` + `getPanelId`). Deleting the public `state`/`error`/`dismissedErrorKey` setters is the *consequence* of that relocation — they are today the controller's sole write path, so the subscription must move first (U9 ordering enforces this). The controller then exposes read-only `state`/`error`. Rationale: the class doc comment concedes truth flows `store → $effect → setters`; the deletion test fails for those setters once the subscription is internal. Deep retry core (`beginRetry`/`isRetrying`) untouched.
4. **Test-injection seam, not a production extension point (Phase 4).** The teardown guard (`isDestroyed` + `registerResolvedDragDropListener`) already exists and is correct; what is missing is a way to test it deterministically. `TauriDragDropController` takes a **minimal `listen`-signature dependency** (returns `Promise<UnlistenFn>`) with a real Tauri impl + an in-memory fake — the fake exists to drive the post-destroy-unlisten race in a test, not to support a second production backend. Framed honestly as test injection. Optimistic entry: characterize the existing `neverthrow` set/rollback chain (`createPendingUserEntry` → `setPendingUserEntry`/clear); extract a named transaction module **only** if a second consumer is found (otherwise the deletion test fails — it is one neverthrow chain with one call site).

## System-Wide Impact

- **GOD gate (Phase 1 only):** session/transcript-shaped. `god-architecture-check` is mandatory before and during Phase 1 code. Pre-flight expectation: this is a *deletion of **settled** dual authority* (removing TS mirrors of settled canonical mode), which is the green direction — not a widening, and explicitly **not** a purge of legitimate client-side live-input transients (bucket c). The three-branch escalation contract above is the tripwire.
- **No canonical/envelope changes** in Phases 2–4; these are desktop controller-locality refactors with no authority-surface impact.
- **Test surface grows** in the intended place: each controller gets a `.vitest.ts` exercising its async lifecycle and race behavior — the surface that does not exist today.

## Implementation Units

Each phase ships and reviews on its own commit; Phases 3 and 4 are gated to start only after Phase 1 ships (Verification Summary sequencing gate). Within a phase, units are ordered; the red-test unit precedes its implementation unit (Phase 1 additionally opens with the U0 bucketing analysis). **TDD red-first is mandatory** (CLAUDE.md Hard Rule 4: non-trivial refactors require a failing/characterization test first).

### Phase 1 — Unify transcript scroll authority on canonical `mode.kind` (GOD-gated)

**U0 — Mirror bucketing (analysis deliverable, precedes U1)**
- Output: a per-variable table for every `let` in `scene-content-viewport.svelte:162-184`, each assigned to bucket **(a) delete — derivable from `mode.kind`**, **(b) move to `transcript-viewport-store`**, or **(c) keep TS-local — live-input transient**. This is the precondition that makes U1/U2 unambiguous (resolves coherence/feasibility/adversarial convergence on "which mirrors"). Record it in the plan or a short note before writing U1's tests. Known seed assignments from review: `userScrollingAwayFromTail`, pre-dispatch live `locallyDetachedFromTail`, `bottomJumpPinRequested` → (c); the actuator RAF/seq bookkeeping (`*RafPending`, `lastApplied*EmissionSeq`) → keep (not a mirror, not in scope to delete).

#### U0 deliverable — per-variable bucket assignment (`scene-content-viewport.svelte:162-184`)

| Variable | Bucket | Rationale |
|----------|--------|-----------|
| `lastAppliedScrollEmissionSeq` | **keep** (actuator bookkeeping) | Idempotency for rust scroll-target effect; not a mode mirror |
| `lastAppliedCorrectionEmissionSeq` | **keep** (actuator bookkeeping) | Idempotency for anchor-correction effect |
| `lastFollowTailTotalHeightPx` | **keep** (actuator bookkeeping) | Dedupes follow-tail pin on unchanged totalHeight |
| `suppressedProgrammaticScrollTopPx` | **keep** (actuator bookkeeping) | Suppresses echo scroll events from programmatic writes |
| `scrollIntentRafPending` | **keep** (actuator RAF) | Coalesces scroll-intent dispatch |
| `locallyDetachedFromTail` | **(c) TS-local** | Pre-dispatch live detach flip in `handleScroll`; async store would break timing |
| `locallyPinnedToTop` | **(a) delete** | Settled top-pin latch; replace with store bucket-(b) top-recovery scroll + layout-top check |
| `locallyPinnedToBottom` | **(a) delete** | Settled bottom-pin latch; replace with canonical `mode.kind === "followingTail"` (+ `bottomJumpPinRequested` for re-attach) |
| `userScrollingAwayFromTail` | **(c) TS-local** | Wheel-up gesture transient read synchronously in `handleScroll` / `handleWheel` |
| `pendingOutsideBufferScrollTopPx` | **(b) store** | Per-session outside-buffer recovery intent; survives remount |
| `activeOutsideBufferRequestedScrollTopPx` | **(b) store** | Paired with pending outside-buffer recovery |
| `lastOutsideBufferRecoveryDispatchMs` | **(b) store** | Per-session throttle for outside-buffer retry |
| `lastBottomRevealDispatchMs` | **(b) store** | Per-session throttle for bottom reveal dispatch |
| `outsideBufferRecoveryRafPending` | **keep** (actuator RAF) | Frame coalescing for recovery loop |
| `outsideBufferRecoveryFramesRemaining` | **keep** (actuator frame budget) | Caps recovery RAF iterations |
| `bottomPinRecoveryRafPending` | **keep** (actuator RAF) | Frame coalescing for bottom-pin recovery |
| `bottomPinRecoveryFramesRemaining` | **keep** (actuator frame budget) | Caps bottom-pin recovery iterations |
| `bottomJumpPinRequested` | **(c) TS-local** | Multi-frame re-attach latch until tail buffer hydrates; read synchronously in recovery RAF |
| `pendingQueuedScrollIntentPx` | **(b) store** | Per-session semantic scroll queue at buffer edge |
| `queuedScrollIntentRafPending` | **keep** (actuator RAF) | Coalesces queued scroll intents |
| `queuedScrollIntentInFlight` | **keep** (actuator in-flight) | Prevents duplicate semantic scroll RPCs |
| `physicalScrollRafPending` | **keep** (actuator RAF) | Single physical scroll actuator coalescing |
| `pendingPhysicalScrollCommand` | **keep** (actuator) | Pending command for `queuePhysicalScrollCommand` |

**U1 — Red: scroll-authority contradiction test**
- Test files:
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/transcript-viewport-scroll-controller.test.ts` (extend)
  - `packages/desktop/src/lib/acp/store/__tests__/transcript-viewport-store.vitest.ts` (extend) — for any bucket-(b) state moved into the store. (Store lives at `acp/store/transcript-viewport-store.svelte.ts`, not `agent-panel/store/`.)
- Scenarios (behavior, not source-string):
  1. **Prescriptive (the bug):** when canonical `mode.kind === "detached"`, the derived *settled* scroll intent must NOT request a bottom pin, even when a simulated prior settled bottom-pin latch was true. (Captures the teleport: stale settled mirror fighting detached mode.)
  2. When `mode.kind === "followingTail"` and tail rows are loaded, scroll intent requests exactly one pin to rendered bottom; a second identical projection does not re-emit. (Idempotent, single-actuator-feeding.)
  3. A jump-to-bottom in flight (bucket b) is per-session store state; a session switch resets it (per-session, not global). (Encodes the 05-31 generations-in-store invariant.)
  4. **Characterization — preserved behaviors ONLY:** characterize the behaviors Phase 1 intends to *keep* (correct follow-tail pinning, anchor correction, outside-buffer recovery on legitimate jumps, and the bucket-(c) live-gesture handling). **Explicitly exclude the teleport-producing emissions** from this baseline — those are governed by the prescriptive scenario 1, not locked in here. (Resolves the adversarial "characterization locks in the bug" finding.)
- Confirm RED before U2.

**U2 — Gate settled pin/detach emitters on canonical mode; handle mirrors per bucket**
- Files:
  - `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` (1371 LOC)
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-scroll-controller.ts`
  - `packages/desktop/src/lib/acp/store/transcript-viewport-store.svelte.ts`
- Changes:
  - Apply the U0 bucketing to the `let`s at `:162-184`: delete bucket (a); move bucket (b) to the per-session store; keep bucket (c) TS-local with a documenting comment. **Do not delete the actuator's RAF/sequence bookkeeping `let`s** (Scope Boundaries).
  - Gate the 5 pin emitters (`:1229` anchor-correction, `:1137` outside-buffer, `:1282` `followTailRenderedBottom`, `:1194` `rustScrollTarget`, `:672` recovery loop) so their *settled* decision reads canonical `mode.kind`. The prior `shouldContinueBottomPinRecovery` fix (recovery loop only) is subsumed — generalize it to all five.
  - Keep `queuePhysicalScrollCommand` as the sole actuator; only its inputs change.
  - **GOD pre-flight + in-flight checks** per the three-branch escalation contract.
- Verify: U1 green; `bun run check`.

**U3 — Remove temporary instrumentation**
- Files: `scene-content-viewport.svelte` (`__scrollDebug`/`__scrollCmdLog`/`recordScrollCommandDebug`, `declare global` block ~`:62-66`, ~`:465-492`), plus temp `scroll-*.mts` scripts.
- Changes: delete the ad-hoc trace; confirm `window.__ACEPE_TRANSCRIPT_VIEWPORT_TRACE__` (canonical) remains the only trace facility.
- Verify: `bun run check`; grep confirms no `__scrollDebug` / `__scrollCmdLog` references remain.

**U4 — Phase 1 verification (live + harness)**
- **Primary acceptance:** live repro confirmation in the dev app per `acepe-dev-app-qa` (frontend HMR — no restart needed) — the specific scroll scenario that triggered the teleport/flicker no longer reproduces. This is the criterion that proves R1, because the harness may not instrument flicker directly.
- **Secondary (regression net):** run `bun run qa:transcript-viewport-scroll` (artifact under `/tmp/acepe-transcript-viewport-scroll-qa-*.json`); failure signal `blank_top_gap` must be absent.
- `god-architecture-check` final attestation before commit.

### Phase 2 — Collapse the voice lifecycle into one `VoiceSessionController`

**U5 — Red: voice controller lifecycle + race test**
- Test file: `packages/desktop/src/lib/acp/components/agent-input/state/__tests__/voice-session-controller.vitest.ts` (new)
- Scenarios (these exercise **two distinct mechanisms** — keep them as separate assertions):
  1. **Cross-instance identity:** rapid session flip (A → B before A's `await registerListeners()` resolves) — the per-init generation token disposes A's listeners and leaves only B active.
  2. **Intra-instance late callback:** dispose during in-flight init — the per-instance disposed flag rejects A's listeners that resolve *after* dispose, even while the controller is alive serving B.
  3. `ready` is true only when the FSM is in a ready state for the *current* `effectiveVoiceSessionId`.
  4. Existing predicate behavior (`resolveVoiceStateLifecycle`) still holds through the controller interface.
- Confirm RED.

**U6 — Build `VoiceSessionController`**
- Files:
  - `packages/desktop/src/lib/acp/components/agent-input/state/voice-session-controller.svelte.ts` (new)
  - Consumes (does not exclusive-own): `logic/voice-state-lifecycle.ts`, `logic/voice-ui-state.ts`, `logic/voice-toolbar-binding.ts`, `state/voice-transitions.ts`, `state/voice-input-state.svelte.ts`, `state/waveform-state.svelte.ts`. `waveform-state.svelte.ts` is an existing module the controller instantiates and holds as a private field (constructed in the controller's constructor) — these modules stay exported.
- Changes: controller owns FSM + async listen/dispose, holding **both** race mechanisms (per-init generation token + per-instance disposed flag) per KTD-2. **`VoiceInputState` stays a first-class exported class** (`git-panel.svelte` instantiates it directly — see Scope Boundaries).
- Verify: U5 green; `bun run check`.

**U7 — Rewire host; delete in-component voice spine**
- File: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` (2099 LOC)
- Changes: host exposes one reactive input (`effectiveVoiceSessionId`) + one `ready` derived; delete the 4 local mirror vars (`voiceState`/`voiceStateSessionId`/`voiceStatePendingSessionId`/`voiceStateInitGeneration`) and the in-component `initializeVoiceState`/dispose/generation logic (`:912-989`); remove now-internal fragment imports from *this host only*.
- **Out of scope (do not touch):** `git-panel.svelte`'s independent `VoiceInputState` lifecycle (~`:219-246`). Confirm `bun run check` still passes for it — it imports `VoiceInputState` by path, so a breaking API change there is a regression this unit must avoid.
- Verify: `bun run check`; voice still functions in dev QA (HMR) for **both** agent-input and git-panel.

### Phase 3 — Let `ConnectionController` own its subscription

**U8 — Red: controller-owned subscription test**
- Test file: `packages/desktop/src/lib/acp/components/agent-panel/state/__tests__/connection-controller.vitest.ts` (extend or create)
- Scenarios:
  1. Given a stub `connectionStore` and `getPanelId`, a store push updates read-only `state`/`error` without any external setter call.
  2. `dismissedErrorKey` logic still gates error display correctly through the read-only interface.
  3. The deep retry core (`beginRetry` timer, `isRetrying` derived) behaves unchanged.
  4. Destroy unsubscribes; later store pushes are ignored.
  5. **Setter removal is enforced:** the public `state` / `error` / `dismissedErrorKey` setters no longer exist on the constructed instance (TypeScript compile-error if a caller assigns them). (Resolves scope-guardian finding — without this, an implementer could leave the setters in and still pass.)
- Confirm RED.

**U9 — Relocate the subscription into the controller; delete the now-dead setters**
- Files:
  - `packages/desktop/src/lib/acp/components/agent-panel/state/connection-controller.svelte.ts` (85 LOC)
  - `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` (subscription `$effect` `:902-923`)
- Changes (order matters): **first** make the constructor take `connectionStore` + `getPanelId` and own the `connectionStore` subscription internally (the load-bearing act); **then** remove the component `$effect` and delete the public `state`/`error`/`dismissedErrorKey` setters (`:32-51`) — which are the controller's *current sole write path*, so they can only go once the internal subscription feeds state. Expose read-only `state`/`error`. Keep retry core (`:57-84`).
- Verify: U8 green; `bun run check`.

### Phase 4 — Extract Tauri drag-drop lifecycle + characterize optimistic entry

> **Framing (per review):** this phase is **testability/locality deepening, not a bug fix** — the drag-drop teardown guard already exists and is correct (`agent-input-state.svelte.ts:349-351`). It is gated behind Phase 1 shipping (U4 green) so Phase 1's urgency does not pull a hygiene phase into an oversized batch.

**U10a — Red: drag-drop teardown race test**
- Test file: `packages/desktop/src/lib/acp/components/agent-input/state/__tests__/tauri-drag-drop-controller.vitest.ts` (new) — uses the in-memory fake `listen`.
- Reconcile with the existing `agent-input/state/__tests__/agent-input-state-drag-drop-listeners.vitest.ts`, which today mocks `listen` and asserts registration on `AgentInputState` directly. U11 must migrate that coverage into the controller test and delete/rewire the old test (GOD no-coexistence — don't leave two assertions of the same behavior).
- Scenarios:
  1. Destroy before the injected `listen()` resolves → the arriving unlisten is invoked (no leaked listener). (Exercises the existing `isDestroyed` + `registerResolvedDragDropListener` guard, now reachable.)
  2. The real Tauri `listen` impl and the in-memory fake satisfy the same minimal `listen` signature; the fake drives scenario 1 deterministically.
- Confirm RED.

**U10b — Red: optimistic-entry characterization test**
- Test file: `packages/desktop/src/lib/acp/components/agent-input/state/__tests__/agent-input-state-optimistic-entry.vitest.ts` (new)
- Scenarios:
  1. The existing `neverthrow` set/rollback chain (`agent-input-state.svelte.ts:636-687`, via `createPendingUserEntry` from `logic/pending-user-entry.ts` → panel store `setPendingUserEntry`/clear): on success (`.map`) the entry is cleared; on **each** error path (`.mapErr`, and the early-return guards at ~`:597`/`:611`) prior state is restored exactly. Enumerate the paths; characterize current behavior (this path is correct today — characterization, not a fix).
  2. Confirm the canonical-presence resolver `agent-panel/logic/optimistic-user-entry.ts` (`resolveOptimisticUserEntryForGraph`) is **untouched** — the optimistic *set* is a transient UI concern; canonical presence stays the authority (GOD-adjacent guard).
- Confirm RED.

**U11 — Extract `TauriDragDropController`**
- Files:
  - `packages/desktop/src/lib/acp/components/agent-input/state/tauri-drag-drop-controller.svelte.ts` (new)
  - `packages/desktop/src/lib/acp/components/agent-input/state/agent-input-state.svelte.ts` (1255 LOC; drag-drop listeners `:285-365`)
  - migrate + delete `agent-input/state/__tests__/agent-input-state-drag-drop-listeners.vitest.ts`
- Changes: lift drag-drop lifecycle into the controller with the existing `isDestroyed` guard + a **minimal injected `listen`-signature seam** (test injection, not a production extension point — KTD-4); rewire `agent-input-state` to use it.
- Verify: U10a green; `bun run check`.

**U12 — Optimistic entry: keep the neverthrow chain unless a second consumer appears**
- Files: `agent-input-state.svelte.ts` (optimistic entry `:636-687`)
- Default change: **none structural** — U10b's characterization coverage is the deliverable; the existing single-call-site neverthrow chain stays (extracting a `commit`/`rollback` transaction module fails the deletion test — one consumer, the chain already expresses set/rollback).
- Conditional extraction: extract `logic/optimistic-entry-transaction.ts` **only if** a second consumer of the same set/rollback pattern is identified during U10b. If extracted, it must wrap `createPendingUserEntry` + the panel-store calls, not duplicate them. Flag to the user if you believe extraction is warranted.
- Verify: U10b green; `bun run check`.

## Risks & Mitigations

- **R-1 (Phase 1, highest): misclassifying a live-input transient as a deletable mirror.** This is the failure the review caught: bucket-(c) facts (`userScrollingAwayFromTail`, the pre-dispatch live detach flip, `bottomJumpPinRequested`) are read synchronously in `handleScroll` and cannot move to an async store update without changing timing. Mitigation: the U0 bucketing deliverable forces the per-variable decision *before* any deletion; the three-branch escalation contract routes each non-derivable fact to store/local/Rust correctly; the U1 prescriptive test (scenario 1) and preserved-behavior characterization (scenario 4) bound the change.
- **R-2: deleting mirrors regresses an untested edge (e.g. top-pin during prepend).** Mitigation: U1 scenario 4 characterizes *preserved* behavior (excluding the teleport); the `qa:transcript-viewport-scroll` harness + live repro (U4) are the regression net.
- **R-3 (Phase 2): re-opening a race by over-unifying the guards.** Mitigation: KTD-2 keeps **both** mechanisms; U5 scenarios 1 and 2 assert the two distinct races independently.
- **R-4 (Phase 2): breaking `git-panel.svelte`'s independent voice lifecycle.** Mitigation: `VoiceInputState` stays exported; U7 explicitly excludes git-panel and verifies `bun run check` + dev QA for it.
- **R-5: phase coupling / oversized batch.** Mitigation: phases are ordered by independence; Phases 3 and 4 are hygiene/testability deepening gated behind Phase 1 U4 green. Do not start a later phase's code before the prior phase's tests are green and `bun run check` passes.
- **R-6 (cross-cutting): keeping old + new authority alive.** Mitigation: no-coexistence at **phase-commit** granularity (Overview) — the new controller may exist for a unit or two before the old spine is deleted, but the phase does not ship until the old `$effect`/mirrors are gone.

## Verification Summary

- Per unit: red test confirmed failing → implementation → green → `bun run check`.
- Phase 1: live dev-app teleport repro gone (primary) + `god-architecture-check` attestation + `bun run qa:transcript-viewport-scroll` (no `blank_top_gap`, regression net).
- Phases 2–4: controller `.vitest.ts` green + `bun run check`; dev QA for voice (Phase 2, **both** agent-input and git-panel) and drag-drop (Phase 4) via HMR.
- **Sequencing gate:** Phases 3 and 4 do not begin until Phase 1 has shipped (U4 green) — they are hygiene/testability deepening, not bug fixes, and must not ride Phase 1's urgency into one oversized change.
- No `cargo` changes expected (subject to Phase 1 escalation contract branch 3 only).
