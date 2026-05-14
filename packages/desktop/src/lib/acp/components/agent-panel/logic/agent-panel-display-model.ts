import type {
	AgentAssistantEntry,
	AgentPanelSceneEntryModel,
	AgentPanelSessionStatus,
	AssistantMessage,
	AssistantMessageChunk,
	ContentBlock,
} from "@acepe/ui/agent-panel";
import type {
	SessionGraphActivity,
	SessionStateGraph,
	TranscriptEntry,
} from "$lib/services/acp-types.js";
import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { TurnState } from "../../../store/types.js";
import { getPreparingThreadLabel } from "./agent-panel-header-labels.js";
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
	readonly graph: SessionStateGraph | null;
	readonly header: {
		readonly title: string;
		readonly agentName?: string | null;
	};
	readonly local: {
		readonly pendingUserEntry: SessionEntry | null;
		readonly pendingSendIntent: boolean;
	};
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

export interface AgentPanelDisplayMemory {
	readonly sessionId: string | null;
	readonly turnId: string | null;
	readonly displayTextByRowKey: ReadonlyMap<string, string>;
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
	};
}

function mapTurnState(turnState: SessionStateGraph["turnState"] | null): TurnState {
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
	turnState: SessionStateGraph["turnState"] | null
): boolean {
	return (
		activity?.kind === "running_operation" ||
		activity?.kind === "awaiting_model" ||
		activity?.kind === "waiting_for_user" ||
		turnState === "Running"
	);
}

function segmentText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		if (text.length > 0 && entry.role !== "assistant") {
			text += "\n";
		}
		text += segment.text;
	}
	return text;
}

function sessionUserText(entry: Extract<SessionEntry, { type: "user" }>): string {
	const content = entry.message.content;
	if (content.type === "text") {
		return content.text;
	}
	return "";
}

function findAssistantEntryIdAfterLatestUser(
	entries: readonly TranscriptEntry[],
	entryId: string
): string | null {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry?.role === "user") {
			return null;
		}
		if (entry?.role === "assistant" && entry.entryId === entryId) {
			return entry.entryId;
		}
	}
	return null;
}

function findLiveAssistantEntryId(graph: SessionStateGraph): string | null {
	if (graph.turnState !== "Running") {
		return null;
	}

	const entries = graph.transcriptSnapshot.entries;
	const tailEntry = entries[entries.length - 1];
	if (tailEntry?.role === "assistant") {
		return tailEntry.entryId;
	}

	const lastAgentMessageId = graph.lastAgentMessageId ?? null;
	if (lastAgentMessageId === null) {
		return null;
	}

	return findAssistantEntryIdAfterLatestUser(entries, lastAgentMessageId);
}

function createRowsFromGraph(graph: SessionStateGraph): readonly AgentPanelDisplayRow[] {
	const rows: AgentPanelDisplayRow[] = [];
	const liveAssistantId = findLiveAssistantEntryId(graph);
	for (const entry of graph.transcriptSnapshot.entries) {
		if (entry.role === "user") {
			rows.push({
				id: entry.entryId,
				type: "user",
				text: segmentText(entry),
			});
			continue;
		}
		if (entry.role === "assistant") {
			const canonicalText = segmentText(entry);
			rows.push({
				id: entry.entryId,
				type: "assistant",
				canonicalText,
				displayText: canonicalText,
				canonicalTextRevision: `${String(graph.revision.transcriptRevision)}:${entry.entryId}`,
				isLiveTail: entry.entryId === liveAssistantId,
			});
		}
	}
	return rows;
}

function appendPendingUserRow(
	rows: readonly AgentPanelDisplayRow[],
	pendingUserEntry: SessionEntry | null
): readonly AgentPanelDisplayRow[] {
	if (pendingUserEntry?.type !== "user") {
		return rows;
	}
	const nextRows: AgentPanelDisplayRow[] = Array.from(rows);
	const pendingRow: AgentPanelDisplayRow = {
		id: pendingUserEntry.id,
		type: "user",
		text: sessionUserText(pendingUserEntry),
		isOptimistic: true,
	};
	const hasAnyUserRow = nextRows.some((row) => row.type === "user");
	if (hasAnyUserRow) {
		nextRows.push(pendingRow);
		return nextRows;
	}
	nextRows.unshift(pendingRow);
	return nextRows;
}

export function buildAgentPanelBaseModel(input: AgentPanelDisplayInput): AgentPanelBaseModel {
	const graph = input.graph;
	if (graph === null) {
		const rows = appendPendingUserRow([], input.local.pendingUserEntry);
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
	const rows = appendPendingUserRow(createRowsFromGraph(graph), input.local.pendingUserEntry);
	const hasLiveTail = rows.some((row) => row.type === "assistant" && row.isLiveTail);
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
	const previousTexts = shouldResetMemory(previousMemory, baseModel)
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
		},
	};
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

export function applyAgentPanelDisplayModelToSceneEntries(
	model: AgentPanelDisplayModel,
	_memory: AgentPanelDisplayMemory,
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	const assistantRowsById = new Map<string, Extract<AgentPanelDisplayRow, { type: "assistant" }>>();
	for (const row of model.rows) {
		if (row.type === "assistant") {
			assistantRowsById.set(row.id, row);
		}
	}
	return sceneEntries.map((entry) => {
		if (entry.type !== "assistant") {
			return entry;
		}

		const row = findAssistantDisplayRow(assistantRowsById, entry.id);
		if (row === null) {
			return entry;
		}
		if (entry.markdown === row.displayText) {
			return entry;
		}

		return applyDisplayRowToAssistantEntry(entry, row);
	});
}
