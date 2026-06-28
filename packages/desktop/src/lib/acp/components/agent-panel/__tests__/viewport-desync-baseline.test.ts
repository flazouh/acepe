import { describe, expect, test } from "bun:test";
import type { ViewportBufferPush } from "../../../../services/acp-types.js";

// Unit 0 — falsification + characterization baseline for the DOM-authority
// transcript-viewport rewrite. This does NOT test production behavior; it pins,
// in compilable form, the *structural failure shape* the rewrite must make
// unrepresentable, so the Unit 7 cutover can prove the void is gone.
//
// See docs/solutions/transcript-viewport-dom-authority-baseline.md and
// docs/plans/2026-06-28-002-refactor-transcript-viewport-dom-authority-plan.md.
//
// Tripwire: this file is wired to the real `ViewportBufferPush` type. When Unit 6
// strips `totalHeightPx` / `layoutRowCount` from the Rust→WebView wire, this file
// stops compiling — forcing Unit 7 to delete the repro and assert the positive
// rows-only invariant in its place. That compile break IS the proof the dual
// authority is gone.

/**
 * Faithful repro of the live broken state: the projection claimed a 28-row /
 * 4088px layout while only a tiny window of rows was actually rendered (observed
 * as low as 2; modeled here as the empty window — the maximal void). All pixel /
 * count metadata below is a *separate authority* from `rows`.
 */
const OBSERVED_LAYOUT_ROW_COUNT = 28;
const OBSERVED_TOTAL_HEIGHT_PX = 4088;

function desyncReproPush(): ViewportBufferPush {
	return {
		sessionId: "session-baseline",
		graphRevision: { graphRevision: 1, transcriptRevision: 1, lastEventSeq: 1 },
		viewportRevision: 1,
		emissionSeq: 1,
		bufferStartIndex: 0,
		bufferEndIndex: 0,
		// Claimed layout — the "authority" the spacer is sized from:
		layoutRowCount: OBSERVED_LAYOUT_ROW_COUNT,
		totalHeightPx: OBSERVED_TOTAL_HEIGHT_PX,
		bufferEndOffsetPx: OBSERVED_TOTAL_HEIGHT_PX,
		// Rendered window — the *other* authority. Empty here: nothing to paint
		// under a 4088px spacer => 4088px of void.
		rows: [],
		offsetsPx: [],
		mode: { kind: "followingTail" },
		diagnostics: [],
	};
}

/**
 * The legacy spacer model: the WebView sizes a spacer to `totalHeightPx` and
 * paints only the rendered window on top. The void is whatever the spacer claims
 * beyond the actual rendered content. This helper exists only to make the failure
 * shape measurable; the rewrite deletes the spacer entirely.
 */
function legacySpacerVoidPx(push: ViewportBufferPush, renderedRowHeightsPx: readonly number[]): number {
	const rendered = renderedRowHeightsPx.reduce((sum, h) => sum + h, 0);
	return push.totalHeightPx - rendered;
}

describe("transcript viewport — structural desync baseline (Unit 0)", () => {
	test("claimed layout is an authority independent of the rendered window", () => {
		const push = desyncReproPush();
		// The bug class: claimed row count can exceed what the window ships.
		expect(push.rows.length).toBeLessThan(push.layoutRowCount);
	});

	test("a totalHeightPx-sized spacer over an empty window is pure void", () => {
		const push = desyncReproPush();
		expect(legacySpacerVoidPx(push, [])).toBe(OBSERVED_TOTAL_HEIGHT_PX);
	});

	test("even a partially-rendered window leaves a void the user cannot fill by scrolling", () => {
		const push = desyncReproPush();
		// Model the observed "2 rendered rows" at a typical ~150px each.
		const twoRealRows = [150, 150];
		const voidPx = legacySpacerVoidPx(push, twoRealRows);
		expect(voidPx).toBe(OBSERVED_TOTAL_HEIGHT_PX - 300); // 3788px of emptiness
		expect(voidPx).toBeGreaterThan(0);
	});

	// Parity invariant the rewrite must satisfy (asserted positively in Unit 7):
	// scrollable height derives from rendered rows, and no totalHeightPx /
	// layoutRowCount / offset pixel field crosses the wire. Under that contract
	// `legacySpacerVoidPx` has no inputs to compute from — the void is
	// unrepresentable. Documented here; enforced when this file fails to compile
	// after the Unit 6 wire-strip.
});
