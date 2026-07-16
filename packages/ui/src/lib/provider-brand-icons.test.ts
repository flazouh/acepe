import { describe, expect, it } from "vitest";

import {
	getProviderBrandIconSrc,
	getUpstreamProviderBrandIconSrc,
} from "./provider-brand-icons.js";

describe("provider brand icons", () => {
	it("keeps the Codex agent mark separate from the OpenAI upstream mark", () => {
		const codexAgentLightIcon = getProviderBrandIconSrc("codex", "light");
		const codexAgentDarkIcon = getProviderBrandIconSrc("codex", "dark");
		const openAiUpstreamIcon = getUpstreamProviderBrandIconSrc("openAi", "dark");

		expect(codexAgentLightIcon).toBe("/svgs/agents/codex/codex-icon-light.svg");
		expect(codexAgentDarkIcon).toBe("/svgs/agents/codex/codex-icon-dark.svg");
		expect(openAiUpstreamIcon).toBe("/svgs/agents/codex/openai-icon.svg");
		expect(codexAgentDarkIcon).not.toBe(openAiUpstreamIcon);
	});
});
