import { describe, expect, it } from "bun:test";

import { SETUP_BAR_COPY } from "$lib/setup-bar/setup-bar-state.ts";

describe("setup bar view copy", () => {
	it("keeps English setup bar labels in the desktop model", () => {
		expect(SETUP_BAR_COPY.skillsHeading).toBe("Skills");
		expect(SETUP_BAR_COPY.mcpHeading).toBe("MCP servers");
		expect(SETUP_BAR_COPY.optionsHeading).toBe("Setup");
	});
});
