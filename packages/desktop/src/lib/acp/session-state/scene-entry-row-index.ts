/**
 * Scene-entry row-index builders for the agent-panel materializer: entry-id →
 * row-index maps plus lazy appended/spliced/truncated views over a base index.
 * Pure derivations; used by the conversation-patch fast paths. GOD-safe.
 */
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import { createPatchedReadonlyMap } from "./patched-readonly-map.js";

export function buildSceneEntryRowIndex(
	entries: readonly AgentPanelSceneEntryModel[]
): Map<string, number> {
	const byEntryId = new Map<string, number>();
	entries.forEach((entry, index) => {
		byEntryId.set(entry.id, index);
	});
	return byEntryId;
}

export function createSceneEntryRowIndexForRange(
	entries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): ReadonlyMap<string, number> {
	const indexByEntryId = new Map<string, number>();
	entries.forEach((entry, index) => {
		indexByEntryId.set(entry.id, startIndex + index);
	});
	return indexByEntryId;
}

export function createAppendedSceneEntryRowIndex(
	byEntryId: ReadonlyMap<string, number>,
	appendedEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): ReadonlyMap<string, number> {
	return createPatchedReadonlyMap(
		byEntryId,
		createSceneEntryRowIndexForRange(appendedEntries, startIndex)
	);
}

export function createSplicedSceneEntryRowIndex(
	rowIndex: ReadonlyMap<string, number>,
	previousEntries: readonly AgentPanelSceneEntryModel[],
	nextEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): ReadonlyMap<string, number> {
	const deletedKeys = new Set<string>();
	for (const entry of previousEntries) {
		deletedKeys.add(entry.id);
	}
	return createPatchedReadonlyMap(
		rowIndex,
		createSceneEntryRowIndexForRange(nextEntries, startIndex),
		deletedKeys
	);
}

export function createTruncatedSceneEntryRowIndex(
	rowIndex: ReadonlyMap<string, number>,
	deletedEntries: readonly AgentPanelSceneEntryModel[]
): ReadonlyMap<string, number> {
	const deletedKeys = new Set<string>();
	for (const entry of deletedEntries) {
		deletedKeys.add(entry.id);
	}
	return createPatchedReadonlyMap(rowIndex, new Map(), deletedKeys);
}
