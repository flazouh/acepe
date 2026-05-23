import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import {
	createAgentPanelDisplaySceneEntriesReadModel,
	type AgentPanelDisplayMemory,
	type AgentPanelDisplayModel,
} from "./agent-panel-display-model.js";

export function applyAgentPanelDisplayModelToSceneEntries(
	model: AgentPanelDisplayModel,
	memory: AgentPanelDisplayMemory,
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	return createAgentPanelDisplaySceneEntriesReadModel().apply({
		model,
		memory,
		sceneEntries,
	});
}
