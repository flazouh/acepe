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
import {
	getAgentPanelSceneEntryArrayAppendPatch,
	getAgentPanelSceneEntryArrayPatch,
	getAgentPanelSceneEntryArraySplicePatch,
	getAgentPanelSceneEntryArrayTruncation,
	markAgentPanelSceneEntryArrayAppendPatch,
	markAgentPanelSceneEntryArraySplicePatch,
	markAgentPanelSceneEntryArrayTruncation,
	type AgentPanelSceneEntryArrayAppendPatch,
} from "../../../session-state/agent-panel-scene-entry-array-patch.js";
import type { TurnState } from "../../../store/types.js";
import { getPreparingThreadLabel } from "./agent-panel-header-labels.js";
import {
	createAppendedSceneEntriesArray,
	createPatchedSceneEntriesArray,
} from "./scene-entry-array-view.js";
import {
	isStableSceneEntryAppend,
	isStableSceneEntryTruncation,
} from "./scene-entry-stability.js";
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
	applyPatch(input: {
		readonly model: AgentPanelDisplayModel;
		readonly memory: AgentPanelDisplayMemory;
		readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	}): readonly AgentPanelSceneEntryModel[] | null;
}

export type AgentPanelDisplayScenePatch = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly entriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>;
};

type AgentPanelDisplayRowArrayPatch = {
	readonly baseRows: readonly AgentPanelDisplayRow[];
	readonly rowPatches: ReadonlyMap<number, AgentPanelDisplayRow>;
};

type AgentPanelDisplayRowArrayAppendPatch = {
	readonly baseRows: readonly AgentPanelDisplayRow[];
	readonly appendedRows: readonly AgentPanelDisplayRow[];
};

type AgentPanelDisplayRowArrayTruncation = {
	readonly baseRows: readonly AgentPanelDisplayRow[];
	readonly length: number;
};

type AgentPanelDisplayRowArraySplicePatch = {
	readonly baseRows: readonly AgentPanelDisplayRow[];
	readonly startIndex: number;
	readonly insertedRows: readonly AgentPanelDisplayRow[];
	readonly trailingRows: readonly AgentPanelDisplayRow[];
};

const agentPanelDisplayScenePatches = new WeakMap<
	readonly AgentPanelSceneEntryModel[],
	AgentPanelDisplayScenePatch
>();
const agentPanelDisplayRowArrayPatches = new WeakMap<
	readonly AgentPanelDisplayRow[],
	AgentPanelDisplayRowArrayPatch
>();
const agentPanelDisplayRowArrayAppendPatches = new WeakMap<
	readonly AgentPanelDisplayRow[],
	AgentPanelDisplayRowArrayAppendPatch
>();
const agentPanelDisplayRowArrayTruncations = new WeakMap<
	readonly AgentPanelDisplayRow[],
	AgentPanelDisplayRowArrayTruncation
>();
const agentPanelDisplayRowArraySplicePatches = new WeakMap<
	readonly AgentPanelDisplayRow[],
	AgentPanelDisplayRowArraySplicePatch
>();

export function getAgentPanelDisplayScenePatch(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): AgentPanelDisplayScenePatch | undefined {
	return agentPanelDisplayScenePatches.get(sceneEntries);
}

function getAgentPanelDisplayRowArrayPatch(
	rows: readonly AgentPanelDisplayRow[]
): AgentPanelDisplayRowArrayPatch | undefined {
	return agentPanelDisplayRowArrayPatches.get(rows);
}

function getAgentPanelDisplayRowArrayAppendPatch(
	rows: readonly AgentPanelDisplayRow[]
): AgentPanelDisplayRowArrayAppendPatch | undefined {
	return agentPanelDisplayRowArrayAppendPatches.get(rows);
}

function getAgentPanelDisplayRowArrayTruncation(
	rows: readonly AgentPanelDisplayRow[]
): AgentPanelDisplayRowArrayTruncation | undefined {
	return agentPanelDisplayRowArrayTruncations.get(rows);
}

function getAgentPanelDisplayRowArraySplicePatch(
	rows: readonly AgentPanelDisplayRow[]
): AgentPanelDisplayRowArraySplicePatch | undefined {
	return agentPanelDisplayRowArraySplicePatches.get(rows);
}

export function markAgentPanelDisplayRowArrayPatch(
	rows: readonly AgentPanelDisplayRow[],
	patch: AgentPanelDisplayRowArrayPatch
): void {
	agentPanelDisplayRowArrayPatches.set(rows, patch);
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

type AppendedDisplayRowLayout = {
	readonly baseRows: readonly AgentPanelDisplayRow[] | null;
	readonly baseLayout: AppendedDisplayRowLayout | null;
	readonly appendedRows: readonly AgentPanelDisplayRow[];
	readonly appendedStart: number;
	readonly length: number;
};

const appendedDisplayRowLayouts = new WeakMap<
	readonly AgentPanelDisplayRow[],
	AppendedDisplayRowLayout
>();

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
	applyPatch(input: {
		readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
		readonly transcriptRevision: number;
	}): AgentPanelDisplayRowsProjection | null;
	selectProjection(): AgentPanelDisplayRowsProjection;
}

export function createAgentPanelDisplayRowsReadModel(): AgentPanelDisplayRowsReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let previousTranscriptRevision = 0;
	let previousProjection: AgentPanelDisplayRowsProjection = {
		rows: [],
		hasLiveTail: false,
	};
	let rowIndexById: Map<string, number> = new Map();
	let liveTailRowIds: Set<string> = new Set();

	function rememberProjection(
		projection: AgentPanelDisplayRowsProjection,
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		transcriptRevision: number
	): AgentPanelDisplayRowsProjection {
		previousProjection = projection;
		previousSceneEntries = sceneEntries;
		previousTranscriptRevision = transcriptRevision;
		rowIndexById = indexDisplayRowsById(projection.rows);
		liveTailRowIds = collectLiveTailRowIds(projection.rows);
		return previousProjection;
	}

	function applyGraphScenePatch(input: {
		readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
		readonly transcriptRevision: number;
	}): AgentPanelDisplayRowsProjection | null {
		const graphScenePatch = getAgentPanelSceneEntryArrayPatch(input.sceneEntries);
		if (graphScenePatch?.baseSceneEntries !== previousSceneEntries) {
			return null;
		}
		const rowPatches = new Map<number, AgentPanelDisplayRow>();
		const nextLiveTailRowIds = new Set(liveTailRowIds);
		for (const entry of graphScenePatch.entriesByIndex.values()) {
			const nextRow = createDisplayRowFromSceneEntry(entry, input.transcriptRevision);
			if (nextRow === null) {
				continue;
			}
			const rowIndex = rowIndexById.get(entry.id);
			const previousRow = rowIndex === undefined ? undefined : previousProjection.rows[rowIndex];
			if (
				rowIndex === undefined ||
				previousRow === undefined ||
				previousRow.id !== nextRow.id ||
				previousRow.type !== nextRow.type
			) {
				return null;
			}
			if (areDisplayRowsEquivalent(previousRow, nextRow)) {
				continue;
			}
			rowPatches.set(rowIndex, nextRow);
			if (nextRow.type === "assistant" && nextRow.isLiveTail) {
				nextLiveTailRowIds.add(nextRow.id);
			} else {
				nextLiveTailRowIds.delete(nextRow.id);
			}
		}
		previousSceneEntries = input.sceneEntries;
		previousTranscriptRevision = input.transcriptRevision;
		if (rowPatches.size > 0) {
			previousProjection = {
				rows: createPatchedDisplayRowArray(previousProjection.rows, rowPatches),
				hasLiveTail: nextLiveTailRowIds.size > 0,
			};
			liveTailRowIds = nextLiveTailRowIds;
		}
		return previousProjection;
	}

	function applyGraphSceneAppendPatch(input: {
		readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
		readonly transcriptRevision: number;
	}): AgentPanelDisplayRowsProjection | null {
		const appendPatch = getAgentPanelSceneEntryArrayAppendPatch(input.sceneEntries);
		if (
			appendPatch === undefined ||
			appendPatch.baseSceneEntries !== previousSceneEntries
		) {
			return null;
		}
		if (appendPatch.appendedEntries.length === 0) {
			previousSceneEntries = input.sceneEntries;
			previousTranscriptRevision = input.transcriptRevision;
			return previousProjection;
		}
		const appendedProjection = createRowsFromSceneRange(
			appendPatch.appendedEntries,
			input.transcriptRevision,
			0
		);
		const baseRowCount = previousProjection.rows.length;
		const rows = createAppendedDisplayRowArray(previousProjection.rows, appendedProjection.rows);
		previousProjection = {
			rows,
			hasLiveTail: previousProjection.hasLiveTail || appendedProjection.hasLiveTail,
		};
		previousSceneEntries = input.sceneEntries;
		previousTranscriptRevision = input.transcriptRevision;
		indexDisplayRowsByIdFrom(rowIndexById, rows, baseRowCount);
		for (const row of appendedProjection.rows) {
			if (row.type === "assistant" && row.isLiveTail) {
				liveTailRowIds.add(row.id);
			}
		}
		return previousProjection;
	}

	function applyGraphSceneTruncationPatch(input: {
		readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
		readonly transcriptRevision: number;
	}): AgentPanelDisplayRowsProjection | null {
		const truncation = getAgentPanelSceneEntryArrayTruncation(input.sceneEntries);
		if (
			truncation === undefined ||
			truncation.baseSceneEntries !== previousSceneEntries ||
			truncation.length !== input.sceneEntries.length
		) {
			return null;
		}
		const removedRowCount = countDisplayRowsInRange(
			truncation.baseSceneEntries,
			truncation.length,
			truncation.baseSceneEntries.length
		);
		if (removedRowCount === 0) {
			previousSceneEntries = input.sceneEntries;
			previousTranscriptRevision = input.transcriptRevision;
			return previousProjection;
		}

		const nextRowCount = previousProjection.rows.length - removedRowCount;
		for (
			let removedRowIndex = nextRowCount;
			removedRowIndex < previousProjection.rows.length;
			removedRowIndex += 1
		) {
			const removedRow = previousProjection.rows[removedRowIndex];
			if (removedRow !== undefined) {
				rowIndexById.delete(removedRow.id);
				liveTailRowIds.delete(removedRow.id);
			}
		}

		previousProjection = {
			rows: createTruncatedDisplayRowArray(previousProjection.rows, nextRowCount),
			hasLiveTail: liveTailRowIds.size > 0,
		};
		previousSceneEntries = input.sceneEntries;
		previousTranscriptRevision = input.transcriptRevision;
		return previousProjection;
	}

	function applyGraphSceneSplicePatch(input: {
		readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
		readonly transcriptRevision: number;
	}): AgentPanelDisplayRowsProjection | null {
		const splicePatch = getAgentPanelSceneEntryArraySplicePatch(input.sceneEntries);
		if (
			splicePatch === undefined ||
			splicePatch.baseSceneEntries !== previousSceneEntries ||
			splicePatch.startIndex < 0 ||
			splicePatch.startIndex > splicePatch.baseSceneEntries.length ||
			input.sceneEntries.length !==
				splicePatch.startIndex +
					splicePatch.insertedEntries.length +
					splicePatch.trailingEntries.length
		) {
			return null;
		}

		const firstChangedRowIndex = countDisplayRowsInRange(
			splicePatch.baseSceneEntries,
			0,
			splicePatch.startIndex
		);
		for (
			let removedRowIndex = firstChangedRowIndex;
			removedRowIndex < previousProjection.rows.length;
			removedRowIndex += 1
		) {
			const removedRow = previousProjection.rows[removedRowIndex];
			if (removedRow !== undefined) {
				rowIndexById.delete(removedRow.id);
				liveTailRowIds.delete(removedRow.id);
			}
		}

		const nextSuffixProjection = createRowsFromSceneRange(
			input.sceneEntries,
			input.transcriptRevision,
			splicePatch.startIndex
		);
		const rows = createSplicedDisplayRowArray(
			previousProjection.rows,
			firstChangedRowIndex,
			nextSuffixProjection.rows
		);
		previousProjection = {
			rows,
			hasLiveTail: liveTailRowIds.size > 0 || nextSuffixProjection.hasLiveTail,
		};
		previousSceneEntries = input.sceneEntries;
		previousTranscriptRevision = input.transcriptRevision;
		indexDisplayRowsByIdFrom(rowIndexById, rows, firstChangedRowIndex);
		for (const row of nextSuffixProjection.rows) {
			if (row.type === "assistant" && row.isLiveTail) {
				liveTailRowIds.add(row.id);
			}
		}
		return previousProjection;
	}

	return {
		applySnapshot({ sceneEntries, transcriptRevision }) {
			if (
				sceneEntries === previousSceneEntries &&
				transcriptRevision === previousTranscriptRevision
			) {
				return previousProjection;
			}

			const graphPatchProjection = applyGraphScenePatch({ sceneEntries, transcriptRevision });
			if (graphPatchProjection !== null) {
				return graphPatchProjection;
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
				const baseRowCount = previousProjection.rows.length;
				const rows = createAppendedDisplayRowArray(
					previousProjection.rows,
					appendedProjection.rows
				);
				previousProjection = {
					rows,
					hasLiveTail: previousProjection.hasLiveTail || appendedProjection.hasLiveTail,
				};
				previousSceneEntries = sceneEntries;
				previousTranscriptRevision = transcriptRevision;
				indexDisplayRowsByIdFrom(rowIndexById, rows, baseRowCount);
				for (const row of appendedProjection.rows) {
					if (row.type === "assistant" && row.isLiveTail) {
						liveTailRowIds.add(row.id);
					}
				}
				return previousProjection;
			}

			if (
				previousSceneEntries !== null &&
				isStableDisplaySceneTruncation(previousSceneEntries, sceneEntries)
			) {
				const nextRowCount = previousProjection.rows.length - countDisplayRowsInRange(
					previousSceneEntries,
					sceneEntries.length,
					previousSceneEntries.length
				);
				if (nextRowCount === previousProjection.rows.length) {
					previousSceneEntries = sceneEntries;
					previousTranscriptRevision = transcriptRevision;
					return previousProjection;
				}
				for (
					let removedRowIndex = nextRowCount;
					removedRowIndex < previousProjection.rows.length;
					removedRowIndex += 1
				) {
					const removedRow = previousProjection.rows[removedRowIndex];
					if (removedRow !== undefined) {
						rowIndexById.delete(removedRow.id);
						liveTailRowIds.delete(removedRow.id);
					}
				}
				const rows = createTruncatedDisplayRowArray(previousProjection.rows, nextRowCount);
				previousProjection = {
					rows,
					hasLiveTail: liveTailRowIds.size > 0,
				};
				previousSceneEntries = sceneEntries;
				previousTranscriptRevision = transcriptRevision;
				return previousProjection;
			}

			return rememberProjection(
				createRowsFromScene(sceneEntries, transcriptRevision),
				sceneEntries,
				transcriptRevision
			);
		},
		applyPatch(input) {
			return (
				applyGraphScenePatch(input) ??
				applyGraphSceneAppendPatch(input) ??
				applyGraphSceneTruncationPatch(input) ??
				applyGraphSceneSplicePatch(input) ??
				applyStableIncrementalPatch(input)
			);
		},
		selectProjection() {
			return previousProjection;
		},
	};

	function applyStableIncrementalPatch(input: {
		readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
		readonly transcriptRevision: number;
	}): AgentPanelDisplayRowsProjection | null {
		const previousEntries = previousSceneEntries;
		if (previousEntries === null) {
			return null;
		}

		if (input.sceneEntries === previousEntries) {
			if (input.transcriptRevision === previousTranscriptRevision) {
				return previousProjection;
			}
			previousSceneEntries = input.sceneEntries;
			previousTranscriptRevision = input.transcriptRevision;
			return previousProjection;
		}

		if (input.sceneEntries.length === previousEntries.length) {
			const rowPatches = new Map<number, AgentPanelDisplayRow>();
			const nextLiveTailRowIds = new Set(liveTailRowIds);
			let nextDisplayRowIndex = 0;
			for (const nextEntry of input.sceneEntries) {
				const nextRow = createDisplayRowFromSceneEntry(nextEntry, input.transcriptRevision);
				if (nextRow === null) {
					continue;
				}
				const previousRow = previousProjection.rows[nextDisplayRowIndex];
				if (
					previousRow === undefined ||
					previousRow.id !== nextRow.id ||
					previousRow.type !== nextRow.type
				) {
					return null;
				}
				if (!areDisplayRowsEquivalent(previousRow, nextRow)) {
					rowPatches.set(nextDisplayRowIndex, nextRow);
				}
				if (nextRow.type === "assistant" && nextRow.isLiveTail) {
					nextLiveTailRowIds.add(nextRow.id);
				} else {
					nextLiveTailRowIds.delete(nextRow.id);
				}
				nextDisplayRowIndex += 1;
			}
			if (nextDisplayRowIndex !== previousProjection.rows.length) {
				return null;
			}
			previousSceneEntries = input.sceneEntries;
			previousTranscriptRevision = input.transcriptRevision;
			if (rowPatches.size === 0) {
				return previousProjection;
			}
			previousProjection = {
				rows: createPatchedDisplayRowArray(previousProjection.rows, rowPatches),
				hasLiveTail: nextLiveTailRowIds.size > 0,
			};
			liveTailRowIds = nextLiveTailRowIds;
			return previousProjection;
		}

		if (isStableDisplaySceneAppend(previousEntries, input.sceneEntries)) {
			if (input.sceneEntries.length === previousEntries.length) {
				previousSceneEntries = input.sceneEntries;
				previousTranscriptRevision = input.transcriptRevision;
				return previousProjection;
			}
			const appendedProjection = createRowsFromSceneRange(
				input.sceneEntries,
				input.transcriptRevision,
				previousEntries.length
			);
			const baseRowCount = previousProjection.rows.length;
			const rows = createAppendedDisplayRowArray(previousProjection.rows, appendedProjection.rows);
			previousProjection = {
				rows,
				hasLiveTail: previousProjection.hasLiveTail || appendedProjection.hasLiveTail,
			};
			previousSceneEntries = input.sceneEntries;
			previousTranscriptRevision = input.transcriptRevision;
			indexDisplayRowsByIdFrom(rowIndexById, rows, baseRowCount);
			for (const row of appendedProjection.rows) {
				if (row.type === "assistant" && row.isLiveTail) {
					liveTailRowIds.add(row.id);
				}
			}
			return previousProjection;
		}

		if (isStableDisplaySceneTruncation(previousEntries, input.sceneEntries)) {
			const nextRowCount = previousProjection.rows.length - countDisplayRowsInRange(
				previousEntries,
				input.sceneEntries.length,
				previousEntries.length
			);
			if (nextRowCount === previousProjection.rows.length) {
				previousSceneEntries = input.sceneEntries;
				previousTranscriptRevision = input.transcriptRevision;
				return previousProjection;
			}
			for (
				let removedRowIndex = nextRowCount;
				removedRowIndex < previousProjection.rows.length;
				removedRowIndex += 1
			) {
				const removedRow = previousProjection.rows[removedRowIndex];
				if (removedRow !== undefined) {
					rowIndexById.delete(removedRow.id);
					liveTailRowIds.delete(removedRow.id);
				}
			}
			const rows = createTruncatedDisplayRowArray(previousProjection.rows, nextRowCount);
			previousProjection = {
				rows,
				hasLiveTail: liveTailRowIds.size > 0,
			};
			previousSceneEntries = input.sceneEntries;
			previousTranscriptRevision = input.transcriptRevision;
			return previousProjection;
		}

		return null;
	}
}

function createAppendedDisplayRowArray(
	baseRows: readonly AgentPanelDisplayRow[],
	appendedRows: readonly AgentPanelDisplayRow[]
): readonly AgentPanelDisplayRow[] {
	if (appendedRows.length === 0) {
		return baseRows;
	}

	const layout = createAppendedDisplayRowLayout(baseRows, appendedRows);
	const target = new Array<AgentPanelDisplayRow>(layout.length);
	const rows = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					yield* iterateAppendedDisplayRows(layout);
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectAppendedDisplayRow(layout, index);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectAppendedDisplayRow(layout, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
	appendedDisplayRowLayouts.set(rows, layout);
	agentPanelDisplayRowArrayAppendPatches.set(rows, {
		baseRows,
		appendedRows,
	});
	return rows;
}

function createAppendedDisplayRowLayout(
	baseRows: readonly AgentPanelDisplayRow[],
	appendedRows: readonly AgentPanelDisplayRow[]
): AppendedDisplayRowLayout {
	const baseLayout = appendedDisplayRowLayouts.get(baseRows);
	return {
		baseRows: baseLayout === undefined ? baseRows : null,
		baseLayout: baseLayout ?? null,
		appendedRows,
		appendedStart: baseRows.length,
		length: baseRows.length + appendedRows.length,
	};
}

function selectAppendedDisplayRow(
	layout: AppendedDisplayRowLayout,
	index: number
): AgentPanelDisplayRow | undefined {
	if (index < 0 || index >= layout.length) {
		return undefined;
	}
	if (index >= layout.appendedStart) {
		return layout.appendedRows[index - layout.appendedStart];
	}
	if (layout.baseLayout !== null) {
		return selectAppendedDisplayRow(layout.baseLayout, index);
	}
	return layout.baseRows?.[index];
}

function* iterateAppendedDisplayRows(
	layout: AppendedDisplayRowLayout
): IterableIterator<AgentPanelDisplayRow> {
	if (layout.baseLayout !== null) {
		yield* iterateAppendedDisplayRows(layout.baseLayout);
	} else if (layout.baseRows !== null) {
		for (const row of layout.baseRows) {
			yield row;
		}
	}
	for (const row of layout.appendedRows) {
		yield row;
	}
}

function createTruncatedDisplayRowArray(
	baseRows: readonly AgentPanelDisplayRow[],
	length: number
): readonly AgentPanelDisplayRow[] {
	if (length >= baseRows.length) {
		return baseRows;
	}

	const target = new Array<AgentPanelDisplayRow>(length);
	const rows = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield baseRows[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index < targetArray.length ? baseRows[index] : undefined;
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: baseRows[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
	agentPanelDisplayRowArrayTruncations.set(rows, {
		baseRows,
		length,
	});
	return rows;
}

function createSplicedDisplayRowArray(
	baseRows: readonly AgentPanelDisplayRow[],
	startIndex: number,
	replacementRows: readonly AgentPanelDisplayRow[]
): readonly AgentPanelDisplayRow[] {
	if (startIndex >= baseRows.length) {
		return createAppendedDisplayRowArray(baseRows, replacementRows);
	}
	if (replacementRows.length === 0) {
		return createTruncatedDisplayRowArray(baseRows, startIndex);
	}

	const target = new Array<AgentPanelDisplayRow>(startIndex + replacementRows.length);
	const rows = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield index < startIndex ? baseRows[index] : replacementRows[index - startIndex];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index < startIndex ? baseRows[index] : replacementRows[index - startIndex];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: index < startIndex ? baseRows[index] : replacementRows[index - startIndex],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	});
	agentPanelDisplayRowArraySplicePatches.set(rows, {
		baseRows,
		startIndex,
		insertedRows: replacementRows,
		trailingRows: [],
	});
	return rows;
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
		const row = createDisplayRowFromSceneEntry(entry, transcriptRevision);
		if (row !== null) {
			rows.push(row);
			hasLiveTail ||= row.type === "assistant" && row.isLiveTail;
		}
	}
	return { rows, hasLiveTail };
}

function createDisplayRowFromSceneEntry(
	entry: AgentPanelSceneEntryModel,
	transcriptRevision: number
): AgentPanelDisplayRow | null {
	if (entry.type === "user") {
		return {
			id: entry.id,
			type: "user",
			text: entry.text,
			isOptimistic: entry.isOptimistic,
		};
	}
	if (entry.type === "assistant") {
		const isLiveTail = entry.isStreaming === true;
		return {
			id: entry.id,
			type: "assistant",
			canonicalText: entry.markdown,
			displayText: entry.markdown,
			canonicalTextRevision: `${String(transcriptRevision)}:${entry.id}`,
			isLiveTail,
		};
	}
	return null;
}

function indexDisplayRowsById(
	rows: readonly AgentPanelDisplayRow[]
): Map<string, number> {
	const rowIndexById = new Map<string, number>();
	indexDisplayRowsByIdFrom(rowIndexById, rows, 0);
	return rowIndexById;
}

function indexDisplayRowsByIdFrom(
	rowIndexById: Map<string, number>,
	rows: readonly AgentPanelDisplayRow[],
	startIndex: number
): void {
	for (let index = startIndex; index < rows.length; index += 1) {
		const row = rows[index];
		if (row !== undefined) {
			rowIndexById.set(row.id, index);
		}
	}
}

function collectLiveTailRowIds(rows: readonly AgentPanelDisplayRow[]): Set<string> {
	const liveTailRowIds = new Set<string>();
	for (const row of rows) {
		if (row.type === "assistant" && row.isLiveTail) {
			liveTailRowIds.add(row.id);
		}
	}
	return liveTailRowIds;
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

function isStableDisplaySceneTruncation(
	previous: readonly AgentPanelSceneEntryModel[],
	next: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (next.length >= previous.length) {
		return false;
	}

	for (let index = 0; index < next.length; index += 1) {
		if (!isDisplaySceneEntryStable(previous[index], next[index])) {
			return false;
		}
	}

	return true;
}

function countDisplayRows(sceneEntries: readonly AgentPanelSceneEntryModel[]): number {
	return countDisplayRowsInRange(sceneEntries, 0, sceneEntries.length);
}

function countDisplayRowsInRange(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number,
	endIndex: number
): number {
	let count = 0;
	for (let index = startIndex; index < endIndex; index += 1) {
		const entry = sceneEntries[index];
		if (entry === undefined) {
			continue;
		}
		if (entry.type === "user" || entry.type === "assistant") {
			count += 1;
		}
	}
	return count;
}

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}

function createArrayLikeOwnKeys(length: number): string[] {
	const keys: string[] = [];
	for (let index = 0; index < length; index += 1) {
		keys.push(String(index));
	}
	keys.push("length");
	return keys;
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

function areDisplayRowsEquivalent(
	left: AgentPanelDisplayRow,
	right: AgentPanelDisplayRow
): boolean {
	if (left.type !== right.type || left.id !== right.id) {
		return false;
	}
	if (left.type === "user" && right.type === "user") {
		return left.text === right.text && left.isOptimistic === right.isOptimistic;
	}
	if (left.type === "assistant" && right.type === "assistant") {
		return (
			left.canonicalText === right.canonicalText &&
			left.displayText === right.displayText &&
			left.canonicalTextRevision === right.canonicalTextRevision &&
			left.isLiveTail === right.isLiveTail
		);
	}
	return false;
}

function areJsonLikeValuesEquivalent(left: unknown, right: unknown): boolean {
	if (left === right) {
		return true;
	}
	if (
		left === null ||
		right === null ||
		left === undefined ||
		right === undefined ||
		typeof left !== "object" ||
		typeof right !== "object"
	) {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}
		return left.every((item, index) => areJsonLikeValuesEquivalent(item, right[index]));
	}

	const leftEntries = Object.entries(left);
	const rightRecord = right as Record<string, unknown>;
	if (leftEntries.length !== Object.keys(rightRecord).length) {
		return false;
	}
	return leftEntries.every(([key, value]) =>
		areJsonLikeValuesEquivalent(value, rightRecord[key])
	);
}

export function buildAgentPanelBaseModel(input: AgentPanelDisplayInput): AgentPanelBaseModel {
	const graph = input.graph;
	const transcriptRevision = graph?.revision.transcriptRevision ?? 0;
	const rowProjection =
		input.rows?.applyPatch({
			sceneEntries: input.sceneEntries,
			transcriptRevision,
		}) ??
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

function removeAssistantDisplayTextsForRows(
	rows: readonly AgentPanelDisplayRow[],
	displayTexts: Map<string, string>,
	startIndex: number,
	endIndex: number
): void {
	for (let index = startIndex; index < endIndex; index += 1) {
		const row = rows[index];
		if (row?.type === "assistant") {
			displayTexts.delete(row.id);
		}
	}
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
		previousMemory.sourceRows === baseModel.rows &&
		previousMemory.displayRows !== null
	) {
		const previousTexts = previousMemory.displayTextByRowKey;
		const nextTexts = new Map<string, string>();
		const rowPatches = new Map<number, AgentPanelDisplayRow>();
		for (let index = 0; index < baseModel.rows.length; index += 1) {
			const sourceRow = baseModel.rows[index];
			if (sourceRow === undefined) {
				continue;
			}
			const displayRow = applyDisplayTextToRow(sourceRow, baseModel, nextTexts, previousTexts);
			if (displayRow === previousMemory.displayRows[index]) {
				continue;
			}
			rowPatches.set(index, displayRow);
		}
		const displayRows =
			rowPatches.size === 0
				? previousMemory.displayRows
				: createPatchedDisplayRowArray(previousMemory.displayRows, rowPatches);
		return {
			model: {
				panelId: baseModel.panelId,
				sessionId: baseModel.sessionId,
				turnId: baseModel.turnId,
				status: baseModel.status,
				turnState: baseModel.turnState,
				waiting: baseModel.waiting,
				composer: baseModel.composer,
				rows: displayRows,
				viewport: baseModel.viewport,
			},
			memory: {
				sessionId: baseModel.sessionId,
				turnId: baseModel.turnId,
				displayTextByRowKey: nextTexts,
				sourceRows: baseModel.rows,
				displayRows,
				turnState: baseModel.turnState,
			},
		};
	}

	if (
		!shouldReset &&
		previousMemory.sourceRows !== null &&
		previousMemory.displayRows !== null &&
		previousMemory.turnState === baseModel.turnState &&
		previousMemory.sourceRows.length === baseModel.rows.length
	) {
		const previousTexts = previousMemory.displayTextByRowKey;
		const rowPatches = new Map<number, AgentPanelDisplayRow>();
		const sourceRowsPatch = getAgentPanelDisplayRowArrayPatch(baseModel.rows);
		if (sourceRowsPatch?.baseRows === previousMemory.sourceRows) {
			for (const [index, nextSourceRow] of sourceRowsPatch.rowPatches) {
				const previousSourceRow = previousMemory.sourceRows[index];
				if (
					previousSourceRow?.type === "assistant" &&
					(previousSourceRow.id !== nextSourceRow.id || nextSourceRow.type !== "assistant")
				) {
					previousTexts.delete(previousSourceRow.id);
				}
				const nextDisplayRow = applyDisplayTextToRow(
					nextSourceRow,
					baseModel,
					previousTexts,
					previousTexts
				);
				if (
					previousMemory.displayRows[index] !== undefined &&
					areDisplayRowsEquivalent(previousMemory.displayRows[index], nextDisplayRow)
				) {
					continue;
				}
				rowPatches.set(index, nextDisplayRow);
			}
		} else {
			for (let index = 0; index < baseModel.rows.length; index += 1) {
				const previousSourceRow = previousMemory.sourceRows[index];
				const nextSourceRow = baseModel.rows[index];
				if (previousSourceRow === nextSourceRow || nextSourceRow === undefined) {
					continue;
				}
				if (
					previousSourceRow?.type === "assistant" &&
					(previousSourceRow.id !== nextSourceRow.id || nextSourceRow.type !== "assistant")
				) {
					previousTexts.delete(previousSourceRow.id);
				}
				const nextDisplayRow = applyDisplayTextToRow(
					nextSourceRow,
					baseModel,
					previousTexts,
					previousTexts
				);
				if (
					previousMemory.displayRows[index] !== undefined &&
					areDisplayRowsEquivalent(previousMemory.displayRows[index], nextDisplayRow)
				) {
					continue;
				}
				rowPatches.set(index, nextDisplayRow);
			}
		}
		if (rowPatches.size === 0) {
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
		const rows = createPatchedDisplayRowArray(previousMemory.displayRows, rowPatches);
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

	if (
		!shouldReset &&
		previousMemory.sourceRows !== null &&
		previousMemory.displayRows !== null &&
		previousMemory.turnState === baseModel.turnState
	) {
		const appendPatch = getAgentPanelDisplayRowArrayAppendPatch(baseModel.rows);
		if (appendPatch?.baseRows === previousMemory.sourceRows) {
			const previousTexts = previousMemory.displayTextByRowKey;
			if (appendPatch.appendedRows.length === 0) {
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
			const appendedRows = appendPatch.appendedRows.map((row) =>
				applyDisplayTextToRow(row, baseModel, previousTexts, previousTexts)
			);
			const rows = createAppendedDisplayRowArray(previousMemory.displayRows, appendedRows);
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

		const truncation = getAgentPanelDisplayRowArrayTruncation(baseModel.rows);
		if (truncation?.baseRows === previousMemory.sourceRows) {
			const previousTexts = previousMemory.displayTextByRowKey;
			removeAssistantDisplayTextsForRows(
				previousMemory.sourceRows,
				previousTexts,
				truncation.length,
				previousMemory.sourceRows.length
			);
			const rows = createTruncatedDisplayRowArray(previousMemory.displayRows, truncation.length);
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

		const splicePatch = getAgentPanelDisplayRowArraySplicePatch(baseModel.rows);
		if (splicePatch?.baseRows === previousMemory.sourceRows) {
			const previousTexts = previousMemory.displayTextByRowKey;
			removeAssistantDisplayTextsForRows(
				previousMemory.sourceRows,
				previousTexts,
				splicePatch.startIndex,
				previousMemory.sourceRows.length
			);
			const replacementRows = splicePatch.insertedRows.map((row) =>
				applyDisplayTextToRow(row, baseModel, previousTexts, previousTexts)
			);
			const rows = createSplicedDisplayRowArray(
				previousMemory.displayRows,
				splicePatch.startIndex,
				replacementRows
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
					displayTextByRowKey: previousTexts,
					sourceRows: baseModel.rows,
					displayRows: rows,
					turnState: baseModel.turnState,
				},
			};
		}
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
		const rows = createAppendedDisplayRowArray(previousMemory.displayRows, appendedRows);
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

function createPatchedDisplayRowArray(
	baseRows: readonly AgentPanelDisplayRow[],
	rowPatches: ReadonlyMap<number, AgentPanelDisplayRow>
): readonly AgentPanelDisplayRow[] {
	const target = new Array<AgentPanelDisplayRow>(baseRows.length);
	const rows = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < baseRows.length; index += 1) {
						yield rowPatches.get(index) ?? baseRows[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return rowPatches.get(index) ?? baseRows[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < baseRows.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < baseRows.length) {
				return {
					configurable: true,
					enumerable: true,
					value: rowPatches.get(index) ?? baseRows[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
	agentPanelDisplayRowArrayPatches.set(rows, {
		baseRows,
		rowPatches,
	});
	return rows;
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
		if (shouldProjectAssistantDisplayRow(row)) {
			assistantRowsById.set(row.id, row);
		}
	}
	return assistantRowsById;
}

function shouldProjectAssistantDisplayRow(
	row: AgentPanelDisplayRow
): row is Extract<AgentPanelDisplayRow, { type: "assistant" }> {
	return row.type === "assistant";
}

function patchAssistantRowsForScenePatch(
	previousAssistantRowsById: ReadonlyMap<
		string,
		Extract<AgentPanelDisplayRow, { type: "assistant" }>
	>,
	previousRows: readonly AgentPanelDisplayRow[],
	nextRows: readonly AgentPanelDisplayRow[]
): ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>> | null {
	const rowPatch = getAgentPanelDisplayRowArrayPatch(nextRows);
	if (rowPatch?.baseRows !== previousRows) {
		return null;
	}

	let patchedAssistantRowsById: Map<
		string,
		Extract<AgentPanelDisplayRow, { type: "assistant" }>
	> | null = null;
	for (const [index, nextRow] of rowPatch.rowPatches) {
		const previousRow = previousRows[index];
		if (
			previousRow?.type === "assistant" &&
			previousAssistantRowsById.has(previousRow.id)
		) {
			patchedAssistantRowsById ??= new Map(previousAssistantRowsById);
			patchedAssistantRowsById.delete(previousRow.id);
		}

		if (shouldProjectAssistantDisplayRow(nextRow)) {
			patchedAssistantRowsById ??= new Map(previousAssistantRowsById);
			patchedAssistantRowsById.set(nextRow.id, nextRow);
		}
	}

	return patchedAssistantRowsById ?? previousAssistantRowsById;
}

function applyAssistantDisplayRowsToSceneEntriesByIndex(
	assistantRowsById: ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>>,
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntryIndexesById: ReadonlyMap<string, number>
): readonly AgentPanelSceneEntryModel[] | null {
	if (assistantRowsById.size === 0) {
		return sceneEntries;
	}

	let patchedEntriesByIndex: Map<number, AgentPanelSceneEntryModel> | null = null;
	let patchedEntries: AgentPanelSceneEntryModel[] | null = null;
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

		const patchedEntry = applyDisplayRowToAssistantEntry(entry, row);
		patchedEntriesByIndex ??= new Map<number, AgentPanelSceneEntryModel>();
		patchedEntriesByIndex.set(index, patchedEntry);
		patchedEntries ??= [];
		patchedEntries.push(patchedEntry);
	}
	if (patchedEntriesByIndex !== null && patchedEntries !== null) {
		const nextEntries = createPatchedSceneEntriesArray(sceneEntries, patchedEntriesByIndex);
		agentPanelDisplayScenePatches.set(nextEntries, {
			baseSceneEntries: sceneEntries,
			entries: patchedEntries,
			entriesByIndex: patchedEntriesByIndex,
		});
		return nextEntries;
	}
	return sceneEntries;
}

function applyAssistantDisplayRowsToSceneEntriesByScan(
	assistantRowsById: ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>>,
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	if (assistantRowsById.size === 0) {
		return sceneEntries;
	}

	let patchedEntriesByIndex: Map<number, AgentPanelSceneEntryModel> | null = null;
	let patchedEntries: AgentPanelSceneEntryModel[] | null = null;
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

		const patchedEntry = applyDisplayRowToAssistantEntry(entry, row);
		patchedEntriesByIndex ??= new Map<number, AgentPanelSceneEntryModel>();
		patchedEntriesByIndex.set(index, patchedEntry);
		patchedEntries ??= [];
		patchedEntries.push(patchedEntry);
	});
	if (patchedEntriesByIndex !== null && patchedEntries !== null) {
		const nextEntries = createPatchedSceneEntriesArray(sceneEntries, patchedEntriesByIndex);
		agentPanelDisplayScenePatches.set(nextEntries, {
			baseSceneEntries: sceneEntries,
			entries: patchedEntries,
			entriesByIndex: patchedEntriesByIndex,
		});
		return nextEntries;
	}
	return sceneEntries;
}

export function createAgentPanelDisplaySceneEntriesReadModel(): AgentPanelDisplaySceneEntriesReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let sceneEntryIndexesById: Map<string, number> = new Map();
	let previousModelRows: readonly AgentPanelDisplayRow[] | null = null;
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

	function applyGraphScenePatchIndexes(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): boolean {
		const graphScenePatch = getAgentPanelSceneEntryArrayPatch(sceneEntries);
		if (
			graphScenePatch?.baseSceneEntries !== previousSceneEntries ||
			!canKeepSceneEntryIndexesForGraphPatch(
				graphScenePatch.entriesByIndex,
				sceneEntryIndexesById
			)
		) {
			return false;
		}
		previousSceneEntries = sceneEntries;
		return true;
	}

	function applyGraphSceneAppendPatchIndexes(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): AgentPanelSceneEntryArrayAppendPatch | null {
		const appendPatch = getAgentPanelSceneEntryArrayAppendPatch(sceneEntries);
		if (
			appendPatch === undefined ||
			appendPatch.baseSceneEntries !== previousSceneEntries
		) {
			return null;
		}
		appendSceneEntryIndexes(
			sceneEntryIndexesById,
			appendPatch.appendedEntries,
			0,
			appendPatch.baseSceneEntries.length
		);
		previousSceneEntries = sceneEntries;
		return appendPatch;
	}

	function applyGraphSceneTruncationIndexes(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): boolean {
		const truncation = getAgentPanelSceneEntryArrayTruncation(sceneEntries);
		if (
			truncation === undefined ||
			truncation.baseSceneEntries !== previousSceneEntries ||
			truncation.length !== sceneEntries.length
		) {
			return false;
		}
		removeTruncatedSceneEntryIndexes(
			sceneEntryIndexesById,
			truncation.baseSceneEntries,
			truncation.length
		);
		previousSceneEntries = sceneEntries;
		return true;
	}

	function applyGraphSceneSpliceIndexes(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): boolean {
		const splicePatch = getAgentPanelSceneEntryArraySplicePatch(sceneEntries);
		if (
			splicePatch === undefined ||
			splicePatch.baseSceneEntries !== previousSceneEntries ||
			splicePatch.startIndex < 0 ||
			splicePatch.startIndex > splicePatch.baseSceneEntries.length ||
			sceneEntries.length !==
				splicePatch.startIndex +
					splicePatch.insertedEntries.length +
					splicePatch.trailingEntries.length
		) {
			return false;
		}
		removeTruncatedSceneEntryIndexes(
			sceneEntryIndexesById,
			splicePatch.baseSceneEntries,
			splicePatch.startIndex
		);
		appendSceneEntryIndexes(
			sceneEntryIndexesById,
			sceneEntries,
			splicePatch.startIndex,
			splicePatch.startIndex
		);
		previousSceneEntries = sceneEntries;
		return true;
	}

	function applyStablePrefixAppendSceneIndexes(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): number | null {
		const previousEntries = previousSceneEntries;
		if (previousEntries === null || sceneEntries.length <= previousEntries.length) {
			return null;
		}
		for (let index = 0; index < previousEntries.length; index += 1) {
			if (previousEntries[index]?.id !== sceneEntries[index]?.id) {
				return null;
			}
		}
		appendSceneEntryIndexes(
			sceneEntryIndexesById,
			sceneEntries,
			previousEntries.length,
			previousEntries.length
		);
		previousSceneEntries = sceneEntries;
		return previousEntries.length;
	}

	function selectAssistantRows(
		model: AgentPanelDisplayModel
	): ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>> {
		let assistantRowsById = previousAssistantRowsById;
		if (assistantRowsById === null) {
			assistantRowsById = selectAssistantRowsForScenePatch(model);
		} else if (previousModelRows !== model.rows) {
			assistantRowsById =
				previousModelRows === null
					? selectAssistantRowsForScenePatch(model)
					: (patchAssistantRowsForScenePatch(
							assistantRowsById,
							previousModelRows,
							model.rows
						) ?? selectAssistantRowsForScenePatch(model));
		}
		if (previousAssistantRowsById !== assistantRowsById || previousModelRows !== model.rows) {
			previousAssistantRowsById = assistantRowsById;
			previousModelRows = model.rows;
		}
		return assistantRowsById;
	}

	function applyDisplaySceneEntries(
		model: AgentPanelDisplayModel,
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly AgentPanelSceneEntryModel[] {
		const assistantRowsById = selectAssistantRows(model);
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
		const displayedEntries =
			indexedEntries ??
			applyAssistantDisplayRowsToSceneEntriesByScan(assistantRowsById, sceneEntries);
		previousPatchedSceneEntries = sceneEntries;
		previousPatchedAssistantRowsById = assistantRowsById;
		previousDisplayedSceneEntries = displayedEntries;
		return displayedEntries;
	}

	function applyDisplaySceneAppendEntries(
		model: AgentPanelDisplayModel,
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		appendPatch: AgentPanelSceneEntryArrayAppendPatch
	): readonly AgentPanelSceneEntryModel[] | null {
		if (previousDisplayedSceneEntries === null) {
			return null;
		}
		const assistantRowsById = selectAssistantRows(model);
		const displayedAppendedEntries = applyAssistantDisplayRowsToSceneEntriesByScan(
			assistantRowsById,
			appendPatch.appendedEntries
		);
		if (
			displayedAppendedEntries === appendPatch.appendedEntries &&
			previousDisplayedSceneEntries === appendPatch.baseSceneEntries
		) {
			previousPatchedSceneEntries = previousSceneEntries;
			previousPatchedAssistantRowsById = assistantRowsById;
			previousDisplayedSceneEntries = sceneEntries;
			return sceneEntries;
		}
		const displayedEntries = createAppendedSceneEntriesArray(
			previousDisplayedSceneEntries,
			displayedAppendedEntries
		);
		markAgentPanelSceneEntryArrayAppendPatch(displayedEntries, {
			baseSceneEntries: previousDisplayedSceneEntries,
			appendedEntries: displayedAppendedEntries,
		});
		previousPatchedSceneEntries = previousSceneEntries;
		previousPatchedAssistantRowsById = assistantRowsById;
		previousDisplayedSceneEntries = displayedEntries;
		return displayedEntries;
	}

	function applyDisplaySceneTruncationEntries(
		model: AgentPanelDisplayModel,
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly AgentPanelSceneEntryModel[] | null {
		if (previousDisplayedSceneEntries === null) {
			return null;
		}
		const assistantRowsById = selectAssistantRows(model);
		const firstDisplayChangeIndex = findFirstDisplaySceneChangeIndex(
			assistantRowsById,
			sceneEntries,
			sceneEntryIndexesById,
			previousDisplayedSceneEntries
		);
		const startIndex = firstDisplayChangeIndex ?? sceneEntries.length;
		const displayedEntries =
			startIndex >= sceneEntries.length
				? createTruncatedDisplayedSceneEntriesArray(
						previousDisplayedSceneEntries,
						sceneEntries.length
					)
				: createSplicedDisplayedSceneEntriesArray(
						previousDisplayedSceneEntries,
						startIndex,
						buildDisplayedSceneSuffixEntries(assistantRowsById, sceneEntries, startIndex)
					);
		previousPatchedSceneEntries = previousSceneEntries;
		previousPatchedAssistantRowsById = assistantRowsById;
		previousDisplayedSceneEntries = displayedEntries;
		return displayedEntries;
	}

	function applyDisplaySceneSpliceEntries(
		model: AgentPanelDisplayModel,
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		startIndex: number
	): readonly AgentPanelSceneEntryModel[] | null {
		if (previousDisplayedSceneEntries === null) {
			return null;
		}
		const assistantRowsById = selectAssistantRows(model);
		const firstDisplayChangeIndex = findFirstDisplaySceneChangeIndex(
			assistantRowsById,
			sceneEntries,
			sceneEntryIndexesById,
			previousDisplayedSceneEntries
		);
		const effectiveStartIndex =
			firstDisplayChangeIndex === null ? startIndex : Math.min(startIndex, firstDisplayChangeIndex);
		const replacementEntries = buildDisplayedSceneSuffixEntries(
			assistantRowsById,
			sceneEntries,
			effectiveStartIndex
		);
		const displayedEntries =
			effectiveStartIndex >= previousDisplayedSceneEntries.length
				? createAppendedDisplayedSceneEntriesArray(
						previousDisplayedSceneEntries,
						replacementEntries
					)
				: createSplicedDisplayedSceneEntriesArray(
						previousDisplayedSceneEntries,
						effectiveStartIndex,
						replacementEntries
					);
		previousPatchedSceneEntries = previousSceneEntries;
		previousPatchedAssistantRowsById = assistantRowsById;
		previousDisplayedSceneEntries = displayedEntries;
		return displayedEntries;
	}

	function applyDisplayScenePrefixAppendEntries(
		model: AgentPanelDisplayModel,
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		appendStartIndex: number
	): readonly AgentPanelSceneEntryModel[] | null {
		if (previousDisplayedSceneEntries === null || previousPatchedSceneEntries === null) {
			return null;
		}
		const assistantRowsById = selectAssistantRows(model);
		const firstDisplayChangeIndex = findFirstDisplaySceneChangeIndex(
			assistantRowsById,
			sceneEntries,
			sceneEntryIndexesById,
			previousDisplayedSceneEntries
		);
		const firstCanonicalChangeIndex = findFirstSceneEntryDifferenceIndex(
			previousPatchedSceneEntries,
			sceneEntries,
			appendStartIndex
		);
		const effectiveStartIndex = Math.min(
			firstCanonicalChangeIndex,
			firstDisplayChangeIndex ?? sceneEntries.length
		);
		const replacementEntries = buildDisplayedSceneSuffixEntries(
			assistantRowsById,
			sceneEntries,
			effectiveStartIndex
		);
		const displayedEntries =
			effectiveStartIndex >= previousDisplayedSceneEntries.length
				? createAppendedDisplayedSceneEntriesArray(
						previousDisplayedSceneEntries,
						replacementEntries
					)
				: createSplicedDisplayedSceneEntriesArray(
						previousDisplayedSceneEntries,
						effectiveStartIndex,
						replacementEntries
					);
		previousPatchedSceneEntries = sceneEntries;
		previousPatchedAssistantRowsById = assistantRowsById;
		previousDisplayedSceneEntries = displayedEntries;
		return displayedEntries;
	}

	function applyDisplaySceneSameOrderEntries(
		model: AgentPanelDisplayModel,
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly AgentPanelSceneEntryModel[] | null {
		if (previousDisplayedSceneEntries === null || previousSceneEntries === null) {
			return null;
		}
		const assistantRowsById = selectAssistantRows(model);
		const firstDisplayChangeIndex = findFirstDisplaySceneChangeIndex(
			assistantRowsById,
			sceneEntries,
			sceneEntryIndexesById,
			previousDisplayedSceneEntries
		);
		const firstCanonicalChangeIndex = findFirstSceneEntryDifferenceIndex(
			previousSceneEntries,
			sceneEntries,
			sceneEntries.length
		);
		const effectiveStartIndex = Math.min(
			firstCanonicalChangeIndex,
			firstDisplayChangeIndex ?? sceneEntries.length
		);
		if (effectiveStartIndex >= sceneEntries.length) {
			previousPatchedSceneEntries = sceneEntries;
			previousPatchedAssistantRowsById = assistantRowsById;
			return previousDisplayedSceneEntries;
		}
		const displayedEntries = createSplicedDisplayedSceneEntriesArray(
			previousDisplayedSceneEntries,
			effectiveStartIndex,
			buildDisplayedSceneSuffixEntries(assistantRowsById, sceneEntries, effectiveStartIndex)
		);
		previousPatchedSceneEntries = sceneEntries;
		previousPatchedAssistantRowsById = assistantRowsById;
		previousDisplayedSceneEntries = displayedEntries;
		return displayedEntries;
	}

	return {
		apply({ model, sceneEntries }) {
			if (sceneEntries !== previousSceneEntries) {
				if (applyGraphScenePatchIndexes(sceneEntries)) {
					return applyDisplaySceneEntries(model, sceneEntries);
				}
				const appendPatch = applyGraphSceneAppendPatchIndexes(sceneEntries);
				if (appendPatch !== null) {
					return (
						applyDisplaySceneAppendEntries(model, sceneEntries, appendPatch) ??
						applyDisplaySceneEntries(model, sceneEntries)
					);
				}
				if (applyGraphSceneTruncationIndexes(sceneEntries)) {
					return (
						applyDisplaySceneTruncationEntries(model, sceneEntries) ??
						applyDisplaySceneEntries(model, sceneEntries)
					);
				}
				const splicePatch = getAgentPanelSceneEntryArraySplicePatch(sceneEntries);
				if (applyGraphSceneSpliceIndexes(sceneEntries)) {
					return (
						(splicePatch === undefined
							? null
							: applyDisplaySceneSpliceEntries(
									model,
									sceneEntries,
									splicePatch.startIndex
								)) ?? applyDisplaySceneEntries(model, sceneEntries)
					);
				}
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
				} else if (
					previousSceneEntries !== null &&
					isStableSceneEntryTruncation(previousSceneEntries, sceneEntries)
				) {
					removeTruncatedSceneEntryIndexes(
						sceneEntryIndexesById,
						previousSceneEntries,
						sceneEntries.length
					);
				} else if (
					previousSceneEntries !== null &&
					hasSameSceneEntryIdOrder(previousSceneEntries, sceneEntries)
				) {
					const displayedEntries = applyDisplaySceneSameOrderEntries(model, sceneEntries);
					previousSceneEntries = sceneEntries;
					return displayedEntries ?? applyDisplaySceneEntries(model, sceneEntries);
				} else {
					sceneEntryIndexesById = buildSceneEntryIndexes(sceneEntries);
				}
				previousSceneEntries = sceneEntries;
			}

			return applyDisplaySceneEntries(model, sceneEntries);
		},
		applyPatch({ model, sceneEntries }) {
			if (applyGraphScenePatchIndexes(sceneEntries)) {
				return applyDisplaySceneEntries(model, sceneEntries);
			}
			const appendPatch = applyGraphSceneAppendPatchIndexes(sceneEntries);
			if (appendPatch !== null) {
				return applyDisplaySceneAppendEntries(model, sceneEntries, appendPatch);
			}
			if (applyGraphSceneTruncationIndexes(sceneEntries)) {
				return applyDisplaySceneTruncationEntries(model, sceneEntries);
			}
			const splicePatch = getAgentPanelSceneEntryArraySplicePatch(sceneEntries);
			if (applyGraphSceneSpliceIndexes(sceneEntries)) {
				return splicePatch === undefined
							? null
							: applyDisplaySceneSpliceEntries(model, sceneEntries, splicePatch.startIndex);
			}
			const stablePrefixAppendStartIndex = applyStablePrefixAppendSceneIndexes(sceneEntries);
			if (stablePrefixAppendStartIndex !== null) {
				return applyDisplayScenePrefixAppendEntries(
					model,
					sceneEntries,
					stablePrefixAppendStartIndex
				);
			}
			if (
				previousSceneEntries !== null &&
				isStableSceneEntryTruncation(previousSceneEntries, sceneEntries)
			) {
				return applyDisplaySceneTruncationEntries(model, sceneEntries);
			}
			if (
				previousSceneEntries !== null &&
				hasSameSceneEntryIdOrder(previousSceneEntries, sceneEntries)
			) {
				return applyDisplaySceneSameOrderEntries(model, sceneEntries);
			}
			return null;
		},
	};
}

function findFirstDisplaySceneChangeIndex(
	assistantRowsById: ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>>,
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntryIndexesById: ReadonlyMap<string, number>,
	previousDisplayedSceneEntries: readonly AgentPanelSceneEntryModel[]
): number | null {
	let firstChangedIndex: number | null = null;
	for (const [entryId, row] of assistantRowsById) {
		const index = sceneEntryIndexesById.get(entryId);
		if (index === undefined) {
			continue;
		}
		const entry = sceneEntries[index];
		if (entry?.type !== "assistant") {
			continue;
		}
		const nextDisplayedEntry =
			entry.markdown === row.displayText ? entry : applyDisplayRowToAssistantEntry(entry, row);
		const previousDisplayedEntry = previousDisplayedSceneEntries[index];
		if (!areJsonLikeValuesEquivalent(previousDisplayedEntry, nextDisplayedEntry)) {
			firstChangedIndex = firstChangedIndex === null ? index : Math.min(firstChangedIndex, index);
		}
	}
	return firstChangedIndex;
}

function findFirstSceneEntryDifferenceIndex(
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	endIndex: number
): number {
	for (let index = 0; index < endIndex; index += 1) {
		if (!areJsonLikeValuesEquivalent(previousSceneEntries[index], sceneEntries[index])) {
			return index;
		}
	}
	return endIndex;
}

function buildDisplayedSceneSuffixEntries(
	assistantRowsById: ReadonlyMap<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>>,
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): readonly AgentPanelSceneEntryModel[] {
	const entries: AgentPanelSceneEntryModel[] = [];
	for (let index = startIndex; index < sceneEntries.length; index += 1) {
		const entry = sceneEntries[index];
		if (entry === undefined) {
			continue;
		}
		if (entry.type !== "assistant") {
			entries.push(entry);
			continue;
		}
		const row = assistantRowsById.get(entry.id);
		if (row === undefined || entry.markdown === row.displayText) {
			entries.push(entry);
			continue;
		}
		entries.push(applyDisplayRowToAssistantEntry(entry, row));
	}
	return entries;
}

function createAppendedDisplayedSceneEntriesArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	appendedEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	const nextEntries = createAppendedSceneEntriesArray(baseEntries, appendedEntries);
	markAgentPanelSceneEntryArrayAppendPatch(nextEntries, {
		baseSceneEntries: baseEntries,
		appendedEntries,
	});
	return nextEntries;
}

function createTruncatedDisplayedSceneEntriesArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	length: number
): readonly AgentPanelSceneEntryModel[] {
	if (length >= baseEntries.length) {
		return baseEntries;
	}
	const target = new Array<AgentPanelSceneEntryModel>(length);
	const nextEntries = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield baseEntries[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index < targetArray.length ? baseEntries[index] : undefined;
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: baseEntries[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	});
	markAgentPanelSceneEntryArrayTruncation(nextEntries, {
		baseSceneEntries: baseEntries,
		length,
	});
	return nextEntries;
}

function createSplicedDisplayedSceneEntriesArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number,
	replacementEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	if (startIndex >= baseEntries.length) {
		return createAppendedDisplayedSceneEntriesArray(baseEntries, replacementEntries);
	}
	if (replacementEntries.length === 0) {
		return createTruncatedDisplayedSceneEntriesArray(baseEntries, startIndex);
	}
	const target = new Array<AgentPanelSceneEntryModel>(startIndex + replacementEntries.length);
	const nextEntries = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield index < startIndex ? baseEntries[index] : replacementEntries[index - startIndex];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index < startIndex ? baseEntries[index] : replacementEntries[index - startIndex];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: index < startIndex ? baseEntries[index] : replacementEntries[index - startIndex],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	});
	markAgentPanelSceneEntryArraySplicePatch(nextEntries, {
		baseSceneEntries: baseEntries,
		startIndex,
		insertedEntries: replacementEntries,
		trailingEntries: [],
	});
	return nextEntries;
}

function canKeepSceneEntryIndexesForGraphPatch(
	patchedEntriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>,
	indexesById: ReadonlyMap<string, number>
): boolean {
	for (const [entryIndex, entry] of patchedEntriesByIndex) {
		if (indexesById.get(entry.id) !== entryIndex) {
			return false;
		}
	}
	return true;
}

function hasSameSceneEntryIdOrder(
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (previousSceneEntries.length !== sceneEntries.length) {
		return false;
	}

	for (let index = 0; index < sceneEntries.length; index += 1) {
		if (previousSceneEntries[index]?.id !== sceneEntries[index]?.id) {
			return false;
		}
	}

	return true;
}

function removeTruncatedSceneEntryIndexes(
	indexesById: Map<string, number>,
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): void {
	for (let entryIndex = startIndex; entryIndex < previousSceneEntries.length; entryIndex += 1) {
		const entry = previousSceneEntries[entryIndex];
		if (entry === undefined) {
			continue;
		}
		indexesById.delete(entry.id);
	}
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
