import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type {
	InteractionKind,
	InteractionState,
	OperationSnapshot,
} from "../../services/acp-types.js";
import type {
	ToolArguments,
	ToolCallStatus,
} from "../../services/converted-session-types.js";
import {
	isOperationBlockedByPermission,
	isPlaceholderTitle,
	mergeCanonicalToolArguments,
	operationHasRawEvidence,
	resolveOperationDisplayTitle,
	resolveOperationKnownCommand,
} from "../session-state/session-state-query-service.js";
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

function mergeOptionalField<T>(currentValue: T | null | undefined, nextValue: T | null | undefined): T | null | undefined {
	return nextValue ?? currentValue;
}

function mergeOptionalDefined<T>(
	currentValue: T | null | undefined,
	nextValue: T | null | undefined
): T | undefined {
	return mergeOptionalField(currentValue, nextValue) ?? undefined;
}

function mergeLocations(
	currentLocations: Operation["locations"],
	nextLocations: Operation["locations"]
): Operation["locations"] {
	if (!currentLocations?.length) {
		return nextLocations;
	}
	if (!nextLocations?.length) {
		return currentLocations;
	}

	const merged = currentLocations.slice();
	for (const location of nextLocations) {
		if (!merged.some((candidate) => candidate.path === location.path)) {
			merged.push(location);
		}
	}
	return merged;
}

function mergeTitle(
	currentTitle: string | null | undefined,
	nextTitle: string | null | undefined
): string | null | undefined {
	if (nextTitle == null) {
		return currentTitle;
	}
	if (currentTitle == null) {
		return nextTitle;
	}
	if (isPlaceholderTitle(currentTitle)) {
		return nextTitle;
	}
	if (nextTitle.trim().length > currentTitle.trim().length && nextTitle.startsWith(currentTitle.trim())) {
		return nextTitle;
	}
	return currentTitle;
}

type InteractionBlockers = Map<string, InteractionKind>;

function emptyArgumentsForKind(kind: Operation["kind"]): ToolArguments {
	switch (kind) {
		case "read":
			return { kind: "read", file_path: null, source_context: null };
		case "edit":
			return { kind: "edit", edits: [] };
		case "execute":
			return { kind: "execute", command: null };
		case "search":
			return { kind: "search", query: null, file_path: null };
		case "glob":
			return { kind: "glob", pattern: null, path: null };
		case "fetch":
			return { kind: "fetch", url: null };
		case "web_search":
			return { kind: "webSearch", query: null };
		case "think":
			return {
				kind: "think",
				description: null,
				prompt: null,
				subagent_type: null,
				skill: null,
				skill_args: null,
				raw: null,
			};
		case "task_output":
			return { kind: "taskOutput", task_id: null, timeout: null };
		case "move":
			return { kind: "move", from: null, to: null };
		case "delete":
			return { kind: "delete", file_path: null, file_paths: null };
		case "enter_plan_mode":
		case "exit_plan_mode":
		case "create_plan":
			return { kind: "planMode", mode: null };
		case "tool_search":
			return { kind: "toolSearch", query: null, max_results: null };
		case "browser":
			return { kind: "browser", raw: null };
		case "sql":
			return { kind: "sql", query: null, description: null };
		case "unclassified":
			return {
				kind: "unclassified",
				raw_name: "",
				raw_kind_hint: null,
				title: null,
				arguments_preview: null,
				signals_tried: [],
			};
		case "todo":
		case "question":
		case "task":
		case "skill":
		case "other":
		case null:
		case undefined:
			return { kind: "other", raw: null };
	}
}

function blockedReasonFromBlockers(
	blockers: ReadonlyMap<string, InteractionKind> | undefined
): Operation["blockedReason"] {
	if (blockers == null || blockers.size === 0) {
		return null;
	}

	for (const kind of blockers.values()) {
		return blockedReasonFromInteractionKind(kind);
	}

	return null;
}

function mergeOperationSnapshot(
	currentOperation: Operation | undefined,
	snapshot: OperationSnapshot
): Operation {
	const nextTitle = mergeTitle(currentOperation?.title, snapshot.title);
	const nextArguments =
		currentOperation == null
			? snapshot.arguments
			: mergeCanonicalToolArguments(currentOperation.arguments, snapshot.arguments);
	const nextProgressiveArguments =
		snapshot.progressive_arguments == null &&
		(snapshot.status === "completed" || snapshot.status === "failed")
			? undefined
			: (mergeOptionalField(
					currentOperation?.progressiveArguments,
					snapshot.progressive_arguments ?? undefined
				) ?? undefined);
	const nextCommand =
		resolveOperationKnownCommand({
			command: snapshot.command,
			arguments: nextArguments,
			progressive_arguments: nextProgressiveArguments ?? null,
			title: nextTitle ?? null,
		}) ??
		resolveOperationKnownCommand({
			command: currentOperation?.command ?? null,
			arguments: currentOperation?.arguments ?? snapshot.arguments,
			progressive_arguments: currentOperation?.progressiveArguments ?? null,
			title: currentOperation?.title ?? null,
		});

	return {
		id: snapshot.id,
		sessionId: snapshot.session_id,
		toolCallId: snapshot.tool_call_id,
		sourceEntryId: currentOperation?.sourceEntryId ?? null,
		name: snapshot.name,
		kind: snapshot.kind,
		status: snapshot.status,
		lifecycle: snapshot.lifecycle ?? currentOperation?.lifecycle ?? "pending",
		blockedReason: snapshot.blocked_reason ?? null,
		title: nextTitle,
		arguments: nextArguments,
		progressiveArguments: nextProgressiveArguments,
		result: mergeOptionalField(currentOperation?.result, snapshot.result),
		locations: mergeLocations(currentOperation?.locations, snapshot.locations ?? undefined),
		skillMeta: mergeOptionalField(currentOperation?.skillMeta, snapshot.skill_meta ?? undefined),
		normalizedQuestions: currentOperation?.normalizedQuestions,
		normalizedTodos: mergeOptionalField(
			currentOperation?.normalizedTodos,
			snapshot.normalized_todos ?? undefined
		),
		questionAnswer: currentOperation?.questionAnswer,
		awaitingPlanApproval: currentOperation?.awaitingPlanApproval ?? false,
		planApprovalRequestId: currentOperation?.planApprovalRequestId,
		startedAtMs: mergeOptionalDefined(
			currentOperation?.startedAtMs,
			snapshot.started_at_ms ?? undefined
		),
		completedAtMs: mergeOptionalDefined(
			currentOperation?.completedAtMs,
			snapshot.completed_at_ms ?? undefined
		),
		command: nextCommand,
		parentToolCallId: snapshot.parent_tool_call_id,
		parentOperationId: snapshot.parent_operation_id,
		childToolCallIds: snapshot.child_tool_call_ids,
		childOperationIds: snapshot.child_operation_ids,
	};
}

function operationLifecycleFromStatus(status: ToolCallStatus): Operation["lifecycle"] {
	switch (status) {
		case "pending":
			return "pending";
		case "in_progress":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
	}
}

function blockedReasonFromInteractionKind(
	kind: InteractionKind
): Operation["blockedReason"] {
	switch (kind) {
		case "Permission":
			return "permission";
		case "Question":
			return "question";
		case "PlanApproval":
			return "plan_approval";
	}
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
	private readonly blockerKindsByOperationId = new SvelteMap<string, InteractionBlockers>();
	private readonly deferredBlockerKindsByOperationId = new SvelteMap<string, InteractionBlockers>();
	private readonly deferredBlockerKindsByToolCallKey = new SvelteMap<string, InteractionBlockers>();

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

	upsertOperationSnapshot(snapshot: OperationSnapshot): Operation {
		const operation = mergeOperationSnapshot(this.operationsById.get(snapshot.id), snapshot);
		this.setOperation(operation.sessionId, operation);
		return operation;
	}

	upsertFallbackOperation(
		sessionId: string,
		operationId: string,
		toolCallId: string,
		name: string,
		kind: Operation["kind"],
		status: ToolCallStatus,
		parentOperationId: string | null,
		occurredAtMs: number
	): Operation {
		return this.upsertOperationSnapshot({
			id: operationId,
			session_id: sessionId,
			tool_call_id: toolCallId,
			name,
			kind: kind ?? null,
			status,
			lifecycle: operationLifecycleFromStatus(status),
			blocked_reason: null,
			title: name,
			arguments: emptyArgumentsForKind(kind),
			progressive_arguments: null,
			result: null,
			command: null,
			locations: null,
			skill_meta: null,
			normalized_todos: null,
			started_at_ms:
				status === "completed" || status === "failed" ? null : occurredAtMs,
			completed_at_ms:
				status === "completed" || status === "failed" ? occurredAtMs : null,
			parent_tool_call_id: null,
			parent_operation_id: parentOperationId,
			child_tool_call_ids: [],
			child_operation_ids: [],
		});
	}

	updateOperationStatus(
		sessionId: string,
		operationId: string,
		status: ToolCallStatus
	): Operation | undefined {
		const operation = this.operationsById.get(operationId);
		if (operation == null || operation.sessionId !== sessionId) {
			return undefined;
		}

		const updatedOperation: Operation = {
			id: operation.id,
			sessionId: operation.sessionId,
			toolCallId: operation.toolCallId,
			sourceEntryId: operation.sourceEntryId,
			name: operation.name,
			kind: operation.kind,
			status,
			lifecycle: operationLifecycleFromStatus(status),
			blockedReason:
				status === "completed" || status === "failed" ? null : operation.blockedReason,
			title: operation.title,
			arguments: operation.arguments,
			progressiveArguments: operation.progressiveArguments,
			result: operation.result,
			locations: operation.locations,
			skillMeta: operation.skillMeta,
			normalizedQuestions: operation.normalizedQuestions,
			normalizedTodos: operation.normalizedTodos,
			questionAnswer: operation.questionAnswer,
			awaitingPlanApproval: operation.awaitingPlanApproval,
			planApprovalRequestId: operation.planApprovalRequestId,
			startedAtMs: operation.startedAtMs,
			completedAtMs:
				status === "completed" || status === "failed"
					? (operation.completedAtMs ?? Date.now())
					: operation.completedAtMs,
			command: operation.command,
			parentToolCallId: operation.parentToolCallId,
			parentOperationId: operation.parentOperationId,
			childToolCallIds: operation.childToolCallIds,
			childOperationIds: operation.childOperationIds,
		};
		const nextOperation = this.applyStoredInteractionBlockers(updatedOperation);
		this.setOperation(sessionId, nextOperation);
		return nextOperation;
	}

	updateOperationBlockingFromInteraction(
		sessionId: string,
		interactionId: string,
		operationId: string | null,
		toolCallId: string | null,
		interactionKind: InteractionKind | null,
		interactionState: InteractionState
	): Operation | undefined {
		const operationById =
			operationId == null ? undefined : this.operationsById.get(operationId);
		const operationByToolCall =
			toolCallId == null ? undefined : this.getByToolCallId(sessionId, toolCallId);
		const operation = operationById ?? operationByToolCall;
		const resolvedOperationId = operation?.id ?? operationId;
		const toolCallKey =
			toolCallId == null ? null : createSessionToolKey(sessionId, toolCallId);

		if (interactionState === "Pending" && interactionKind != null) {
			if (resolvedOperationId != null && operation != null && operation.sessionId === sessionId) {
				this.setInteractionBlocker(this.blockerKindsByOperationId, resolvedOperationId, interactionId, interactionKind);
				const updatedOperation = this.applyStoredInteractionBlockers(operation);
				this.setOperation(sessionId, updatedOperation);
				return updatedOperation;
			}

			if (operationId != null) {
				this.setInteractionBlocker(
					this.deferredBlockerKindsByOperationId,
					operationId,
					interactionId,
					interactionKind
				);
			}
			if (toolCallKey != null) {
				this.setInteractionBlocker(
					this.deferredBlockerKindsByToolCallKey,
					toolCallKey,
					interactionId,
					interactionKind
				);
			}
			return undefined;
		}

		if (resolvedOperationId != null) {
			this.deleteInteractionBlocker(this.blockerKindsByOperationId, resolvedOperationId, interactionId);
			this.deleteInteractionBlocker(
				this.deferredBlockerKindsByOperationId,
				resolvedOperationId,
				interactionId
			);
		}
		if (operationId != null && operationId !== resolvedOperationId) {
			this.deleteInteractionBlocker(
				this.deferredBlockerKindsByOperationId,
				operationId,
				interactionId
			);
		}
		if (toolCallKey != null) {
			this.deleteInteractionBlocker(
				this.deferredBlockerKindsByToolCallKey,
				toolCallKey,
				interactionId
			);
		}
		if (operation == null || operation.sessionId !== sessionId) {
			return undefined;
		}

		const updatedOperation = this.applyStoredInteractionBlockers(operation);
		this.setOperation(sessionId, updatedOperation);
		return updatedOperation;
	}

	linkOperationChild(
		sessionId: string,
		parentOperationId: string,
		childOperationId: string
	): void {
		const parentOperation = this.operationsById.get(parentOperationId);
		if (parentOperation != null && parentOperation.sessionId === sessionId) {
			const nextChildOperationIds = parentOperation.childOperationIds.includes(childOperationId)
				? parentOperation.childOperationIds
				: parentOperation.childOperationIds.concat(childOperationId);
			const childOperation = this.operationsById.get(childOperationId);
			const nextChildToolCallIds =
				childOperation == null || parentOperation.childToolCallIds.includes(childOperation.toolCallId)
					? parentOperation.childToolCallIds
					: parentOperation.childToolCallIds.concat(childOperation.toolCallId);
			this.setOperation(sessionId, {
				id: parentOperation.id,
				sessionId: parentOperation.sessionId,
				toolCallId: parentOperation.toolCallId,
				sourceEntryId: parentOperation.sourceEntryId,
				name: parentOperation.name,
				kind: parentOperation.kind,
				status: parentOperation.status,
				lifecycle: parentOperation.lifecycle,
				blockedReason: parentOperation.blockedReason,
				title: parentOperation.title,
				arguments: parentOperation.arguments,
				progressiveArguments: parentOperation.progressiveArguments,
				result: parentOperation.result,
				locations: parentOperation.locations,
				skillMeta: parentOperation.skillMeta,
				normalizedQuestions: parentOperation.normalizedQuestions,
				normalizedTodos: parentOperation.normalizedTodos,
				questionAnswer: parentOperation.questionAnswer,
				awaitingPlanApproval: parentOperation.awaitingPlanApproval,
				planApprovalRequestId: parentOperation.planApprovalRequestId,
				startedAtMs: parentOperation.startedAtMs,
				completedAtMs: parentOperation.completedAtMs,
				command: parentOperation.command,
				parentToolCallId: parentOperation.parentToolCallId,
				parentOperationId: parentOperation.parentOperationId,
				childToolCallIds: nextChildToolCallIds,
				childOperationIds: nextChildOperationIds,
			});
		}

		const childOperation = this.operationsById.get(childOperationId);
		if (childOperation != null && childOperation.sessionId === sessionId) {
			this.setOperation(sessionId, {
				id: childOperation.id,
				sessionId: childOperation.sessionId,
				toolCallId: childOperation.toolCallId,
				sourceEntryId: childOperation.sourceEntryId,
				name: childOperation.name,
				kind: childOperation.kind,
				status: childOperation.status,
				lifecycle: childOperation.lifecycle,
				blockedReason: childOperation.blockedReason,
				title: childOperation.title,
				arguments: childOperation.arguments,
				progressiveArguments: childOperation.progressiveArguments,
				result: childOperation.result,
				locations: childOperation.locations,
				skillMeta: childOperation.skillMeta,
				normalizedQuestions: childOperation.normalizedQuestions,
				normalizedTodos: childOperation.normalizedTodos,
				questionAnswer: childOperation.questionAnswer,
				awaitingPlanApproval: childOperation.awaitingPlanApproval,
				planApprovalRequestId: childOperation.planApprovalRequestId,
				startedAtMs: childOperation.startedAtMs,
				completedAtMs: childOperation.completedAtMs,
				command: childOperation.command,
				parentToolCallId: childOperation.parentToolCallId,
				parentOperationId,
				childToolCallIds: childOperation.childToolCallIds,
				childOperationIds: childOperation.childOperationIds,
			});
		}
	}

	getDisplayTitle(operation: Operation | null | undefined): string | null {
		if (operation == null) {
			return null;
		}

		return resolveOperationDisplayTitle({
			title: operation.title ?? null,
			arguments: operation.arguments,
			name: operation.name,
		});
	}

	getKnownCommand(operation: Operation | null | undefined): string | null {
		if (operation == null) {
			return null;
		}

		return resolveOperationKnownCommand({
			command: operation.command ?? null,
			arguments: operation.arguments,
			progressive_arguments: operation.progressiveArguments ?? null,
			title: operation.title ?? null,
		});
	}

	isBlockedByPermission(operation: Operation | null | undefined): boolean {
		if (operation == null) {
			return false;
		}

		return isOperationBlockedByPermission({
			lifecycle: operation.lifecycle,
			blocked_reason: operation.blockedReason,
		});
	}

	hasRawEvidence(operation: Operation | null | undefined): boolean {
		if (operation == null) {
			return false;
		}

		return operationHasRawEvidence({
			title: operation.title ?? null,
			command: operation.command ?? null,
			result: operation.result ?? null,
			locations: operation.locations ?? null,
			skill_meta: operation.skillMeta ?? null,
			normalized_todos: operation.normalizedTodos ?? null,
		});
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
			this.blockerKindsByOperationId.delete(operationId);
			this.deferredBlockerKindsByOperationId.delete(operationId);
			if (operation.sourceEntryId != null) {
				this.operationIdByEntryKey.delete(createSessionToolKey(sessionId, operation.sourceEntryId));
			}
		}

		this.sessionOperationIds.delete(sessionId);
		for (const [key] of this.deferredBlockerKindsByToolCallKey) {
			if (key.startsWith(`${sessionId}::`)) {
				this.deferredBlockerKindsByToolCallKey.delete(key);
			}
		}
	}

	replaceSessionOperations(sessionId: string, snapshots: ReadonlyArray<OperationSnapshot>): void {
		const nextSessionOperationIds: Array<string> = [];
		const nextOperationIdSet = new Set<string>();
		for (const snapshot of snapshots) {
			const operation = mergeOperationSnapshot(this.operationsById.get(snapshot.id), snapshot);
			this.setOperation(sessionId, operation);
			nextOperationIdSet.add(operation.id);
			nextSessionOperationIds.push(operation.id);
		}

		const previousOperationIds = this.sessionOperationIds.get(sessionId) ?? [];
		for (const operationId of previousOperationIds) {
			if (nextOperationIdSet.has(operationId)) {
				continue;
			}
			const operation = this.operationsById.get(operationId);
			if (operation == null) {
				continue;
			}
			this.operationsById.delete(operationId);
			this.operationIdByToolCallKey.delete(createSessionToolKey(sessionId, operation.toolCallId));
			this.blockerKindsByOperationId.delete(operationId);
			this.deferredBlockerKindsByOperationId.delete(operationId);
			if (operation.sourceEntryId != null) {
				this.operationIdByEntryKey.delete(createSessionToolKey(sessionId, operation.sourceEntryId));
			}
		}

		this.sessionOperationIds.set(sessionId, nextSessionOperationIds);
	}

	private setOperation(sessionId: string, operation: Operation): void {
		const nextOperation = this.mergeDeferredInteractionBlockers(sessionId, operation);
		this.operationsById.set(nextOperation.id, nextOperation);
		this.operationIdByToolCallKey.set(
			createSessionToolKey(sessionId, nextOperation.toolCallId),
			nextOperation.id
		);
		if (nextOperation.sourceEntryId != null) {
			this.operationIdByEntryKey.set(
				createSessionToolKey(sessionId, nextOperation.sourceEntryId),
				nextOperation.id
			);
		}

		const sessionOperationIds = this.sessionOperationIds.get(sessionId) ?? [];
		if (!sessionOperationIds.includes(nextOperation.id)) {
			this.sessionOperationIds.set(sessionId, sessionOperationIds.concat(nextOperation.id));
		}
	}

	private applyStoredInteractionBlockers(operation: Operation): Operation {
		const blockedReason = blockedReasonFromBlockers(
			this.blockerKindsByOperationId.get(operation.id)
		);
		if (blockedReason == null) {
			return {
				id: operation.id,
				sessionId: operation.sessionId,
				toolCallId: operation.toolCallId,
				sourceEntryId: operation.sourceEntryId,
				name: operation.name,
				kind: operation.kind,
				status: operation.status,
				lifecycle: operationLifecycleFromStatus(operation.status),
				blockedReason: null,
				title: operation.title,
				arguments: operation.arguments,
				progressiveArguments: operation.progressiveArguments,
				result: operation.result,
				locations: operation.locations,
				skillMeta: operation.skillMeta,
				normalizedQuestions: operation.normalizedQuestions,
				normalizedTodos: operation.normalizedTodos,
				questionAnswer: operation.questionAnswer,
				awaitingPlanApproval: operation.awaitingPlanApproval,
				planApprovalRequestId: operation.planApprovalRequestId,
				startedAtMs: operation.startedAtMs,
				completedAtMs: operation.completedAtMs,
				command: operation.command,
				parentToolCallId: operation.parentToolCallId,
				parentOperationId: operation.parentOperationId,
				childToolCallIds: operation.childToolCallIds,
				childOperationIds: operation.childOperationIds,
			};
		}

		return {
			id: operation.id,
			sessionId: operation.sessionId,
			toolCallId: operation.toolCallId,
			sourceEntryId: operation.sourceEntryId,
			name: operation.name,
			kind: operation.kind,
			status: operation.status,
			lifecycle: "blocked",
			blockedReason,
			title: operation.title,
			arguments: operation.arguments,
			progressiveArguments: operation.progressiveArguments,
			result: operation.result,
			locations: operation.locations,
			skillMeta: operation.skillMeta,
			normalizedQuestions: operation.normalizedQuestions,
			normalizedTodos: operation.normalizedTodos,
			questionAnswer: operation.questionAnswer,
			awaitingPlanApproval: operation.awaitingPlanApproval,
			planApprovalRequestId: operation.planApprovalRequestId,
			startedAtMs: operation.startedAtMs,
			completedAtMs: operation.completedAtMs,
			command: operation.command,
			parentToolCallId: operation.parentToolCallId,
			parentOperationId: operation.parentOperationId,
			childToolCallIds: operation.childToolCallIds,
			childOperationIds: operation.childOperationIds,
		};
	}

	private mergeDeferredInteractionBlockers(sessionId: string, operation: Operation): Operation {
		const toolCallKey = createSessionToolKey(sessionId, operation.toolCallId);
		const nextBlockers = this.cloneInteractionBlockers(
			this.blockerKindsByOperationId.get(operation.id)
		);
		const deferredByOperationId = this.deferredBlockerKindsByOperationId.get(operation.id);
		if (deferredByOperationId != null) {
			for (const [interactionId, kind] of deferredByOperationId.entries()) {
				nextBlockers.set(interactionId, kind);
			}
			this.deferredBlockerKindsByOperationId.delete(operation.id);
		}
		const deferredByToolCallId = this.deferredBlockerKindsByToolCallKey.get(toolCallKey);
		if (deferredByToolCallId != null) {
			for (const [interactionId, kind] of deferredByToolCallId.entries()) {
				nextBlockers.set(interactionId, kind);
			}
			this.deferredBlockerKindsByToolCallKey.delete(toolCallKey);
		}

		if (nextBlockers.size > 0) {
			this.blockerKindsByOperationId.set(operation.id, nextBlockers);
			return this.applyStoredInteractionBlockers(operation);
		}

		if (operation.lifecycle !== "blocked" || operation.blockedReason == null) {
			this.blockerKindsByOperationId.delete(operation.id);
		}

		return operation;
	}

	private cloneInteractionBlockers(
		blockers: ReadonlyMap<string, InteractionKind> | undefined
	): InteractionBlockers {
		return blockers == null ? new Map<string, InteractionKind>() : new Map(blockers.entries());
	}

	private setInteractionBlocker(
		store: SvelteMap<string, InteractionBlockers>,
		key: string,
		interactionId: string,
		interactionKind: InteractionKind
	): void {
		const blockers = this.cloneInteractionBlockers(store.get(key));
		blockers.set(interactionId, interactionKind);
		store.set(key, blockers);
	}

	private deleteInteractionBlocker(
		store: SvelteMap<string, InteractionBlockers>,
		key: string,
		interactionId: string
	): void {
		const blockers = store.get(key);
		if (blockers == null) {
			return;
		}

		const nextBlockers = this.cloneInteractionBlockers(blockers);
		nextBlockers.delete(interactionId);
		if (nextBlockers.size === 0) {
			store.delete(key);
			return;
		}

		store.set(key, nextBlockers);
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
			lifecycle: operationLifecycleFromStatus(toolCall.status),
			blockedReason: null,
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
