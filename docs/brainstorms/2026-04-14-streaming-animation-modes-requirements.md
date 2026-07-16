---
date: 2026-04-14
topic: streaming-animation-modes
---

# Streaming Animation Modes

## Problem Frame

Acepe's current assistant message streaming does not feel as smooth or premium as products like Perplexity or Notion. The current reveal is a single hardcoded behavior, which prevents users from choosing a presentation style that matches their preference. We want a smoother default experience without removing the existing behavior for users who prefer it, and without forcing animation on users who want messages to appear immediately.

## Requirements

**User-visible behavior**
- R1. Acepe must expose a user-selectable streaming animation setting with exactly three modes: `Smooth`, `Classic`, and `Instant`.
- R2. `Smooth` must be the default mode for new and existing users who do not already have an explicit streaming animation preference saved.
- R3. The selected streaming animation mode must apply consistently to assistant message streaming in the agent panel wherever the current streaming reveal behavior appears.

**Mode definitions**
- R4. `Smooth` must present streaming as buffered append behavior rather than character-by-character typewriter reveal.
- R5. `Smooth` must apply a subtle fade-in treatment only to the newly appended tail, not to the entire message body and not to already settled content.
- R6. `Classic` must preserve the current reveal behavior closely enough that existing users who prefer it can continue using it without a material UX change.
- R7. `Instant` must render streaming content without animation or staged reveal.

**Settings and persistence**
- R8. Users must be able to change the streaming animation mode from the Chat section of Settings.
- R9. The selected mode must persist across app restarts using the app's existing settings persistence patterns.
- R10. The settings UI must describe the options clearly enough that users can understand the difference between `Smooth`, `Classic`, and `Instant` without trying each one first.

## Success Criteria
- Streaming in `Smooth` feels visibly calmer and more premium than the current default behavior.
- Users who dislike animation can switch to `Instant` and stop seeing reveal effects.
- Users who prefer the current behavior can switch to `Classic` and retain it.
- The setting behaves predictably and stays in effect across sessions.

## Scope Boundaries
- No reduced-motion-specific behavior is required for this change.
- This work does not require changing provider-side streaming behavior.
- This work does not require adding per-session or per-panel streaming mode overrides.
- This work does not require redesigning non-message loading animations elsewhere in the product.

## Key Decisions
- Default mode: `Smooth`, because the goal is to improve the out-of-box feel rather than hide the new behavior behind opt-in settings.
- Option set: `Smooth`, `Classic`, and `Instant`, so users can choose between premium motion, legacy behavior, and no animation.
- Smooth motion style: buffered append with tail-only fade, because it should feel more like premium streaming products and avoid animating already rendered content.
- Accessibility handling: reduced-motion behavior is explicitly out of scope for this requirement set.

## Dependencies / Assumptions
- The existing settings system can persist one additional chat-related preference.
- The current message streaming architecture can be refactored to support multiple reveal strategies without changing the upstream session/chunk ingestion model.

## Outstanding Questions

### Deferred to Planning
- [Affects R3][Technical] Where the reveal strategy boundary should live so `markdown-text.svelte` can switch modes cleanly without duplicating rendering logic.
- [Affects R4][Needs research] What buffer cadence and batching behavior best achieve a smooth feel without making the stream feel delayed.
- [Affects R5][Technical] What tail-only fade treatment is subtle enough to feel polished without causing distraction during long responses.
- [Affects R10][Technical] Whether the Settings UI should use a segmented control, select, or radio-group style control within the existing settings page patterns.

## Next Steps

-> Create a structured implementation plan in docs/plans/