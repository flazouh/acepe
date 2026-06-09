// Reveal-scene patch annotation — U3 of the display-model retirement plan
// (docs/plans/2026-06-09-001-refactor-retire-agent-panel-display-model-plan.md).
//
// Describes a same-length index-replacement of a scene-entries array: "this
// array is `baseSceneEntries` with the entries at `entriesByIndex` swapped".
// It is emitted whenever the reveal layer overrides assistant `markdown`
// (continuity / displayed-text), and read by the incremental fast-paths in
// token-reveal-scene-read-model and graph-scene-entry-match so they patch
// instead of recomputing O(n) per tick (the VList perf contract,
// docs/plans/2026-04-29-001-fix-long-session-performance-contracts-plan.md).
//
// Previously this WeakMap lived inside agent-panel-display-model.ts. It is
// relocated here so the annotation survives the display model's deletion (U5)
// and so a single shared store is written by both the display model (live until
// U4) and the reveal-text-projection (live from U4) and read by both consumers
// — no window where the fast-path goes dark.

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

export type RevealScenePatch = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly entriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>;
};

const revealScenePatches = new WeakMap<readonly AgentPanelSceneEntryModel[], RevealScenePatch>();

export function getRevealScenePatch(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): RevealScenePatch | undefined {
	return revealScenePatches.get(sceneEntries);
}

export function markRevealScenePatch(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	patch: RevealScenePatch
): void {
	revealScenePatches.set(sceneEntries, patch);
}
