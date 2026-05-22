import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

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
	getIndex(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel>;
}

export function createGraphSceneEntryIndexReadModel(): GraphSceneEntryIndexReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let entriesById: Map<string, AgentPanelSceneEntryModel> = new Map();

	return {
		applySnapshot(sceneEntries) {
			if (sceneEntries === previousSceneEntries) {
				return entriesById;
			}

			if (previousSceneEntries !== null && isIdentityStableAppend(previousSceneEntries, sceneEntries)) {
				appendGraphSceneEntriesToIndex(
					entriesById,
					sceneEntries.slice(previousSceneEntries.length)
				);
				previousSceneEntries = sceneEntries;
				return entriesById;
			}

			entriesById = new Map();
			appendGraphSceneEntriesToIndex(entriesById, sceneEntries);
			previousSceneEntries = sceneEntries;
			return entriesById;
		},
		applyAppendPatch(appendedSceneEntries) {
			if (appendedSceneEntries.length === 0) {
				return entriesById;
			}

			appendGraphSceneEntriesToIndex(entriesById, appendedSceneEntries);
			previousSceneEntries = (previousSceneEntries ?? []).concat(appendedSceneEntries);
			return entriesById;
		},
		selectIndex() {
			return entriesById;
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
	for (const sceneEntry of sceneEntries) {
		if (!entriesById.has(sceneEntry.id)) {
			entriesById.set(sceneEntry.id, sceneEntry);
		}
	}
}

function isIdentityStableAppend(
	previous: readonly AgentPanelSceneEntryModel[],
	next: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (next.length < previous.length) {
		return false;
	}

	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) {
			return false;
		}
	}

	return true;
}
