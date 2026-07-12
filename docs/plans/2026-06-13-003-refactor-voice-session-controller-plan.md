---
title: "refactor: VoiceSessionController — own the voice input lifecycle"
type: refactor
status: active
date: 2026-06-13
---

# refactor: VoiceSessionController — own the voice input lifecycle

## Overview

Voice input behavior is smeared across eight fragments plus a generation-counter race that lives in the host component `agent-input-ui.svelte`. The pure predicate fragments (`voice-state-lifecycle`, `voice-ui-state`, `voice-toolbar-binding`) are well-tested; the **stateful spine that calls them** — async listener init/dispose, a host-resident generation counter, and a second disposal guard inside `VoiceInputState` — is where the real bugs live, with no locality and no test surface.

This plan introduces a single `VoiceSessionController` that owns the voice FSM and its async lifecycle, holding **both** race mechanisms in one tested place. The host collapses to one reactive input (`effectiveVoiceSessionId`) + one `ready` derived.

**Relationship to plan 002:** this candidate is candidate #2 of the 2026-06-13 architecture review and was originally Phase 2 of `docs/plans/2026-06-13-002-refactor-decompose-stateful-spines-plan.md`. We are splitting the review's candidates into one plan per candidate. The decisions below carry forward the corrections that passed the plan review inside 002 (the "two coordinated mechanisms" framing; the `git-panel.svelte` carve-out). Plan 002 should be slimmed to the scroll candidate (Phase 1) only so there is one source of truth per candidate — flagged, not yet done.

Origin: the 2026-06-13 architecture review (transient report at `$TMPDIR/architecture-review-20260613-192205.html`; voice card = `Strong`).

## Problem Frame

Apply the deletion test. Delete `voice-state-lifecycle.ts` / `voice-ui-state.ts` and the complexity reappears across callers — they earn their keep. But the *bugs* aren't there. They are in the calling context:

1. **A host-resident generation race.** `agent-input-ui.svelte:912-989` runs `initializeVoiceState()` keyed by a local `voiceStateInitGeneration` counter (`const generation = ++voiceStateInitGeneration`), re-checked after `await registerListeners()`. This arbitrates *cross-instance identity* across a rapid session flip — which `new VoiceInputState(...)` is current — and disposes the loser.
2. **A second, independent disposal guard.** `VoiceInputState` (`voice-input-state.svelte.ts`, ~601 LOC) carries its own `isDisposed` flag checked at ~15 async continuation sites. This arbitrates *intra-instance late callbacks* — this one instance asking "was I disposed while awaiting?".

These two guards protect **different** races and neither is aware of the other. Both live outside any single tested unit: one in a 2099-LOC Svelte host, one threaded through a 601-LOC state class. There is no place to test "session A→B flip disposes A's listeners" as a unit because the logic spans the host and the state class.

Four local mirror vars on the host (`voiceState` / `voiceStateSessionId` / `voiceStatePendingSessionId` / `voiceStateInitGeneration`) form the host's slice of this spine. ADR-0002's target shape is exactly the inverse: a sub-store/controller owns the disjoint slice + its methods; the host is a thin composition spine.

## Requirements Trace

- **R1.** A single `VoiceSessionController` owns the voice FSM + async `listen`/`dispose` lifecycle for the agent-input host. The host holds one reactive input (`effectiveVoiceSessionId`) + one `ready` derived; the four local mirror vars and the in-component init/dispose/generation logic (`:912-989`) are deleted.
- **R2.** The controller keeps **both** race mechanisms as coordinated internals: (a) a per-init generation token captured at listen-dispatch time (cross-instance identity across session flip) and (b) a per-instance disposed flag (intra-instance late-callback rejection). They are NOT collapsed to one guard — they close different races. The win is locality + testability, not count reduction.
- **R3.** The race behavior is unit-tested at the controller seam: a rapid A→B session flip disposes A's listeners and leaves only B active; a dispose during in-flight init rejects A's late-resolving listeners even while the controller is alive serving B.
- **R4.** Pure predicate fragments (`voice-state-lifecycle`, `voice-ui-state`, `voice-toolbar-binding`, `voice-transitions`) keep their tested interfaces and become internals the controller *consumes* — not rewrites, not hidden.
- **R5.** `VoiceInputState` remains a first-class **exported** class. `git-panel.svelte` instantiates it directly with its own lifecycle and is out of scope.
- **R6.** Net behavior is unchanged for the user: voice records, transcribes, and cancels exactly as today in both the agent-input composer and the git panel.

## Scope Boundaries

- **`git-panel.svelte` voice lifecycle is out of scope.** `git-panel.svelte` instantiates `VoiceInputState` directly (~`:219-246`) with its own `onTranscriptionReady` callback, independent of `agent-input-ui.svelte`. This plan does **not** migrate it. `VoiceInputState` stays exported and directly instantiable; `VoiceSessionController` *consumes* it, it does not exclusive-own it. Migrating git-panel onto the controller is a separate future task.
- **No Rust / canonical changes.** Voice input lifecycle is transient UI state (recording, listener registration, waveform). It is not session/transcript canonical truth — no GOD gate applies, no envelope changes. (The transcription *result*, once submitted, flows through the normal send path, which is untouched here.)
- **No new `@acepe/ui` components.** This is a desktop-layer controller extraction. If any extraction touches `@acepe/ui`, invoke `extract-to-ui-package` first.
- **Predicate modules are not rewritten.** `voice-state-lifecycle.ts`, `voice-ui-state.ts`, `voice-toolbar-binding.ts`, `voice-keyboard.ts`, `voice-mic-keyboard.ts`, `voice-transitions.ts`, `waveform-state.svelte.ts` keep their interfaces and exports.

### Deferred to Separate Tasks

- Migrating `git-panel.svelte` onto `VoiceSessionController` (R5 keeps it independent).
- Any consolidation of the keyboard fragments (`voice-keyboard.ts`, `voice-mic-keyboard.ts`) beyond what the controller needs to consume.

## Key Technical Decisions

1. **One owner, two coordinated mechanisms.** The controller keeps both the per-init generation token (cross-instance identity) and the per-instance disposed flag (intra-instance late-callback). A rapid session flip A→B: the resolving listener for A captures its generation at dispatch time; if the controller's current generation has advanced, A's listeners are disposed. Independently, if the controller disposed A while serving B, A's late continuations check the disposed flag. Both relocate into one tested controller. **Rationale:** the two guards observed in the code close different races; unifying to a single guard re-opens one (confirmed by plan review on 002).
2. **Controller consumes predicate fragments; does not hide them.** `voice-state-lifecycle`, `voice-ui-state`, `voice-toolbar-binding`, `voice-transitions` stay exported modules the controller calls. `waveform-state.svelte.ts` is constructed and held as a private controller field. **Rationale:** ADR-0002 — own the slice + methods; keep the deep predicates as leverage, not rewrites.
3. **Host exposes one input + one derived.** `agent-input-ui.svelte` passes `effectiveVoiceSessionId` in and reads a `ready` derived out. All init/dispose/generation logic leaves the host. **Rationale:** thin composition spine; deletes the host's slice of the parallel state machine.
4. **`ready` is `$derived`, never `$effect`.** Per Svelte conventions, `ready` is true only when the FSM is in a ready state for the *current* `effectiveVoiceSessionId`. Lifecycle actions (listen/dispose) are triggered by the controller's own methods, not by host effects.

## System-Wide Impact

- **No canonical/envelope changes.** Voice input is transient UI state; no GOD gate, no Rust.
- **Consumer surface preserved.** `VoiceInputState`, `voice-ui-state` (`canCancelVoiceInteraction`), and the other fragments keep their exports — `mic-button.svelte`, `agent-input-composer-body.svelte`, `voice-recording-overlay.svelte`, and `git-panel.svelte` continue to import them unchanged.
- **Test surface grows where the bug is:** a new `voice-session-controller.vitest.ts` exercises the async lifecycle and both races — coverage that does not exist anywhere today.

## Implementation Units

Units are ordered; the red-test unit precedes implementation. **TDD red-first is mandatory** (CLAUDE.md Hard Rule 4). No-coexistence is enforced at **commit granularity** — the controller may exist for a unit or two before the host spine is deleted; this plan does not ship until the host's init/dispose/generation logic and the four mirror vars are gone.

**U1 — Red: controller lifecycle + dual-race test**
- Test file: `packages/desktop/src/lib/acp/components/agent-input/state/__tests__/voice-session-controller.vitest.ts` (new)
- Scenarios (keep 1 and 2 as separate assertions — they exercise two distinct mechanisms):
  1. **Cross-instance identity:** session flip A→B before A's `await registerListeners()` resolves — the per-init generation token disposes A's listeners and leaves only B active.
  2. **Intra-instance late callback:** dispose during in-flight init — the per-instance disposed flag rejects A's listeners that resolve *after* dispose, even while the controller is alive serving B.
  3. `ready` is true only when the FSM is in a ready state for the *current* `effectiveVoiceSessionId`; switching sessions makes it false until the new session is ready.
  4. Existing predicate behavior (`resolveVoiceStateLifecycle`, today asserted near `agent-input-ui.svelte:972`) still holds through the controller interface.
  5. Dispose is idempotent and tears down listeners + waveform; no leaked listener after dispose.
- Confirm RED before U2.

**U2 — Build `VoiceSessionController`**
- Files:
  - `packages/desktop/src/lib/acp/components/agent-input/state/voice-session-controller.svelte.ts` (new)
  - Consumes (stay exported): `logic/voice-state-lifecycle.ts`, `logic/voice-ui-state.ts`, `logic/voice-toolbar-binding.ts`, `state/voice-transitions.ts`, `state/voice-input-state.svelte.ts`, `state/waveform-state.svelte.ts` (constructed as a private field), and the keyboard fragments as needed.
- Changes: controller owns the FSM + async `listen`/`dispose`, holding both race mechanisms (KTD-1). Exposes `ready` and the controller methods the composer needs (start/cancel/etc., mirroring today's host calls). `VoiceInputState` stays a first-class exported class (R5).
- Verify: U1 green; `bun run check`.

**U3 — Rewire host; delete in-component voice spine**
- File: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` (2099 LOC)
- Changes: host instantiates `VoiceSessionController`, passes `effectiveVoiceSessionId`, reads `ready`. Delete the four local mirror vars (`voiceState` / `voiceStateSessionId` / `voiceStatePendingSessionId` / `voiceStateInitGeneration`) and the in-component `initializeVoiceState` / dispose / generation logic (`:912-989`). Remove now-internal fragment imports **from this host only**.
- **Out of scope (do not touch):** `git-panel.svelte`'s independent `VoiceInputState` lifecycle (~`:219-246`). It imports `VoiceInputState` by path, so an API break there is a regression this unit must avoid — confirm `bun run check` passes for it.
- Verify: `bun run check`; dev QA (HMR) shows voice working in **both** the agent-input composer and the git panel.

## Risks & Mitigations

- **R-1 (highest): re-opening a race by over-unifying the guards.** Mitigation: KTD-1 keeps both mechanisms; U1 scenarios 1 and 2 assert the two distinct races independently and must both pass.
- **R-2: breaking `git-panel.svelte`'s independent voice lifecycle.** Mitigation: `VoiceInputState` stays exported; U3 explicitly excludes git-panel and verifies `bun run check` + dev QA for it.
- **R-3: behavior drift in the predicate fragments during extraction.** Mitigation: U1 scenario 4 asserts existing predicate behavior through the controller; fragments are consumed, not rewritten (KTD-2).
- **R-4: hidden host coupling (a composer control still reaching into a deleted host var).** Mitigation: `bun run check` after U3 surfaces every broken reference; dev QA confirms the composer mic/cancel/overlay still function.

## Verification Summary

- Per unit: red test confirmed failing → implementation → green → `bun run check`.
- `voice-session-controller.vitest.ts` green (both races + `ready` + dispose).
- Dev QA via HMR: voice records / transcribes / cancels in the agent-input composer **and** the git panel (no Rust change, so no dev-server restart needed).
- No `cargo` changes — voice input is transient UI state, not canonical.
