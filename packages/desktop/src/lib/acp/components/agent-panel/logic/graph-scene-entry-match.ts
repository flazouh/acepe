import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import { isStableSceneEntryAppend } from "./scene-entry-stability.js";
import type { SceneDisplayRow } from "./scene-display-rows.js";
import { getSceneDisplayRowKey } from "./scene-display-rows.js";

export function findGraphSceneEntryForDisplayEntry(
	entry: SceneDisplayRow | undefined,
	sceneEntriesById: ReadonlyMap<string, AgentPanelSceneEntryModel> | undefined
): AgentPanelSceneEntryModel | undefined {
	if (
		entry === undefined ||
		entry.type === "thinking" ||
		entry.type === "assistant_merged" ||
		sceneEntriesById === undefined
	) {
		return undefined;
	}

	return sceneEntriesById.get(getSceneDisplayRowKey(entry));
}

export function createGraphSceneEntryIndex(
	sceneEntries: readonly AgentPanelSceneEntryModel[] | undefined
): ReadonlyMap<string, AgentPanelSceneEntryModel> | undefined {
	if (sceneEntries === undefined) {
		return undefined;
	}

	const entriesById = new Map<string, AgentPanelSceneEntryModel>();
	appendGraphSceneEntriesToIndex(entriesById, sceneEntries);
	return entriesById;
}

export interface GraphSceneEntryIndexReadModel {
	applySnapshot(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel>;
	applyAppendPatch(
		appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel>;
	selectIndex(): ReadonlyMap<string, AgentPanelSceneEntryModel>;
	selectEntryById(id: string | null | undefined): AgentPanelSceneEntryModel | undefined;
	selectEntryIndexById(id: string | null | undefined): number | undefined;
	getIndex(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel>;
}

export function createGraphSceneEntryIndexReadModel(): GraphSceneEntryIndexReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let entriesById: Map<string, AgentPanelSceneEntryModel> = new Map();
	let entryIndexesById: Map<string, number> = new Map();

	return {
		applySnapshot(sceneEntries) {
			if (sceneEntries === previousSceneEntries) {
				return entriesById;
			}

			if (
				previousSceneEntries !== null &&
				isStableSceneEntryAppend(previousSceneEntries, sceneEntries)
			) {
				appendGraphSceneEntriesToIndexes(
					entriesById,
					entryIndexesById,
					sceneEntries.slice(previousSceneEntries.length),
					previousSceneEntries.length
				);
				previousSceneEntries = sceneEntries;
				return entriesById;
			}

			entriesById = new Map();
			entryIndexesById = new Map();
			appendGraphSceneEntriesToIndexes(entriesById, entryIndexesById, sceneEntries, 0);
			previousSceneEntries = sceneEntries;
			return entriesById;
		},
		applyAppendPatch(appendedSceneEntries) {
			if (appendedSceneEntries.length === 0) {
				return entriesById;
			}

			appendGraphSceneEntriesToIndexes(
				entriesById,
				entryIndexesById,
				appendedSceneEntries,
				previousSceneEntries?.length ?? entriesById.size
			);
			previousSceneEntries = (previousSceneEntries ?? []).concat(appendedSceneEntries);
			return entriesById;
		},
		selectIndex() {
			return entriesById;
		},
		selectEntryById(id) {
			return id == null ? undefined : entriesById.get(id);
		},
		selectEntryIndexById(id) {
			return id == null ? undefined : entryIndexesById.get(id);
		},
		getIndex(sceneEntries) {
			return this.applySnapshot(sceneEntries);
		},
	};
}

function appendGraphSceneEntriesToIndex(
	entriesById: Map<string, AgentPanelSceneEntryModel>,
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): void {
	appendGraphSceneEntriesToIndexes(entriesById, undefined, sceneEntries, 0);
}

function appendGraphSceneEntriesToIndexes(
	entriesById: Map<string, AgentPanelSceneEntryModel>,
	entryIndexesById: Map<string, number> | undefined,
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): void {
	let index = startIndex;
	for (const sceneEntry of sceneEntries) {
		if (!entriesById.has(sceneEntry.id)) {
			entriesById.set(sceneEntry.id, sceneEntry);
			entryIndexesById?.set(sceneEntry.id, index);
		}
		index += 1;
	}
}
