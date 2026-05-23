import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

export type AgentPanelSceneEntryArrayPatch = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly entriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>;
};

const agentPanelSceneEntryArrayPatches = new WeakMap<
	readonly AgentPanelSceneEntryModel[],
	AgentPanelSceneEntryArrayPatch
>();

export function markAgentPanelSceneEntryArrayPatch(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	patch: AgentPanelSceneEntryArrayPatch
): void {
	agentPanelSceneEntryArrayPatches.set(sceneEntries, patch);
}

export function getAgentPanelSceneEntryArrayPatch(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): AgentPanelSceneEntryArrayPatch | undefined {
	return agentPanelSceneEntryArrayPatches.get(sceneEntries);
}
