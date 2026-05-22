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

			if (previousSceneEntries !== null && isStableAppend(previousSceneEntries, sceneEntries)) {
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

function isStableAppend(
	previous: readonly AgentPanelSceneEntryModel[],
	next: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (next.length < previous.length) {
		return false;
	}

	for (let index = 0; index < previous.length; index += 1) {
		if (!isSceneEntryStable(previous[index], next[index])) {
			return false;
		}
	}

	return true;
}

function isSceneEntryStable(
	previous: AgentPanelSceneEntryModel | undefined,
	next: AgentPanelSceneEntryModel | undefined
): boolean {
	if (previous === next) {
		return true;
	}

	if (
		previous === undefined ||
		next === undefined ||
		previous.id !== next.id ||
		previous.type !== next.type
	) {
		return false;
	}

	if (previous.type === "assistant" && next.type === "assistant") {
		return (
			previous.markdown === next.markdown &&
			previous.timestampMs === next.timestampMs &&
			previous.isStreaming === next.isStreaming &&
			previous.tokenRevealCss === next.tokenRevealCss &&
			previous.message === next.message
		);
	}

	if (previous.type === "user" && next.type === "user") {
		return previous.text === next.text && previous.timestampMs === next.timestampMs;
	}

	if (previous.type === "tool_call" && next.type === "tool_call") {
		return (
			previous.title === next.title &&
			previous.subtitle === next.subtitle &&
			previous.detailsText === next.detailsText &&
			previous.scriptText === next.scriptText &&
			previous.filePath === next.filePath &&
			previous.status === next.status &&
			previous.startedAtMs === next.startedAtMs &&
			previous.completedAtMs === next.completedAtMs &&
			previous.presentationState === next.presentationState &&
			previous.degradedReason === next.degradedReason &&
			previous.todos === next.todos &&
			previous.question === next.question &&
			previous.taskChildren === next.taskChildren
		);
	}

	if (previous.type === "thinking" && next.type === "thinking") {
		return previous.startedAtMs === next.startedAtMs && previous.label === next.label;
	}

	if (previous.type === "missing" && next.type === "missing") {
		return previous.diagnosticLabel === next.diagnosticLabel;
	}

	return false;
}
