import { describe, expect, it } from "bun:test";

import { agentInputSubmitButtonClass } from "./agent-input-submit-button-variants.js";

describe("agentInputSubmitButtonVariants", () => {
	it("keeps submit on the foreground surface without a split menu segment", () => {
		expect(agentInputSubmitButtonClass).toContain("bg-foreground");
		expect(agentInputSubmitButtonClass).toContain("rounded-lg");
		expect(agentInputSubmitButtonClass).toContain("disabled:opacity-50");
		expect(agentInputSubmitButtonClass).not.toContain("rounded-l-lg");
		expect(agentInputSubmitButtonClass).not.toContain("rounded-r-none");
	});
});
