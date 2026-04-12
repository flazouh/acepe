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
import type { Operation } from "../../types/operation.js";
import type { ToolCall, ToolCallUpdate } from "../../types/tool-call.js";
import { createLogger } from "../../utils/logger.js";
import { OperationStore } from "../operation-store.svelte.js";
import type { SessionEntry } from "../types.js";
import { isToolCallEntry } from "../types.js";
import type { IEntryIndex } from "./interfaces/entry-index.js";
import type { IEntryStoreInternal } from "./interfaces/entry-store-internal.js";
import type { IToolCallManager } from "./interfaces/tool-call-manager-interface.js";

const logger = createLogger({ id: "tool-call-manager", name: "ToolCallManager" });

type LegacyTextContentBlock = { type: "content"; content: { type: "text"; text: string } };
type ResultContentBlock = ContentBlock | LegacyTextContentBlock;

/**
 * Determine if a tool call entry should be marked as streaming based on its status.
 * Tool calls are streaming when pending or in progress, not streaming when completed or failed.
 */
export function isToolCallStreaming(status: ToolCallStatus | null | undefined): boolean {
	return status === "pending" || status === "in_progress";
}

/**
 * Extract result text from content blocks.
 */
export function extractResultFromContent(
	content: ResultContentBlock[] | null | undefined
): string | null {
	if (!content || !Array.isArray(content) || content.length === 0) {
		return null;
	}

	const textParts: string[] = [];
	for (const block of content) {
		if (block.type === "text") {
			textParts.push(block.text);
			continue;
		}

		if (block.type === "content" && block.content.type === "text") {
			textParts.push(block.content.text);
		}
	}

	return textParts.length > 0 ? textParts.join("\n") : null;
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

function projectOperationToToolCall(
	operation: Operation,
	taskChildren: ToolCall[] | null | undefined
): ToolCall {
	return {
		id: operation.toolCallId,
		name: operation.name,
		rawInput: operation.rawInput,
		arguments: operation.arguments,
		status: operation.status,
		result: operation.result,
		kind: operation.kind,
		title: operation.title,
		locations: operation.locations,
		skillMeta: operation.skillMeta,
		normalizedQuestions: operation.normalizedQuestions,
		normalizedTodos: operation.normalizedTodos,
		parentToolUseId: operation.parentToolCallId,
		taskChildren,
		questionAnswer: operation.questionAnswer,
		awaitingPlanApproval: operation.awaitingPlanApproval,
		planApprovalRequestId: operation.planApprovalRequestId,
		progressiveArguments: operation.progressiveArguments,
		startedAtMs: operation.startedAtMs,
		completedAtMs: operation.completedAtMs,
	};
}

function createIncomingToolCall(
	data: ToolCallData,
	options?: {
		progressiveArguments?: ToolArguments;
		startedAtMs?: number;
		completedAtMs?: number;
		taskChildren?: ToolCall[] | null;
	}
): ToolCall {
	return {
		id: data.id,
		name: data.name,
		rawInput: data.rawInput,
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
		taskChildren: options?.taskChildren ?? data.taskChildren,
		questionAnswer: data.questionAnswer,
		awaitingPlanApproval: data.awaitingPlanApproval,
		planApprovalRequestId: data.planApprovalRequestId,
		progressiveArguments: options?.progressiveArguments,
		startedAtMs: options?.startedAtMs,
		completedAtMs: options?.completedAtMs,
	};
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

			this.ensureOperationTracked(sessionId, entry);
			const existingToolCall = entry.message;
			const nextTaskChildren = data.taskChildren ?? existingToolCall.taskChildren;
			const operation = this.operationStore.upsertFromToolCall(
				sessionId,
				entry.id,
				createIncomingToolCall(data, {
					progressiveArguments: existingToolCall.progressiveArguments,
					startedAtMs: existingToolCall.startedAtMs,
					completedAtMs: existingToolCall.completedAtMs,
					taskChildren: nextTaskChildren,
				})
			);
			const updatedToolCall = projectOperationToToolCall(operation, nextTaskChildren);

			const updatedEntry: SessionEntry = {
				...entry,
				message: updatedToolCall,
				isStreaming: isToolCallStreaming(updatedToolCall.status),
			};

			this.updateToolCallEntryRef(sessionId, existingRef, updatedEntry);

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
		const operation = this.operationStore.upsertFromToolCall(
			sessionId,
			data.id,
			createIncomingToolCall(data)
		);
		const newToolCall = projectOperationToToolCall(operation, data.taskChildren);

		const newEntry: SessionEntry = {
			id: data.id,
			type: "tool_call",
			message: newToolCall,
			timestamp: new Date(operation.startedAtMs ?? Date.now()),
			isStreaming: isToolCallStreaming(data.status),
		};

		this.entryStore.addEntry(sessionId, newEntry);

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

			const operation = this.operationStore.upsertFromToolCallUpdate(
				sessionId,
				update.toolCallId,
				update
			);
			const newToolCall = projectOperationToToolCall(operation, undefined);

			const newEntry: SessionEntry = {
				id: update.toolCallId,
				type: "tool_call",
				message: newToolCall,
				timestamp: new Date(operation.startedAtMs ?? Date.now()),
				isStreaming: isToolCallStreaming(newToolCall.status),
			};

			this.entryStore.addEntry(sessionId, newEntry);
			return ok(undefined);
		}

		const entry = entryRef.entry;
		if (!isToolCallEntry(entry)) {
			logger.warn("Entry is not a tool call", { sessionId, entryId: entry.id });
			return ok(undefined);
		}

		const toolCall = entry.message;
		this.ensureOperationTracked(sessionId, entry);
		const operation = this.operationStore.upsertFromToolCallUpdate(sessionId, entry.id, update);
		const updatedToolCall = projectOperationToToolCall(operation, toolCall.taskChildren);

		// Determine streaming state from status after regression protection
		const updatedEntry: SessionEntry = {
			...entry,
			message: updatedToolCall,
			isStreaming: isToolCallStreaming(updatedToolCall.status),
		};

		this.updateToolCallEntryRef(sessionId, entryRef, updatedEntry);

		// Clean up streaming arguments when tool reaches a terminal status.
		// At this point the entry has authoritative data and streaming args are redundant.
		if (updatedToolCall.status === "completed" || updatedToolCall.status === "failed") {
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

	private ensureOperationTracked(sessionId: string, entry: SessionEntry): void {
		if (!isToolCallEntry(entry)) {
			return;
		}

		const existingOperation = this.operationStore.getByToolCallId(sessionId, entry.message.id);
		if (existingOperation != null) {
			return;
		}

		this.operationStore.upsertFromToolCall(sessionId, entry.id, entry.message);
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
