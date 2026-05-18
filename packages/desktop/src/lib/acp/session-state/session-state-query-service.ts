import type {
	SessionStateDelta,
	ToolCallStatus,
	TranscriptDelta,
	TranscriptDeltaOperation,
} from "../../services/acp-types.js";
import type {
	ToolArguments,
	ToolCallData,
	ToolCallUpdateData,
} from "../../services/converted-session-types.js";
import type { ToolCall } from "../types/tool-call.js";

export type SessionStateDeltaResolution =
	| {
			kind: "refreshSnapshot";
			fromRevision: number;
			toRevision: number;
	  }
	| {
			kind: "applyTranscriptDelta";
			delta: TranscriptDelta;
	  }
	| {
			kind: "noop";
	  };

export function transcriptOperationsFromDelta(
	delta: SessionStateDelta
): TranscriptDeltaOperation[] {
	const operations = delta.transcriptOperations ?? [];
	const validOperations: TranscriptDeltaOperation[] = [];

	for (const operation of operations) {
		if (!isValidTranscriptDeltaOperation(operation)) {
			continue;
		}
		validOperations.push(operation);
	}

	return validOperations;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isValidTranscriptDeltaOperation(
	operation: TranscriptDeltaOperation | undefined | null
): operation is TranscriptDeltaOperation {
	if (!operation || typeof operation !== "object" || !("kind" in operation)) {
		return false;
	}

	if (operation.kind === "replaceSnapshot") {
		return true;
	}

	if (operation.kind === "appendEntry") {
		return isNonEmptyString(operation.entry?.entryId);
	}

	if (operation.kind === "appendSegment") {
		return isNonEmptyString(operation.entryId);
	}

	return false;
}

export function sessionStateDeltaHasAssistantMutation(delta: SessionStateDelta): boolean {
	for (const operation of transcriptOperationsFromDelta(delta)) {
		if (operation.kind === "appendEntry" && operation.entry.role === "assistant") {
			return true;
		}
		if (operation.kind === "appendSegment" && operation.role === "assistant") {
			return true;
		}
		if (operation.kind === "replaceSnapshot") {
			return true;
		}
	}
	return false;
}

export function resolveSessionStateDelta(
	sessionId: string,
	currentRevision: number | undefined,
	delta: SessionStateDelta
): SessionStateDeltaResolution {
	const operations = transcriptOperationsFromDelta(delta);
	const isTranscriptBearing = operations.length > 0;
	const fromRevision = delta.fromRevision.transcriptRevision;
	const toRevision = delta.toRevision.transcriptRevision;

	if (isTranscriptBearing && currentRevision === undefined) {
		if (fromRevision > 0) {
			return {
				kind: "refreshSnapshot",
				fromRevision,
				toRevision,
			};
		}
	} else if (isTranscriptBearing && fromRevision !== currentRevision) {
		return {
			kind: "refreshSnapshot",
			fromRevision,
			toRevision,
		};
	}
	if (operations.length === 0) {
		return {
			kind: "noop",
		};
	}

	return {
		kind: "applyTranscriptDelta",
		delta: {
			eventSeq: delta.toRevision.lastEventSeq,
			sessionId,
			snapshotRevision: delta.toRevision.transcriptRevision,
			operations,
		},
	};
}

function isTerminalToolCallStatus(status: ToolCallStatus | null | undefined): boolean {
	return status === "completed" || status === "failed";
}

export function resolveTranscriptToolCallStatus(
	currentStatus: ToolCallStatus | null | undefined,
	nextStatus: ToolCallStatus | null | undefined
): ToolCallStatus | null | undefined {
	return nextStatus ?? currentStatus;
}

function isStreamingToolCallStatus(status: ToolCallStatus | null | undefined): boolean {
	return status === "pending" || status === "in_progress";
}

export interface TranscriptToolCallCreateResolution {
	nextStatus: ToolCallStatus | null | undefined;
	nextArguments: ToolArguments;
	nextRawInput: ToolCall["rawInput"];
	nextResult: ToolCall["result"];
	nextKind: ToolCall["kind"];
	nextAwaitingPlanApproval: boolean;
	nextPlanApprovalRequestId: number | null;
	nextProgressiveArguments: ToolCall["progressiveArguments"];
	startedAtMs: number;
	completedAtMs: number | undefined;
	isStreaming: boolean;
}

export function resolveTranscriptToolCallCreate(
	currentToolCall: ToolCall,
	data: ToolCallData,
	startedAtMsHint: number,
	nowMs: number
): TranscriptToolCallCreateResolution {
	const nextAwaitingPlanApproval = data.awaitingPlanApproval;
	const nextProgressiveArguments = isTerminalToolCallStatus(data.status)
		? undefined
		: currentToolCall.progressiveArguments;
	return {
		nextStatus: data.status,
		nextArguments: data.arguments,
		nextRawInput: data.rawInput,
		nextResult: data.result,
		nextKind: data.kind,
		nextAwaitingPlanApproval,
		nextPlanApprovalRequestId: nextAwaitingPlanApproval ? (data.planApprovalRequestId ?? null) : null,
		nextProgressiveArguments,
		startedAtMs: currentToolCall.startedAtMs ?? startedAtMsHint,
		completedAtMs: isTerminalToolCallStatus(data.status) ? nowMs : undefined,
		isStreaming: isStreamingToolCallStatus(data.status),
	};
}

export interface TranscriptToolCallUpdateResolution {
	nextStatus: ToolCallStatus | null | undefined;
	nextArguments: ToolArguments;
	nextProgressiveArguments: ToolCall["progressiveArguments"];
	nextResult: ToolCall["result"];
	startedAtMs: number;
	completedAtMs: number | undefined;
	shouldRefreshNormalizedResult: boolean;
	isStreaming: boolean;
}

export function resolveTranscriptToolCallUpdate(
	currentToolCall: ToolCall,
	update: ToolCallUpdateData,
	extractedResult: ToolCall["result"] | null | undefined,
	startedAtMsHint: number,
	nowMs: number
): TranscriptToolCallUpdateResolution {
	const incomingStatus = update.status ?? currentToolCall.status;
	const nextStatus = resolveTranscriptToolCallStatus(currentToolCall.status, incomingStatus);
	const nextArguments = update.arguments ?? currentToolCall.arguments;
	const nextProgressiveArguments = isTerminalToolCallStatus(nextStatus)
		? undefined
		: (update.arguments ?? null) != null
			? undefined
			: (update.streamingArguments ?? currentToolCall.progressiveArguments);
	const nextResult = extractedResult ?? currentToolCall.result;
	const argumentsChanged = nextArguments !== currentToolCall.arguments;
	return {
		nextStatus,
		nextArguments,
		nextProgressiveArguments,
		nextResult,
		startedAtMs: currentToolCall.startedAtMs ?? startedAtMsHint,
		completedAtMs:
			currentToolCall.completedAtMs ?? (isTerminalToolCallStatus(nextStatus) ? nowMs : undefined),
		shouldRefreshNormalizedResult:
			extractedResult !== null ||
			currentToolCall.normalizedResult === undefined ||
			(argumentsChanged && nextResult !== null && nextResult !== undefined),
		isStreaming: isStreamingToolCallStatus(nextStatus),
	};
}
