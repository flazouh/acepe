import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

export type AgentPanelSceneEntryArrayPatch = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly entriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>;
};

export type AgentPanelSceneEntryArrayAppendPatch = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly appendedEntries: readonly AgentPanelSceneEntryModel[];
};

export type AgentPanelSceneEntryArrayTruncation = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly length: number;
};

const agentPanelSceneEntryArrayPatches = new WeakMap<
	readonly AgentPanelSceneEntryModel[],
	AgentPanelSceneEntryArrayPatch
>();
const agentPanelSceneEntryArrayAppendPatches = new WeakMap<
	readonly AgentPanelSceneEntryModel[],
	AgentPanelSceneEntryArrayAppendPatch
>();
const agentPanelSceneEntryArrayTruncations = new WeakMap<
	readonly AgentPanelSceneEntryModel[],
	AgentPanelSceneEntryArrayTruncation
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

export function markAgentPanelSceneEntryArrayAppendPatch(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	patch: AgentPanelSceneEntryArrayAppendPatch
): void {
	agentPanelSceneEntryArrayAppendPatches.set(sceneEntries, patch);
}

export function getAgentPanelSceneEntryArrayAppendPatch(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): AgentPanelSceneEntryArrayAppendPatch | undefined {
	return agentPanelSceneEntryArrayAppendPatches.get(sceneEntries);
}

export function markAgentPanelSceneEntryArrayTruncation(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	truncation: AgentPanelSceneEntryArrayTruncation
): void {
	agentPanelSceneEntryArrayTruncations.set(sceneEntries, truncation);
}

export function getAgentPanelSceneEntryArrayTruncation(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): AgentPanelSceneEntryArrayTruncation | undefined {
	return agentPanelSceneEntryArrayTruncations.get(sceneEntries);
}
