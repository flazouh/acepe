import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import {
	appendSceneDisplayRows,
	buildSceneDisplayRows,
	type SceneDisplayRow,
} from "./scene-display-rows.js";

export interface SceneDisplayRowsReadModel {
	getRows(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
}

export function createSceneDisplayRowsReadModel(): SceneDisplayRowsReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let previousRows: readonly SceneDisplayRow[] = [];

	return {
		getRows(sceneEntries) {
			if (sceneEntries === previousSceneEntries) {
				return previousRows;
			}

			if (
				previousSceneEntries !== null &&
				isStableAppend(previousSceneEntries, sceneEntries)
			) {
				previousRows = appendSceneDisplayRows(
					previousRows,
					sceneEntries.slice(previousSceneEntries.length)
				);
				previousSceneEntries = sceneEntries;
				return previousRows;
			}

			previousRows = buildSceneDisplayRows(sceneEntries);
			previousSceneEntries = sceneEntries;
			return previousRows;
		},
	};
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

	if (previous === undefined || next === undefined || previous.id !== next.id || previous.type !== next.type) {
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
