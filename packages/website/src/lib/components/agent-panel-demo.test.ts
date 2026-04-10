import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import AgentPanelDemo from "./agent-panel-demo.svelte";
import {
	AGENT_PANEL_DEMO_SCRIPT,
	buildWebsiteAgentPanelScene,
} from "./agent-panel-demo-scene.js";

describe("agent panel demo", () => {
	it("renders the shared scene demo", () => {
		const { body } = render(AgentPanelDemo);

		expect(body).toContain("Migrate auth to JWT");
	});

	it("builds a website scene from mocked entries", () => {
		const scene = buildWebsiteAgentPanelScene({
			panelId: "test-panel",
			title: "JWT migration",
			projectName: "acepe",
			projectColor: "#7C3AED",
			status: "running",
			entries: AGENT_PANEL_DEMO_SCRIPT.slice(0, 4),
		});

		expect(scene.header.title).toBe("JWT migration");
		expect(scene.conversation.entries).toHaveLength(4);
	});
});
