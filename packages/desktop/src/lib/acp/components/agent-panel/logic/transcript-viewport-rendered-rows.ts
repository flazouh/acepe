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

type RenderableTranscriptViewportRowMetadata = {
	readonly key: string;
	readonly rowId: string;
	readonly estimatePx: number;
	readonly isActiveTail: boolean;
	readonly anchorEligible: boolean;
	readonly kind: TranscriptViewportRow["kind"];
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
	readonly optimisticUserEntry?: AgentPanelSceneEntryModel | null;
	readonly showLocalPlanningIndicator: boolean;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
}): readonly RenderableTranscriptViewportRow[] {
	const renderableRows: RenderableTranscriptViewportRow[] = [];
	let representedSceneEntryIds: Set<string> | null = null;
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
		renderableRows.push(
			createRenderableTranscriptViewportRow({
				row,
				index: input.bufferStartIndex + localIndex,
				localOnly: false,
			})
		);
	}

	if (input.optimisticUserEntry !== null && input.optimisticUserEntry !== undefined) {
		appendLocalOptimisticRow({
			entry: input.optimisticUserEntry,
			renderableRows,
			bufferStartIndex: input.bufferStartIndex,
			representedSceneEntryIds: getRepresentedSceneEntryIds(),
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
	readonly optimisticUserEntry?: AgentPanelSceneEntryModel | null;
	readonly showLocalPlanningIndicator: boolean;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
}): RenderableTranscriptViewportRowSource {
	const localRows = buildLocalRenderableTranscriptViewportRows(input);
	const baseLength = input.bufferRows.length;
	const totalLength = baseLength + localRows.length;
	const baseMetadataByIndex: Array<RenderableTranscriptViewportRowMetadata | null | undefined> =
		new Array(baseLength);

	function getBaseRow(index: number): TranscriptViewportRow | undefined {
		return input.bufferRows[index];
	}

	function getLocalRow(index: number): RenderableTranscriptViewportRow | undefined {
		return localRows[index - baseLength];
	}

	function getBaseMetadata(
		index: number
	): RenderableTranscriptViewportRowMetadata | null {
		if (index < 0 || index >= baseLength) {
			return null;
		}
		const cached = baseMetadataByIndex[index];
		if (cached !== undefined) {
			return cached;
		}
		const row = getBaseRow(index);
		if (row === undefined) {
			baseMetadataByIndex[index] = null;
			return null;
		}
		const metadata: RenderableTranscriptViewportRowMetadata = {
			key: renderKey(row),
			rowId: row.rowId,
			estimatePx: rowEstimatePx(row.kind),
			isActiveTail: row.activeStreamingTail !== null,
			anchorEligible: row.anchorEligible,
			kind: row.kind,
		};
		baseMetadataByIndex[index] = metadata;
		return metadata;
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
			if (index >= baseLength) {
				return getLocalRow(index)?.key ?? null;
			}
			return getBaseMetadata(index)?.key ?? null;
		},
		getRowId(index: number): string | null {
			if (index >= baseLength) {
				return getLocalRow(index)?.rowId ?? null;
			}
			return getBaseMetadata(index)?.rowId ?? null;
		},
		getEstimatePx(index: number): number {
			if (index >= baseLength) {
				const row = getLocalRow(index)?.row;
				return rowEstimatePx(row?.kind ?? "assistantText");
			}
			return getBaseMetadata(index)?.estimatePx ?? rowEstimatePx("assistantText");
		},
		isActiveTail(index: number): boolean {
			if (index >= baseLength) {
				const row = getLocalRow(index)?.row;
				return row?.activeStreamingTail !== null && row?.activeStreamingTail !== undefined;
			}
			return getBaseMetadata(index)?.isActiveTail ?? false;
		},
		isAnchorEligible(index: number): boolean {
			if (index >= baseLength) {
				return getLocalRow(index)?.anchorEligible ?? false;
			}
			return getBaseMetadata(index)?.anchorEligible ?? false;
		},
		findIndexByRowId(rowId: string): number | null {
			for (let index = 0; index < baseLength; index += 1) {
				if (getBaseMetadata(index)?.rowId === rowId) {
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
			for (let index = baseLength - 1; index >= 0; index -= 1) {
				const metadata = getBaseMetadata(index);
				if (metadata?.kind === "user") {
					return metadata.rowId;
				}
			}
			return null;
		},
	};
}

function buildLocalRenderableTranscriptViewportRows(input: {
	readonly bufferRows: readonly TranscriptViewportRow[];
	readonly bufferStartIndex: number;
	readonly optimisticUserEntry?: AgentPanelSceneEntryModel | null;
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

	if (input.optimisticUserEntry !== null && input.optimisticUserEntry !== undefined) {
		appendLocalOptimisticRow({
			entry: input.optimisticUserEntry,
			renderableRows: localRows,
			bufferStartIndex: input.bufferStartIndex + input.bufferRows.length,
			representedSceneEntryIds: getRepresentedSceneEntryIds(),
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
	readonly optimisticUserEntry?: AgentPanelSceneEntryModel | null;
	readonly planningPlaceholderPresentation?: PlanningPlaceholderPresentation | null;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
}): (renderable: RenderableTranscriptViewportRow) => RenderedTranscriptViewportRow {
	return (renderable: RenderableTranscriptViewportRow): RenderedTranscriptViewportRow => {
		const entry = resolveRenderableTranscriptViewportEntry({
			renderable,
			optimisticUserEntry: input.optimisticUserEntry ?? null,
			planningPlaceholderPresentation: input.planningPlaceholderPresentation ?? null,
			syntheticReviewEntry: input.syntheticReviewEntry ?? null,
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
	readonly optimisticUserEntry?: AgentPanelSceneEntryModel | null;
	readonly showLocalPlanningIndicator: boolean;
	readonly planningPlaceholderPresentation?: PlanningPlaceholderPresentation | null;
	readonly syntheticReviewEntry?: AgentPanelSceneEntryModel | null;
}): readonly RenderedTranscriptViewportRow[] {
	const renderableRows = buildRenderableTranscriptViewportRows({
		bufferRows: input.bufferRows,
		bufferStartIndex: input.bufferStartIndex,
		optimisticUserEntry: input.optimisticUserEntry,
		showLocalPlanningIndicator: input.showLocalPlanningIndicator,
		syntheticReviewEntry: input.syntheticReviewEntry,
	});
	const resolveRenderedRow = createRenderedTranscriptViewportRowResolver({
		optimisticUserEntry: input.optimisticUserEntry,
		planningPlaceholderPresentation: input.planningPlaceholderPresentation,
		syntheticReviewEntry: input.syntheticReviewEntry,
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
	readonly optimisticUserEntry: AgentPanelSceneEntryModel | null;
	readonly planningPlaceholderPresentation: PlanningPlaceholderPresentation | null;
	readonly syntheticReviewEntry: AgentPanelSceneEntryModel | null;
}): AgentPanelSceneEntryModel {
	const row = input.renderable.row;
	if (input.renderable.localOnly && row.rowId === PLANNING_ROW_ID) {
		return createLocalPlanningEntry(input.planningPlaceholderPresentation);
	}
	if (input.syntheticReviewEntry !== null && row.sourceEntryId === input.syntheticReviewEntry.id) {
		return input.syntheticReviewEntry;
	}
	if (input.renderable.localOnly) {
		const indexedEntry = resolveTranscriptViewportSceneEntryCandidate(
			row,
			input.optimisticUserEntry ?? undefined
		);
		if (indexedEntry !== null) {
			return indexedEntry;
		}
	}
	return resolveTranscriptViewportSceneEntry(row);
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
