import { expect, test } from "bun:test";

import AgentPanelScene from "./agent-panel-scene.svelte";
import {
	AgentPanelSceneComposer,
	AgentPanelSceneEntry,
	AgentPanelSceneHeader,
	AgentPanelSceneReviewCard,
	AgentPanelSceneSidebar,
	AgentPanelSceneStatusStrip,
} from "./index.js";
import {
	AgentPanelScene as RootAgentPanelScene,
	AgentPanelSceneEntry as RootAgentPanelSceneEntry,
} from "../../index.js";

test("scene renderer exports are defined", () => {
	expect(AgentPanelScene).toBeDefined();
	expect(AgentPanelSceneComposer).toBeDefined();
	expect(AgentPanelSceneEntry).toBeDefined();
	expect(AgentPanelSceneHeader).toBeDefined();
	expect(AgentPanelSceneReviewCard).toBeDefined();
	expect(AgentPanelSceneSidebar).toBeDefined();
	expect(AgentPanelSceneStatusStrip).toBeDefined();
	expect(RootAgentPanelScene).toBeDefined();
	expect(RootAgentPanelSceneEntry).toBeDefined();
});
