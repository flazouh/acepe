import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { OperationSnapshot, OperationSourceLink } from "../../services/acp-types.js";
import type { Operation, OperationState } from "../types/operation.js";
import type { ToolCall } from "../types/tool-call.js";
import type { ToolKind } from "../types/tool-kind.js";
import { mapOperationStateToToolPresentationStatus } from "../utils/tool-state-utils.js";
import { normalizeToolResult } from "./services/tool-result-normalizer.js";

const OPERATION_STORE_KEY = Symbol("operation-store");

function createSessionToolKey(sessionId: string, toolCallId: string): string {
	return `${sessionId}::${toolCallId}`;
}

export function buildOperationId(sessionId: string, toolCallId: string): string {
	return buildCanonicalOperationId(sessionId, toolCallId);
}

export function buildCanonicalOperationId(sessionId: string, provenanceKey: string): string {
	return `op:${sessionId.length}:${sessionId}:${provenanceKey.length}:${provenanceKey}`;
}

function isTerminalOperationState(state: OperationState | undefined): boolean {
	if (state === undefined) {
		return false;
	}

	switch (state) {
		case "completed":
		case "failed":
		case "cancelled":
		case "degraded":
			return true;
		case "pending":
		case "running":
		case "blocked":
			return false;
	}
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
	private readonly currentStreamingOperationIdBySession = new SvelteMap<string, string>();

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
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		const operations: Array<Operation> = [];
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation != null) {
				operations.push(operation);
			}
		}
		return operations;
	}

	getSessionToolCalls(sessionId: string): Array<ToolCall> {
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
		return toolCalls;
	}

	getCurrentStreamingToolCall(sessionId: string): ToolCall | null {
		const operation = this.getCurrentStreamingOperation(sessionId);
		if (operation !== null) {
			const toolCall = this.materializeToolCall(operation.id, new Set<string>());
			if (toolCall !== null) {
				return toolCall;
			}
		}

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
		const operations = this.getSessionOperations(sessionId);
		for (let index = operations.length - 1; index >= 0; index -= 1) {
			const toolCall = this.materializeToolCall(operations[index].id, new Set<string>());
			if (toolCall !== null) {
				return toolCall;
			}
		}

		return null;
	}

	getLastTodoToolCall(sessionId: string): ToolCall | null {
		const operations = this.getSessionOperations(sessionId);
		for (let index = operations.length - 1; index >= 0; index -= 1) {
			const toolCall = this.materializeToolCall(operations[index].id, new Set<string>());
			if (toolCall?.normalizedTodos && toolCall.normalizedTodos.length > 0) {
				return toolCall;
			}
		}

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
		this.currentStreamingOperationIdBySession.delete(sessionId);
	}

	replaceSessionOperations(sessionId: string, snapshots: ReadonlyArray<OperationSnapshot>): void {
		this.clearSession(sessionId);
		const nextSessionOperationIds: Array<string> = [];
		let currentStreamingOperationId: string | null = null;
		for (const snapshot of snapshots) {
			const operation = this.operationFromSnapshot(snapshot);
			this.operationsById.set(operation.id, operation);
			this.indexOperation(operation);
			nextSessionOperationIds.push(operation.id);
			if (isStreamingOperationState(operation.operationState)) {
				currentStreamingOperationId = operation.id;
			}
		}
		this.sessionOperationIds.set(sessionId, nextSessionOperationIds);
		if (currentStreamingOperationId === null) {
			this.currentStreamingOperationIdBySession.delete(sessionId);
		} else {
			this.currentStreamingOperationIdBySession.set(sessionId, currentStreamingOperationId);
		}
	}

	applySessionOperationPatches(
		sessionId: string,
		snapshots: ReadonlyArray<OperationSnapshot>
	): void {
		for (const snapshot of snapshots) {
			const operation = this.operationFromSnapshot(snapshot);
			const existingOperation = this.operationsById.get(operation.id);
			if (
				existingOperation !== undefined &&
				isTerminalOperationState(existingOperation.operationState) &&
				!isTerminalOperationState(operation.operationState)
			) {
				continue;
			}
			if (existingOperation !== undefined) {
				this.unindexOperation(existingOperation);
			}
			this.operationsById.set(operation.id, operation);
			this.indexOperation(operation);
			const sessionOperationIds = this.sessionOperationIds.get(sessionId) ?? [];
			if (!sessionOperationIds.includes(operation.id)) {
				const nextSessionOperationIds = sessionOperationIds.slice();
				nextSessionOperationIds.push(operation.id);
				this.sessionOperationIds.set(sessionId, nextSessionOperationIds);
			}
			this.updateCurrentStreamingOperation(sessionId, operation);
		}
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
			awaitingPlanApproval: snapshot.awaiting_plan_approval ?? false,
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
			this.operationIdByEntryKey.delete(createSessionToolKey(operation.sessionId, transcriptEntryId));
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

export function createOperationStore(): OperationStore {
	const store = new OperationStore();
	setContext(OPERATION_STORE_KEY, store);
	return store;
}

export function getOperationStore(): OperationStore {
	return getContext<OperationStore>(OPERATION_STORE_KEY);
}
