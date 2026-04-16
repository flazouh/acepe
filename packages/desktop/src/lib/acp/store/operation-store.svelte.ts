import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { OperationSnapshot } from "../../services/acp-types.js";
import type { ToolArguments } from "../../services/converted-session-types.js";
import type { Operation } from "../types/operation.js";
import type { ToolCall } from "../types/tool-call.js";

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
	return `${sessionId}:${toolCallId}`;
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

export class OperationStore {
	/**
	 * Canonical runtime owner for resolved tool execution state.
	 *
	 * `ToolCallManager` remains the mutation/reconciliation adapter that updates
	 * transcript entries. `OperationStore` is the canonical read/query layer
	 * those mutations feed so projection consumers stop reconstructing semantics
	 * from raw transport artifacts.
	 */
	private readonly operationsById = new SvelteMap<string, Operation>();
	private readonly operationIdByToolCallKey = new SvelteMap<string, string>();
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

	clearSession(sessionId: string): void {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation == null) {
				continue;
			}

			this.operationsById.delete(operationId);
			this.operationIdByToolCallKey.delete(createSessionToolKey(sessionId, operation.toolCallId));
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
			const operation: Operation = {
				id: snapshot.id,
				sessionId: snapshot.session_id,
				toolCallId: snapshot.tool_call_id,
				sourceEntryId: null,
				name: snapshot.name,
				kind: snapshot.kind,
				status: snapshot.status,
				title: snapshot.title,
				arguments: snapshot.arguments,
				progressiveArguments: snapshot.progressive_arguments ?? undefined,
				result: snapshot.result,
				locations: undefined,
				skillMeta: undefined,
				normalizedQuestions: undefined,
				normalizedTodos: undefined,
				questionAnswer: undefined,
				awaitingPlanApproval: false,
				planApprovalRequestId: undefined,
				startedAtMs: undefined,
				completedAtMs: undefined,
				command: snapshot.command,
				parentToolCallId: snapshot.parent_tool_call_id,
				parentOperationId: snapshot.parent_operation_id,
				childToolCallIds: snapshot.child_tool_call_ids,
				childOperationIds: snapshot.child_operation_ids,
			};
			this.operationsById.set(operation.id, operation);
			this.operationIdByToolCallKey.set(
				createSessionToolKey(sessionId, operation.toolCallId),
				operation.id
			);
			nextSessionOperationIds.push(operation.id);
		}
		this.sessionOperationIds.set(sessionId, nextSessionOperationIds);
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
		};

		this.operationsById.set(operationId, nextOperation);
		this.operationIdByToolCallKey.set(createSessionToolKey(sessionId, toolCall.id), operationId);
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
}

export function createOperationStore(): OperationStore {
	const store = new OperationStore();
	setContext(OPERATION_STORE_KEY, store);
	return store;
}

export function getOperationStore(): OperationStore {
	return getContext<OperationStore>(OPERATION_STORE_KEY);
}
