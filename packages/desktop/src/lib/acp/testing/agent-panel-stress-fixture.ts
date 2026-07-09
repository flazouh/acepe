import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type {
	SessionCompactionEvent,
	TranscriptSegment,
	TranscriptViewportOperationLink,
	TranscriptViewportRow,
	TranscriptViewportRowKind,
} from "../../services/acp-types.js";
import type { TranscriptRowsState } from "../store/transcript-rows-store.js";

export const AGENT_PANEL_STRESS_ROW_COUNT_PRESETS = [1_000, 5_000, 10_000, 25_000] as const;

export type AgentPanelStressPreset = "mixed" | "text-heavy" | "tool-heavy" | "streaming-tail";

export type AgentPanelStressKindCounts = Record<TranscriptViewportRowKind, number>;

export type AgentPanelStressFixtureOptions = {
	readonly rowCount: number;
	readonly preset?: AgentPanelStressPreset;
	readonly seed?: number;
	readonly sessionId?: string;
	readonly includeStreamingTail?: boolean;
};

export type AgentPanelStressSummary = {
	readonly totalRows: number;
	readonly preset: AgentPanelStressPreset;
	readonly seed: number;
	readonly kindCounts: AgentPanelStressKindCounts;
	readonly activeTailRowId: string | null;
};

export type AgentPanelStressFixture = {
	readonly sessionId: string;
	readonly preset: AgentPanelStressPreset;
	readonly seed: number;
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly rowsProjection: TranscriptRowsState;
	readonly summary: AgentPanelStressSummary;
};

type BuiltStressRow = {
	readonly row: TranscriptViewportRow;
	readonly entry: AgentPanelSceneEntryModel;
};

const DEFAULT_SESSION_ID = "stress-agent-panel-session";
const DEFAULT_SEED = 1;
const BASE_TIMESTAMP_MS = Date.parse("2026-01-01T00:00:00.000Z");

function createEmptyKindCounts(): AgentPanelStressKindCounts {
	return {
		user: 0,
		assistantText: 0,
		assistantThought: 0,
		tool: 0,
		sessionActivity: 0,
		awaitingPlaceholder: 0,
	};
}

function normalizeRowCount(rowCount: number): number {
	if (!Number.isFinite(rowCount) || rowCount <= 0) {
		return 0;
	}
	return Math.floor(rowCount);
}

function normalizeSeed(seed: number | undefined): number {
	if (seed === undefined || !Number.isFinite(seed)) {
		return DEFAULT_SEED;
	}
	return Math.abs(Math.floor(seed));
}

function timestampForIndex(index: number): number {
	return BASE_TIMESTAMP_MS + index * 1_000;
}

function paddedIndex(index: number): string {
	return index.toString().padStart(5, "0");
}

function rowIdFor(preset: AgentPanelStressPreset, seed: number, index: number): string {
	return `stress:${preset}:${seed}:row:${paddedIndex(index)}`;
}

function entryIdFor(preset: AgentPanelStressPreset, seed: number, index: number): string {
	return `stress:${preset}:${seed}:entry:${paddedIndex(index)}`;
}

function operationIdFor(preset: AgentPanelStressPreset, seed: number, index: number): string {
	return `stress:${preset}:${seed}:operation:${paddedIndex(index)}`;
}

function toolCallIdFor(preset: AgentPanelStressPreset, seed: number, index: number): string {
	return `stress:${preset}:${seed}:tool:${paddedIndex(index)}`;
}

function textFor(kind: TranscriptViewportRowKind, index: number, seed: number): string {
	const token = (index * 31 + seed * 17) % 997;
	if (kind === "user") {
		return `Stress user request ${index} with token ${token}`;
	}
	if (kind === "assistantThought") {
		return `Planning stress row ${index} with token ${token}`;
	}
	if (kind === "tool") {
		return `Tool output for stress row ${index} token ${token}`;
	}
	if (kind === "sessionActivity") {
		return `Compaction done for stress row ${index}`;
	}
	return `Assistant stress response ${index} with token ${token}`;
}

function chooseKind(
	index: number,
	lastIndex: number,
	preset: AgentPanelStressPreset,
	includeStreamingTail: boolean
): TranscriptViewportRowKind {
	if (includeStreamingTail && index === lastIndex) {
		return "assistantText";
	}

	if (preset === "text-heavy") {
		const slot = index % 12;
		if (slot === 0 || slot === 6) {
			return "user";
		}
		if (slot === 8) {
			return "assistantThought";
		}
		if (slot === 10) {
			return "tool";
		}
		return "assistantText";
	}

	if (preset === "tool-heavy") {
		const slot = index % 5;
		if (slot === 0) {
			return "user";
		}
		if (slot === 3) {
			return "assistantText";
		}
		return "tool";
	}

	const slot = index % 10;
	if (slot === 0 || slot === 5) {
		return "user";
	}
	if (slot === 2 || slot === 8) {
		return "assistantThought";
	}
	if (slot === 3 || slot === 7) {
		return "tool";
	}
	if (slot === 9) {
		return "sessionActivity";
	}
	return "assistantText";
}

function createTextSegment(id: string, text: string): TranscriptSegment {
	return { kind: "text", segmentId: `${id}:segment:0`, text };
}

function createThoughtSegment(id: string, text: string): TranscriptSegment {
	return { kind: "thought", segmentId: `${id}:segment:0`, text };
}

function createUserEntry(id: string, text: string, timestampMs: number): AgentPanelSceneEntryModel {
	return {
		id,
		type: "user",
		text,
		chunks: [{ kind: "text", text }],
		timestampMs,
	};
}

function createAssistantEntry(
	id: string,
	text: string,
	timestampMs: number,
	activeTail: boolean
): AgentPanelSceneEntryModel {
	if (activeTail) {
		return {
			id,
			type: "assistant",
			markdown: text,
			message: {
				chunks: [{ type: "message", block: { type: "text", text } }],
			},
			isStreaming: true,
			tokenRevealCss: {
				revealCount: text.length,
				revealedCharCount: text.length,
				baselineMs: timestampMs,
				tokStepMs: 12,
				tokFadeDurMs: 80,
				mode: "instant",
			},
			timestampMs,
			planningStartedAtMs: timestampMs,
		};
	}

	return {
		id,
		type: "assistant",
		markdown: text,
		message: {
			chunks: [{ type: "message", block: { type: "text", text } }],
		},
		isStreaming: false,
		timestampMs,
		planningStartedAtMs: null,
	};
}

function createThinkingEntry(id: string, text: string, timestampMs: number): AgentPanelSceneEntryModel {
	return {
		id,
		type: "thinking",
		durationMs: 1_200,
		startedAtMs: timestampMs,
		label: text,
		agentIconSrc: null,
		showWorkingSpark: false,
	};
}

function createCompactionEvent(
	sessionId: string,
	preset: AgentPanelStressPreset,
	seed: number,
	index: number,
	timestampMs: number
): SessionCompactionEvent {
	const postCompactionTokens = 42_000 + index;
	const preCompactionTokens = 180_000 + index;
	return {
		eventId: `stress:${preset}:${seed}:compaction:${paddedIndex(index)}`,
		sessionId,
		status: "completed",
		trigger: "auto",
		preCompactionTokens,
		postCompactionTokens,
		droppedTokens: preCompactionTokens - postCompactionTokens,
		contextWindowSize: 200_000,
		durationMs: 918,
		precomputed: true,
		preservedMessageCount: 2,
		cumulativeDroppedTokens: preCompactionTokens - postCompactionTokens + 12_000,
		timestampMs,
		summary: "Compaction done",
		providerMetadata: { source: "stress-fixture" },
	};
}

function createSessionActivityEntry(
	id: string,
	event: SessionCompactionEvent
): AgentPanelSceneEntryModel {
	return {
		id,
		type: "session_activity",
		activityKind: "compaction",
		title: event.summary ?? "Compaction done",
		status: event.status,
		subtitle: `${event.droppedTokens?.toLocaleString("en-US") ?? "0"} tokens freed`,
		metadata: [
			{ label: "Trigger", value: "Auto" },
			{ label: "Before", value: event.preCompactionTokens?.toLocaleString("en-US") ?? "0" },
			{ label: "After", value: event.postCompactionTokens?.toLocaleString("en-US") ?? "0" },
			{ label: "Window", value: event.contextWindowSize?.toLocaleString("en-US") ?? "0" },
			{ label: "Duration", value: `${event.durationMs ?? 0} ms` },
			{ label: "Precomputed", value: event.precomputed ? "Yes" : "No" },
			{ label: "Preserved", value: event.preservedMessageCount?.toLocaleString("en-US") ?? "0" },
			{
				label: "Dropped total",
				value: event.cumulativeDroppedTokens?.toLocaleString("en-US") ?? "0",
			},
		],
	};
}

function createToolOperationLink(
	preset: AgentPanelStressPreset,
	seed: number,
	index: number,
	activeTail: boolean
): TranscriptViewportOperationLink {
	return {
		operationId: operationIdFor(preset, seed, index),
		toolCallId: toolCallIdFor(preset, seed, index),
		name: "bash",
		state: activeTail ? "running" : "completed",
	};
}

function createToolEntry(
	id: string,
	text: string,
	link: TranscriptViewportOperationLink,
	timestampMs: number,
	activeTail: boolean
): AgentPanelSceneEntryModel {
	if (activeTail) {
		return {
			id,
			type: "tool_call",
			toolCallId: link.toolCallId,
			operationId: link.operationId,
			kind: "execute",
			title: "Running stress command",
			status: "running",
			startedAtMs: timestampMs,
			completedAtMs: null,
			command: "bun test --stress",
			stdout: text,
			stderr: null,
			presentationState: "resolved",
			resultText: text,
		};
	}

	return {
		id,
		type: "tool_call",
		toolCallId: link.toolCallId,
		operationId: link.operationId,
		kind: "execute",
		title: "Completed stress command",
		status: "done",
		startedAtMs: timestampMs,
		completedAtMs: timestampMs + 200,
		command: "bun test --stress",
		stdout: text,
		stderr: null,
		exitCode: 0,
		presentationState: "resolved",
		resultText: text,
	};
}

function createRow(input: {
	readonly sessionId: string;
	readonly preset: AgentPanelStressPreset;
	readonly seed: number;
	readonly index: number;
	readonly kind: TranscriptViewportRowKind;
	readonly activeTail: boolean;
}): BuiltStressRow {
	const rowId = rowIdFor(input.preset, input.seed, input.index);
	const sourceEntryId = entryIdFor(input.preset, input.seed, input.index);
	const text = textFor(input.kind, input.index, input.seed);
	const timestampMs = timestampForIndex(input.index);
	if (input.kind === "sessionActivity") {
		const event = createCompactionEvent(
			input.sessionId,
			input.preset,
			input.seed,
			input.index,
			timestampMs
		);
		const row: TranscriptViewportRow = {
			rowId,
			sourceEntryId,
			kind: input.kind,
			version: `${rowId}:v1`,
			anchorEligible: true,
			activeStreamingTail: null,
			operationLinks: [],
			interactionLinks: [],
			content: {
				kind: "compaction",
				event,
			},
			durationStartedAtMs: null,
		};
		return {
			row,
			entry: createSessionActivityEntry(sourceEntryId, event),
		};
	}

	const operationLinks =
		input.kind === "tool"
			? [createToolOperationLink(input.preset, input.seed, input.index, input.activeTail)]
			: [];
	const segment =
		input.kind === "assistantThought"
			? createThoughtSegment(rowId, text)
			: createTextSegment(rowId, text);
	const role = input.kind === "user" ? "user" : input.kind === "tool" ? "tool" : "assistant";
	const row: TranscriptViewportRow = {
		rowId,
		sourceEntryId,
		kind: input.kind,
		version: `${rowId}:v1`,
		anchorEligible: true,
		activeStreamingTail: input.activeTail
			? input.kind === "assistantThought"
				? "thought"
				: "message"
			: null,
		operationLinks,
		interactionLinks: [],
		content: {
			kind: "transcript",
			role,
			segments: [segment],
		},
		durationStartedAtMs:
			input.kind === "assistantThought" || input.activeTail ? timestampMs : null,
	};

	if (input.kind === "user") {
		return {
			row,
			entry: createUserEntry(sourceEntryId, text, timestampMs),
		};
	}

	if (input.kind === "assistantThought") {
		return {
			row,
			entry: createThinkingEntry(sourceEntryId, text, timestampMs),
		};
	}

	if (input.kind === "tool") {
		const link = operationLinks[0];
		if (link !== undefined) {
			return {
				row,
				entry: createToolEntry(sourceEntryId, text, link, timestampMs, input.activeTail),
			};
		}
	}

	return {
		row,
		entry: createAssistantEntry(sourceEntryId, text, timestampMs, input.activeTail),
	};
}

function createRowsProjection(
	sessionId: string,
	emissionSeq: number,
	rows: readonly TranscriptViewportRow[]
): TranscriptRowsState {
	const byId = new Map<string, TranscriptViewportRow>();
	const order: string[] = [];
	for (const row of rows) {
		order.push(row.rowId);
		byId.set(row.rowId, row);
	}
	return {
		sessionId,
		emissionSeq,
		revision: null,
		projectionVersion: null,
		totalRowCount: null,
		loadedStartRowIndex: null,
		loadedEndRowIndex: null,
		order,
		byId,
		rows,
	};
}

export function createAgentPanelStressFixture(
	options: AgentPanelStressFixtureOptions
): AgentPanelStressFixture {
	const preset = options.preset ?? "mixed";
	const seed = normalizeSeed(options.seed);
	const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
	const rowCount = normalizeRowCount(options.rowCount);
	const includeStreamingTail = options.includeStreamingTail ?? preset === "streaming-tail";
	const rows: TranscriptViewportRow[] = [];
	const sceneEntries: AgentPanelSceneEntryModel[] = [];
	const kindCounts = createEmptyKindCounts();
	let activeTailRowId: string | null = null;
	const lastIndex = rowCount - 1;

	for (let index = 0; index < rowCount; index += 1) {
		const kind = chooseKind(index, lastIndex, preset, includeStreamingTail);
		const activeTail = includeStreamingTail && index === lastIndex;
		const built = createRow({
			sessionId,
			preset,
			seed,
			index,
			kind,
			activeTail,
		});
		rows.push(built.row);
		sceneEntries.push(built.entry);
		kindCounts[kind] += 1;
		if (activeTail) {
			activeTailRowId = built.row.rowId;
		}
	}

	return {
		sessionId,
		preset,
		seed,
		sceneEntries,
		rowsProjection: createRowsProjection(sessionId, rowCount, rows),
		summary: {
			totalRows: rowCount,
			preset,
			seed,
			kindCounts,
			activeTailRowId,
		},
	};
}
