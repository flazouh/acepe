import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { TranscriptViewportRow } from "../../../../services/acp-types.js";
import { resolveTranscriptViewportSceneEntry } from "./transcript-viewport-row-mapper.js";

export type RenderedTranscriptViewportRow = {
	readonly row: TranscriptViewportRow;
	readonly index: number;
	readonly entry: AgentPanelSceneEntryModel;
	readonly localOnly: boolean;
};

export interface PlanningPlaceholderPresentation {
	readonly label: string;
	readonly agentIconSrc: string | null;
	readonly showWorkingSpark: boolean;
}

const LOCAL_OPTIMISTIC_ROW_PREFIX = "local:optimistic:";
const LOCAL_PLANNING_ROW_ID = "local:planning";
const LOCAL_REVIEW_ROW_ID = "local:review";

export function buildRenderedTranscriptViewportRows(input: {
	readonly bufferRows: readonly TranscriptViewportRow[];
	readonly bufferStartIndex: number;
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly showLocalPlanningIndicator: boolean;
	readonly planningPlaceholderPresentation?: PlanningPlaceholderPresentation | null;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
}): readonly RenderedTranscriptViewportRow[] {
	const sceneEntryById = buildSceneEntryById(input.sceneEntries);
	const sceneEntryByToolCallId = buildSceneEntryByToolCallId(input.sceneEntries);
	const representedSceneEntryIds = new Set<string>();
	const renderedRows: RenderedTranscriptViewportRow[] = [];

	for (let localIndex = 0; localIndex < input.bufferRows.length; localIndex += 1) {
		const row = input.bufferRows[localIndex];
		if (row === undefined) {
			continue;
		}
		const entry = resolveTranscriptViewportSceneEntry(
			row,
			sceneEntryById,
			sceneEntryByToolCallId
		);
		representedSceneEntryIds.add(row.rowId);
		representedSceneEntryIds.add(row.sourceEntryId);
		representedSceneEntryIds.add(entry.id);
		renderedRows.push({
			row,
			index: input.bufferStartIndex + localIndex,
			entry,
			localOnly: false,
		});
	}

	for (const entry of input.sceneEntries) {
		if (!isLocalOptimisticUserEntry(entry) || representedSceneEntryIds.has(entry.id)) {
			continue;
		}
		renderedRows.push({
			row: createLocalOptimisticUserRow(entry),
			index: input.bufferStartIndex + renderedRows.length,
			entry,
			localOnly: true,
		});
		representedSceneEntryIds.add(entry.id);
	}

	if (input.showLocalPlanningIndicator && !hasPlanningEntry(renderedRows)) {
		renderedRows.push({
			row: createLocalPlanningRow(),
			index: input.bufferStartIndex + renderedRows.length,
			entry: createLocalPlanningEntry(input.planningPlaceholderPresentation ?? null),
			localOnly: true,
		});
	}

	if (
		input.syntheticReviewEntry !== null &&
		input.syntheticReviewEntry !== undefined &&
		!representedSceneEntryIds.has(input.syntheticReviewEntry.id)
	) {
		renderedRows.push({
			row: createLocalReviewRow(),
			index: input.bufferStartIndex + renderedRows.length,
			entry: input.syntheticReviewEntry,
			localOnly: true,
		});
	}

	return renderedRows;
}

function createLocalPlanningEntry(
	presentation: PlanningPlaceholderPresentation | null
): AgentPanelSceneEntryModel {
	return {
		id: LOCAL_PLANNING_ROW_ID,
		type: "thinking",
		durationMs: null,
		startedAtMs: null,
		label: presentation?.label ?? null,
		agentIconSrc: presentation?.agentIconSrc ?? null,
		showWorkingSpark: presentation?.showWorkingSpark ?? false,
	};
}

function buildSceneEntryById(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): ReadonlyMap<string, AgentPanelSceneEntryModel> {
	const index = new Map<string, AgentPanelSceneEntryModel>();
	for (const entry of sceneEntries) {
		index.set(entry.id, entry);
	}
	return index;
}

function buildSceneEntryByToolCallId(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): ReadonlyMap<string, AgentPanelSceneEntryModel> {
	const index = new Map<string, AgentPanelSceneEntryModel>();
	for (const entry of sceneEntries) {
		if (entry.type === "tool_call" && entry.toolCallId !== undefined) {
			index.set(entry.toolCallId, entry);
		}
	}
	return index;
}

function isLocalOptimisticUserEntry(
	entry: AgentPanelSceneEntryModel
): entry is Extract<AgentPanelSceneEntryModel, { type: "user" }> {
	return entry.type === "user" && entry.isOptimistic === true;
}

function hasPlanningEntry(rows: readonly RenderedTranscriptViewportRow[]): boolean {
	for (const row of rows) {
		if (row.entry.type === "thinking" || row.row.kind === "awaitingPlaceholder") {
			return true;
		}
	}
	return false;
}

function createLocalOptimisticUserRow(
	entry: Extract<AgentPanelSceneEntryModel, { type: "user" }>
): TranscriptViewportRow {
	const rowId = `${LOCAL_OPTIMISTIC_ROW_PREFIX}${entry.id}`;
	return {
		rowId,
		sourceEntryId: entry.id,
		kind: "user",
		version: `${rowId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "user",
			segments: [{ kind: "text", segmentId: `${rowId}:segment:0`, text: entry.text }],
		},
		durationStartedAtMs: null,
	};
}

function createLocalPlanningRow(): TranscriptViewportRow {
	return {
		rowId: LOCAL_PLANNING_ROW_ID,
		sourceEntryId: LOCAL_PLANNING_ROW_ID,
		kind: "awaitingPlaceholder",
		version: `${LOCAL_PLANNING_ROW_ID}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [],
		},
		durationStartedAtMs: null,
	};
}

function createLocalReviewRow(): TranscriptViewportRow {
	return {
		rowId: LOCAL_REVIEW_ROW_ID,
		sourceEntryId: LOCAL_REVIEW_ROW_ID,
		kind: "tool",
		version: `${LOCAL_REVIEW_ROW_ID}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [],
		},
		durationStartedAtMs: null,
	};
}
