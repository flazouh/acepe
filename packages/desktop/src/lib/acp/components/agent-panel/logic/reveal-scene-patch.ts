// Reveal-scene patch annotation — explicit ScenePatch return values for the
// reveal-text projection fast path (replaces the former WeakMap tagging).

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import { createPatchedSceneEntriesArray } from "./scene-entry-array-view.js";
import {
	scenePatchDisplayScene,
	scenePatchIdentity,
	type RevealScenePatchPayload,
	type ScenePatch,
} from "./scene-patch.js";

export type RevealScenePatch = RevealScenePatchPayload;

export type RevealTextProjectionResult = {
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly scenePatch: ScenePatch;
};

export function buildRevealScenePatchResult(
	baseSceneEntries: readonly AgentPanelSceneEntryModel[],
	overridesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>,
	patchedEntries: readonly AgentPanelSceneEntryModel[]
): RevealTextProjectionResult {
	if (overridesByIndex.size === 0) {
		return {
			entries: baseSceneEntries,
			scenePatch: scenePatchIdentity(),
		};
	}
	return {
		entries: patchedEntries,
		scenePatch: scenePatchDisplayScene({
			baseSceneEntries,
			entries: Array.from(overridesByIndex.values()),
			entriesByIndex: overridesByIndex,
		}),
	};
}

export function buildRevealScenePatchedEntriesWithPatch(
	baseSceneEntries: readonly AgentPanelSceneEntryModel[],
	overridesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>
): RevealTextProjectionResult {
	const patchedEntries = createPatchedSceneEntriesArray(baseSceneEntries, overridesByIndex);
	return buildRevealScenePatchResult(baseSceneEntries, overridesByIndex, patchedEntries);
}
