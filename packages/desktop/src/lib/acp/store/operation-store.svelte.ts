import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { OperationSnapshot } from "../../services/acp-types.js";
import type { ToolArguments } from "../../services/converted-session-types.js";
import type { Operation, OperationState } from "../types/operation.js";
import type { ToolCall } from "../types/tool-call.js";
import type { ToolKind } from "../types/tool-kind.js";
import { normalizeToolResult } from "./services/tool-result-normalizer.js";

const OPERATION_STORE_KEY = Symbol("operation-store");

function createSessionToolKey(sessionId: string, toolCallId: string): string {
	return `${sessionId}::${toolCallId}`;
}

function normalizeCommand(value: string | null | undefined): string | null {
	if (value == null) {
		return null;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}

	return trimmed.replace(/\s+/g, " ");
}

function extractCommandFromArguments(argumentsValue: ToolArguments | undefined): string | null {
	if (argumentsValue?.kind !== "execute") {
		return null;
	}

	return normalizeCommand(argumentsValue.command);
}

export function buildOperationId(sessionId: string, toolCallId: string): string {
	return buildCanonicalOperationId(sessionId, toolCallId);
}

export function buildCanonicalOperationId(sessionId: string, provenanceKey: string): string {
	return `op:${sessionId.length}:${sessionId}:${provenanceKey.length}:${provenanceKey}`;
}

export function extractToolOperationCommand(toolCall: ToolCall): string | null {
	const progressiveCommand = extractCommandFromArguments(toolCall.progressiveArguments);
	if (progressiveCommand !== null) {
		return progressiveCommand;
	}

	const argumentCommand = extractCommandFromArguments(toolCall.arguments);
	if (argumentCommand !== null) {
		return argumentCommand;
	}

	if (toolCall.title == null) {
		return null;
	}

	const titleMatch = /^`(.+)`$/.exec(toolCall.title);
	if (titleMatch?.[1] == null) {
		return null;
	}

	return normalizeCommand(titleMatch[1]);
}

function deriveOperationState(
	status: Operation["status"],
	kind: Operation["kind"]
): OperationState {
	if (kind === "unclassified") {
		return "degraded";
	}
	if (status === "pending") {
		return "pending";
	}
	if (status === "in_progress") {
		return "running";
	}
	if (status === "completed") {
		return "completed";
	}
	return "failed";
}

function isTerminalOperationState(state: OperationState | undefined): boolean {
	return (
		state === "completed" ||
		state === "failed" ||
		state === "cancelled" ||
		state === "degraded" ||
		state === "blocked"
	);
}

function isStreamingOperationState(state: OperationState): boolean {
	return state === "pending" || state === "running";
}

export class OperationStore {
	/**
	 * Canonical runtime owner for resolved tool execution state.
	 *
	 * `TranscriptToolCallBuffer` remains the mutation/reconciliation adapter that updates
	 * transcript entries. `OperationStore` is the canonical read/query layer
	 * those mutations feed so projection consumers stop reconstructing semantics
	 * from raw transport artifacts.
	 */
	private readonly operationsById = new SvelteMap<string, Operation>();
	private readonly operationIdByToolCallKey = new SvelteMap<string, string>();
	private readonly operationIdByProvenanceKey = new SvelteMap<string, string>();
	private readonly operationIdByEntryKey = new SvelteMap<string, string>();
	private readonly sessionOperationIds = new SvelteMap<string, Array<string>>();

	upsertFromToolCall(
		sessionId: string,
		sourceEntryId: string | null,
		toolCall: ToolCall
	): Operation {
		return this.upsertToolCall(
			sessionId,
			sourceEntryId,
			toolCall,
			null,
			toolCall.parentToolUseId ?? null
		);
	}

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
		const operations = this.getSessionOperations(sessionId);
		for (let index = operations.length - 1; index >= 0; index -= 1) {
			const operation = operations[index];
			if (isStreamingOperationState(operation.operationState)) {
				return operation;
			}
		}

		return null;
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
			this.operationIdByToolCallKey.delete(createSessionToolKey(sessionId, operation.toolCallId));
			this.operationIdByProvenanceKey.delete(
				createSessionToolKey(sessionId, operation.operationProvenanceKey ?? operation.toolCallId)
			);
			if (operation.sourceEntryId != null) {
				this.operationIdByEntryKey.delete(createSessionToolKey(sessionId, operation.sourceEntryId));
			}
		}

		this.sessionOperationIds.delete(sessionId);
	}

	replaceSessionOperations(sessionId: string, snapshots: ReadonlyArray<OperationSnapshot>): void {
		this.clearSession(sessionId);
		const nextSessionOperationIds: Array<string> = [];
		for (const snapshot of snapshots) {
			const operation = this.operationFromSnapshot(snapshot);
			this.operationsById.set(operation.id, operation);
			this.indexOperation(operation);
			nextSessionOperationIds.push(operation.id);
		}
		this.sessionOperationIds.set(sessionId, nextSessionOperationIds);
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
			this.operationsById.set(operation.id, operation);
			this.indexOperation(operation);
			const sessionOperationIds = this.sessionOperationIds.get(sessionId) ?? [];
			if (!sessionOperationIds.includes(operation.id)) {
				const nextSessionOperationIds = sessionOperationIds.slice();
				nextSessionOperationIds.push(operation.id);
				this.sessionOperationIds.set(sessionId, nextSessionOperationIds);
			}
		}
	}

	private operationFromSnapshot(snapshot: OperationSnapshot): Operation {
		return {
			id: snapshot.id,
			sessionId: snapshot.session_id,
			toolCallId: snapshot.tool_call_id,
			sourceEntryId: snapshot.source_entry_id ?? null,
			name: snapshot.name,
			kind: snapshot.kind,
			status: snapshot.status,
			operationState:
				snapshot.operation_state ??
				deriveOperationState(snapshot.status, snapshot.kind ?? undefined),
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
		if (operation.sourceEntryId != null) {
			this.operationIdByEntryKey.set(
				createSessionToolKey(operation.sessionId, operation.sourceEntryId),
				operation.id
			);
		}
	}

	private upsertToolCall(
		sessionId: string,
		sourceEntryId: string | null,
		toolCall: ToolCall,
		parentOperationId: string | null,
		parentToolCallId: string | null
	): Operation {
		const operationId = buildOperationId(sessionId, toolCall.id);
		const existingOperation = this.operationsById.get(operationId);
		const nextSourceEntryId = sourceEntryId ?? existingOperation?.sourceEntryId ?? null;
		const nextParentToolCallId = toolCall.parentToolUseId ?? parentToolCallId ?? null;
		const derivedOperationState = deriveOperationState(toolCall.status, toolCall.kind);
		const existingOperationState = existingOperation?.operationState;
		const nextOperationState =
			existingOperationState !== undefined && isTerminalOperationState(existingOperationState)
				? existingOperationState
				: derivedOperationState;
		const childToolCallIds: Array<string> = [];
		const childOperationIds: Array<string> = [];

		for (const childToolCall of toolCall.taskChildren ?? []) {
			const childOperation = this.upsertToolCall(
				sessionId,
				null,
				childToolCall,
				operationId,
				toolCall.id
			);
			childToolCallIds.push(childToolCall.id);
			childOperationIds.push(childOperation.id);
		}

		const nextOperation: Operation = {
			id: operationId,
			sessionId,
			toolCallId: toolCall.id,
			sourceEntryId: nextSourceEntryId,
			name: toolCall.name,
			kind: toolCall.kind,
			status: toolCall.status,
			operationState: nextOperationState,
			operationProvenanceKey: toolCall.id,
			title: toolCall.title,
			arguments: toolCall.arguments,
			progressiveArguments: toolCall.progressiveArguments,
			result: toolCall.result,
			locations: toolCall.locations,
			skillMeta: toolCall.skillMeta,
			normalizedQuestions: toolCall.normalizedQuestions,
			normalizedTodos: toolCall.normalizedTodos,
			questionAnswer: toolCall.questionAnswer,
			awaitingPlanApproval: toolCall.awaitingPlanApproval,
			planApprovalRequestId: toolCall.planApprovalRequestId,
			startedAtMs: toolCall.startedAtMs,
			completedAtMs: toolCall.completedAtMs,
			command: extractToolOperationCommand(toolCall),
			parentToolCallId: nextParentToolCallId,
			parentOperationId,
			childToolCallIds,
			childOperationIds,
			degradationReason:
				derivedOperationState === "degraded"
					? {
							code: "classification_failure",
							detail: "Tool kind could not be classified into a canonical operation.",
						}
					: null,
		};

		this.operationsById.set(operationId, nextOperation);
		this.operationIdByToolCallKey.set(createSessionToolKey(sessionId, toolCall.id), operationId);
		this.operationIdByProvenanceKey.set(createSessionToolKey(sessionId, toolCall.id), operationId);
		if (nextSourceEntryId != null) {
			this.operationIdByEntryKey.set(
				createSessionToolKey(sessionId, nextSourceEntryId),
				operationId
			);
		}

		const sessionOperationIds = this.sessionOperationIds.get(sessionId) ?? [];
		if (!sessionOperationIds.includes(operationId)) {
			const nextSessionOperationIds = sessionOperationIds.slice();
			nextSessionOperationIds.push(operationId);
			this.sessionOperationIds.set(sessionId, nextSessionOperationIds);
		}

		return nextOperation;
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
