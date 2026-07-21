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

export type AgentPanelSceneEntryArraySplicePatch = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly startIndex: number;
	readonly insertedEntries: readonly AgentPanelSceneEntryModel[];
	readonly trailingEntries: readonly AgentPanelSceneEntryModel[];
};

export type ScenePatch =
	| { readonly kind: "identity" }
	| { readonly kind: "fullRebuild" }
	| { readonly kind: "stableIncremental" }
	| { readonly kind: "graphScene"; readonly patch: AgentPanelSceneEntryArrayPatch }
	| { readonly kind: "graphSceneAppend"; readonly patch: AgentPanelSceneEntryArrayAppendPatch }
	| { readonly kind: "graphSceneTruncation"; readonly patch: AgentPanelSceneEntryArrayTruncation }
	| { readonly kind: "graphSceneSplice"; readonly patch: AgentPanelSceneEntryArraySplicePatch };

export function scenePatchIdentity(): ScenePatch {
	return { kind: "identity" };
}

export function scenePatchFullRebuild(): ScenePatch {
	return { kind: "fullRebuild" };
}

export function scenePatchStableIncremental(): ScenePatch {
	return { kind: "stableIncremental" };
}

export function scenePatchGraphScene(patch: AgentPanelSceneEntryArrayPatch): ScenePatch {
	return { kind: "graphScene", patch };
}

export function scenePatchGraphSceneAppend(
	patch: AgentPanelSceneEntryArrayAppendPatch
): ScenePatch {
	return { kind: "graphSceneAppend", patch };
}

export function scenePatchGraphSceneTruncation(
	patch: AgentPanelSceneEntryArrayTruncation
): ScenePatch {
	return { kind: "graphSceneTruncation", patch };
}

export function scenePatchGraphSceneSplice(
	patch: AgentPanelSceneEntryArraySplicePatch
): ScenePatch {
	return { kind: "graphSceneSplice", patch };
}

export type SceneEntryArrayResult = {
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly scenePatch: ScenePatch;
};
