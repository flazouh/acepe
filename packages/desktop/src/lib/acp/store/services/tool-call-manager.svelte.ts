/**
 * Tool Call Manager - Manages tool call CRUD, child-parent reconciliation,
 * and canonical progressive tool state.
 *
 * Extracted from SessionEntryStore to isolate tool call concerns.
 * All dependencies are injected via interfaces for testability.
 *
 * Note: This file uses native Map/Set for internal indexes that are NOT reactive.
 * Progressive tool arguments live on the tool entry itself; indexes only help locate it.
 */

import { ok, type Result } from "neverthrow";

import type {
	ContentBlock,
	ToolArguments,
	ToolCallData,
	ToolCallStatus,
} from "../../../services/converted-session-types.js";
import type { AppError } from "../../errors/app-error.js";
import type { ToolCall, ToolCallUpdate } from "../../types/tool-call.js";
import { createLogger } from "../../utils/logger.js";
import { OperationStore } from "../operation-store.svelte.js";
import type { SessionEntry } from "../types.js";
import { isToolCallEntry } from "../types.js";
import type { IEntryIndex } from "./interfaces/entry-index.js";
import type { IEntryStoreInternal } from "./interfaces/entry-store-internal.js";
import type { IToolCallManager } from "./interfaces/tool-call-manager-interface.js";

const logger = createLogger({ id: "tool-call-manager", name: "ToolCallManager" });

/**
 * Determine if a tool call entry should be marked as streaming based on its status.
 * Tool calls are streaming when pending or in progress, not streaming when completed or failed.
 */
export function isToolCallStreaming(status: ToolCallStatus | null | undefined): boolean {
	return status === "pending" || status === "in_progress";
}

function isTerminalStatus(status: ToolCallStatus | null | undefined): boolean {
	return status === "completed" || status === "failed";
}

function nowMs(): number {
	return Date.now();
}

/**
 * Prevent status regressions when replayed historical events arrive out-of-order.
 * A terminal tool call should never be downgraded back to pending/in_progress.
 */
function resolveNextStatus(
	currentStatus: ToolCallStatus | null | undefined,
	nextStatus: ToolCallStatus | null | undefined
): ToolCallStatus | null | undefined {
	if (!nextStatus) {
		return currentStatus;
	}

	if (isTerminalStatus(currentStatus) && !isTerminalStatus(nextStatus)) {
		return currentStatus;
	}

	return nextStatus;
}

/**
 * Extract result text from content blocks.
 */
export function extractResultFromContent(
	content: ContentBlock[] | null | undefined
): string | null {
	if (!content || !Array.isArray(content) || content.length === 0) {
		return null;
	}

	const textParts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object") {
			const anyBlock = block as Record<string, unknown>;
			if (anyBlock.type === "content" && anyBlock.content) {
				const innerContent = anyBlock.content as Record<string, unknown>;
				if (innerContent.type === "text" && typeof innerContent.text === "string") {
					textParts.push(innerContent.text);
				}
			} else if (block.type === "text" && "text" in block) {
				textParts.push(block.text);
			}
		}
	}

	return textParts.length > 0 ? textParts.join("\n") : null;
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

function mergeToolArguments(currentArgs: ToolArguments, nextArgs: ToolArguments): ToolArguments {
	if (currentArgs.kind === "edit" && nextArgs.kind === "edit") {
		return {
			kind: "edit",
			edits: mergeEditEntries(currentArgs.edits, nextArgs.edits),
		};
	}

	return nextArgs;
}

function hasMaterializedToolUpdateFields(update: ToolCallUpdate): boolean {
	return (
		update.status != null ||
		update.result != null ||
		update.content != null ||
		update.rawOutput != null ||
		update.title != null ||
		update.locations != null ||
		update.arguments != null ||
		update.normalizedTodos != null ||
		update.normalizedQuestions != null ||
		update.failureReason != null
	);
}

function isStreamingOnlyToolUpdate(update: ToolCallUpdate): boolean {
	const hasStreamingFields =
		update.streamingArguments != null || update.streamingInputDelta != null;
	return hasStreamingFields && !hasMaterializedToolUpdateFields(update);
}

export class ToolCallManager implements IToolCallManager {
	// Track which tool call IDs belong to which session (for cleanup on clearSession)
	private sessionToolCallIds = new Map<string, Set<string>>();

	// Tool call ID -> session ID index for fast progressive-argument lookup.
	private toolCallSessionIndex = new Map<string, string>();

	// Child-to-parent index for O(1) lookup when updating children
	private childToParentIndex = new Map<string, { sessionId: string; parentId: string }>();

	// Memory safety: limit tracked sessions for streaming cleanup
	private static readonly MAX_SESSIONS = 100;

	constructor(
		private readonly entryStore: IEntryStoreInternal,
		private readonly entryIndex: IEntryIndex,
		private readonly operationStore: OperationStore = new OperationStore()
	) {}

	private rememberToolCallSession(
		sessionId: string,
		toolCallId: string,
		options?: { enforceSessionLimit?: boolean }
	): boolean {
		let toolCallIds = this.sessionToolCallIds.get(sessionId);
		if (!toolCallIds) {
			if (
				options?.enforceSessionLimit === true &&
				this.sessionToolCallIds.size >= ToolCallManager.MAX_SESSIONS
			) {
				logger.warn("Session limit exceeded, dropping streaming arguments", {
					sessionId,
					toolCallId,
					maxSessions: ToolCallManager.MAX_SESSIONS,
				});
				return false;
			}
			toolCallIds = new Set();
			this.sessionToolCallIds.set(sessionId, toolCallIds);
		}

		toolCallIds.add(toolCallId);
		this.toolCallSessionIndex.set(toolCallId, sessionId);
		return true;
	}

	// ============================================
	// TOOL CALL CRUD
	// ============================================

	/**
	 * Create a new tool call entry from full ToolCallData.
	 * Backend handles parent-child reconciliation via TaskReconciler -
	 * taskChildren are already assembled when we receive the data.
	 */
	createEntry(sessionId: string, data: ToolCallData): Result<void, AppError> {
		this.rememberToolCallSession(sessionId, data.id);

		// NOTE: Do NOT clear streaming arguments here.
		// Streaming args are cleaned up in updateEntry() on terminal status instead.

		const existingRef = this.findToolCallEntryRef(sessionId, data.id);

		if (existingRef) {
			// Tool call already exists - update it with incoming data
			const entry = existingRef.entry;
			if (!isToolCallEntry(entry)) return ok(undefined);

			const existingToolCall = entry.message;
			const nextStatus = resolveNextStatus(existingToolCall.status, data.status);
			const startedAtMs = existingToolCall.startedAtMs ?? entry.timestamp?.getTime() ?? nowMs();
			const completedAtMs =
				existingToolCall.completedAtMs ??
				(isTerminalStatus(nextStatus ?? data.status) ? nowMs() : undefined);
			const shouldPromoteTaskToQuestion =
				existingToolCall.kind === "task" &&
				data.kind === "question" &&
				(data.normalizedQuestions?.length ?? 0) > 0;
			const shouldUpgradeGenericKind =
				(existingToolCall.kind === undefined || existingToolCall.kind === "other") &&
				data.kind !== undefined &&
				data.kind !== "other";
			const nextKind = shouldPromoteTaskToQuestion
				? data.kind
				: shouldUpgradeGenericKind
					? data.kind
					: (existingToolCall.kind ?? data.kind);
			if (
				existingToolCall.kind !== data.kind &&
				(existingToolCall.kind === "other" || data.kind === "skill")
			) {
				logger.warn("Reconciling tool kind on existing entry", {
					sessionId,
					toolCallId: data.id,
					existingKind: existingToolCall.kind,
					incomingKind: data.kind,
					resolvedKind: nextKind,
					shouldPromoteTaskToQuestion,
					shouldUpgradeGenericKind,
					existingArgumentsKind: existingToolCall.arguments.kind,
					incomingArgumentsKind: data.arguments.kind,
					title: data.title ?? existingToolCall.title,
					name: data.name,
				});
			}
			const nextAwaitingPlanApproval = data.awaitingPlanApproval;
			const nextPlanApprovalRequestId = nextAwaitingPlanApproval
				? (data.planApprovalRequestId ?? existingToolCall.planApprovalRequestId)
				: null;
			const nextProgressiveArguments = isTerminalStatus(nextStatus ?? data.status)
				? undefined
				: existingToolCall.progressiveArguments;
			const updatedToolCall: ToolCall = {
				...existingToolCall,
				name: data.name,
				arguments: mergeToolArguments(existingToolCall.arguments, data.arguments),
				rawInput: data.rawInput ?? existingToolCall.rawInput,
				status: nextStatus ?? existingToolCall.status,
				result: data.result ?? existingToolCall.result,
				kind: nextKind,
				title: data.title ?? existingToolCall.title,
				locations: data.locations ?? existingToolCall.locations,
				skillMeta: data.skillMeta ?? existingToolCall.skillMeta,
				normalizedQuestions: data.normalizedQuestions ?? existingToolCall.normalizedQuestions,
				normalizedTodos: data.normalizedTodos ?? existingToolCall.normalizedTodos,
				parentToolUseId: data.parentToolUseId ?? existingToolCall.parentToolUseId,
				// Backend sends pre-assembled taskChildren - use incoming if present, else keep existing
				taskChildren: data.taskChildren ?? existingToolCall.taskChildren,
				questionAnswer: data.questionAnswer ?? existingToolCall.questionAnswer,
				awaitingPlanApproval: nextAwaitingPlanApproval,
				planApprovalRequestId: nextPlanApprovalRequestId,
				progressiveArguments: nextProgressiveArguments,
				startedAtMs,
				completedAtMs,
			};

			const updatedEntry: SessionEntry = {
				...entry,
				message: updatedToolCall,
				isStreaming: isToolCallStreaming(nextStatus),
			};

			this.updateToolCallEntryRef(sessionId, existingRef, updatedEntry);
			this.operationStore.upsertFromToolCall(sessionId, updatedEntry.id, updatedToolCall);

			// Re-index children in case taskChildren was added/updated
			this.indexTaskChildren(sessionId, data.id, data.taskChildren);

			logger.debug("Updated existing tool call with full data", {
				sessionId,
				toolCallId: data.id,
				name: data.name,
			});
			return ok(undefined);
		}

		// Create new tool call entry - taskChildren already assembled by backend
		const createdAtMs = nowMs();
		const newToolCall: ToolCall = {
			id: data.id,
			name: data.name,
			arguments: data.arguments,
			status: data.status,
			result: data.result,
			kind: data.kind,
			title: data.title,
			locations: data.locations,
			skillMeta: data.skillMeta,
			normalizedQuestions: data.normalizedQuestions,
			normalizedTodos: data.normalizedTodos,
			parentToolUseId: data.parentToolUseId,
			taskChildren: data.taskChildren,
			awaitingPlanApproval: data.awaitingPlanApproval,
			planApprovalRequestId: data.planApprovalRequestId,
			questionAnswer: data.questionAnswer,
			progressiveArguments: undefined,
			startedAtMs: createdAtMs,
			completedAtMs: isTerminalStatus(data.status) ? createdAtMs : undefined,
		};

		const newEntry: SessionEntry = {
			id: data.id,
			type: "tool_call",
			message: newToolCall,
			timestamp: new Date(createdAtMs),
			isStreaming: isToolCallStreaming(data.status),
		};

		this.entryStore.addEntry(sessionId, newEntry);
		this.operationStore.upsertFromToolCall(sessionId, newEntry.id, newToolCall);

		// Index children for O(1) lookup during child updates
		this.indexTaskChildren(sessionId, data.id, data.taskChildren);

		logger.debug("Created tool call entry from full data", {
			sessionId,
			toolCallId: data.id,
			name: data.name,
			kind: data.kind,
		});
		return ok(undefined);
	}

	/**
	 * Update tool call entry.
	 * Backend handles child-to-parent updates via TaskReconciler.
	 */
	updateEntry(sessionId: string, update: ToolCallUpdate): Result<void, AppError> {
		this.rememberToolCallSession(sessionId, update.toolCallId);

		// Extract result from update.result, update.rawOutput, or content (as fallback)
		const extractedResult =
			update.result ?? update.rawOutput ?? extractResultFromContent(update.content);

		const entryRef = this.findToolCallEntryRef(sessionId, update.toolCallId);

		if (!entryRef) {
			if (isStreamingOnlyToolUpdate(update)) {
				logger.debug("Ignoring streaming-only tool update without canonical entry", {
					sessionId,
					toolCallId: update.toolCallId,
				});
				return ok(undefined);
			}

			// Entry doesn't exist yet - create it
			logger.debug("Creating tool call entry from update", {
				sessionId,
				toolCallId: update.toolCallId,
			});

			const createdAtMs = nowMs();
			const newToolCall: ToolCall = {
				id: update.toolCallId,
				name: "Tool",
				arguments: update.arguments ?? { kind: "other", raw: {} },
				status: update.status ?? "pending",
				result: extractedResult,
				title: update.title,
				locations: update.locations,
				normalizedTodos: update.normalizedTodos,
				normalizedQuestions: update.normalizedQuestions,
				awaitingPlanApproval: false,
				progressiveArguments: update.streamingArguments ?? undefined,
				startedAtMs: createdAtMs,
				completedAtMs: isTerminalStatus(update.status) ? createdAtMs : undefined,
			};

			const newEntry: SessionEntry = {
				id: update.toolCallId,
				type: "tool_call",
				message: newToolCall,
				timestamp: new Date(createdAtMs),
				isStreaming: isToolCallStreaming(update.status),
			};

			this.entryStore.addEntry(sessionId, newEntry);
			this.operationStore.upsertFromToolCall(sessionId, newEntry.id, newToolCall);
			return ok(undefined);
		}

		const entry = entryRef.entry;
		if (!isToolCallEntry(entry)) {
			logger.warn("Entry is not a tool call", { sessionId, entryId: entry.id });
			return ok(undefined);
		}

		const toolCall = entry.message;

		// Determine the result to use:
		// - If extractedResult is null, keep existing toolCall.result
		// - If toolCall.result is a structured object (e.g., {numFiles: 4}) and extractedResult
		//   is just a string (text from content), preserve the structured result
		// - Otherwise, use extractedResult
		const isStructuredResult =
			toolCall.result !== null &&
			typeof toolCall.result === "object" &&
			!Array.isArray(toolCall.result);
		const isTextExtracted = typeof extractedResult === "string";
		const shouldPreserveStructuredResult = isStructuredResult && isTextExtracted;
		const incomingStatus = update.status ?? toolCall.status;
		const newStatus = resolveNextStatus(toolCall.status, incomingStatus);
		const startedAtMs = toolCall.startedAtMs ?? entry.timestamp?.getTime() ?? nowMs();
		const completedAtMs =
			toolCall.completedAtMs ?? (isTerminalStatus(newStatus) ? nowMs() : undefined);
		const rawNextArguments = update.arguments ?? update.streamingArguments ?? toolCall.arguments;
		const nextArguments =
			rawNextArguments === toolCall.arguments
				? toolCall.arguments
				: mergeToolArguments(toolCall.arguments, rawNextArguments);
		const nextProgressiveArguments = isTerminalStatus(newStatus)
			? undefined
			: (update.arguments ?? null) != null
				? undefined
				: (update.streamingArguments ?? toolCall.progressiveArguments);

		const updatedToolCall: ToolCall = {
			...toolCall,
			status: newStatus ?? toolCall.status,
			result: shouldPreserveStructuredResult
				? toolCall.result
				: (extractedResult ?? toolCall.result),
			title: update.title ?? toolCall.title,
			locations: update.locations ?? toolCall.locations,
			arguments: nextArguments,
			// Progressive normalized data from streaming accumulator
			normalizedTodos: update.normalizedTodos ?? toolCall.normalizedTodos,
			normalizedQuestions: update.normalizedQuestions ?? toolCall.normalizedQuestions,
			progressiveArguments: nextProgressiveArguments,
			startedAtMs,
			completedAtMs,
		};

		// Determine streaming state from status after regression protection
		const updatedEntry: SessionEntry = {
			...entry,
			message: updatedToolCall,
			isStreaming: isToolCallStreaming(newStatus),
		};

		this.updateToolCallEntryRef(sessionId, entryRef, updatedEntry);
		this.operationStore.upsertFromToolCall(sessionId, updatedEntry.id, updatedToolCall);

		// Clean up streaming arguments when tool reaches a terminal status.
		// At this point the entry has authoritative data and streaming args are redundant.
		if (newStatus === "completed" || newStatus === "failed") {
			this.clearStreamingArguments(update.toolCallId);
		}

		return ok(undefined);
	}

	// ============================================
	// STREAMING ARGUMENTS (read/cleanup over canonical entry state)
	// ============================================

	/**
	 * Get the streaming arguments for a tool call.
	 */
	getStreamingArguments(toolCallId: string): ToolArguments | undefined {
		const sessionId = this.toolCallSessionIndex.get(toolCallId);
		if (!sessionId) {
			return undefined;
		}

		const entryRef = this.findToolCallEntryRef(sessionId, toolCallId);
		if (entryRef && isToolCallEntry(entryRef.entry)) {
			return entryRef.entry.message.progressiveArguments;
		}

		const parentInfo = this.childToParentIndex.get(toolCallId);
		if (!parentInfo || parentInfo.sessionId !== sessionId) {
			return undefined;
		}

		const parentRef = this.findToolCallEntryRef(sessionId, parentInfo.parentId);
		if (!parentRef || !isToolCallEntry(parentRef.entry) || !parentRef.entry.message.taskChildren) {
			return undefined;
		}

		return parentRef.entry.message.taskChildren.find((child) => child.id === toolCallId)
			?.progressiveArguments;
	}

	/**
	 * Clear streaming arguments for a tool call.
	 */
	clearStreamingArguments(toolCallId: string): void {
		const sessionId = this.toolCallSessionIndex.get(toolCallId);
		if (!sessionId) {
			return;
		}

		const entryRef = this.findToolCallEntryRef(sessionId, toolCallId);
		if (entryRef && isToolCallEntry(entryRef.entry)) {
			if (entryRef.entry.message.progressiveArguments === undefined) {
				return;
			}

			const updatedEntry: SessionEntry = {
				...entryRef.entry,
				message: {
					...entryRef.entry.message,
					progressiveArguments: undefined,
				},
			};

			this.updateToolCallEntryRef(sessionId, entryRef, updatedEntry);
			return;
		}

		const parentInfo = this.childToParentIndex.get(toolCallId);
		if (!parentInfo || parentInfo.sessionId !== sessionId) {
			return;
		}

		const parentRef = this.findToolCallEntryRef(sessionId, parentInfo.parentId);
		if (!parentRef || !isToolCallEntry(parentRef.entry) || !parentRef.entry.message.taskChildren) {
			return;
		}

		const updatedChildren = parentRef.entry.message.taskChildren.map((child) =>
			child.id === toolCallId && child.progressiveArguments !== undefined
				? {
						...child,
						progressiveArguments: undefined,
					}
				: child
		);

		const updatedParent: ToolCall = {
			...parentRef.entry.message,
			taskChildren: updatedChildren,
		};
		const updatedEntry: SessionEntry = {
			...parentRef.entry,
			message: updatedParent,
		};

		this.updateToolCallEntryRef(sessionId, parentRef, updatedEntry);
	}

	/**
	 * Get tool call IDs for a session.
	 */
	getToolCallIdsForSession(sessionId: string): ReadonlySet<string> {
		return this.sessionToolCallIds.get(sessionId) ?? new Set<string>();
	}

	/**
	 * Clear all state for a session.
	 */
	clearSession(sessionId: string): void {
		const toolCallIds = this.sessionToolCallIds.get(sessionId);
		if (toolCallIds) {
			for (const toolCallId of toolCallIds) {
				this.toolCallSessionIndex.delete(toolCallId);
				this.childToParentIndex.delete(toolCallId);
			}
			this.sessionToolCallIds.delete(sessionId);
		}
	}

	// ============================================
	// PRIVATE HELPERS
	// ============================================

	/**
	 * Find a tool call entry by ID using O(1) index lookup.
	 * Falls back to linear search if index is stale.
	 */
	private findToolCallEntryRef(
		sessionId: string,
		toolCallId: string
	): { entry: SessionEntry; index: number } | null {
		// O(1) lookup using toolCallId index (mirrors messageIdIndex pattern)
		const index = this.entryIndex.getToolCallIdIndex(sessionId, toolCallId);
		if (index !== undefined) {
			const entries = this.entryStore.getEntries(sessionId);
			const entry = entries[index];
			// Verify the entry still matches (defensive check)
			if (entry && isToolCallEntry(entry) && entry.message.id === toolCallId) {
				return { entry, index };
			}
		}

		// Fallback: linear search (index may be stale after addEntry)
		const entries = this.entryStore.getEntries(sessionId);
		const fallbackIndex = entries.findIndex(
			(entry) => isToolCallEntry(entry) && entry.message.id === toolCallId
		);
		if (fallbackIndex !== -1) {
			return { entry: entries[fallbackIndex], index: fallbackIndex };
		}

		return null;
	}

	/**
	 * Write an updated entry back to the store.
	 */
	private updateToolCallEntryRef(
		sessionId: string,
		ref: { entry: SessionEntry; index: number },
		updatedEntry: SessionEntry
	): void {
		this.entryStore.updateEntry(sessionId, ref.index, updatedEntry);
	}

	/**
	 * Index task children for O(1) lookup during child updates.
	 */
	private indexTaskChildren(
		sessionId: string,
		parentId: string,
		taskChildren: ToolCallData[] | null | undefined
	): void {
		if (!taskChildren) return;

		for (const child of taskChildren) {
			this.rememberToolCallSession(sessionId, child.id);
			this.childToParentIndex.set(child.id, { sessionId, parentId });
		}
	}
}
