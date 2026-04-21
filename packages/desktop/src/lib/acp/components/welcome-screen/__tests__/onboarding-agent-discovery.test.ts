import { describe, expect, it } from "bun:test";

import { getOnboardingSelectableAgents } from "../onboarding-agent-discovery.js";

describe("getOnboardingSelectableAgents", () => {
	it("keeps only agents that support project discovery", () => {
		expect(
			getOnboardingSelectableAgents([
				{ id: "claude-code", name: "Claude Code", icon: "claude", supportsProjectDiscovery: true },
				{ id: "custom-agent", name: "Custom Agent", icon: "terminal", supportsProjectDiscovery: false },
				{ id: "copilot", name: "GitHub Copilot", icon: "copilot", supportsProjectDiscovery: true },
			]).map((agent) => agent.id)
		).toEqual(["claude-code", "copilot"]);
	});
});
