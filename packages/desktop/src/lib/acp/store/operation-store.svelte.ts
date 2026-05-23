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
	private readonly lastRootOperationIdBySession = new SvelteMap<string, string>();
	private readonly lastTodoOperationIdBySession = new SvelteMap<string, string>();
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

		const toolCalls = this.getSessionModifiedFileToolCalls(sessionId);
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

		const operationId =
			this.lastRootOperationIdBySession.get(sessionId) ??
			this.recomputeLastRootOperationId(sessionId);
		if (operationId !== null) {
			const toolCall = this.materializeToolCall(operationId, new Set<string>());
			this.lastToolCallBySession.set(sessionId, { version, toolCall });
			return toolCall;
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

		const operationId =
			this.lastTodoOperationIdBySession.get(sessionId) ??
			this.recomputeLastTodoOperationId(sessionId);
		if (operationId !== null) {
			const toolCall = this.materializeToolCall(operationId, new Set<string>());
			this.lastTodoToolCallBySession.set(sessionId, { version, toolCall });
			return toolCall;
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
		this.lastRootOperationIdBySession.delete(sessionId);
		this.lastTodoOperationIdBySession.delete(sessionId);
		this.modifiedFilesStateBySession.delete(sessionId);
		this.bumpSessionOperationVersion(sessionId);
	}

	replaceSessionOperations(sessionId: string, snapshots: ReadonlyArray<OperationSnapshot>): void {
		this.clearSession(sessionId);
		const nextSessionOperationIds: Array<string> = [];
		const nextSessionOperationIdSet = new Set<string>();
		let currentStreamingOperationId: string | null = null;
		let lastRootOperationId: string | null = null;
		let lastTodoOperationId: string | null = null;
		for (const snapshot of snapshots) {
			const operation = this.operationFromSnapshot(snapshot);
			this.operationsById.set(operation.id, operation);
			this.indexOperation(operation);
			nextSessionOperationIds.push(operation.id);
			nextSessionOperationIdSet.add(operation.id);
			if (operation.parentOperationId === null) {
				lastRootOperationId = operation.id;
			}
			if (operationHasTodos(operation)) {
				lastTodoOperationId = operation.id;
			}
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
		if (lastRootOperationId === null) {
			this.lastRootOperationIdBySession.delete(sessionId);
		} else {
			this.lastRootOperationIdBySession.set(sessionId, lastRootOperationId);
		}
		if (lastTodoOperationId === null) {
			this.lastTodoOperationIdBySession.delete(sessionId);
		} else {
			this.lastTodoOperationIdBySession.set(sessionId, lastTodoOperationId);
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

		const previousVersion = this.sessionOperationVersions.get(sessionId) ?? 0;
		const cachedSessionOperations = this.sessionOperationsBySession.get(sessionId);
		const cachedSessionToolCalls = this.sessionToolCallsBySession.get(sessionId);
		const cachedModifiedFilesState = this.modifiedFilesStateBySession.get(sessionId);
		const cachedCurrentStreamingToolCall = this.currentStreamingToolCallBySession.get(sessionId);
		const cachedLastToolCall = this.lastToolCallBySession.get(sessionId);
		const cachedLastTodoToolCall = this.lastTodoToolCallBySession.get(sessionId);
		let cachedOperationPatches: Map<number, Operation> | null = null;
		let cachedOperationAppends: Operation[] | null = null;
		let cachedToolCallPatches: Map<number, ToolCall> | null = null;
		let cachedToolCallAppends: ToolCall[] | null = null;
		let canPatchCachedToolCalls =
			cachedSessionToolCalls === undefined || cachedSessionToolCalls.version === previousVersion;
		let canPreserveModifiedFilesState =
			cachedModifiedFilesState === undefined ||
			cachedModifiedFilesState.version === previousVersion;
		let canPreserveCurrentStreamingToolCall =
			cachedCurrentStreamingToolCall === undefined ||
			cachedCurrentStreamingToolCall.version === previousVersion;
		let canPreserveLastToolCall =
			cachedLastToolCall === undefined || cachedLastToolCall.version === previousVersion;
		let canPreserveLastTodoToolCall =
			cachedLastTodoToolCall === undefined ||
			cachedLastTodoToolCall.version === previousVersion;
		let changed = false;
		let appendedOperationId = false;
		let shouldRecomputeLastRootOperation = false;
		let shouldRecomputeLastTodoOperation = false;
		for (const snapshot of snapshots) {
			const operation = this.operationFromSnapshot(snapshot);
			const existingOperation = this.operationsById.get(operation.id);
			if (existingOperation !== undefined && areOperationsEquivalent(existingOperation, operation)) {
				continue;
			}
			const existingIsRootOperation = existingOperation?.parentOperationId === null;
			const nextIsRootOperation = operation.parentOperationId === null;
			if (existingOperation !== undefined) {
				this.unindexOperation(existingOperation);
			}
			if (
				cachedModifiedFilesState?.version === previousVersion &&
				(existingOperation === undefined
					? operationCanAffectModifiedFiles(operation)
					: !areModifiedFileInputsEquivalent(existingOperation, operation))
			) {
				canPreserveModifiedFilesState = false;
			}
			if (
				cachedLastToolCall?.version === previousVersion &&
				(existingOperation === undefined ||
					cachedLastToolCall.toolCall === null ||
					operation.toolCallId === cachedLastToolCall.toolCall.id)
			) {
				canPreserveLastToolCall = false;
			}
			if (
				cachedCurrentStreamingToolCall?.version === previousVersion &&
				(cachedCurrentStreamingToolCall.toolCall === null ||
					operation.toolCallId === cachedCurrentStreamingToolCall.toolCall.id ||
					isStreamingOperationState(operation.operationState))
			) {
				canPreserveCurrentStreamingToolCall = false;
			}
			if (
				cachedLastTodoToolCall?.version === previousVersion &&
				(cachedLastTodoToolCall.toolCall === null ||
					operation.toolCallId === cachedLastTodoToolCall.toolCall.id ||
					operationHasTodos(operation))
			) {
				canPreserveLastTodoToolCall = false;
			}
			this.operationsById.set(operation.id, operation);
			this.indexOperation(operation);
			changed = true;
			if (existingOperation !== undefined) {
				if (
					existingIsRootOperation !== nextIsRootOperation ||
					(this.lastRootOperationIdBySession.get(sessionId) === operation.id &&
						!nextIsRootOperation)
				) {
					shouldRecomputeLastRootOperation = true;
				}
				if (
					operationHasTodos(existingOperation) ||
					operationHasTodos(operation)
				) {
					shouldRecomputeLastTodoOperation = true;
				}
			}
			const canPatchRootToolCall =
				nextIsRootOperation &&
				(existingOperation === undefined || existingOperation.parentOperationId === null);
			if (cachedSessionToolCalls?.version === previousVersion && !canPatchRootToolCall) {
				canPatchCachedToolCalls = false;
			}
			let wasAppendedOperation = false;
			if (!sessionOperationIdSet.has(operation.id)) {
				sessionOperationIds.push(operation.id);
				sessionOperationIdSet.add(operation.id);
				appendedOperationId = true;
				wasAppendedOperation = true;
				if (cachedSessionOperations?.version === previousVersion) {
					cachedOperationAppends ??= [];
					cachedOperationAppends.push(operation);
				}
				if (nextIsRootOperation) {
					this.lastRootOperationIdBySession.set(sessionId, operation.id);
				}
				if (operationHasTodos(operation)) {
					this.lastTodoOperationIdBySession.set(sessionId, operation.id);
				}
				if (cachedSessionToolCalls?.version === previousVersion && canPatchRootToolCall) {
					const toolCall = this.materializeToolCall(operation.id, new Set<string>());
					if (toolCall !== null) {
						cachedToolCallAppends ??= [];
						cachedToolCallAppends.push(toolCall);
					}
				}
			} else if (cachedSessionOperations?.version === previousVersion) {
				const cachedOperationIndex = findCachedOperationIndex(
					cachedSessionOperations.operations,
					operation.id
				);
				if (cachedOperationIndex !== -1) {
					cachedOperationPatches ??= new Map<number, Operation>();
					cachedOperationPatches.set(cachedOperationIndex, operation);
				}
			}
			if (
				sessionOperationIdSet.has(operation.id) &&
				!wasAppendedOperation &&
				cachedSessionToolCalls?.version === previousVersion &&
				canPatchRootToolCall
			) {
				const cachedToolCallIndex = findCachedToolCallIndex(
					cachedSessionToolCalls.toolCalls,
					operation.toolCallId
				);
				const toolCall = this.materializeToolCall(operation.id, new Set<string>());
				if (cachedToolCallIndex !== -1 && toolCall !== null) {
					cachedToolCallPatches ??= new Map<number, ToolCall>();
					cachedToolCallPatches.set(cachedToolCallIndex, toolCall);
				}
			}
			this.updateCurrentStreamingOperation(sessionId, operation);
		}
		if (appendedOperationId) {
			this.sessionOperationIds.set(sessionId, sessionOperationIds);
		}
		if (changed) {
			if (shouldRecomputeLastRootOperation) {
				this.recomputeLastRootOperationId(sessionId);
			}
			if (shouldRecomputeLastTodoOperation) {
				this.recomputeLastTodoOperationId(sessionId);
			}
			const nextVersion = this.bumpSessionOperationVersion(sessionId);
			if (cachedSessionOperations?.version === previousVersion) {
				this.sessionOperationsBySession.set(sessionId, {
					version: nextVersion,
					operations: createPatchedOperationArray(
						cachedSessionOperations.operations,
						cachedOperationPatches,
						cachedOperationAppends
					),
				});
			}
			if (cachedSessionToolCalls?.version === previousVersion && canPatchCachedToolCalls) {
				this.sessionToolCallsBySession.set(sessionId, {
					version: nextVersion,
					toolCalls: createPatchedToolCallArray(
						cachedSessionToolCalls.toolCalls,
						cachedToolCallPatches,
						cachedToolCallAppends
					),
				});
			}
			if (cachedModifiedFilesState?.version === previousVersion && canPreserveModifiedFilesState) {
				this.modifiedFilesStateBySession.set(sessionId, {
					version: nextVersion,
					state: cachedModifiedFilesState.state,
				});
			}
			if (cachedLastToolCall?.version === previousVersion && canPreserveLastToolCall) {
				this.lastToolCallBySession.set(sessionId, {
					version: nextVersion,
					toolCall: cachedLastToolCall.toolCall,
				});
			}
			if (
				cachedCurrentStreamingToolCall?.version === previousVersion &&
				canPreserveCurrentStreamingToolCall
			) {
				this.currentStreamingToolCallBySession.set(sessionId, {
					version: nextVersion,
					toolCall: cachedCurrentStreamingToolCall.toolCall,
				});
			}
			if (cachedLastTodoToolCall?.version === previousVersion && canPreserveLastTodoToolCall) {
				this.lastTodoToolCallBySession.set(sessionId, {
					version: nextVersion,
					toolCall: cachedLastTodoToolCall.toolCall,
				});
			}
		}
	}

	private bumpSessionOperationVersion(sessionId: string): number {
		const nextVersion = (this.sessionOperationVersions.get(sessionId) ?? 0) + 1;
		this.sessionOperationVersions.set(sessionId, nextVersion);
		this.sessionOperationsBySession.delete(sessionId);
		this.modifiedFilesStateBySession.delete(sessionId);
		this.sessionToolCallsBySession.delete(sessionId);
		this.currentStreamingToolCallBySession.delete(sessionId);
		this.lastToolCallBySession.delete(sessionId);
		this.lastTodoToolCallBySession.delete(sessionId);
		return nextVersion;
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

	private recomputeLastRootOperationId(sessionId: string): string | null {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		for (let index = operationIds.length - 1; index >= 0; index -= 1) {
			const operationId = operationIds[index];
			const operation = this.operationsById.get(operationId);
			if (operation !== undefined && operation.parentOperationId === null) {
				this.lastRootOperationIdBySession.set(sessionId, operation.id);
				return operation.id;
			}
		}

		this.lastRootOperationIdBySession.delete(sessionId);
		return null;
	}

	private recomputeLastTodoOperationId(sessionId: string): string | null {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		for (let index = operationIds.length - 1; index >= 0; index -= 1) {
			const operationId = operationIds[index];
			const operation = this.operationsById.get(operationId);
			if (operation !== undefined && operationHasTodos(operation)) {
				this.lastTodoOperationIdBySession.set(sessionId, operation.id);
				return operation.id;
			}
		}

		this.lastTodoOperationIdBySession.delete(sessionId);
		return null;
	}

	private getSessionModifiedFileToolCalls(sessionId: string): Array<ToolCall> {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		const toolCalls: Array<ToolCall> = [];
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation === undefined || !operationCanAffectModifiedFiles(operation)) {
				continue;
			}
			const toolCall = this.materializeToolCall(operation.id, new Set<string>());
			if (toolCall !== null) {
				toolCalls.push(toolCall);
			}
		}
		return toolCalls;
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

function findCachedOperationIndex(operations: readonly Operation[], operationId: string): number {
	for (let index = 0; index < operations.length; index += 1) {
		if (operations[index]?.id === operationId) {
			return index;
		}
	}
	return -1;
}

function findCachedToolCallIndex(toolCalls: readonly ToolCall[], toolCallId: string): number {
	for (let index = 0; index < toolCalls.length; index += 1) {
		if (toolCalls[index]?.id === toolCallId) {
			return index;
		}
	}
	return -1;
}

function createPatchedOperationArray(
	baseOperations: readonly Operation[],
	operationPatches: ReadonlyMap<number, Operation> | null,
	appendedOperations: readonly Operation[] | null
): Array<Operation> {
	if (operationPatches === null && appendedOperations === null) {
		return baseOperations as Array<Operation>;
	}

	const appended = appendedOperations ?? [];
	const target = new Array<Operation>(baseOperations.length + appended.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectPatchedOperation(baseOperations, operationPatches, appended, index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectPatchedOperation(baseOperations, operationPatches, appended, index);
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectPatchedOperation(baseOperations, operationPatches, appended, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	}) as Array<Operation>;
}

function createPatchedToolCallArray(
	baseToolCalls: readonly ToolCall[],
	toolCallPatches: ReadonlyMap<number, ToolCall> | null,
	appendedToolCalls: readonly ToolCall[] | null
): Array<ToolCall> {
	if (toolCallPatches === null && appendedToolCalls === null) {
		return baseToolCalls as Array<ToolCall>;
	}

	const appended = appendedToolCalls ?? [];
	const target = new Array<ToolCall>(baseToolCalls.length + appended.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectPatchedToolCall(baseToolCalls, toolCallPatches, appended, index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectPatchedToolCall(baseToolCalls, toolCallPatches, appended, index);
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectPatchedToolCall(baseToolCalls, toolCallPatches, appended, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	}) as Array<ToolCall>;
}

function selectPatchedOperation(
	baseOperations: readonly Operation[],
	operationPatches: ReadonlyMap<number, Operation> | null,
	appendedOperations: readonly Operation[],
	index: number
): Operation | undefined {
	if (index < baseOperations.length) {
		return operationPatches?.get(index) ?? baseOperations[index];
	}
	return appendedOperations[index - baseOperations.length];
}

function selectPatchedToolCall(
	baseToolCalls: readonly ToolCall[],
	toolCallPatches: ReadonlyMap<number, ToolCall> | null,
	appendedToolCalls: readonly ToolCall[],
	index: number
): ToolCall | undefined {
	if (index < baseToolCalls.length) {
		return toolCallPatches?.get(index) ?? baseToolCalls[index];
	}
	return appendedToolCalls[index - baseToolCalls.length];
}

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}

function createArrayLikeOwnKeys(length: number): string[] {
	const keys: string[] = [];
	for (let index = 0; index < length; index += 1) {
		keys.push(String(index));
	}
	keys.push("length");
	return keys;
}

function areOperationsEquivalent(left: Operation, right: Operation): boolean {
	return (
		left.id === right.id &&
		left.sessionId === right.sessionId &&
		left.toolCallId === right.toolCallId &&
		areJsonLikeValuesEquivalent(left.sourceLink, right.sourceLink) &&
		left.name === right.name &&
		left.kind === right.kind &&
		left.status === right.status &&
		left.operationState === right.operationState &&
		left.operationProvenanceKey === right.operationProvenanceKey &&
		left.title === right.title &&
		areJsonLikeValuesEquivalent(left.arguments, right.arguments) &&
		areJsonLikeValuesEquivalent(left.progressiveArguments, right.progressiveArguments) &&
		areJsonLikeValuesEquivalent(left.result, right.result) &&
		areJsonLikeValuesEquivalent(left.locations, right.locations) &&
		areJsonLikeValuesEquivalent(left.skillMeta, right.skillMeta) &&
		areJsonLikeValuesEquivalent(left.normalizedQuestions, right.normalizedQuestions) &&
		areJsonLikeValuesEquivalent(left.normalizedTodos, right.normalizedTodos) &&
		areJsonLikeValuesEquivalent(left.questionAnswer, right.questionAnswer) &&
		left.awaitingPlanApproval === right.awaitingPlanApproval &&
		left.planApprovalRequestId === right.planApprovalRequestId &&
		left.startedAtMs === right.startedAtMs &&
		left.completedAtMs === right.completedAtMs &&
		left.command === right.command &&
		left.parentToolCallId === right.parentToolCallId &&
		left.parentOperationId === right.parentOperationId &&
		areJsonLikeValuesEquivalent(left.childToolCallIds, right.childToolCallIds) &&
		areJsonLikeValuesEquivalent(left.childOperationIds, right.childOperationIds) &&
		left.degradationReason === right.degradationReason
	);
}

function areModifiedFileInputsEquivalent(left: Operation, right: Operation): boolean {
	return (
		left.toolCallId === right.toolCallId &&
		left.kind === right.kind &&
		areJsonLikeValuesEquivalent(left.arguments, right.arguments) &&
		left.parentOperationId === right.parentOperationId &&
		areJsonLikeValuesEquivalent(left.childOperationIds, right.childOperationIds)
	);
}

function operationCanAffectModifiedFiles(operation: Operation): boolean {
	return operation.kind === "edit" || operation.childOperationIds.length > 0;
}

function operationHasTodos(operation: Operation): boolean {
	return operation.normalizedTodos != null && operation.normalizedTodos.length > 0;
}

function areJsonLikeValuesEquivalent(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (typeof left !== typeof right) {
		return false;
	}
	if (left === null || right === null || left === undefined || right === undefined) {
		return false;
	}
	if (typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}
		for (let index = 0; index < left.length; index += 1) {
			if (!areJsonLikeValuesEquivalent(left[index], right[index])) {
				return false;
			}
		}
		return true;
	}

	const leftEntries = Object.entries(left);
	const rightRecord = right as Record<string, unknown>;
	if (leftEntries.length !== Object.keys(rightRecord).length) {
		return false;
	}
	for (const [key, value] of leftEntries) {
		if (!areJsonLikeValuesEquivalent(value, rightRecord[key])) {
			return false;
		}
	}
	return true;
}
