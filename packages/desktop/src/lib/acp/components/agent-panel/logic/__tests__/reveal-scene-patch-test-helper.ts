// Test fixture helper: builds reveal-scene patched entries with an explicit ScenePatch.

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import { buildRevealScenePatchedEntriesWithPatch } from "../reveal-scene-patch.js";

export function buildRevealScenePatchedEntries(
	baseSceneEntries: readonly AgentPanelSceneEntryModel[],
	overridesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>
): readonly AgentPanelSceneEntryModel[] {
	return buildRevealScenePatchedEntriesWithPatch(baseSceneEntries, overridesByIndex).entries;
}

export { buildRevealScenePatchedEntriesWithPatch };
