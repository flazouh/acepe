import { describe, expect, test } from "bun:test";
import type { ViewportBufferPush } from "../../../../services/acp-types.js";

// Positive guard for the DOM-authority transcript viewport rewrite. The old bug
// came from two authorities crossing the Rust -> WebView wire:
//
//   Rust pixels/counts: totalHeightPx, offsetsPx, layoutRowCount
//   DOM rows:          rows actually rendered
//
// The new wire sends ordered rows only. The DOM owns scroll height.

function rowsOnlyPush(): ViewportBufferPush {
	return {
		sessionId: "session-baseline",
		graphRevision: { graphRevision: 1, transcriptRevision: 1, lastEventSeq: 1 },
		emissionSeq: 1,
		rows: [],
		diagnostics: [],
	};
}

describe("transcript viewport — rows-only wire baseline", () => {
	test("buffer push has no independent layout authority", () => {
		const json = JSON.stringify(rowsOnlyPush());

		expect(json).not.toContain("totalHeightPx");
		expect(json).not.toContain("layoutRowCount");
		expect(json).not.toContain("offsetsPx");
		expect(json).not.toContain("bufferEndOffsetPx");
		expect(json).not.toContain("scrollTopTarget");
		expect(json).not.toContain("scrollAnchorCorrectionPx");
		expect(json).not.toContain("mode");
	});

	test("an empty row push cannot claim scrollable height", () => {
		const push = rowsOnlyPush();

		expect(push.rows).toHaveLength(0);
		expect(Object.keys(push).sort()).toEqual([
			"diagnostics",
			"emissionSeq",
			"graphRevision",
			"rows",
			"sessionId",
		]);
	});
});
