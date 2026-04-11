import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import AgentPanelScene from "./agent-panel-scene.svelte";
import {
	AgentPanelSceneComposer,
	AgentPanelSceneEntry,
	AgentPanelSceneHeader,
	AgentPanelSceneReviewCard,
	AgentPanelSceneSidebar,
	AgentPanelSceneStatusStrip,
} from "./index.js";

test("scene renderer exports are defined", () => {
	expect(AgentPanelScene).toBeDefined();
	expect(AgentPanelSceneComposer).toBeDefined();
	expect(AgentPanelSceneEntry).toBeDefined();
	expect(AgentPanelSceneHeader).toBeDefined();
	expect(AgentPanelSceneReviewCard).toBeDefined();
	expect(AgentPanelSceneSidebar).toBeDefined();
	expect(AgentPanelSceneStatusStrip).toBeDefined();
});

describe("scene architecture", () => {
	const sceneSource = readFileSync(
		resolve(__dirname, "./agent-panel-scene.svelte"),
		"utf-8"
	);

	test("renders through AgentPanel shell, not its own layout div", () => {
		expect(sceneSource).toContain('import AgentPanel from "../agent-panel/agent-panel.svelte"');
		expect(sceneSource).toContain("<AgentPanel");
	});

	test("all snippet override props are optional", () => {
		expect(sceneSource).toContain("headerControls?: Snippet");
		expect(sceneSource).toContain("composerOverride?: Snippet");
		expect(sceneSource).toContain("footerOverride?: Snippet");
		expect(sceneSource).toContain("conversationBody?: Snippet");
	});
});
