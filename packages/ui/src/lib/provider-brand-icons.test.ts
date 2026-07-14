import { describe, expect, it } from "vitest";

import {
	getProviderBrandIconSrc,
	getUpstreamProviderBrandIconSrc,
} from "./provider-brand-icons.js";

describe("provider brand icons", () => {
	it("keeps the Codex agent mark separate from the OpenAI upstream mark", () => {
		const codexAgentIcon = getProviderBrandIconSrc("codex", "dark");
		const openAiUpstreamIcon = getUpstreamProviderBrandIconSrc("openAi", "dark");

		expect(codexAgentIcon).toBe("/svgs/agents/codex/codex-icon.svg");
		expect(openAiUpstreamIcon).toBe("/svgs/agents/codex/openai-icon.svg");
		expect(codexAgentIcon).not.toBe(openAiUpstreamIcon);
	});
});
