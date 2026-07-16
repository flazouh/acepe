import { describe, expect, it } from "bun:test";

import { TOOL_CARD_HEADER_ROW_CLASS } from "./tool-card-header.js";

describe("TOOL_CARD_HEADER_ROW_CLASS", () => {
	it("keeps equal corner inset for icon-sm controls in an h-6 row", () => {
		expect(TOOL_CARD_HEADER_ROW_CLASS).toContain("h-6");
		expect(TOOL_CARD_HEADER_ROW_CLASS).toContain("pl-2");
		expect(TOOL_CARD_HEADER_ROW_CLASS).toContain("pr-0.5");
		expect(TOOL_CARD_HEADER_ROW_CLASS).not.toContain("px-2");
	});
});
