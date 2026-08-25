import { describe, expect, it } from "bun:test";

import { getNewThreadChipClass } from "./agent-input-new-thread-chip-state.js";

describe("new thread chip rest state", () => {
	it("keeps chips at half opacity until hover or focus", () => {
		const className = getNewThreadChipClass();

		expect(className).toContain("opacity-50");
		expect(className).toContain("hover:opacity-100");
		expect(className).toContain("focus-within:opacity-100");
		expect(className).toContain("transition-opacity");
	});
});
