---
date: 2026-04-15
topic: streaming-markdown-during-reveal
---

# Streaming Markdown During Reveal

## Problem Frame

Acepe's assistant streaming currently feels worse than it should because markdown structure only appears after the reveal settles or the stream ends. During the live portion, users mostly see raw text or a limited live tail, then experience a late visual reshape into the final formatted message. That makes streamed answers harder to scan, weakens perceived quality, and makes the product feel less responsive even when tokens are arriving on time.

We want the streamed response to feel readable and structurally correct while it is still arriving, without reintroducing whole-block flicker, without making the final render less rich, and without turning the renderer into an unstable fully incremental markdown engine.

## Requirements

**Live readability**
- R1. Assistant messages must render a basic markdown presentation while text is still streaming, instead of waiting for the end of the reveal before showing markdown structure.
- R2. The live presentation must make common structure readable as it emerges, including paragraphs, headings, lists, blockquotes, inline emphasis, inline code, links, and fenced code blocks when the currently available text is sufficient to represent them coherently.
- R3. When the current streamed text is not yet structurally coherent, Acepe must prefer a stable partial presentation over aggressive reformatting that reshapes large portions of already visible content.

**Reveal and stability behavior**
- R4. Live markdown rendering must preserve the existing streaming-animation experience by acting only on content that is already visible within the active reveal, rather than bypassing animation or causing content to appear all at once.
- R5. All existing streaming modes must use the same live-markdown rules in this phase. Scope is limited to preserving current reveal timing semantics and preventing repeated animation, flicker, or pop-in, not to redesigning mode-specific visuals or heuristics.
- R6. Already visible content must not repeatedly flicker, re-fade, or be re-animated just because later markdown structure becomes available.
- R7. When a message transitions from live streaming to its settled final form, the handoff must feel continuous: the user should not see a sudden jump from mostly plain text to fully formatted content plus trailing blocks appearing at once.

**Final fidelity and fallback behavior**
- R8. The final settled message must still use Acepe's full markdown rendering path so users keep the richer end-state behavior they already expect.
- R9. Markdown features that depend on heavier, async, or enriched rendering may remain deferred until the settled final state as long as the live state still feels readable and structurally helpful.
- R10. Final-only rendering may add enrichment, but it must not reclassify already visible block boundaries or cause a large structural reshape at settle.
- R11. If a partially streamed construct cannot yet be rendered safely, Acepe must fall back to a stable live presentation for that portion instead of forcing a malformed or misleading markdown interpretation.
- R12. Live markdown must not materially regress stream responsiveness on long responses. If progressive formatting would introduce visible lag or jank, Acepe must temporarily fall back to a simpler stable presentation for the affected live region until it can settle safely.

## Success Criteria
- Users can understand the structure of a streamed answer while it is arriving instead of having to wait for the final render.
- Streaming feels more responsive because formatting appears progressively rather than in a late reshape, without a noticeable increase in token-to-paint lag or scroll jank on long answers.
- Existing smooth/classic/instant streaming modes still behave predictably during live markdown rendering because live markdown never reveals unrevealed text and never restarts animation on already visible content.
- Long or complex responses do not regress into whole-block flicker, repeated animation, or abrupt end-of-stream pop-in.

## Scope Boundaries
- This change does not require a fully general incremental markdown parser that guarantees perfect intermediate structure at every token boundary.
- This change does not require changing provider-side chunking or upstream session event behavior.
- This change does not require new user settings, per-session overrides, or a toggle between old and new markdown streaming behavior.
- This phase limits live rendering to paragraphs, headings, lists, blockquotes, inline emphasis, inline code, links, and fenced code blocks. Tables, task lists, images, HTML blocks, footnotes, and other advanced constructs may remain final-render-only.
- This change does not require enriched final-state features to become available during the live stream if doing so would add instability or major carrying cost.
- This phase must keep the existing final markdown renderer as-is and implement live markdown as a narrow augmentation within the current streaming/reveal pipeline, not as a new general-purpose markdown engine or renderer-architecture rewrite.

## Key Decisions
- Product direction: adopt a hybrid progressive markdown model, because that is the best tradeoff between live readability and rendering stability.
- Live/final split: basic markdown should appear during streaming, while enriched or heavier rendering can remain deferred until settle/end to protect responsiveness and reduce instability.
- Reveal boundary: live markdown may only affect already visible content; unrevealed streamed text cannot influence what appears on screen ahead of reveal.
- Stability over aggressiveness: when the current text is ambiguous, Acepe should preserve a coherent partial view instead of frequently reshaping already visible blocks.
- No new setting: this should become the standard streaming behavior rather than another user-managed preference.

## Dependencies / Assumptions
- The existing markdown renderer can continue to provide a richer final-state render even if the live path uses a narrower capability set.
- The current streaming reveal pipeline can support progressive markdown updates without discarding the mode-latched reveal behavior already introduced for smooth/classic/instant.

## Outstanding Questions

### Deferred to Planning
- [Affects R2][Technical] Which live markdown constructs can be promoted immediately with acceptable stability, and which should wait for additional structure before switching from fallback text to markdown.
- [Affects R3][Technical] What promotion rules best avoid visible reshaping when lists, blockquotes, or fenced code blocks are still incomplete.
- [Affects R4][Technical] Where the boundary should live between reveal state, live markdown rendering, and final enriched rendering so the stream stays animated without duplicating renderer logic.
- [Affects R9][Needs research] Which existing enriched markdown behaviors are safe to defer without noticeably harming the in-stream experience.

## Next Steps

-> /ce:plan for structured implementation planning
