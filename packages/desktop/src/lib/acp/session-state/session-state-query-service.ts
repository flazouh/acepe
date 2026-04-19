import type {
	SessionOpenFound,
	SessionStateDelta,
	SessionStateSnapshotMaterialization,
	ToolArguments,
	ToolCallStatus,
	TranscriptDelta,
	TranscriptDeltaOperation,
} from "../../services/acp-types.js";
import type { ToolCallData } from "../../services/converted-session-types.js";
import type { ToolCall, ToolCallUpdate } from "../types/tool-call.js";
import { materializeSnapshotFromOpenFound } from "./session-state-protocol.js";

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

export function materializeSessionOpenState(
	found: SessionOpenFound
): SessionStateSnapshotMaterialization {
	return materializeSnapshotFromOpenFound(found);
}

export function transcriptOperationsFromDelta(
	delta: SessionStateDelta
): TranscriptDeltaOperation[] {
	return delta.transcriptOperations ?? [];
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
	const fromRevision = delta.fromRevision.graphRevision;
	const toRevision = delta.toRevision.graphRevision;

	if (currentRevision === undefined) {
		if (fromRevision > 0) {
			return {
				kind: "refreshSnapshot",
				fromRevision,
				toRevision,
			};
		}
	} else if (fromRevision !== currentRevision) {
		return {
			kind: "refreshSnapshot",
			fromRevision,
			toRevision,
		};
	}

	const operations = transcriptOperationsFromDelta(delta);
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
			snapshotRevision: delta.toRevision.graphRevision,
			operations,
		},
	};
}

function mergeOptionalField<T>(
	currentValue: T | null | undefined,
	incomingValue: T | null | undefined
): T | null | undefined {
	return incomingValue ?? currentValue;
}

function mergeStringList(currentValues: string[], incomingValues: string[]): string[] {
	const merged: string[] = [];

	for (const value of currentValues) {
		if (!merged.includes(value)) {
			merged.push(value);
		}
	}

	for (const value of incomingValues) {
		if (!merged.includes(value)) {
			merged.push(value);
		}
	}

	return merged;
}

function mergeEditEntries(
	currentEdits: Extract<ToolArguments, { kind: "edit" }>["edits"],
	incomingEdits: Extract<ToolArguments, { kind: "edit" }>["edits"]
): Extract<ToolArguments, { kind: "edit" }>["edits"] {
	const maxLength = Math.max(currentEdits.length, incomingEdits.length);
	const merged: Extract<ToolArguments, { kind: "edit" }>["edits"] = [];

	for (let index = 0; index < maxLength; index += 1) {
		const currentEdit = currentEdits[index];
		const incomingEdit = incomingEdits[index];

		if (currentEdit && incomingEdit) {
			merged.push({
				filePath: incomingEdit.filePath ?? currentEdit.filePath,
				moveFrom: incomingEdit.moveFrom ?? currentEdit.moveFrom,
				oldString: incomingEdit.oldString ?? currentEdit.oldString,
				newString: incomingEdit.newString ?? currentEdit.newString,
				content: incomingEdit.content ?? currentEdit.content,
			});
			continue;
		}

		if (incomingEdit) {
			merged.push(incomingEdit);
			continue;
		}

		if (currentEdit) {
			merged.push(currentEdit);
		}
	}

	return merged;
}

function isTerminalToolCallStatus(status: ToolCallStatus | null | undefined): boolean {
	return status === "completed" || status === "failed";
}

export function resolveCanonicalToolCallStatus(
	currentStatus: ToolCallStatus | null | undefined,
	nextStatus: ToolCallStatus | null | undefined
): ToolCallStatus | null | undefined {
	if (!nextStatus) {
		return currentStatus;
	}

	if (isTerminalToolCallStatus(currentStatus) && !isTerminalToolCallStatus(nextStatus)) {
		return currentStatus;
	}

	return nextStatus;
}

export function mergeCanonicalToolArguments(
	currentArgs: ToolArguments,
	nextArgs: ToolArguments
): ToolArguments {
	if (currentArgs.kind !== nextArgs.kind) {
		return nextArgs;
	}

	switch (currentArgs.kind) {
		case "read":
			if (nextArgs.kind !== "read") return nextArgs;
			return {
				kind: "read",
				file_path: mergeOptionalField(currentArgs.file_path, nextArgs.file_path),
				source_context: mergeOptionalField(
					currentArgs.source_context ?? null,
					nextArgs.source_context ?? null
				),
			};
		case "edit":
			if (nextArgs.kind !== "edit") return nextArgs;
			return {
				kind: "edit",
				edits: mergeEditEntries(currentArgs.edits, nextArgs.edits),
			};
		case "execute":
			if (nextArgs.kind !== "execute") return nextArgs;
			return {
				kind: "execute",
				command: mergeOptionalField(currentArgs.command, nextArgs.command),
			};
		case "search":
			if (nextArgs.kind !== "search") return nextArgs;
			return {
				kind: "search",
				query: mergeOptionalField(currentArgs.query, nextArgs.query),
				file_path: mergeOptionalField(currentArgs.file_path, nextArgs.file_path),
			};
		case "glob":
			if (nextArgs.kind !== "glob") return nextArgs;
			return {
				kind: "glob",
				pattern: mergeOptionalField(currentArgs.pattern, nextArgs.pattern),
				path: mergeOptionalField(currentArgs.path, nextArgs.path),
			};
		case "fetch":
			if (nextArgs.kind !== "fetch") return nextArgs;
			return {
				kind: "fetch",
				url: mergeOptionalField(currentArgs.url, nextArgs.url),
			};
		case "webSearch":
			if (nextArgs.kind !== "webSearch") return nextArgs;
			return {
				kind: "webSearch",
				query: mergeOptionalField(currentArgs.query, nextArgs.query),
			};
		case "think":
			if (nextArgs.kind !== "think") return nextArgs;
			return {
				kind: "think",
				description: mergeOptionalField(currentArgs.description, nextArgs.description),
				prompt: mergeOptionalField(currentArgs.prompt, nextArgs.prompt),
				subagent_type: mergeOptionalField(currentArgs.subagent_type, nextArgs.subagent_type),
				skill: mergeOptionalField(currentArgs.skill, nextArgs.skill),
				skill_args: mergeOptionalField(currentArgs.skill_args, nextArgs.skill_args),
				raw: mergeOptionalField(currentArgs.raw, nextArgs.raw),
			};
		case "taskOutput":
			if (nextArgs.kind !== "taskOutput") return nextArgs;
			return {
				kind: "taskOutput",
				task_id: mergeOptionalField(currentArgs.task_id, nextArgs.task_id),
				timeout: mergeOptionalField(currentArgs.timeout, nextArgs.timeout),
			};
		case "move":
			if (nextArgs.kind !== "move") return nextArgs;
			return {
				kind: "move",
				from: mergeOptionalField(currentArgs.from, nextArgs.from),
				to: mergeOptionalField(currentArgs.to, nextArgs.to),
			};
		case "delete":
			if (nextArgs.kind !== "delete") return nextArgs;
			return {
				kind: "delete",
				file_path: mergeOptionalField(currentArgs.file_path, nextArgs.file_path),
				file_paths: mergeOptionalField(currentArgs.file_paths, nextArgs.file_paths),
			};
		case "planMode":
			if (nextArgs.kind !== "planMode") return nextArgs;
			return {
				kind: "planMode",
				mode: mergeOptionalField(currentArgs.mode, nextArgs.mode),
			};
		case "toolSearch":
			if (nextArgs.kind !== "toolSearch") return nextArgs;
			return {
				kind: "toolSearch",
				query: mergeOptionalField(currentArgs.query, nextArgs.query),
				max_results: mergeOptionalField(currentArgs.max_results, nextArgs.max_results),
			};
		case "browser":
			return nextArgs;
		case "sql":
			if (nextArgs.kind !== "sql") return nextArgs;
			return {
				kind: "sql",
				query: mergeOptionalField(currentArgs.query, nextArgs.query),
				description: mergeOptionalField(currentArgs.description, nextArgs.description),
			};
		case "unclassified":
			if (nextArgs.kind !== "unclassified") return nextArgs;
			return {
				kind: "unclassified",
				raw_name: nextArgs.raw_name.length > 0 ? nextArgs.raw_name : currentArgs.raw_name,
				raw_kind_hint: mergeOptionalField(currentArgs.raw_kind_hint, nextArgs.raw_kind_hint),
				title: mergeOptionalField(currentArgs.title, nextArgs.title),
				arguments_preview: mergeOptionalField(
					currentArgs.arguments_preview,
					nextArgs.arguments_preview
				),
				signals_tried: mergeStringList(currentArgs.signals_tried, nextArgs.signals_tried),
			};
		case "other":
			return nextArgs;
	}
}

function isStreamingToolCallStatus(status: ToolCallStatus | null | undefined): boolean {
	return status === "pending" || status === "in_progress";
}

export interface CanonicalToolCallCreateResolution {
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

export function resolveCanonicalToolCallCreate(
	currentToolCall: ToolCall,
	data: ToolCallData,
	startedAtMsHint: number,
	nowMs: number
): CanonicalToolCallCreateResolution {
	const nextStatus = resolveCanonicalToolCallStatus(currentToolCall.status, data.status);
	const nextKind =
		currentToolCall.kind === "task" &&
		data.kind === "question" &&
		(data.normalizedQuestions?.length ?? 0) > 0
			? data.kind
			: (currentToolCall.kind === undefined || currentToolCall.kind === "other") &&
				  data.kind !== undefined &&
				  data.kind !== "other"
				? data.kind
				: (currentToolCall.kind ?? data.kind);
	const nextAwaitingPlanApproval = data.awaitingPlanApproval;
	return {
		nextStatus,
		nextArguments: mergeCanonicalToolArguments(currentToolCall.arguments, data.arguments),
		nextRawInput: data.rawInput ?? currentToolCall.rawInput,
		nextResult: data.result ?? currentToolCall.result,
		nextKind,
		nextAwaitingPlanApproval,
		nextPlanApprovalRequestId: nextAwaitingPlanApproval
			? (data.planApprovalRequestId ?? currentToolCall.planApprovalRequestId ?? null)
			: null,
		nextProgressiveArguments: isTerminalToolCallStatus(nextStatus ?? data.status)
			? undefined
			: currentToolCall.progressiveArguments,
		startedAtMs: currentToolCall.startedAtMs ?? startedAtMsHint,
		completedAtMs:
			currentToolCall.completedAtMs ??
			(isTerminalToolCallStatus(nextStatus ?? data.status) ? nowMs : undefined),
		isStreaming: isStreamingToolCallStatus(nextStatus),
	};
}

export interface CanonicalToolCallUpdateResolution {
	nextStatus: ToolCallStatus | null | undefined;
	nextArguments: ToolArguments;
	nextProgressiveArguments: ToolCall["progressiveArguments"];
	nextResult: ToolCall["result"];
	startedAtMs: number;
	completedAtMs: number | undefined;
	shouldRefreshNormalizedResult: boolean;
	isStreaming: boolean;
}

export function resolveCanonicalToolCallUpdate(
	currentToolCall: ToolCall,
	update: ToolCallUpdate,
	extractedResult: ToolCall["result"] | null | undefined,
	startedAtMsHint: number,
	nowMs: number
): CanonicalToolCallUpdateResolution {
	const isStructuredResult =
		currentToolCall.result !== null &&
		currentToolCall.result !== undefined &&
		typeof currentToolCall.result === "object" &&
		!Array.isArray(currentToolCall.result);
	const isTextExtracted = typeof extractedResult === "string";
	const shouldPreserveStructuredResult = isStructuredResult && isTextExtracted;
	const incomingStatus = update.status ?? currentToolCall.status;
	const nextStatus = resolveCanonicalToolCallStatus(currentToolCall.status, incomingStatus);
	const rawNextArguments =
		update.arguments ?? update.streamingArguments ?? currentToolCall.arguments;
	const nextArguments =
		rawNextArguments === currentToolCall.arguments
			? currentToolCall.arguments
			: mergeCanonicalToolArguments(currentToolCall.arguments, rawNextArguments);
	const nextProgressiveArguments = isTerminalToolCallStatus(nextStatus)
		? undefined
		: (update.arguments ?? null) != null
			? undefined
			: (update.streamingArguments ?? currentToolCall.progressiveArguments);
	const nextResult = shouldPreserveStructuredResult
		? currentToolCall.result
		: (extractedResult ?? currentToolCall.result);
	const argumentsChanged = nextArguments !== currentToolCall.arguments;
	return {
		nextStatus,
		nextArguments,
		nextProgressiveArguments,
		nextResult,
		startedAtMs: currentToolCall.startedAtMs ?? startedAtMsHint,
		completedAtMs:
			currentToolCall.completedAtMs ??
			(isTerminalToolCallStatus(nextStatus) ? nowMs : undefined),
		shouldRefreshNormalizedResult:
			(!shouldPreserveStructuredResult && extractedResult !== null) ||
			currentToolCall.normalizedResult === undefined ||
			(argumentsChanged && nextResult !== null && nextResult !== undefined),
		isStreaming: isStreamingToolCallStatus(nextStatus),
	};
}
