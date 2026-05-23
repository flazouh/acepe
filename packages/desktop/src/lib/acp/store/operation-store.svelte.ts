import { SvelteMap } from "svelte/reactivity";
import type { OperationSnapshot, OperationSourceLink } from "../../services/acp-types.js";
import { aggregateFileEditsFromToolCalls } from "../logic/aggregate-file-edits.js";
import type { ModifiedFilesState } from "../types/modified-files-state.js";
import type { Operation, OperationState } from "../types/operation.js";
import type { ToolCall } from "../types/tool-call.js";
import type { ToolKind } from "../types/tool-kind.js";
import { mapOperationStateToToolPresentationStatus } from "../utils/tool-state-utils.js";
import { normalizeToolResult } from "./services/tool-result-normalizer.js";

function createSessionToolKey(sessionId: string, toolCallId: string): string {
	return `${sessionId}::${toolCallId}`;
}

export function buildOperationId(sessionId: string, toolCallId: string): string {
	return buildCanonicalOperationId(sessionId, toolCallId);
}

export function buildCanonicalOperationId(sessionId: string, provenanceKey: string): string {
	return `op:${sessionId.length}:${sessionId}:${provenanceKey.length}:${provenanceKey}`;
}

function isStreamingOperationState(state: OperationState): boolean {
	return state === "pending" || state === "running" || state === "blocked";
}

function transcriptSourceEntryId(sourceLink: OperationSourceLink): string | null {
	return sourceLink.kind === "transcript_linked" ? sourceLink.entry_id : null;
}

export class OperationStore {
	/**
	 * Canonical runtime owner for resolved tool execution state. Operations enter
	 * this store only through Rust-authored session graph snapshots and patches.
	 */
	private readonly operationsById = new SvelteMap<string, Operation>();
	private readonly operationIdByToolCallKey = new SvelteMap<string, string>();
	private readonly operationIdByProvenanceKey = new SvelteMap<string, string>();
	private readonly operationIdByEntryKey = new SvelteMap<string, string>();
	private readonly sessionOperationIds = new SvelteMap<string, Array<string>>();
	private readonly sessionOperationIdSets = new Map<string, Set<string>>();
	private readonly sessionOperationVersions = new SvelteMap<string, number>();
	private readonly currentStreamingOperationIdBySession = new SvelteMap<string, string>();
	private readonly modifiedFilesStateBySession = new Map<
		string,
		{ readonly version: number; readonly state: ModifiedFilesState | null }
	>();
	private readonly sessionOperationsBySession = new Map<
		string,
		{ readonly version: number; readonly operations: Array<Operation> }
	>();
	private readonly sessionToolCallsBySession = new Map<
		string,
		{ readonly version: number; readonly toolCalls: Array<ToolCall> }
	>();
	private readonly currentStreamingToolCallBySession = new Map<
		string,
		{ readonly version: number; readonly toolCall: ToolCall | null }
	>();
	private readonly lastToolCallBySession = new Map<
		string,
		{ readonly version: number; readonly toolCall: ToolCall | null }
	>();
	private readonly lastTodoToolCallBySession = new Map<
		string,
		{ readonly version: number; readonly toolCall: ToolCall | null }
	>();

	getById(operationId: string): Operation | undefined {
		return this.operationsById.get(operationId);
	}

	getByToolCallId(sessionId: string, toolCallId: string): Operation | undefined {
		const operationId = this.operationIdByToolCallKey.get(
			createSessionToolKey(sessionId, toolCallId)
		);
		if (operationId == null) {
			return undefined;
		}

		return this.operationsById.get(operationId);
	}

	getByProvenanceKey(sessionId: string, provenanceKey: string): Operation | undefined {
		const operationId = this.operationIdByProvenanceKey.get(
			createSessionToolKey(sessionId, provenanceKey)
		);
		if (operationId == null) {
			return undefined;
		}

		return this.operationsById.get(operationId);
	}

	getToolCallById(sessionId: string, toolCallId: string): ToolCall | null {
		const operation = this.getByToolCallId(sessionId, toolCallId);
		if (operation == null) {
			return null;
		}

		return this.materializeToolCall(operation.id, new Set<string>());
	}

	getByEntryId(sessionId: string, entryId: string): Operation | undefined {
		const operationId = this.operationIdByEntryKey.get(createSessionToolKey(sessionId, entryId));
		if (operationId == null) {
			return undefined;
		}

		return this.operationsById.get(operationId);
	}

	getSessionOperations(sessionId: string): Array<Operation> {
		const version = this.sessionOperationVersions.get(sessionId) ?? 0;
		const cached = this.sessionOperationsBySession.get(sessionId);
		if (cached !== undefined && cached.version === version) {
			return cached.operations;
		}

		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		const operations: Array<Operation> = [];
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation != null) {
				operations.push(operation);
			}
		}
		this.sessionOperationsBySession.set(sessionId, { version, operations });
		return operations;
	}

	getSessionToolCalls(sessionId: string): Array<ToolCall> {
		const version = this.sessionOperationVersions.get(sessionId) ?? 0;
		const cached = this.sessionToolCallsBySession.get(sessionId);
		if (cached !== undefined && cached.version === version) {
			return cached.toolCalls;
		}

		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		const toolCalls: Array<ToolCall> = [];
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation == null || operation.parentOperationId !== null) {
				continue;
			}
			const toolCall = this.materializeToolCall(operation.id, new Set<string>());
			if (toolCall !== null) {
				toolCalls.push(toolCall);
			}
		}
		this.sessionToolCallsBySession.set(sessionId, { version, toolCalls });
		return toolCalls;
	}

	getSessionModifiedFilesState(sessionId: string): ModifiedFilesState | null {
		const version = this.sessionOperationVersions.get(sessionId) ?? 0;
		const cached = this.modifiedFilesStateBySession.get(sessionId);
		if (cached !== undefined && cached.version === version) {
			return cached.state;
		}

		const toolCalls = this.getSessionToolCalls(sessionId);
		if (toolCalls.length === 0) {
			this.modifiedFilesStateBySession.set(sessionId, { version, state: null });
			return null;
		}

		const state = aggregateFileEditsFromToolCalls(toolCalls);
		const selectedState = state.fileCount > 0 ? state : null;
		this.modifiedFilesStateBySession.set(sessionId, { version, state: selectedState });
		return selectedState;
	}

	getCurrentStreamingToolCall(sessionId: string): ToolCall | null {
		const version = this.sessionOperationVersions.get(sessionId) ?? 0;
		const cached = this.currentStreamingToolCallBySession.get(sessionId);
		if (cached !== undefined && cached.version === version) {
			return cached.toolCall;
		}

		const operation = this.getCurrentStreamingOperation(sessionId);
		if (operation !== null) {
			const toolCall = this.materializeToolCall(operation.id, new Set<string>());
			if (toolCall !== null) {
				this.currentStreamingToolCallBySession.set(sessionId, { version, toolCall });
				return toolCall;
			}
		}

		this.currentStreamingToolCallBySession.set(sessionId, { version, toolCall: null });
		return null;
	}

	getCurrentStreamingOperation(sessionId: string): Operation | null {
		const operationId = this.currentStreamingOperationIdBySession.get(sessionId);
		if (operationId === undefined) {
			return null;
		}

		const operation = this.operationsById.get(operationId);
		if (operation !== undefined && isStreamingOperationState(operation.operationState)) {
			return operation;
		}

		return this.recomputeCurrentStreamingOperation(sessionId);
	}

	getLastToolCall(sessionId: string): ToolCall | null {
		const version = this.sessionOperationVersions.get(sessionId) ?? 0;
		const cached = this.lastToolCallBySession.get(sessionId);
		if (cached !== undefined && cached.version === version) {
			return cached.toolCall;
		}

		const operations = this.getSessionOperations(sessionId);
		for (let index = operations.length - 1; index >= 0; index -= 1) {
			const toolCall = this.materializeToolCall(operations[index].id, new Set<string>());
			if (toolCall !== null) {
				this.lastToolCallBySession.set(sessionId, { version, toolCall });
				return toolCall;
			}
		}

		this.lastToolCallBySession.set(sessionId, { version, toolCall: null });
		return null;
	}

	getLastTodoToolCall(sessionId: string): ToolCall | null {
		const version = this.sessionOperationVersions.get(sessionId) ?? 0;
		const cached = this.lastTodoToolCallBySession.get(sessionId);
		if (cached !== undefined && cached.version === version) {
			return cached.toolCall;
		}

		const operations = this.getSessionOperations(sessionId);
		for (let index = operations.length - 1; index >= 0; index -= 1) {
			const toolCall = this.materializeToolCall(operations[index].id, new Set<string>());
			if (toolCall?.normalizedTodos && toolCall.normalizedTodos.length > 0) {
				this.lastTodoToolCallBySession.set(sessionId, { version, toolCall });
				return toolCall;
			}
		}

		this.lastTodoToolCallBySession.set(sessionId, { version, toolCall: null });
		return null;
	}

	getCurrentToolKind(sessionId: string): ToolKind | null {
		const currentOperation = this.getCurrentStreamingOperation(sessionId);
		if (currentOperation == null) {
			return null;
		}

		return currentOperation.kind ?? "other";
	}

	clearSession(sessionId: string): void {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation == null) {
				continue;
			}

			this.operationsById.delete(operationId);
			this.unindexOperation(operation);
		}

		this.sessionOperationIds.delete(sessionId);
		this.sessionOperationIdSets.delete(sessionId);
		this.currentStreamingOperationIdBySession.delete(sessionId);
		this.modifiedFilesStateBySession.delete(sessionId);
		this.bumpSessionOperationVersion(sessionId);
	}

	replaceSessionOperations(sessionId: string, snapshots: ReadonlyArray<OperationSnapshot>): void {
		this.clearSession(sessionId);
		const nextSessionOperationIds: Array<string> = [];
		const nextSessionOperationIdSet = new Set<string>();
		let currentStreamingOperationId: string | null = null;
		for (const snapshot of snapshots) {
			const operation = this.operationFromSnapshot(snapshot);
			this.operationsById.set(operation.id, operation);
			this.indexOperation(operation);
			nextSessionOperationIds.push(operation.id);
			nextSessionOperationIdSet.add(operation.id);
			if (isStreamingOperationState(operation.operationState)) {
				currentStreamingOperationId = operation.id;
			}
		}
		this.sessionOperationIds.set(sessionId, nextSessionOperationIds);
		this.sessionOperationIdSets.set(sessionId, nextSessionOperationIdSet);
		if (currentStreamingOperationId === null) {
			this.currentStreamingOperationIdBySession.delete(sessionId);
		} else {
			this.currentStreamingOperationIdBySession.set(sessionId, currentStreamingOperationId);
		}
		this.bumpSessionOperationVersion(sessionId);
	}

	applySessionOperationPatches(
		sessionId: string,
		snapshots: ReadonlyArray<OperationSnapshot>
	): void {
		if (snapshots.length === 0) {
			return;
		}

		let sessionOperationIds = this.sessionOperationIds.get(sessionId);
		if (sessionOperationIds === undefined) {
			sessionOperationIds = [];
			this.sessionOperationIds.set(sessionId, sessionOperationIds);
		}
		let sessionOperationIdSet = this.sessionOperationIdSets.get(sessionId);
		if (sessionOperationIdSet === undefined) {
			sessionOperationIdSet = new Set(sessionOperationIds);
			this.sessionOperationIdSets.set(sessionId, sessionOperationIdSet);
		}

		let appendedOperationId = false;
		for (const snapshot of snapshots) {
			const operation = this.operationFromSnapshot(snapshot);
			const existingOperation = this.operationsById.get(operation.id);
			if (existingOperation !== undefined) {
				this.unindexOperation(existingOperation);
			}
			this.operationsById.set(operation.id, operation);
			this.indexOperation(operation);
			if (!sessionOperationIdSet.has(operation.id)) {
				sessionOperationIds.push(operation.id);
				sessionOperationIdSet.add(operation.id);
				appendedOperationId = true;
			}
			this.updateCurrentStreamingOperation(sessionId, operation);
		}
		if (appendedOperationId) {
			this.sessionOperationIds.set(sessionId, sessionOperationIds);
		}
		this.bumpSessionOperationVersion(sessionId);
	}

	private bumpSessionOperationVersion(sessionId: string): void {
		this.sessionOperationVersions.set(
			sessionId,
			(this.sessionOperationVersions.get(sessionId) ?? 0) + 1
		);
		this.sessionOperationsBySession.delete(sessionId);
		this.modifiedFilesStateBySession.delete(sessionId);
		this.sessionToolCallsBySession.delete(sessionId);
		this.currentStreamingToolCallBySession.delete(sessionId);
		this.lastToolCallBySession.delete(sessionId);
		this.lastTodoToolCallBySession.delete(sessionId);
	}

	private operationFromSnapshot(snapshot: OperationSnapshot): Operation {
		const providerStatus = snapshot.provider_status;
		return {
			id: snapshot.id,
			sessionId: snapshot.session_id,
			toolCallId: snapshot.tool_call_id,
			sourceLink: snapshot.source_link,
			name: snapshot.name,
			kind: snapshot.kind,
			status: providerStatus,
			operationState: snapshot.operation_state,
			operationProvenanceKey: snapshot.operation_provenance_key ?? snapshot.tool_call_id,
			title: snapshot.title,
			arguments: snapshot.arguments,
			progressiveArguments: snapshot.progressive_arguments ?? undefined,
			result: snapshot.result,
			locations: snapshot.locations ?? undefined,
			skillMeta: snapshot.skill_meta ?? undefined,
			normalizedQuestions: snapshot.normalized_questions ?? undefined,
			normalizedTodos: snapshot.normalized_todos ?? undefined,
			questionAnswer: snapshot.question_answer ?? undefined,
			awaitingPlanApproval: snapshot.awaiting_plan_approval,
			planApprovalRequestId: snapshot.plan_approval_request_id ?? undefined,
			startedAtMs: snapshot.started_at_ms ?? undefined,
			completedAtMs: snapshot.completed_at_ms ?? undefined,
			command: snapshot.command,
			parentToolCallId: snapshot.parent_tool_call_id,
			parentOperationId: snapshot.parent_operation_id,
			childToolCallIds: snapshot.child_tool_call_ids,
			childOperationIds: snapshot.child_operation_ids,
			degradationReason: snapshot.degradation_reason ?? null,
		};
	}

	private unindexOperation(operation: Operation): void {
		this.operationIdByToolCallKey.delete(
			createSessionToolKey(operation.sessionId, operation.toolCallId)
		);
		this.operationIdByProvenanceKey.delete(
			createSessionToolKey(
				operation.sessionId,
				operation.operationProvenanceKey ?? operation.toolCallId
			)
		);
		const transcriptEntryId = transcriptSourceEntryId(operation.sourceLink);
		if (transcriptEntryId !== null) {
			this.operationIdByEntryKey.delete(
				createSessionToolKey(operation.sessionId, transcriptEntryId)
			);
		}
	}

	private indexOperation(operation: Operation): void {
		this.operationIdByToolCallKey.set(
			createSessionToolKey(operation.sessionId, operation.toolCallId),
			operation.id
		);
		this.operationIdByProvenanceKey.set(
			createSessionToolKey(
				operation.sessionId,
				operation.operationProvenanceKey ?? operation.toolCallId
			),
			operation.id
		);
		const transcriptEntryId = transcriptSourceEntryId(operation.sourceLink);
		if (transcriptEntryId !== null) {
			this.operationIdByEntryKey.set(
				createSessionToolKey(operation.sessionId, transcriptEntryId),
				operation.id
			);
		}
	}

	private updateCurrentStreamingOperation(sessionId: string, operation: Operation): void {
		if (isStreamingOperationState(operation.operationState)) {
			this.currentStreamingOperationIdBySession.set(sessionId, operation.id);
			return;
		}

		if (this.currentStreamingOperationIdBySession.get(sessionId) === operation.id) {
			this.recomputeCurrentStreamingOperation(sessionId);
		}
	}

	private recomputeCurrentStreamingOperation(sessionId: string): Operation | null {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		for (let index = operationIds.length - 1; index >= 0; index -= 1) {
			const operationId = operationIds[index];
			const operation = this.operationsById.get(operationId);
			if (operation !== undefined && isStreamingOperationState(operation.operationState)) {
				this.currentStreamingOperationIdBySession.set(sessionId, operation.id);
				return operation;
			}
		}

		this.currentStreamingOperationIdBySession.delete(sessionId);
		return null;
	}

	private materializeToolCall(operationId: string, visited: Set<string>): ToolCall | null {
		if (visited.has(operationId)) {
			return null;
		}

		const operation = this.operationsById.get(operationId);
		if (operation == null) {
			return null;
		}

		visited.add(operationId);
		const taskChildren: ToolCall[] = [];
		for (const childOperationId of operation.childOperationIds) {
			const childToolCall = this.materializeToolCall(childOperationId, visited);
			if (childToolCall !== null) {
				taskChildren.push(childToolCall);
			}
		}

		return {
			id: operation.toolCallId,
			name: operation.name,
			arguments: operation.arguments,
			status: operation.status,
			result: operation.result,
			normalizedResult: normalizeToolResult({
				kind: operation.kind,
				arguments: operation.arguments,
				result: operation.result,
			}),
			kind: operation.kind,
			title: operation.title ?? null,
			locations: operation.locations ?? null,
			skillMeta: operation.skillMeta ?? null,
			normalizedQuestions: operation.normalizedQuestions ?? null,
			normalizedTodos: operation.normalizedTodos ?? null,
			parentToolUseId: operation.parentToolCallId,
			taskChildren,
			questionAnswer: operation.questionAnswer ?? null,
			awaitingPlanApproval: operation.awaitingPlanApproval,
			planApprovalRequestId: operation.planApprovalRequestId ?? null,
			progressiveArguments: operation.progressiveArguments,
			startedAtMs: operation.startedAtMs,
			completedAtMs: operation.completedAtMs,
			presentationStatus: mapOperationStateToToolPresentationStatus(operation.operationState),
		};
	}
}
