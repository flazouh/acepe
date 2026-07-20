import { SvelteMap } from "svelte/reactivity";
import type { OperationSnapshot, OperationSourceLink } from "../../services/acp-types.js";
import { aggregateFileEditsFromToolCalls } from "../logic/aggregate-file-edits.js";
import type { ModifiedFilesState } from "../types/modified-files-state.js";
import type { Operation, OperationState } from "../types/operation.js";
import type { PermissionRequest } from "../types/permission.js";
import type { ToolCall } from "../types/tool-call.js";
import type { ToolKind } from "../types/tool-kind.js";
import { mapOperationStateToToolPresentationStatus } from "../utils/tool-state-utils.js";
import {
	isPermissionRepresentedByOperation,
	visiblePermissionsForOperations,
} from "./permission-operation-projection.js";
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
	private readonly sessionRootOperationIds = new Map<string, Array<string>>();
	private readonly sessionOperationVersions = new SvelteMap<string, number>();
	private readonly currentStreamingOperationIdBySession = new Map<string, string>();
	private readonly lastRootOperationIdBySession = new Map<string, string>();
	private readonly lastTodoOperationIdBySession = new Map<string, string>();
	private readonly modifiedFilesStateBySession = new Map<
		string,
		{ readonly version: number; readonly state: ModifiedFilesState | null }
	>();
	private readonly sessionOperationsBySession = new Map<
		string,
		{
			readonly version: number;
			readonly operations: Array<Operation>;
			readonly operationIndexById: ReadonlyMap<string, number>;
		}
	>();
	private readonly sessionToolCallsBySession = new Map<
		string,
		{
			readonly version: number;
			readonly toolCalls: Array<ToolCall>;
			readonly toolCallIndexById: ReadonlyMap<string, number>;
		}
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
		const operationIndexById = new Map<string, number>();
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation != null) {
				operationIndexById.set(operation.id, operations.length);
				operations.push(operation);
			}
		}
		this.sessionOperationsBySession.set(sessionId, { version, operations, operationIndexById });
		return operations;
	}

	getSessionToolCalls(sessionId: string): Array<ToolCall> {
		const version = this.sessionOperationVersions.get(sessionId) ?? 0;
		const cached = this.sessionToolCallsBySession.get(sessionId);
		if (cached !== undefined && cached.version === version) {
			return cached.toolCalls;
		}

		const operationIds = this.sessionRootOperationIds.get(sessionId) ?? [];
		const toolCalls: Array<ToolCall> = [];
		const toolCallIndexById = new Map<string, number>();
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation == null) {
				continue;
			}
			const toolCall = this.materializeToolCall(operation.id, new Set<string>());
			if (toolCall !== null) {
				toolCallIndexById.set(toolCall.id, toolCalls.length);
				toolCalls.push(toolCall);
			}
		}
		this.sessionToolCallsBySession.set(sessionId, { version, toolCalls, toolCallIndexById });
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
		this.sessionRootOperationIds.delete(sessionId);
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
		const nextSessionRootOperationIds: Array<string> = [];
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
				nextSessionRootOperationIds.push(operation.id);
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
		this.sessionRootOperationIds.set(sessionId, nextSessionRootOperationIds);
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
		const patchedRootOperationIds = new Set<string>();
		const appendedRootOperationIds: string[] = [];
		const patchedRootToolCallsByOperationId = new Map<string, ToolCall>();
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
			cachedLastTodoToolCall === undefined || cachedLastTodoToolCall.version === previousVersion;
		const resolvePatchedRootToolCall = (rootOperationId: string): ToolCall | undefined => {
			const cachedToolCall = patchedRootToolCallsByOperationId.get(rootOperationId);
			if (cachedToolCall !== undefined) {
				return cachedToolCall;
			}
			const toolCall = this.materializeToolCall(rootOperationId, new Set<string>());
			if (toolCall !== null) {
				patchedRootToolCallsByOperationId.set(rootOperationId, toolCall);
				return toolCall;
			}
			return undefined;
		};
		let changed = false;
		let appendedOperationId = false;
		let shouldRecomputeRootOperationIds = false;
		let shouldRecomputeLastRootOperation = false;
		let shouldRecomputeLastTodoOperation = false;
		const incomingOperations = snapshots.map((snapshot) => this.operationFromSnapshot(snapshot));
		const incomingOperationsById = new Map(
			incomingOperations.map((operation) => [operation.id, operation])
		);
		for (const operation of incomingOperations) {
			const existingOperation = this.operationsById.get(operation.id);
			if (
				existingOperation !== undefined &&
				areOperationsEquivalent(existingOperation, operation)
			) {
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
					: !areModifiedFileInputsEquivalent(
							existingOperation,
							operation,
							this.operationsById,
							incomingOperationsById
						))
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
			const rootOperationId =
				operation.parentOperationId === null
					? operation.id
					: this.findRootOperationId(operation.id);
			if (
				rootOperationId !== null &&
				cachedLastToolCall?.version === previousVersion &&
				cachedLastToolCall.toolCall !== null &&
				this.getByToolCallId(sessionId, cachedLastToolCall.toolCall.id)?.id === rootOperationId
			) {
				canPreserveLastToolCall = false;
			}
			if (
				rootOperationId !== null &&
				cachedCurrentStreamingToolCall?.version === previousVersion &&
				cachedCurrentStreamingToolCall.toolCall !== null &&
				this.getByToolCallId(sessionId, cachedCurrentStreamingToolCall.toolCall.id)?.id ===
					rootOperationId
			) {
				canPreserveCurrentStreamingToolCall = false;
			}
			if (
				rootOperationId !== null &&
				cachedLastTodoToolCall?.version === previousVersion &&
				cachedLastTodoToolCall.toolCall !== null &&
				this.getByToolCallId(sessionId, cachedLastTodoToolCall.toolCall.id)?.id === rootOperationId
			) {
				canPreserveLastTodoToolCall = false;
			}
			changed = true;
			if (existingOperation !== undefined) {
				if (
					existingIsRootOperation !== nextIsRootOperation ||
					(this.lastRootOperationIdBySession.get(sessionId) === operation.id &&
						!nextIsRootOperation)
				) {
					shouldRecomputeRootOperationIds = true;
					shouldRecomputeLastRootOperation = true;
				}
				if (operationHasTodos(existingOperation) || operationHasTodos(operation)) {
					shouldRecomputeLastTodoOperation = true;
				}
			}
			const canPatchRootToolCall =
				nextIsRootOperation &&
				(existingOperation === undefined || existingOperation.parentOperationId === null);
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
					this.sessionRootOperationIds.set(
						sessionId,
						createAppendedOperationIdArray(
							this.sessionRootOperationIds.get(sessionId) ?? [],
							operation.id
						)
					);
					this.lastRootOperationIdBySession.set(sessionId, operation.id);
				}
				if (operationHasTodos(operation)) {
					this.lastTodoOperationIdBySession.set(sessionId, operation.id);
				}
				if (cachedSessionToolCalls?.version === previousVersion && canPatchRootToolCall) {
					appendedRootOperationIds.push(operation.id);
				}
			} else if (cachedSessionOperations?.version === previousVersion) {
				const cachedOperationIndex =
					cachedSessionOperations.operationIndexById.get(operation.id) ?? -1;
				if (cachedOperationIndex !== -1) {
					cachedOperationPatches ??= new Map<number, Operation>();
					cachedOperationPatches.set(cachedOperationIndex, operation);
				}
			}
			if (
				sessionOperationIdSet.has(operation.id) &&
				!wasAppendedOperation &&
				cachedSessionToolCalls?.version === previousVersion
			) {
				if (
					existingOperation !== undefined &&
					existingOperation.parentOperationId !== operation.parentOperationId
				) {
					canPatchCachedToolCalls = false;
				} else {
					if (rootOperationId === null) {
						canPatchCachedToolCalls = false;
					} else if (
						!appendedRootOperationIds.includes(rootOperationId) &&
						(canPatchRootToolCall || operation.parentOperationId !== null)
					) {
						patchedRootOperationIds.add(rootOperationId);
					}
				}
			}
			this.updateCurrentStreamingOperation(sessionId, operation);
		}
		if (cachedSessionToolCalls?.version === previousVersion && canPatchCachedToolCalls) {
			for (const rootOperationId of patchedRootOperationIds) {
				const rootOperation = this.operationsById.get(rootOperationId);
				if (rootOperation == null) {
					canPatchCachedToolCalls = false;
					break;
				}
				const cachedToolCallIndex =
					cachedSessionToolCalls.toolCallIndexById.get(rootOperation.toolCallId) ?? -1;
				const toolCall = this.materializeToolCall(rootOperationId, new Set<string>());
				if (cachedToolCallIndex === -1 || toolCall === null) {
					canPatchCachedToolCalls = false;
					break;
				}
				patchedRootToolCallsByOperationId.set(rootOperationId, toolCall);
				cachedToolCallPatches ??= new Map<number, ToolCall>();
				cachedToolCallPatches.set(cachedToolCallIndex, toolCall);
			}
			if (canPatchCachedToolCalls) {
				for (const rootOperationId of appendedRootOperationIds) {
					const toolCall = this.materializeToolCall(rootOperationId, new Set<string>());
					if (toolCall === null) {
						canPatchCachedToolCalls = false;
						break;
					}
					patchedRootToolCallsByOperationId.set(rootOperationId, toolCall);
					cachedToolCallAppends ??= [];
					cachedToolCallAppends.push(toolCall);
				}
			}
		}
		if (appendedOperationId) {
			this.sessionOperationIds.set(sessionId, sessionOperationIds);
		}
		if (changed) {
			if (shouldRecomputeRootOperationIds) {
				this.recomputeRootOperationIds(sessionId);
			}
			if (shouldRecomputeLastRootOperation) {
				this.recomputeLastRootOperationId(sessionId);
			}
			if (shouldRecomputeLastTodoOperation) {
				this.recomputeLastTodoOperationId(sessionId);
			}
			const nextVersion = this.bumpSessionOperationVersion(sessionId);
			if (cachedSessionOperations?.version === previousVersion) {
				const nextOperationIndexById = patchCachedItemIndex(
					cachedSessionOperations.operationIndexById,
					cachedOperationAppends,
					cachedSessionOperations.operations.length
				);
				this.sessionOperationsBySession.set(sessionId, {
					version: nextVersion,
					operations: createPatchedOperationArray(
						cachedSessionOperations.operations,
						cachedOperationPatches,
						cachedOperationAppends
					),
					operationIndexById: nextOperationIndexById,
				});
			}
			if (cachedSessionToolCalls?.version === previousVersion && canPatchCachedToolCalls) {
				const nextToolCallIndexById = patchCachedItemIndex(
					cachedSessionToolCalls.toolCallIndexById,
					cachedToolCallAppends,
					cachedSessionToolCalls.toolCalls.length
				);
				this.sessionToolCallsBySession.set(sessionId, {
					version: nextVersion,
					toolCalls: createPatchedToolCallArray(
						cachedSessionToolCalls.toolCalls,
						cachedToolCallPatches,
						cachedToolCallAppends
					),
					toolCallIndexById: nextToolCallIndexById,
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
			} else if (cachedLastToolCall?.version === previousVersion) {
				const lastToolOperation = cachedLastToolCall.toolCall
					? this.getByToolCallId(sessionId, cachedLastToolCall.toolCall.id)
					: undefined;
				const patchedLastRootToolCall =
					lastToolOperation?.parentOperationId === null
						? resolvePatchedRootToolCall(lastToolOperation.id)
						: undefined;
				if (patchedLastRootToolCall !== undefined) {
					this.lastToolCallBySession.set(sessionId, {
						version: nextVersion,
						toolCall: patchedLastRootToolCall,
					});
				}
			}
			if (
				cachedCurrentStreamingToolCall?.version === previousVersion &&
				canPreserveCurrentStreamingToolCall
			) {
				this.currentStreamingToolCallBySession.set(sessionId, {
					version: nextVersion,
					toolCall: cachedCurrentStreamingToolCall.toolCall,
				});
			} else if (cachedCurrentStreamingToolCall?.version === previousVersion) {
				const currentStreamingOperation = cachedCurrentStreamingToolCall.toolCall
					? this.getByToolCallId(sessionId, cachedCurrentStreamingToolCall.toolCall.id)
					: undefined;
				const patchedCurrentStreamingToolCall =
					currentStreamingOperation?.parentOperationId === null &&
					isStreamingOperationState(currentStreamingOperation.operationState)
						? resolvePatchedRootToolCall(currentStreamingOperation.id)
						: undefined;
				if (patchedCurrentStreamingToolCall !== undefined) {
					this.currentStreamingToolCallBySession.set(sessionId, {
						version: nextVersion,
						toolCall: patchedCurrentStreamingToolCall,
					});
				}
			}
			if (cachedLastTodoToolCall?.version === previousVersion && canPreserveLastTodoToolCall) {
				this.lastTodoToolCallBySession.set(sessionId, {
					version: nextVersion,
					toolCall: cachedLastTodoToolCall.toolCall,
				});
			} else if (cachedLastTodoToolCall?.version === previousVersion) {
				const lastTodoOperation = cachedLastTodoToolCall.toolCall
					? this.getByToolCallId(sessionId, cachedLastTodoToolCall.toolCall.id)
					: undefined;
				const patchedLastTodoToolCall =
					lastTodoOperation?.parentOperationId === null
						? resolvePatchedRootToolCall(lastTodoOperation.id)
						: undefined;
				if (patchedLastTodoToolCall !== undefined) {
					this.lastTodoToolCallBySession.set(sessionId, {
						version: nextVersion,
						toolCall: patchedLastTodoToolCall,
					});
				}
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

	private recomputeRootOperationIds(sessionId: string): Array<string> {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		const rootOperationIds: Array<string> = [];
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation?.parentOperationId === null) {
				rootOperationIds.push(operation.id);
			}
		}
		this.sessionRootOperationIds.set(sessionId, rootOperationIds);
		return rootOperationIds;
	}

	private recomputeLastRootOperationId(sessionId: string): string | null {
		const operationIds =
			this.sessionRootOperationIds.get(sessionId) ?? this.recomputeRootOperationIds(sessionId);
		for (let index = operationIds.length - 1; index >= 0; index -= 1) {
			const operationId = operationIds[index];
			const operation = this.operationsById.get(operationId);
			if (operation !== undefined) {
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

	private findRootOperationId(operationId: string): string | null {
		const visited = new Set<string>();
		let currentOperationId: string | null = operationId;
		while (currentOperationId !== null) {
			if (visited.has(currentOperationId)) {
				return null;
			}
			visited.add(currentOperationId);
			const operation = this.operationsById.get(currentOperationId);
			if (operation == null) {
				return null;
			}
			if (operation.parentOperationId === null) {
				return operation.id;
			}
			currentOperationId = operation.parentOperationId;
		}
		return null;
	}

	private getSessionModifiedFileToolCalls(sessionId: string): Array<ToolCall> {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		const materializedRootOperationIds = new Set<string>();
		const toolCalls: Array<ToolCall> = [];
		for (const operationId of operationIds) {
			const rootOperationId = this.findRootOperationId(operationId) ?? operationId;
			if (materializedRootOperationIds.has(rootOperationId)) {
				continue;
			}
			if (
				!operationTreeCanAffectModifiedFiles(
					rootOperationId,
					this.operationsById,
					new Set<string>()
				)
			) {
				continue;
			}
			const toolCall = this.materializeToolCall(rootOperationId, new Set<string>());
			if (toolCall !== null) {
				materializedRootOperationIds.add(rootOperationId);
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

	isToolCallExecuting(sessionId: string, toolCallId: string): boolean {
		const operation = this.getByToolCallId(sessionId, toolCallId);
		if (operation === undefined) {
			return false;
		}

		return (
			operation.operationState === "pending" ||
			operation.operationState === "running" ||
			operation.operationState === "blocked"
		);
	}

	isPermissionRepresentedByToolCall(permission: PermissionRequest, sessionId: string): boolean {
		return isPermissionRepresentedByOperation(permission, sessionId, this);
	}

	getVisiblePermissionsForSessionBar(
		permissions: ReadonlyArray<PermissionRequest>
	): PermissionRequest[] {
		return visiblePermissionsForOperations(permissions, this);
	}
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
					return (start?: number, end?: number) => Array.prototype.slice.call(receiver, start, end);
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

function createAppendedOperationIdArray(
	baseOperationIds: readonly string[],
	appendedOperationId: string
): Array<string> {
	const target = new Array<string>(baseOperationIds.length + 1);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield index === baseOperationIds.length ? appendedOperationId : baseOperationIds[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index === baseOperationIds.length ? appendedOperationId : baseOperationIds[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) => Array.prototype.slice.call(receiver, start, end);
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
					value: index === baseOperationIds.length ? appendedOperationId : baseOperationIds[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	}) as Array<string>;
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
					return (start?: number, end?: number) => Array.prototype.slice.call(receiver, start, end);
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

function patchCachedItemIndex<T extends { readonly id: string }>(
	baseIndexById: ReadonlyMap<string, number>,
	appendedItems: readonly T[] | null,
	baseLength: number
): ReadonlyMap<string, number> {
	if (appendedItems === null || appendedItems.length === 0) {
		return baseIndexById;
	}

	return new AppendedItemIndexMap(baseIndexById, appendedItems, baseLength);
}

class AppendedItemIndexMap<T extends { readonly id: string }>
	implements ReadonlyMap<string, number>
{
	readonly [Symbol.toStringTag] = "AppendedItemIndexMap";

	constructor(
		private readonly base: ReadonlyMap<string, number>,
		private readonly appendedItems: readonly T[],
		private readonly baseLength: number
	) {}

	get size(): number {
		let appendedCount = 0;
		for (const item of this.appendedItems) {
			if (item !== undefined && !this.base.has(item.id)) {
				appendedCount += 1;
			}
		}
		return this.base.size + appendedCount;
	}

	get(key: string): number | undefined {
		for (let index = 0; index < this.appendedItems.length; index += 1) {
			const item = this.appendedItems[index];
			if (item?.id === key) {
				return this.baseLength + index;
			}
		}
		return this.base.get(key);
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	forEach(
		callbackfn: (value: number, key: string, map: ReadonlyMap<string, number>) => void,
		thisArg?: unknown
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	private *entryIterator(): IterableIterator<[string, number]> {
		const appendedKeys = new Set<string>();
		for (let index = 0; index < this.appendedItems.length; index += 1) {
			const item = this.appendedItems[index];
			if (item !== undefined) {
				appendedKeys.add(item.id);
			}
		}
		for (const [key, value] of this.base.entries()) {
			if (!appendedKeys.has(key)) {
				yield [key, value];
			}
		}
		for (let index = 0; index < this.appendedItems.length; index += 1) {
			const item = this.appendedItems[index];
			if (item !== undefined) {
				yield [item.id, this.baseLength + index];
			}
		}
	}

	entries(): MapIterator<[string, number]> {
		return this.entryIterator() as unknown as MapIterator<[string, number]>;
	}

	private *keyIterator(): IterableIterator<string> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	keys(): MapIterator<string> {
		return this.keyIterator() as unknown as MapIterator<string>;
	}

	private *valueIterator(): IterableIterator<number> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	values(): MapIterator<number> {
		return this.valueIterator() as unknown as MapIterator<number>;
	}

	[Symbol.iterator](): MapIterator<[string, number]> {
		return this.entries();
	}
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

function areModifiedFileInputsEquivalent(
	left: Operation,
	right: Operation,
	operationsById: ReadonlyMap<string, Operation>,
	incomingOperationsById: ReadonlyMap<string, Operation>
): boolean {
	return (
		left.toolCallId === right.toolCallId &&
		left.kind === right.kind &&
		areJsonLikeValuesEquivalent(left.arguments, right.arguments) &&
		left.parentOperationId === right.parentOperationId &&
		(areJsonLikeValuesEquivalent(left.childOperationIds, right.childOperationIds) ||
			childOperationChangesCannotAffectModifiedFiles(
				left.childOperationIds,
				right.childOperationIds,
				operationsById,
				incomingOperationsById
			))
	);
}

function operationCanAffectModifiedFiles(operation: Operation): boolean {
	return operation.kind === "edit" || operation.childOperationIds.length > 0;
}

function operationTreeCanAffectModifiedFiles(
	operationId: string,
	operationsById: ReadonlyMap<string, Operation>,
	visited: Set<string>
): boolean {
	if (visited.has(operationId)) {
		return false;
	}
	visited.add(operationId);
	const operation = operationsById.get(operationId);
	if (operation === undefined) {
		return false;
	}
	if (operation.kind === "edit") {
		return true;
	}
	for (const childOperationId of operation.childOperationIds) {
		if (operationTreeCanAffectModifiedFiles(childOperationId, operationsById, visited)) {
			return true;
		}
	}
	return false;
}

function childOperationChangesCannotAffectModifiedFiles(
	leftChildOperationIds: readonly string[],
	rightChildOperationIds: readonly string[],
	operationsById: ReadonlyMap<string, Operation>,
	incomingOperationsById: ReadonlyMap<string, Operation>
): boolean {
	const leftChildOperationIdSet = new Set(leftChildOperationIds);
	const rightChildOperationIdSet = new Set(rightChildOperationIds);
	let changedChildMembership = false;
	for (const childOperationId of leftChildOperationIdSet) {
		if (!rightChildOperationIdSet.has(childOperationId)) {
			changedChildMembership = true;
			if (
				operationIdCanAffectModifiedFiles(childOperationId, operationsById, incomingOperationsById)
			) {
				return false;
			}
		}
	}
	for (const childOperationId of rightChildOperationIdSet) {
		if (!leftChildOperationIdSet.has(childOperationId)) {
			changedChildMembership = true;
			if (
				operationIdCanAffectModifiedFiles(childOperationId, operationsById, incomingOperationsById)
			) {
				return false;
			}
		}
	}
	return changedChildMembership;
}

function operationIdCanAffectModifiedFiles(
	operationId: string,
	operationsById: ReadonlyMap<string, Operation>,
	incomingOperationsById: ReadonlyMap<string, Operation>
): boolean {
	const operation = incomingOperationsById.get(operationId) ?? operationsById.get(operationId);
	return operation === undefined || operationCanAffectModifiedFiles(operation);
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
