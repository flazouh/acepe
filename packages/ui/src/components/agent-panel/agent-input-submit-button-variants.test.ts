import { describe, expect, it } from "bun:test";

import {
	agentInputSubmitMenuSegmentClass,
	agentInputSubmitSegmentBase,
} from "./agent-input-submit-button-variants.js";

describe("agentInputSubmitButtonVariants", () => {
	it("keeps the enter-behavior menu segment on the same foreground surface as submit", () => {
		expect(agentInputSubmitSegmentBase).toContain("bg-foreground");
		expect(agentInputSubmitMenuSegmentClass).toContain("bg-foreground");
		expect(agentInputSubmitMenuSegmentClass).toContain("dark:bg-foreground");
		expect(agentInputSubmitMenuSegmentClass).toContain("hover:bg-foreground/85");
		expect(agentInputSubmitMenuSegmentClass).toContain("dark:hover:bg-foreground/85");
		expect(agentInputSubmitMenuSegmentClass).not.toContain("dark:bg-input");
	});
});
