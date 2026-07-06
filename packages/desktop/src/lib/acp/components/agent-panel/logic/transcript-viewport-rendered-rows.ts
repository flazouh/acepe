import {
	rowEstimatePx,
	type AgentPanelSceneEntryModel,
	type MessageScrollerItem,
	type MessageScrollerItemSource,
} from "@acepe/ui/agent-panel";
import type { TranscriptViewportRow } from "../../../../services/acp-types.js";
import { renderKey } from "../../../store/transcript-rows-store.js";
import {
	resolveTranscriptViewportSceneEntry,
	resolveTranscriptViewportSceneEntryCandidate,
	type TranscriptViewportOperationSceneEntryResolver,
} from "./transcript-viewport-row-mapper.js";

export type RenderedTranscriptViewportRow = {
	readonly row: TranscriptViewportRow;
	readonly index: number;
	readonly entry: AgentPanelSceneEntryModel;
	readonly localOnly: boolean;
};

export type RenderableTranscriptViewportRow = MessageScrollerItem & {
	readonly row: TranscriptViewportRow;
	readonly index: number;
	readonly localOnly: boolean;
};

export type RenderableTranscriptViewportRowSource = MessageScrollerItemSource & {
	getRenderable(index: number): RenderableTranscriptViewportRow | undefined;
	getLastUserRowId(): string | null;
};

export interface PlanningPlaceholderPresentation {
	readonly label: string;
	readonly agentIconSrc: string | null;
	readonly showWorkingSpark: boolean;
}

const LOCAL_OPTIMISTIC_ROW_PREFIX = "local:optimistic:";
const PLANNING_ROW_ID = "awaiting:planning";
const PLANNING_ROW_VERSION = "00000000000000000000000000000000";
const LOCAL_REVIEW_ROW_ID = "local:review";

export function buildRenderableTranscriptViewportRows(input: {
	readonly bufferRows: readonly TranscriptViewportRow[];
	readonly bufferStartIndex: number;
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly showLocalPlanningIndicator: boolean;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
}): readonly RenderableTranscriptViewportRow[] {
	const renderableRows: RenderableTranscriptViewportRow[] = [];
	let representedSceneEntryIds: Set<string> | null = null;
	let hasCanonicalUserRow = false;
	const getRepresentedSceneEntryIds = (): Set<string> => {
		if (representedSceneEntryIds === null) {
			representedSceneEntryIds = buildRepresentedSceneEntryIds(renderableRows);
		}
		return representedSceneEntryIds;
	};

	for (let localIndex = 0; localIndex < input.bufferRows.length; localIndex += 1) {
		const row = input.bufferRows[localIndex];
		if (row === undefined) {
			continue;
		}
		if (row.kind === "user") {
			hasCanonicalUserRow = true;
		}
		renderableRows.push(
			createRenderableTranscriptViewportRow({
				row,
				index: input.bufferStartIndex + localIndex,
				localOnly: false,
			})
		);
	}

	if (input.sceneEntries.length > input.bufferRows.length) {
		appendLocalOptimisticRows({
			sceneEntries: input.sceneEntries,
			renderableRows,
			bufferStartIndex: input.bufferStartIndex,
			representedSceneEntryIds: getRepresentedSceneEntryIds(),
			scanMode: hasCanonicalUserRow ? "trailing" : "full",
		});
	}

	if (input.showLocalPlanningIndicator && !hasPlanningRow(renderableRows)) {
		renderableRows.push(
			createRenderableTranscriptViewportRow({
				row: createLocalPlanningRow(),
				index: input.bufferStartIndex + renderableRows.length,
				localOnly: true,
			})
		);
	}

	if (
		input.syntheticReviewEntry !== null &&
		input.syntheticReviewEntry !== undefined &&
		!getRepresentedSceneEntryIds().has(input.syntheticReviewEntry.id)
	) {
		renderableRows.push(
			createRenderableTranscriptViewportRow({
				row: createLocalReviewRow(),
				index: input.bufferStartIndex + renderableRows.length,
				localOnly: true,
			})
		);
	}

	return renderableRows;
}

export function createRenderableTranscriptViewportRowSource(input: {
	readonly bufferRows: readonly TranscriptViewportRow[];
	readonly bufferStartIndex: number;
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly showLocalPlanningIndicator: boolean;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
}): RenderableTranscriptViewportRowSource {
	const localRows = buildLocalRenderableTranscriptViewportRows(input);
	const baseLength = input.bufferRows.length;
	const totalLength = baseLength + localRows.length;

	function getBaseRow(index: number): TranscriptViewportRow | undefined {
		return input.bufferRows[index];
	}

	function getLocalRow(index: number): RenderableTranscriptViewportRow | undefined {
		return localRows[index - baseLength];
	}

	function getRenderable(index: number): RenderableTranscriptViewportRow | undefined {
		if (index < 0 || index >= totalLength) {
			return undefined;
		}
		if (index >= baseLength) {
			return getLocalRow(index);
		}
		const row = getBaseRow(index);
		if (row === undefined) {
			return undefined;
		}
		return createRenderableTranscriptViewportRow({
			row,
			index: input.bufferStartIndex + index,
			localOnly: false,
		});
	}

	return {
		length: totalLength,
		getItem(index: number): MessageScrollerItem | undefined {
			return getRenderable(index);
		},
		getItems(startIndex: number, endIndex: number): readonly MessageScrollerItem[] {
			const safeStartIndex = Math.max(0, Math.floor(startIndex));
			const safeEndIndex = Math.min(totalLength, Math.max(safeStartIndex, Math.floor(endIndex)));
			const items: RenderableTranscriptViewportRow[] = [];
			for (let index = safeStartIndex; index < safeEndIndex; index += 1) {
				const renderable = getRenderable(index);
				if (renderable !== undefined) {
					items.push(renderable);
				}
			}
			return items;
		},
		getKey(index: number): string | null {
			const row = index >= baseLength ? getLocalRow(index)?.row : getBaseRow(index);
			return row === undefined ? null : renderKey(row);
		},
		getRowId(index: number): string | null {
			const row = index >= baseLength ? getLocalRow(index)?.row : getBaseRow(index);
			return row?.rowId ?? null;
		},
		getEstimatePx(index: number): number {
			const row = index >= baseLength ? getLocalRow(index)?.row : getBaseRow(index);
			return rowEstimatePx(row?.kind ?? "assistantText");
		},
		isActiveTail(index: number): boolean {
			const row = index >= baseLength ? getLocalRow(index)?.row : getBaseRow(index);
			return row?.activeStreamingTail !== null && row?.activeStreamingTail !== undefined;
		},
		isAnchorEligible(index: number): boolean {
			const row = index >= baseLength ? getLocalRow(index)?.row : getBaseRow(index);
			return row?.anchorEligible ?? false;
		},
		findIndexByRowId(rowId: string): number | null {
			for (let index = 0; index < input.bufferRows.length; index += 1) {
				if (input.bufferRows[index]?.rowId === rowId) {
					return index;
				}
			}
			for (let index = 0; index < localRows.length; index += 1) {
				if (localRows[index]?.rowId === rowId) {
					return baseLength + index;
				}
			}
			return null;
		},
		getRenderable,
		getLastUserRowId(): string | null {
			for (let index = localRows.length - 1; index >= 0; index -= 1) {
				const row = localRows[index]?.row;
				if (row?.kind === "user") {
					return row.rowId;
				}
			}
			for (let index = input.bufferRows.length - 1; index >= 0; index -= 1) {
				const row = input.bufferRows[index];
				if (row?.kind === "user") {
					return row.rowId;
				}
			}
			return null;
		},
	};
}

function buildLocalRenderableTranscriptViewportRows(input: {
	readonly bufferRows: readonly TranscriptViewportRow[];
	readonly bufferStartIndex: number;
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly showLocalPlanningIndicator: boolean;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
}): readonly RenderableTranscriptViewportRow[] {
	const localRows: RenderableTranscriptViewportRow[] = [];
	let representedSceneEntryIds: Set<string> | null = null;
	const getRepresentedSceneEntryIds = (): Set<string> => {
		if (representedSceneEntryIds === null) {
			representedSceneEntryIds = buildRepresentedSceneEntryIdsForBuffer(input.bufferRows);
		}
		return representedSceneEntryIds;
	};

	if (input.sceneEntries.length > input.bufferRows.length) {
		appendLocalOptimisticRows({
			sceneEntries: input.sceneEntries,
			renderableRows: localRows,
			bufferStartIndex: input.bufferStartIndex + input.bufferRows.length,
			representedSceneEntryIds: getRepresentedSceneEntryIds(),
			scanMode: hasCanonicalUserRow(input.bufferRows) ? "trailing" : "full",
		});
	}

	if (input.showLocalPlanningIndicator && !hasPlanningRowInRows(input.bufferRows, localRows)) {
		localRows.push(
			createRenderableTranscriptViewportRow({
				row: createLocalPlanningRow(),
				index: input.bufferStartIndex + input.bufferRows.length + localRows.length,
				localOnly: true,
			})
		);
	}

	if (
		input.syntheticReviewEntry !== null &&
		input.syntheticReviewEntry !== undefined &&
		!getRepresentedSceneEntryIds().has(input.syntheticReviewEntry.id)
	) {
		localRows.push(
			createRenderableTranscriptViewportRow({
				row: createLocalReviewRow(),
				index: input.bufferStartIndex + input.bufferRows.length + localRows.length,
				localOnly: true,
			})
		);
	}

	return localRows;
}

export function createRenderedTranscriptViewportRowResolver(input: {
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly planningPlaceholderPresentation?: PlanningPlaceholderPresentation | null;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
	readonly resolveOperationSceneEntry?: TranscriptViewportOperationSceneEntryResolver | null;
}): (renderable: RenderableTranscriptViewportRow) => RenderedTranscriptViewportRow {
	let sceneEntryById: ReadonlyMap<string, AgentPanelSceneEntryModel> | null = null;
	let sceneEntryByToolCallId: ReadonlyMap<string, AgentPanelSceneEntryModel> | null = null;
	const getSceneEntryById = (): ReadonlyMap<string, AgentPanelSceneEntryModel> => {
		if (sceneEntryById === null) {
			sceneEntryById = buildSceneEntryById(input.sceneEntries);
		}
		return sceneEntryById;
	};
	const getSceneEntryByToolCallId = (): ReadonlyMap<string, AgentPanelSceneEntryModel> => {
		if (sceneEntryByToolCallId === null) {
			sceneEntryByToolCallId = buildSceneEntryByToolCallId(input.sceneEntries);
		}
		return sceneEntryByToolCallId;
	};
	return (renderable: RenderableTranscriptViewportRow): RenderedTranscriptViewportRow => {
		const entry = resolveRenderableTranscriptViewportEntry({
			renderable,
			sceneEntries: input.sceneEntries,
			getSceneEntryById,
			getSceneEntryByToolCallId,
			planningPlaceholderPresentation: input.planningPlaceholderPresentation ?? null,
			syntheticReviewEntry: input.syntheticReviewEntry ?? null,
			resolveOperationSceneEntry: input.resolveOperationSceneEntry ?? null,
		});
		return {
			row: renderable.row,
			index: renderable.index,
			entry,
			localOnly: renderable.localOnly,
		};
	};
}

export function buildRenderedTranscriptViewportRows(input: {
	readonly bufferRows: readonly TranscriptViewportRow[];
	readonly bufferStartIndex: number;
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly showLocalPlanningIndicator: boolean;
	readonly planningPlaceholderPresentation?: PlanningPlaceholderPresentation | null;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
	readonly resolveOperationSceneEntry?: TranscriptViewportOperationSceneEntryResolver | null;
}): readonly RenderedTranscriptViewportRow[] {
	const renderableRows = buildRenderableTranscriptViewportRows({
		bufferRows: input.bufferRows,
		bufferStartIndex: input.bufferStartIndex,
		sceneEntries: input.sceneEntries,
		showLocalPlanningIndicator: input.showLocalPlanningIndicator,
		syntheticReviewEntry: input.syntheticReviewEntry,
	});
	const resolveRenderedRow = createRenderedTranscriptViewportRowResolver({
		sceneEntries: input.sceneEntries,
		planningPlaceholderPresentation: input.planningPlaceholderPresentation,
		syntheticReviewEntry: input.syntheticReviewEntry,
		resolveOperationSceneEntry: input.resolveOperationSceneEntry,
	});
	const renderedRows: RenderedTranscriptViewportRow[] = [];
	for (const renderable of renderableRows) {
		renderedRows.push(resolveRenderedRow(renderable));
	}
	return renderedRows;
}

function createRenderableTranscriptViewportRow(input: {
	readonly row: TranscriptViewportRow;
	readonly index: number;
	readonly localOnly: boolean;
}): RenderableTranscriptViewportRow {
	return {
		key: renderKey(input.row),
		rowId: input.row.rowId,
		estimatePx: rowEstimatePx(input.row.kind),
		isActiveTail: input.row.activeStreamingTail !== null,
		anchorEligible: input.row.anchorEligible,
		row: input.row,
		index: input.index,
		localOnly: input.localOnly,
	};
}

function resolveRenderableTranscriptViewportEntry(input: {
	readonly renderable: RenderableTranscriptViewportRow;
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly getSceneEntryById: () => ReadonlyMap<string, AgentPanelSceneEntryModel>;
	readonly getSceneEntryByToolCallId: () => ReadonlyMap<string, AgentPanelSceneEntryModel>;
	readonly planningPlaceholderPresentation: PlanningPlaceholderPresentation | null;
	readonly syntheticReviewEntry: AgentPanelSceneEntryModel | null;
	readonly resolveOperationSceneEntry: TranscriptViewportOperationSceneEntryResolver | null;
}): AgentPanelSceneEntryModel {
	const row = input.renderable.row;
	if (input.renderable.localOnly && row.rowId === PLANNING_ROW_ID) {
		return createLocalPlanningEntry(input.planningPlaceholderPresentation);
	}
	if (input.syntheticReviewEntry !== null && row.sourceEntryId === input.syntheticReviewEntry.id) {
		return input.syntheticReviewEntry;
	}
	const indexedEntry = resolveTranscriptViewportSceneEntryCandidate(
		row,
		input.sceneEntries[input.renderable.index]
	);
	if (indexedEntry !== null) {
		return indexedEntry;
	}
	return resolveTranscriptViewportSceneEntry(
		row,
		input.getSceneEntryById(),
		input.getSceneEntryByToolCallId(),
		input.resolveOperationSceneEntry
	);
}

function buildRepresentedSceneEntryIds(
	rows: readonly RenderableTranscriptViewportRow[]
): Set<string> {
	const representedSceneEntryIds = new Set<string>();
	for (const row of rows) {
		representedSceneEntryIds.add(row.row.rowId);
		representedSceneEntryIds.add(row.row.sourceEntryId);
	}
	return representedSceneEntryIds;
}

function buildRepresentedSceneEntryIdsForBuffer(
	rows: readonly TranscriptViewportRow[]
): Set<string> {
	const representedSceneEntryIds = new Set<string>();
	for (const row of rows) {
		representedSceneEntryIds.add(row.rowId);
		representedSceneEntryIds.add(row.sourceEntryId);
	}
	return representedSceneEntryIds;
}

function hasCanonicalUserRow(rows: readonly TranscriptViewportRow[]): boolean {
	for (const row of rows) {
		if (row.kind === "user") {
			return true;
		}
	}
	return false;
}

function hasPlanningRowInRows(
	bufferRows: readonly TranscriptViewportRow[],
	localRows: readonly RenderableTranscriptViewportRow[]
): boolean {
	for (const row of bufferRows) {
		if (row.kind === "assistantThought" || row.kind === "awaitingPlaceholder") {
			return true;
		}
	}
	return hasPlanningRow(localRows);
}

function appendLocalOptimisticRows(input: {
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly renderableRows: RenderableTranscriptViewportRow[];
	readonly bufferStartIndex: number;
	readonly representedSceneEntryIds: Set<string>;
	readonly scanMode: "full" | "trailing";
}): void {
	if (input.scanMode === "trailing") {
		appendTrailingLocalOptimisticRows(input);
		return;
	}

	for (const entry of input.sceneEntries) {
		appendLocalOptimisticRow({
			entry,
			renderableRows: input.renderableRows,
			bufferStartIndex: input.bufferStartIndex,
			representedSceneEntryIds: input.representedSceneEntryIds,
		});
	}
}

function appendTrailingLocalOptimisticRows(input: {
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly renderableRows: RenderableTranscriptViewportRow[];
	readonly bufferStartIndex: number;
	readonly representedSceneEntryIds: Set<string>;
}): void {
	const trailingEntries: Extract<AgentPanelSceneEntryModel, { type: "user" }>[] = [];
	for (let index = input.sceneEntries.length - 1; index >= 0; index -= 1) {
		const entry = input.sceneEntries[index];
		if (!isLocalOptimisticUserEntry(entry)) {
			break;
		}
		trailingEntries.push(entry);
	}

	for (let index = trailingEntries.length - 1; index >= 0; index -= 1) {
		const entry = trailingEntries[index];
		if (entry === undefined) {
			continue;
		}
		appendLocalOptimisticRow({
			entry,
			renderableRows: input.renderableRows,
			bufferStartIndex: input.bufferStartIndex,
			representedSceneEntryIds: input.representedSceneEntryIds,
		});
	}
}

function appendLocalOptimisticRow(input: {
	readonly entry: AgentPanelSceneEntryModel;
	readonly renderableRows: RenderableTranscriptViewportRow[];
	readonly bufferStartIndex: number;
	readonly representedSceneEntryIds: Set<string>;
}): void {
	if (!isLocalOptimisticUserEntry(input.entry) || input.representedSceneEntryIds.has(input.entry.id)) {
		return;
	}
	input.renderableRows.push(
		createRenderableTranscriptViewportRow({
			row: createLocalOptimisticUserRow(input.entry),
			index: input.bufferStartIndex + input.renderableRows.length,
			localOnly: true,
		})
	);
	input.representedSceneEntryIds.add(input.entry.id);
}

function createLocalPlanningEntry(
	presentation: PlanningPlaceholderPresentation | null
): AgentPanelSceneEntryModel {
	return {
		id: PLANNING_ROW_ID,
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

function hasPlanningRow(rows: readonly RenderableTranscriptViewportRow[]): boolean {
	for (const row of rows) {
		if (row.row.kind === "assistantThought" || row.row.kind === "awaitingPlaceholder") {
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
		rowId: PLANNING_ROW_ID,
		sourceEntryId: PLANNING_ROW_ID,
		kind: "awaitingPlaceholder",
		version: PLANNING_ROW_VERSION,
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
