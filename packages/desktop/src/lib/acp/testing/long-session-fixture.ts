import type { SessionEntry } from "../application/dto/session.js";
import type { OperationSnapshot } from "../../services/acp-types.js";
import type { ToolCall } from "../types/tool-call.js";

export type LongSessionFixtureScale = "short" | "long" | "doubled";

type FailureSessionProfile = {
	transcriptEntryCount: number | null;
	operationCount: number | null;
	largeToolOutputProfile: string;
	sessionDuration: string;
};

export type LongSessionFixtureAssumptions = {
	calibration: "unvalidated";
	knownFailureSession: FailureSessionProfile;
	notes: string;
};

export const LONG_SESSION_FIXTURE_ASSUMPTIONS: LongSessionFixtureAssumptions = {
	calibration: "unvalidated",
	knownFailureSession: {
		transcriptEntryCount: null,
		operationCount: null,
		largeToolOutputProfile: "unknown",
		sessionDuration: "unknown",
	},
	notes:
		"Synthetic fixture until a real failure-session profile is available. It intentionally uses short, long, and doubled variants so tests can assert bounded scaling.",
};

export type LongSessionFixture = {
	sessionId: string;
	entries: readonly SessionEntry[];
	operationSnapshots: readonly OperationSnapshot[];
	changedOperationSnapshot: OperationSnapshot;
	activeStreamingOperationId: string;
	metadata: {
		scale: LongSessionFixtureScale;
		assumptions: LongSessionFixtureAssumptions;
		failureSessionCalibration: "unvalidated";
		transcriptEntryCount: number;
		completedOperationCount: number;
	};
};

type LongSessionFixtureOptions = {
	scale?: LongSessionFixtureScale;
	sessionId?: string;
};

type ScaleCounts = {
	transcriptEntryCount: number;
	operationSnapshotCount: number;
};

const ACTIVE_TOOL_CALL_ID = "active-tool-call";
const ACTIVE_COMMAND = "bun test --filter long-session";
const BASE_TIMESTAMP_MS = Date.parse("2026-01-01T00:00:00.000Z");
const ACTIVE_OPERATION_STARTED_AT_MS = BASE_TIMESTAMP_MS + 999_000;

function countsForScale(scale: LongSessionFixtureScale): ScaleCounts {
	if (scale === "short") {
		return {
			transcriptEntryCount: 24,
			operationSnapshotCount: 24,
		};
	}

	if (scale === "doubled") {
		return {
			transcriptEntryCount: 640,
			operationSnapshotCount: 480,
		};
	}

	return {
		transcriptEntryCount: 320,
		operationSnapshotCount: 240,
	};
}

function timestampForIndex(index: number): Date {
	return new Date(BASE_TIMESTAMP_MS + index * 1_000);
}

function createTextBlock(text: string): { type: "text"; text: string } {
	return { type: "text", text };
}

function createUserEntry(index: number): SessionEntry {
	const text = `User message ${index}`;
	return {
		id: `user-${index}`,
		type: "user",
		message: {
			content: createTextBlock(text),
			chunks: [createTextBlock(text)],
			sentAt: timestampForIndex(index),
		},
		timestamp: timestampForIndex(index),
	};
}

function createAssistantEntry(index: number): SessionEntry {
	const chunkType = index % 6 === 1 ? "thought" : "message";
	return {
		id: `assistant-${index}`,
		type: "assistant",
		message: {
			chunks: [
				{
					type: chunkType,
					block: createTextBlock(`Assistant response ${index}`),
				},
			],
			receivedAt: timestampForIndex(index),
		},
		timestamp: timestampForIndex(index),
	};
}

function createToolCall(
	toolCallId: string,
	index: number,
	status: "completed" | "in_progress"
): ToolCall {
	const command = status === "in_progress" ? ACTIVE_COMMAND : `echo fixture-${index}`;
	return {
		id: toolCallId,
		name: "bash",
		arguments: { kind: "execute", command },
		status,
		result: status === "completed" ? `completed ${index}` : null,
		kind: "execute",
		title: status === "completed" ? `Completed command ${index}` : "Active command",
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos:
			index % 10 === 0
				? [
						{
							content: `Todo ${index}`,
							activeForm: `Doing todo ${index}`,
							status: "completed",
						},
					]
				: null,
		awaitingPlanApproval: false,
		startedAtMs:
			status === "in_progress" ? ACTIVE_OPERATION_STARTED_AT_MS : BASE_TIMESTAMP_MS + index * 1_000,
		completedAtMs: status === "completed" ? BASE_TIMESTAMP_MS + index * 1_000 + 500 : undefined,
	};
}

function createToolCallEntry(index: number, status: "completed" | "in_progress"): SessionEntry {
	const toolCallId = status === "in_progress" ? ACTIVE_TOOL_CALL_ID : `tool-${index}`;
	return {
		id: `tool-entry-${index}`,
		type: "tool_call",
		message: createToolCall(toolCallId, index, status),
		timestamp: timestampForIndex(index),
		isStreaming: status === "in_progress",
	};
}

function buildEntries(count: number): SessionEntry[] {
	const entries: SessionEntry[] = [];
	for (let index = 0; index < count - 1; index += 1) {
		if (index % 5 === 0) {
			entries.push(createToolCallEntry(index, "completed"));
			continue;
		}

		if (index % 2 === 0) {
			entries.push(createUserEntry(index));
			continue;
		}

		entries.push(createAssistantEntry(index));
	}

	entries.push(createToolCallEntry(count - 1, "in_progress"));
	return entries;
}

function buildCanonicalOperationId(sessionId: string, toolCallId: string): string {
	return `op:${sessionId.length}:${sessionId}:${toolCallId.length}:${toolCallId}`;
}

function createOperationSnapshot(
	sessionId: string,
	index: number,
	status: "completed" | "in_progress"
): OperationSnapshot {
	const toolCallId = status === "in_progress" ? ACTIVE_TOOL_CALL_ID : `operation-tool-${index}`;
	const command = status === "in_progress" ? ACTIVE_COMMAND : `echo operation-${index}`;
	const operationState = status === "in_progress" ? "running" : "completed";
	return {
		id: buildCanonicalOperationId(sessionId, toolCallId),
		session_id: sessionId,
		tool_call_id: toolCallId,
		name: "bash",
		kind: "execute",
		provider_status: status,
		title: status === "in_progress" ? "Active command" : `Completed operation ${index}`,
		arguments: { kind: "execute", command },
		progressive_arguments: null,
		result: status === "completed" ? `operation result ${index}` : null,
		command,
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_provenance_key: toolCallId,
		operation_state: operationState,
		locations: null,
		skill_meta: null,
		normalized_questions: null,
		question_answer: null,
		awaiting_plan_approval: false,
		plan_approval_request_id: null,
		started_at_ms:
			status === "in_progress" ? ACTIVE_OPERATION_STARTED_AT_MS : BASE_TIMESTAMP_MS + index * 1_000,
		completed_at_ms: status === "completed" ? BASE_TIMESTAMP_MS + index * 1_000 + 500 : null,
		source_entry_id: null,
		degradation_reason: null,
	};
}

function buildOperationSnapshots(sessionId: string, count: number): OperationSnapshot[] {
	const snapshots: OperationSnapshot[] = [];
	for (let index = 0; index < count - 1; index += 1) {
		snapshots.push(createOperationSnapshot(sessionId, index, "completed"));
	}
	snapshots.push(createOperationSnapshot(sessionId, count - 1, "in_progress"));
	return snapshots;
}

export function createLongSessionFixture(
	options: LongSessionFixtureOptions = {}
): LongSessionFixture {
	const scale = options.scale ?? "long";
	const sessionId = options.sessionId ?? "session-long-fixture";
	const counts = countsForScale(scale);
	const entries = buildEntries(counts.transcriptEntryCount);
	const operationSnapshots = buildOperationSnapshots(sessionId, counts.operationSnapshotCount);
	const changedOperationSnapshot = operationSnapshots[operationSnapshots.length - 1];
	if (!changedOperationSnapshot) {
		throw new Error("Long-session fixture requires an active streaming operation");
	}

	return {
		sessionId,
		entries,
		operationSnapshots,
		changedOperationSnapshot,
		activeStreamingOperationId: changedOperationSnapshot.id,
		metadata: {
			scale,
			assumptions: LONG_SESSION_FIXTURE_ASSUMPTIONS,
			failureSessionCalibration: LONG_SESSION_FIXTURE_ASSUMPTIONS.calibration,
			transcriptEntryCount: entries.length,
			completedOperationCount: operationSnapshots.length - 1,
		},
	};
}
