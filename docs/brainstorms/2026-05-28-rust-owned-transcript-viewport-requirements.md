---
date: 2026-05-28
topic: rust-owned-transcript-viewport
---

# Rust-Owned Transcript Viewport

## Summary

Acepe should replace the agent-panel transcript's WebView-owned virtualization authority with a Rust-owned canonical viewport and layout authority. The WebView should become a thin renderer of bounded visible-window data, while Rust owns transcript row identity, row order, follow-tail state, scroll anchoring, layout cache decisions, and delta delivery.

---

## Problem Frame

The current agent-panel transcript has improved substantially: it uses a pure TypeScript viewport reducer, a renderer adapter around TanStack Virtual, and canonical scene projections. But the remaining architecture still leaves important product truth outside the canonical backend. Row visibility, scroll offset, height cache, follow behavior, measurement timing, and mounted row identity are partly decided by browser layout, Svelte effects, DOM refs, ResizeObservers, and TanStack's internal state.

That shape is good enough for pragmatic UI stabilization, but not for the target Acepe architecture. For a production-grade agentic developer environment used heavily by many developers, transcript rendering must be deterministic, bounded, debuggable, and canonical-first. The user explicitly wants to reason from the "GOD" architecture bar: purity, deterministic behavior, production-grade separation of concerns, minimal request/update bytes, and no reader-level patches that make the UI look right while truth remains split.

Zed's GPUI list model provides an important reference point. Zed does not delegate transcript list behavior to browser virtualization. Its list state is an owned Rust/GPUI primitive backed by cumulative measurement data, logical scroll offsets, explicit follow-tail state, splice/remeasure APIs, focused-item retention, and list-owned reveal behavior. Acepe should move in the same direction while respecting its Tauri/Svelte architecture: Rust should own canonical viewport decisions, and Svelte should render only the visible projection plus report user scroll intent and measured row confirmations.

---

## Actors

- A1. Developer using Acepe: Reads, scrolls, resumes, and supervises long agent sessions without losing transcript position or follow-tail behavior.
- A2. Agent runtime/provider edge: Emits canonical transcript, operation, interaction, and lifecycle facts that feed the viewport authority.
- A3. Rust canonical graph/viewport authority: Owns transcript display truth, layout decisions, visible-window derivation, follow state, and bounded delta emission.
- A4. Svelte desktop renderer: Renders bounded visible rows, forwards user input/measurement confirmations, and avoids semantic repair.
- A5. Implementing agent: Uses the requirements and plan to replace the current split authority without introducing coexistence as an endpoint.

---

## Key Flows

- F1. Live streaming follow-tail
  - **Trigger:** An active agent session streams assistant text or tool activity while the developer is following the tail.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Provider facts enter the canonical graph; Rust derives display-row deltas and viewport changes; Svelte applies a visible-window delta; row growth is reflected without mounting unbounded history or relying on competing measurement loops.
  - **Outcome:** The newest content remains visible deterministically while follow-tail is active.
  - **Covered by:** R1, R2, R4, R7, R10, R13

- F2. User detaches from tail
  - **Trigger:** The developer scrolls upward in a long transcript.
  - **Actors:** A1, A3, A4
  - **Steps:** Svelte reports user scroll intent; Rust updates the viewport authority to detached mode; new transcript deltas update total layout state without forcing the visible window to jump to the tail.
  - **Outcome:** The developer's reading position stays stable while new content arrives.
  - **Covered by:** R2, R5, R8, R10, R11

- F3. Session open or restore
  - **Trigger:** The developer opens a historical or restored session with a long transcript.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Rust materializes canonical transcript facts, computes initial row arena and viewport state, emits a bounded visible window, and hydrates cached/estimated layout data without rendering the full transcript.
  - **Outcome:** The session opens with bounded rendering, stable initial position, and no WebView-owned reconstruction of display truth.
  - **Covered by:** R1, R3, R6, R9, R12, R14

- F4. Row height confirmation
  - **Trigger:** Svelte renders a visible row whose measured height differs from Rust's current height decision.
  - **Actors:** A3, A4
  - **Steps:** Svelte sends a row-versioned height confirmation; Rust validates it against canonical row identity/version, updates layout indexes if accepted, and emits any needed visible-window correction.
  - **Outcome:** Measurement feedback is bounded, versioned, and subordinate to Rust-owned layout authority.
  - **Covered by:** R6, R8, R10, R12, R15

---

## Requirements

**Canonical authority**
- R1. Rust must own transcript display row identity, row order, row kind, row version, and row-to-operation/interaction joins before the WebView receives data.
- R2. Rust must own viewport semantic state: follow-tail vs detached, anchor row, logical scroll offset, pending reveal requests, and visible range.
- R3. The WebView must not derive, merge, sort, repair, or reinterpret transcript rows from raw session entries, provider IDs, or provider-specific facts.
- R4. Assistant text/thought/tool grouping must be resolved before viewport delivery as canonical display rows or canonical row facts, not in the virtualized renderer.

**Viewport and layout behavior**
- R5. Scroll position must be represented as a logical canonical viewport position rather than raw browser `scrollTop` as product truth.
- R6. Rust must maintain a row layout index that can answer total height, row offsets, visible range, anchor preservation, and tail position without scanning the full transcript on every hot update.
- R7. Follow-tail behavior must be explicit and deterministic: tail growth keeps the newest content revealed only while follow mode is active.
- R8. Detached reading must preserve the user's anchor across row insertions, removals, row growth, and height confirmation corrections.
- R9. Session open and restore must emit a bounded visible window rather than requiring Svelte/TanStack to reconstruct row visibility from the full transcript.

**Delta protocol and byte discipline**
- R10. The Rust-to-WebView protocol must be delta-oriented: hot streaming updates send changed row content/version/height-window facts, not full transcript or full display-entry snapshots.
- R11. User scroll and reveal requests from the WebView to Rust must be intent-level events, not direct semantic state writes.
- R12. Height confirmations must be row-versioned and bounded so stale measurements cannot corrupt canonical layout state.
- R13. The visible-window payload must be proportional to the number of rendered rows plus changed rows, not total transcript length.

**Renderer boundary**
- R14. Svelte must render only the current visible-window projection plus bounded overscan/window rows supplied by Rust.
- R15. Svelte may report measured heights, focus/selection-affecting local state, and user input intent, but it must not decide canonical follow state, row order, or display identity.
- R16. The final architecture must delete the TanStack transcript virtualizer path and any duplicate transcript viewport authority rather than keeping it as a permanent fallback.

**Quality and proof**
- R17. The implementation must include behavior tests proving follow-tail, detach, anchor preservation, streaming row growth, row insertion/removal, stale height confirmation rejection, and bounded visible-window emission.
- R18. The implementation must include architectural guard tests preventing transcript viewport product code from importing browser virtualizer dependencies or reconstructing display truth from raw provider/session data.
- R19. The migration must preserve current agent-panel user-visible behavior for live streaming, historical reading, tool rows, permissions/questions, send reveal, and session switching unless an explicit follow-up requirement changes it.
- R20. The implementation must include performance or budget tests showing hot streaming and long-session open/update payloads are bounded independently of total transcript length.

---

## Acceptance Examples

- AE1. **Covers R2, R7, R10, R13.** Given a long session with follow-tail active, when the assistant streams more text into the latest row, Rust emits a bounded row/visible-window delta and the latest content remains revealed without Svelte scrolling to an index on its own.
- AE2. **Covers R5, R8, R11.** Given a developer has scrolled away from the tail, when new assistant and tool rows arrive, the visible reading anchor stays stable and the renderer does not jump to the bottom.
- AE3. **Covers R6, R9, R13, R20.** Given a historical session with thousands of rows, when it opens, the first emitted viewport payload contains only the bounded visible window plus required metadata, not every transcript row.
- AE4. **Covers R12, R15.** Given a row is re-rendered after its content version changes, when an old height confirmation arrives for the previous version, Rust ignores it and the visible window remains based on the current row version.
- AE5. **Covers R3, R4, R18.** Given provider history contains reused provider assistant IDs, when the transcript is projected, display row identity and order come from canonical row facts rather than WebView grouping or provider-ID merging.
- AE6. **Covers R16, R19.** Given the new viewport authority is active, when existing agent-panel flows render live streaming, historical sessions, tool calls, permissions/questions, and send reveal, there is no permanent fallback path that lets TanStack or Svelte own transcript visibility semantics.

---

## Success Criteria

- A teammate can describe transcript rendering as one authority path: canonical Rust graph and viewport authority -> visible-window deltas -> dumb Svelte renderer.
- Long-session transcript open, streaming, and scroll updates are bounded by visible rows and changed rows, not total transcript length.
- Follow-tail and detached-reading behavior are deterministic enough to test without relying on browser timing or TanStack internals.
- Provider IDs are never used by the WebView as display identity or grouping authority.
- The current transcript virtualizer complexity in the Svelte agent-panel view is deleted or reduced to a non-authoritative renderer shell.
- Tests prove both behavior and architecture boundaries: no WebView display-truth reconstruction, no permanent dual virtualizer authority, and bounded protocol payloads.

---

## Scope Boundaries

- This brainstorm targets the agent-panel transcript viewport and layout authority, not a full GPUI rewrite of Acepe.
- This brainstorm does not require replacing Svelte or Tauri. The target keeps Svelte as the desktop renderer but removes its ownership of transcript viewport truth.
- This brainstorm does not require full Canvas/WebGL rendering. DOM rendering remains acceptable for accessibility and native interaction, provided layout decisions remain Rust-owned.
- This brainstorm does not require introducing a generic Differential Dataflow or Salsa dependency. Those are possible implementation inspirations, but the requirement is an owned deterministic core and bounded delta protocol.
- This brainstorm does not define new visual design for the transcript. Existing user-visible behavior should be preserved unless a separate requirement changes it.
- This brainstorm does not authorize a long-lived coexistence architecture where old TanStack/Svelte viewport authority remains as a parallel production path.
- This brainstorm does not require solving every long-session performance issue outside transcript viewport/layout authority; adjacent selector, journal, and restore performance work belongs to separate performance requirements unless directly needed here.

---

## Key Decisions

- **Rust owns viewport truth:** The clean architecture is not a better Svelte/TanStack wrapper; it is a Rust-owned viewport and layout authority with a thin WebView renderer.
- **DOM can remain a renderer, not an authority:** Keeping DOM preserves accessibility, selection, copy/paste, links, and existing UI composition, while still moving layout decisions upstream.
- **Deltas over snapshots:** Hot streaming and visible-window updates should be structural deltas bounded by changed rows and rendered rows.
- **No permanent dual path:** The current TanStack transcript virtualizer may inform migration tests, but it is not an acceptable endpoint beside the Rust-owned authority.
- **Zed is prior art for the shape, not a direct port:** Zed's owned GPUI `ListState` validates the direction: explicit follow mode, logical offsets, splice/remeasure, cumulative height index, and renderer-owned measurement callbacks. Acepe should adapt the pattern to its Rust/Tauri/Svelte split rather than replatforming the whole UI.

---

## Dependencies / Assumptions

- Existing canonical transcript/order/operation facts are strong enough, or can be widened, to produce canonical display rows without WebView repair.
- The Rust backend can emit viewport/materialization deltas through the existing Tauri event/request path without making the WebView depend on provider-specific facts.
- Some final row height information may still come from DOM measurement, but measurement feedback is subordinate to Rust-owned row identity/version and layout state.
- Accessibility, text selection, copy/paste, and existing transcript content affordances are product requirements; a pure Canvas/WebGL renderer is not assumed acceptable.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R4][Technical] Which canonical Rust module should own display-row projection: an extension of the session graph, a dedicated transcript viewport domain, or a separate materialization layer fed by canonical transcript and operation graph?
- [Affects R6-R13][Technical] What exact row layout index should be used for cumulative heights and visible-range queries?
- [Affects R10-R13][Technical] What versioned delta protocol should connect Rust viewport authority to the Svelte renderer?
- [Affects R12-R15][Technical] What is the strict contract for DOM height confirmations, stale measurement rejection, and layout correction emissions?
- [Affects R16-R20][Technical] What migration sequence removes TanStack/Svelte viewport authority cleanly without ending in a coexistence architecture?

## Next Steps

-> Create a structured implementation plan in docs/plans/