import { describe, expect, it } from "vitest";

import { resolveAgentPanelProviderBrand } from "../agent-panel-provider-brand.js";

describe("resolveAgentPanelProviderBrand", () => {
	it("uses canonical session provider metadata before registry fallbacks", () => {
		expect(
			resolveAgentPanelProviderBrand({
				sessionProviderBrand: "claude-code",
				storeProviderBrand: "custom",
				listedProviderBrand: "custom",
			})
		).toBe("claude-code");
	});

	it("falls back to registry metadata when the session has no provider metadata", () => {
		expect(
			resolveAgentPanelProviderBrand({
				sessionProviderBrand: null,
				storeProviderBrand: "codex",
				listedProviderBrand: "custom",
			})
		).toBe("codex");
	});

	it("uses a built-in canonical agent id before custom registry metadata", () => {
		expect(
			resolveAgentPanelProviderBrand({
				agentId: "claude-code",
				sessionProviderBrand: null,
				storeProviderBrand: "custom",
				listedProviderBrand: "custom",
			})
		).toBe("claude-code");
	});

	it("does not return the temporary custom provider brand", () => {
		expect(
			resolveAgentPanelProviderBrand({
				sessionProviderBrand: "custom",
				storeProviderBrand: "custom",
				listedProviderBrand: "custom",
			})
		).toBe(null);
	});
});
