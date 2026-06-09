// Test fixture helper (U5): builds a RevealScenePatch-annotated scene-entries
// array directly via the production patch primitives, replacing the deleted
// agent-panel-display-scene-test-helper (which routed through the display model).
//
// Use this to exercise the patch-consumption fast-paths of token-reveal,
// graph-scene-entry-match, and scene-display-rows: pass the base array and a map
// of index -> overridden entry; the result is the same shape the reveal-text
// projection emits in production.

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import { createPatchedSceneEntriesArray } from "../scene-entry-array-view.js";
import { markRevealScenePatch } from "../reveal-scene-patch.js";

export function buildRevealScenePatchedEntries(
	baseSceneEntries: readonly AgentPanelSceneEntryModel[],
	overridesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>
): readonly AgentPanelSceneEntryModel[] {
	const next = createPatchedSceneEntriesArray(baseSceneEntries, overridesByIndex);
	markRevealScenePatch(next, {
		baseSceneEntries,
		entries: Array.from(overridesByIndex.values()),
		entriesByIndex: overridesByIndex,
	});
	return next;
}
