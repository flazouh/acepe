import { describe, expect, it } from "vitest";

import {
	getProviderBrandIcon,
	resolveAgentIconProviderBrand,
} from "./thread-list-constants.js";

describe("thread-list-constants", () => {
	it("falls back to the built-in Codex provider brand when metadata is missing", () => {
		const providerBrand = resolveAgentIconProviderBrand({
			agentId: "codex",
			explicitProviderBrand: null,
			storeProviderBrand: null,
		});

		expect(providerBrand).toBe("codex");
		expect(getProviderBrandIcon(providerBrand, "dark")).toBe("/svgs/agents/codex/codex-icon-dark.svg");
	});

	it("falls back to the built-in Codex provider brand when metadata is custom", () => {
		expect(
			resolveAgentIconProviderBrand({
				agentId: "codex",
				explicitProviderBrand: "custom",
				storeProviderBrand: "custom",
			})
		).toBe("codex");
	});

	it("prefers explicit provider metadata over the agent id fallback", () => {
		expect(
			resolveAgentIconProviderBrand({
				agentId: "codex",
				explicitProviderBrand: "copilot",
				storeProviderBrand: null,
			})
		).toBe("copilot");
	});
});
