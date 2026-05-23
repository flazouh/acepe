import type {
	AgentAssistantEntry,
	AgentPanelSceneEntryModel,
	AgentPanelSessionStatus,
	AssistantMessage,
	AssistantMessageChunk,
	ContentBlock,
} from "@acepe/ui/agent-panel";
import type { SessionGraphActivity, SessionTurnState } from "$lib/services/acp-types.js";
import type { AgentPanelCanonicalSource } from "../../../session-state/agent-panel-canonical-source.js";
import type { TurnState } from "../../../store/types.js";
import { getPreparingThreadLabel } from "./agent-panel-header-labels.js";
import { isStableSceneEntryAppend } from "./scene-entry-stability.js";
import { mapCanonicalSessionToPanelStatus } from "./session-status-mapper.js";

export type AgentPanelDisplayRow =
	| {
			readonly id: string;
			readonly type: "user";
			readonly text: string;
			readonly isOptimistic?: boolean;
	  }
	| {
			readonly id: string;
			readonly type: "assistant";
			readonly canonicalText: string;
			readonly displayText: string;
			readonly canonicalTextRevision: string;
			readonly isLiveTail: boolean;
	  };

export interface AgentPanelDisplayInput {
	readonly panelId: string;
	readonly graph: AgentPanelCanonicalSource | null;
	readonly header: {
		readonly title: string;
		readonly agentName?: string | null;
	};
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly local: {
		readonly pendingSendIntent: boolean;
	};
	readonly rows?: AgentPanelDisplayRowsReadModel;
}

export interface AgentPanelBaseModel {
	readonly panelId: string;
	readonly sessionId: string | null;
	readonly turnId: string | null;
	readonly status: AgentPanelSessionStatus;
	readonly turnState: TurnState;
	readonly waiting: {
		readonly show: boolean;
		readonly label: string | null;
	};
	readonly composer: {
		readonly canSubmit: boolean;
		readonly showStop: boolean;
	};
	readonly rows: readonly AgentPanelDisplayRow[];
	readonly viewport: {
		readonly hasLiveTail: boolean;
		readonly requiresStableTailMount: boolean;
	};
}

export type AgentPanelDisplayModel = AgentPanelBaseModel;

export interface AgentPanelDisplaySceneEntriesReadModel {
	apply(input: {
		readonly model: AgentPanelDisplayModel;
		readonly memory: AgentPanelDisplayMemory;
		readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	}): readonly AgentPanelSceneEntryModel[];
}

export interface AgentPanelDisplayMemory {
	readonly sessionId: string | null;
	readonly turnId: string | null;
	readonly displayTextByRowKey: Map<string, string>;
	readonly sourceRows: readonly AgentPanelDisplayRow[] | null;
	readonly displayRows: readonly AgentPanelDisplayRow[] | null;
	readonly turnState: TurnState | null;
}

export interface AgentPanelDisplayResult {
	readonly model: AgentPanelDisplayModel;
	readonly memory: AgentPanelDisplayMemory;
}

const WAITING_LABEL = "Planning next moves...";

export function createAgentPanelDisplayMemory(): AgentPanelDisplayMemory {
	return {
		sessionId: null,
		turnId: null,
		displayTextByRowKey: new Map<string, string>(),
		sourceRows: null,
		displayRows: null,
		turnState: null,
	};
}

function mapTurnState(turnState: SessionTurnState | null): TurnState {
	if (turnState === "Running") {
		return "streaming";
	}
	if (turnState === "Completed") {
		return "completed";
	}
	if (turnState === "Failed") {
		return "error";
	}
	return "idle";
}

function isBusy(
	activity: SessionGraphActivity | null,
	turnState: SessionTurnState | null
): boolean {
	return (
		activity?.kind === "running_operation" ||
		activity?.kind === "awaiting_model" ||
		activity?.kind === "waiting_for_user" ||
		turnState === "Running"
	);
}

export type AgentPanelDisplayRowsProjection = {
	readonly rows: readonly AgentPanelDisplayRow[];
	readonly hasLiveTail: boolean;
};

export interface AgentPanelDisplayRowsReadModel {
	applySnapshot(input: {
		readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
		readonly transcriptRevision: number;
	}): AgentPanelDisplayRowsProjection;
	selectProjection(): AgentPanelDisplayRowsProjection;
}

export function createAgentPanelDisplayRowsReadModel(): AgentPanelDisplayRowsReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let previousTranscriptRevision = 0;
	let previousProjection: AgentPanelDisplayRowsProjection = {
		rows: [],
		hasLiveTail: false,
	};

	return {
		applySnapshot({ sceneEntries, transcriptRevision }) {
			if (
				sceneEntries === previousSceneEntries &&
				transcriptRevision === previousTranscriptRevision
			) {
				return previousProjection;
			}

			if (
				previousSceneEntries !== null &&
				isStableDisplaySceneAppend(previousSceneEntries, sceneEntries)
			) {
				if (sceneEntries.length === previousSceneEntries.length) {
					previousSceneEntries = sceneEntries;
					previousTranscriptRevision = transcriptRevision;
					return previousProjection;
				}
				const appendedProjection = createRowsFromSceneRange(
					sceneEntries,
					transcriptRevision,
					previousSceneEntries.length
				);
				previousProjection = {
					rows: previousProjection.rows.concat(appendedProjection.rows),
					hasLiveTail: previousProjection.hasLiveTail || appendedProjection.hasLiveTail,
				};
				previousSceneEntries = sceneEntries;
				previousTranscriptRevision = transcriptRevision;
				return previousProjection;
			}

			previousProjection = createRowsFromScene(sceneEntries, transcriptRevision);
			previousSceneEntries = sceneEntries;
			previousTranscriptRevision = transcriptRevision;
			return previousProjection;
		},
		selectProjection() {
			return previousProjection;
		},
	};
}

export function createRowsFromScene(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	transcriptRevision: number
): AgentPanelDisplayRowsProjection {
	return createRowsFromSceneRange(sceneEntries, transcriptRevision, 0);
}

function createRowsFromSceneRange(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	transcriptRevision: number,
	startIndex: number
): AgentPanelDisplayRowsProjection {
	const rows: AgentPanelDisplayRow[] = [];
	let hasLiveTail = false;
	for (let index = startIndex; index < sceneEntries.length; index += 1) {
		const entry = sceneEntries[index];
		if (entry === undefined) {
			continue;
		}
		if (entry.type === "user") {
			rows.push({
				id: entry.id,
				type: "user",
				text: entry.text,
				isOptimistic: entry.isOptimistic,
			});
			continue;
		}
		if (entry.type === "assistant") {
			const isLiveTail = entry.isStreaming === true;
			hasLiveTail ||= isLiveTail;
			rows.push({
				id: entry.id,
				type: "assistant",
				canonicalText: entry.markdown,
				displayText: entry.markdown,
				canonicalTextRevision: `${String(transcriptRevision)}:${entry.id}`,
				isLiveTail,
			});
		}
	}
	return { rows, hasLiveTail };
}

function isStableDisplaySceneAppend(
	previous: readonly AgentPanelSceneEntryModel[],
	next: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (next.length < previous.length) {
		return false;
	}

	for (let index = 0; index < previous.length; index += 1) {
		if (!isDisplaySceneEntryStable(previous[index], next[index])) {
			return false;
		}
	}

	return true;
}

function isDisplaySceneEntryStable(
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
	if (previous.type === "user" && next.type === "user") {
		return previous.text === next.text && previous.isOptimistic === next.isOptimistic;
	}
	if (previous.type === "assistant" && next.type === "assistant") {
		return previous.markdown === next.markdown && previous.isStreaming === next.isStreaming;
	}
	return false;
}

export function buildAgentPanelBaseModel(input: AgentPanelDisplayInput): AgentPanelBaseModel {
	const graph = input.graph;
	const transcriptRevision = graph?.revision.transcriptRevision ?? 0;
	const rowProjection =
		input.rows?.applySnapshot({
			sceneEntries: input.sceneEntries,
			transcriptRevision,
		}) ?? createRowsFromScene(input.sceneEntries, transcriptRevision);
	const rows = rowProjection.rows;
	if (graph === null) {
		const hasPending = rows.length > 0 || input.local.pendingSendIntent;
		const pendingLabel = getPreparingThreadLabel(input.header.agentName);
		return {
			panelId: input.panelId,
			sessionId: null,
			turnId: null,
			status: hasPending ? "warming" : "empty",
			turnState: "idle",
			waiting: {
				show: hasPending,
				label: hasPending ? pendingLabel : null,
			},
			composer: {
				canSubmit: false,
				showStop: false,
			},
			rows,
			viewport: {
				hasLiveTail: false,
				requiresStableTailMount: hasPending,
			},
		};
	}

	const busy = isBusy(graph.activity, graph.turnState);
	const hasLiveTail = rowProjection.hasLiveTail;
	const shouldShowWaiting =
		input.local.pendingSendIntent || (graph.activity.kind === "awaiting_model" && !hasLiveTail);
	return {
		panelId: input.panelId,
		sessionId: graph.canonicalSessionId,
		turnId: graph.lastTerminalTurnId ?? `${graph.canonicalSessionId}:active`,
		status: mapCanonicalSessionToPanelStatus({
			lifecycle: graph.lifecycle,
			activity: graph.activity,
			turnState: graph.turnState,
			hasEntries: rows.length > 0,
		}),
		turnState: mapTurnState(graph.turnState),
		waiting: {
			show: shouldShowWaiting,
			label: shouldShowWaiting ? WAITING_LABEL : null,
		},
		composer: {
			canSubmit: input.local.pendingSendIntent ? false : graph.lifecycle.actionability.canSend,
			showStop: busy,
		},
		rows,
		viewport: {
			hasLiveTail,
			requiresStableTailMount: hasLiveTail || input.local.pendingSendIntent,
		},
	};
}

function shouldResetMemory(memory: AgentPanelDisplayMemory, model: AgentPanelBaseModel): boolean {
	return memory.sessionId !== model.sessionId || memory.turnId !== model.turnId;
}

function applyDisplayTextToRow(
	row: AgentPanelDisplayRow,
	model: AgentPanelBaseModel,
	nextTexts: Map<string, string>,
	previousTexts: ReadonlyMap<string, string>
): AgentPanelDisplayRow {
	if (row.type !== "assistant") {
		return row;
	}
	if (model.turnState === "completed") {
		nextTexts.set(row.id, row.canonicalText);
		if (row.displayText === row.canonicalText) {
			return row;
		}
		return {
			id: row.id,
			type: "assistant",
			canonicalText: row.canonicalText,
			displayText: row.canonicalText,
			canonicalTextRevision: row.canonicalTextRevision,
			isLiveTail: row.isLiveTail,
		};
	}

	const previousText = previousTexts.get(row.id) ?? "";
	const displayText =
		row.canonicalText.length === 0 && previousText.length > 0 ? previousText : row.canonicalText;
	nextTexts.set(row.id, displayText);
	if (row.displayText === displayText) {
		return row;
	}
	return {
		id: row.id,
		type: "assistant",
		canonicalText: row.canonicalText,
		displayText,
		canonicalTextRevision: row.canonicalTextRevision,
		isLiveTail: row.isLiveTail,
	};
}

export function applyAgentPanelDisplayMemory(
	previousMemory: AgentPanelDisplayMemory,
	baseModel: AgentPanelBaseModel
): AgentPanelDisplayResult {
	const shouldReset = shouldResetMemory(previousMemory, baseModel);
	if (
		!shouldReset &&
		previousMemory.sourceRows === baseModel.rows &&
		previousMemory.displayRows !== null &&
		previousMemory.turnState === baseModel.turnState
	) {
		return {
			model: {
				panelId: baseModel.panelId,
				sessionId: baseModel.sessionId,
				turnId: baseModel.turnId,
				status: baseModel.status,
				turnState: baseModel.turnState,
				waiting: baseModel.waiting,
				composer: baseModel.composer,
				rows: previousMemory.displayRows,
				viewport: baseModel.viewport,
			},
			memory: previousMemory,
		};
	}

	if (
		!shouldReset &&
		previousMemory.sourceRows !== null &&
		previousMemory.displayRows !== null &&
		previousMemory.turnState === baseModel.turnState &&
		isStableDisplayRowAppend(previousMemory.sourceRows, baseModel.rows)
	) {
		const previousTexts = previousMemory.displayTextByRowKey;
		if (previousMemory.sourceRows.length === baseModel.rows.length) {
			return {
				model: {
					panelId: baseModel.panelId,
					sessionId: baseModel.sessionId,
					turnId: baseModel.turnId,
					status: baseModel.status,
					turnState: baseModel.turnState,
					waiting: baseModel.waiting,
					composer: baseModel.composer,
					rows: previousMemory.displayRows,
					viewport: baseModel.viewport,
				},
				memory: {
					sessionId: baseModel.sessionId,
					turnId: baseModel.turnId,
					displayTextByRowKey: previousTexts,
					sourceRows: baseModel.rows,
					displayRows: previousMemory.displayRows,
					turnState: baseModel.turnState,
				},
			};
		}

		const appendedRows: AgentPanelDisplayRow[] = [];
		for (let index = previousMemory.sourceRows.length; index < baseModel.rows.length; index += 1) {
			const row = baseModel.rows[index];
			if (row !== undefined) {
				appendedRows.push(applyDisplayTextToRow(row, baseModel, previousTexts, previousTexts));
			}
		}
		const rows = previousMemory.displayRows.concat(appendedRows);
		return {
			model: {
				panelId: baseModel.panelId,
				sessionId: baseModel.sessionId,
				turnId: baseModel.turnId,
				status: baseModel.status,
				turnState: baseModel.turnState,
				waiting: baseModel.waiting,
				composer: baseModel.composer,
				rows,
				viewport: baseModel.viewport,
			},
			memory: {
				sessionId: baseModel.sessionId,
				turnId: baseModel.turnId,
				displayTextByRowKey: previousTexts,
				sourceRows: baseModel.rows,
				displayRows: rows,
				turnState: baseModel.turnState,
			},
		};
	}

	const previousTexts = shouldReset
		? new Map<string, string>()
		: previousMemory.displayTextByRowKey;
	const nextTexts = new Map<string, string>();
	const rows = baseModel.rows.map((row) =>
		applyDisplayTextToRow(row, baseModel, nextTexts, previousTexts)
	);
	return {
		model: {
			panelId: baseModel.panelId,
			sessionId: baseModel.sessionId,
			turnId: baseModel.turnId,
			status: baseModel.status,
			turnState: baseModel.turnState,
			waiting: baseModel.waiting,
			composer: baseModel.composer,
			rows,
			viewport: baseModel.viewport,
		},
		memory: {
			sessionId: baseModel.sessionId,
			turnId: baseModel.turnId,
			displayTextByRowKey: nextTexts,
			sourceRows: baseModel.rows,
			displayRows: rows,
			turnState: baseModel.turnState,
		},
	};
}

function isStableDisplayRowAppend(
	previousRows: readonly AgentPanelDisplayRow[],
	nextRows: readonly AgentPanelDisplayRow[]
): boolean {
	if (nextRows.length < previousRows.length) {
		return false;
	}

	for (let index = 0; index < previousRows.length; index += 1) {
		if (nextRows[index] !== previousRows[index]) {
			return false;
		}
	}
	return true;
}

function cloneContentBlock(block: ContentBlock): ContentBlock {
	if (block.type === "text") {
		return { type: "text", text: block.text };
	}
	if (block.type === "image") {
		if (block.uri !== undefined) {
			return {
				type: "image",
				data: block.data,
				mimeType: block.mimeType,
				uri: block.uri,
			};
		}
		return {
			type: "image",
			data: block.data,
			mimeType: block.mimeType,
		};
	}
	if (block.type === "audio") {
		return {
			type: "audio",
			data: block.data,
			mimeType: block.mimeType,
		};
	}
	if (block.type === "resource") {
		return {
			type: "resource",
			resource: {
				uri: block.resource.uri,
				text: block.resource.text,
				blob: block.resource.blob,
				mimeType: block.resource.mimeType,
			},
		};
	}
	const result: ContentBlock = {
		type: "resource_link",
		uri: block.uri,
		name: block.name,
	};
	if (block.title !== undefined) {
		result.title = block.title;
	}
	if (block.description !== undefined) {
		result.description = block.description;
	}
	if (block.mimeType !== undefined) {
		result.mimeType = block.mimeType;
	}
	if (block.size !== undefined) {
		result.size = block.size;
	}
	return result;
}

function createDisplayedAssistantTextChunk(
	chunk: AssistantMessageChunk,
	displayText: string,
	displayOffset: number,
	hasOriginalTextContent: boolean
): {
	readonly chunk: AssistantMessageChunk;
	readonly nextDisplayOffset: number;
} {
	if (chunk.type !== "message" || chunk.block.type !== "text") {
		return {
			chunk: {
				type: chunk.type,
				block: cloneContentBlock(chunk.block),
			},
			nextDisplayOffset: displayOffset,
		};
	}

	const originalTextLength = hasOriginalTextContent ? chunk.block.text.length : displayText.length;
	const nextDisplayOffset = Math.min(displayText.length, displayOffset + originalTextLength);
	return {
		chunk: {
			type: "message",
			block: {
				type: "text",
				text: displayText.slice(displayOffset, nextDisplayOffset),
			},
		},
		nextDisplayOffset,
	};
}

function createDisplayedAssistantMessage(
	message: AssistantMessage,
	displayText: string
): AssistantMessage {
	const chunks: AssistantMessageChunk[] = [];
	let hasDisplayedTextChunk = false;
	let displayOffset = 0;
	let originalTextLength = 0;
	for (const chunk of message.chunks) {
		if (chunk.type === "message" && chunk.block.type === "text") {
			originalTextLength += chunk.block.text.length;
		}
	}
	const hasOriginalTextContent = originalTextLength > 0;
	for (const chunk of message.chunks) {
		const displayedChunk = createDisplayedAssistantTextChunk(
			chunk,
			displayText,
			displayOffset,
			hasOriginalTextContent
		);
		chunks.push(displayedChunk.chunk);
		if (chunk.type === "message" && chunk.block.type === "text") {
			hasDisplayedTextChunk = true;
			displayOffset = displayedChunk.nextDisplayOffset;
		}
	}

	if (!hasDisplayedTextChunk || displayOffset < displayText.length) {
		chunks.push({
			type: "message",
			block: {
				type: "text",
				text: displayText.slice(displayOffset),
			},
		});
	}

	return {
		chunks,
		model: message.model,
		displayModel: message.displayModel,
		receivedAt: message.receivedAt,
		thinkingDurationMs: message.thinkingDurationMs,
	};
}

function findAssistantDisplayRow(
	rowById: ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>>,
	entryId: string
): Extract<AgentPanelDisplayRow, { type: "assistant" }> | null {
	return rowById.get(entryId) ?? null;
}

function applyDisplayRowToAssistantEntry(
	entry: AgentAssistantEntry,
	row: Extract<AgentPanelDisplayRow, { type: "assistant" }>
): AgentAssistantEntry {
	return {
		id: entry.id,
		type: "assistant",
		markdown: row.displayText,
		message:
			entry.message === undefined
				? undefined
				: createDisplayedAssistantMessage(entry.message, row.displayText),
		isStreaming: entry.isStreaming,
		tokenRevealCss: entry.tokenRevealCss,
		timestampMs: entry.timestampMs,
	};
}

function selectAssistantRowsForScenePatch(
	model: AgentPanelDisplayModel
): ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>> {
	const assistantRowsById = new Map<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>>();
	for (const row of model.rows) {
		if (row.type === "assistant") {
			if (row.displayText === row.canonicalText && model.turnState !== "streaming") {
				continue;
			}
			assistantRowsById.set(row.id, row);
		}
	}
	return assistantRowsById;
}

function applyAssistantDisplayRowsToSceneEntriesByIndex(
	assistantRowsById: ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>>,
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntryIndexesById: ReadonlyMap<string, number>
): readonly AgentPanelSceneEntryModel[] | null {
	if (assistantRowsById.size === 0) {
		return sceneEntries;
	}

	let nextEntries: AgentPanelSceneEntryModel[] | null = null;
	for (const [entryId, row] of assistantRowsById) {
		const index = sceneEntryIndexesById.get(entryId);
		if (index === undefined) {
			return null;
		}
		const entry = sceneEntries[index];
		if (entry?.type !== "assistant") {
			return null;
		}
		if (entry.markdown === row.displayText) {
			continue;
		}

		nextEntries ??= sceneEntries.slice();
		nextEntries[index] = applyDisplayRowToAssistantEntry(entry, row);
	}
	return nextEntries ?? sceneEntries;
}

function applyAssistantDisplayRowsToSceneEntriesByScan(
	assistantRowsById: ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>>,
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	if (assistantRowsById.size === 0) {
		return sceneEntries;
	}

	let nextEntries: AgentPanelSceneEntryModel[] | null = null;
	sceneEntries.forEach((entry, index) => {
		if (entry.type !== "assistant") {
			return;
		}

		const row = findAssistantDisplayRow(assistantRowsById, entry.id);
		if (row === null) {
			return;
		}
		if (entry.markdown === row.displayText) {
			return;
		}

		nextEntries ??= sceneEntries.slice();
		nextEntries[index] = applyDisplayRowToAssistantEntry(entry, row);
	});
	return nextEntries ?? sceneEntries;
}

export function applyAgentPanelDisplayModelToSceneEntries(
	model: AgentPanelDisplayModel,
	_memory: AgentPanelDisplayMemory,
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	return applyAssistantDisplayRowsToSceneEntriesByScan(
		selectAssistantRowsForScenePatch(model),
		sceneEntries
	);
}

export function createAgentPanelDisplaySceneEntriesReadModel(): AgentPanelDisplaySceneEntriesReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let sceneEntryIndexesById: Map<string, number> = new Map();
	let previousModelRows: readonly AgentPanelDisplayRow[] | null = null;
	let previousModelTurnState: TurnState | null = null;
	let previousAssistantRowsById: ReadonlyMap<
		string,
		Extract<AgentPanelDisplayRow, { type: "assistant" }>
	> | null = null;
	let previousPatchedSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let previousPatchedAssistantRowsById: ReadonlyMap<
		string,
		Extract<AgentPanelDisplayRow, { type: "assistant" }>
	> | null = null;
	let previousDisplayedSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;

	return {
		apply({ model, sceneEntries }) {
			if (sceneEntries !== previousSceneEntries) {
				if (
					previousSceneEntries !== null &&
					isStableSceneEntryAppend(previousSceneEntries, sceneEntries)
				) {
					appendSceneEntryIndexes(
						sceneEntryIndexesById,
						sceneEntries,
						previousSceneEntries.length,
						previousSceneEntries.length
					);
				} else {
					sceneEntryIndexesById = buildSceneEntryIndexes(sceneEntries);
				}
				previousSceneEntries = sceneEntries;
			}

			let assistantRowsById = previousAssistantRowsById;
			if (
				assistantRowsById === null ||
				previousModelRows !== model.rows ||
				previousModelTurnState !== model.turnState
			) {
				assistantRowsById = selectAssistantRowsForScenePatch(model);
				previousAssistantRowsById = assistantRowsById;
				previousModelRows = model.rows;
				previousModelTurnState = model.turnState;
			}
			if (
				previousPatchedSceneEntries === sceneEntries &&
				previousPatchedAssistantRowsById === assistantRowsById &&
				previousDisplayedSceneEntries !== null
			) {
				return previousDisplayedSceneEntries;
			}

			const indexedEntries = applyAssistantDisplayRowsToSceneEntriesByIndex(
				assistantRowsById,
				sceneEntries,
				sceneEntryIndexesById
			);
			if (indexedEntries !== null) {
				previousPatchedSceneEntries = sceneEntries;
				previousPatchedAssistantRowsById = assistantRowsById;
				previousDisplayedSceneEntries = indexedEntries;
				return indexedEntries;
			}
			const displayedEntries = applyAssistantDisplayRowsToSceneEntriesByScan(
				assistantRowsById,
				sceneEntries
			);
			previousPatchedSceneEntries = sceneEntries;
			previousPatchedAssistantRowsById = assistantRowsById;
			previousDisplayedSceneEntries = displayedEntries;
			return displayedEntries;
		},
	};
}

function buildSceneEntryIndexes(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): Map<string, number> {
	const indexesById = new Map<string, number>();
	appendSceneEntryIndexes(indexesById, sceneEntries, 0);
	return indexesById;
}

function appendSceneEntryIndexes(
	indexesById: Map<string, number>,
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number,
	entryIndexStart: number = 0
): void {
	let index = startIndex;
	for (let entryIndex = entryIndexStart; entryIndex < sceneEntries.length; entryIndex += 1) {
		const entry = sceneEntries[entryIndex];
		if (entry === undefined) {
			continue;
		}
		indexesById.set(entry.id, index);
		index += 1;
	}
}
