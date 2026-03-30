/**
 * Tool Call Manager - Manages tool call CRUD, child-parent reconciliation,
 * and streaming argument storage.
 *
 * Extracted from SessionEntryStore to isolate tool call concerns.
 * All dependencies are injected via interfaces for testability.
 *
 * Note: This file uses native Map/Set for internal indexes that are NOT reactive.
 * Only streamingArgumentsParsed uses SvelteMap for fine-grained reactivity.
 */

import { ok, type Result } from "neverthrow";
import { SvelteMap } from "svelte/reactivity";

import type {
	ContentBlock,
	ToolArguments,
	ToolCallData,
	ToolCallStatus,
} from "../../../services/converted-session-types.js";
import type { AppError } from "../../errors/app-error.js";
import type { ToolCall, ToolCallUpdate } from "../../types/tool-call.js";
import { createLogger } from "../../utils/logger.js";
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

function areToolArgumentsEqual(
	currentArgs: ToolArguments | undefined,
	nextArgs: ToolArguments
): boolean {
	if (currentArgs === undefined) {
		return false;
	}
	if (currentArgs.kind !== nextArgs.kind) {
		return false;
	}

	switch (currentArgs.kind) {
		case "read":
			return nextArgs.kind === "read" && currentArgs.file_path === nextArgs.file_path;
		case "edit":
			return (
				nextArgs.kind === "edit" &&
				JSON.stringify(currentArgs.edits) === JSON.stringify(nextArgs.edits)
			);
		case "execute":
			return nextArgs.kind === "execute" && currentArgs.command === nextArgs.command;
		case "search":
			return (
				nextArgs.kind === "search" &&
				currentArgs.query === nextArgs.query &&
				currentArgs.file_path === nextArgs.file_path
			);
		case "glob":
			return (
				nextArgs.kind === "glob" &&
				currentArgs.pattern === nextArgs.pattern &&
				currentArgs.path === nextArgs.path
			);
		case "fetch":
			return nextArgs.kind === "fetch" && currentArgs.url === nextArgs.url;
		case "webSearch":
			return nextArgs.kind === "webSearch" && currentArgs.query === nextArgs.query;
		case "think":
			return (
				nextArgs.kind === "think" &&
				currentArgs.description === nextArgs.description &&
				currentArgs.prompt === nextArgs.prompt &&
				currentArgs.subagent_type === nextArgs.subagent_type &&
				currentArgs.skill === nextArgs.skill &&
				currentArgs.skill_args === nextArgs.skill_args &&
				JSON.stringify(currentArgs.raw ?? null) === JSON.stringify(nextArgs.raw ?? null)
			);
		case "taskOutput":
			return (
				nextArgs.kind === "taskOutput" &&
				currentArgs.task_id === nextArgs.task_id &&
				currentArgs.timeout === nextArgs.timeout
			);
		case "move":
			return (
				nextArgs.kind === "move" &&
				currentArgs.from === nextArgs.from &&
				currentArgs.to === nextArgs.to
			);
		case "delete":
			return nextArgs.kind === "delete" && currentArgs.file_path === nextArgs.file_path;
		case "planMode":
			return nextArgs.kind === "planMode" && currentArgs.mode === nextArgs.mode;
		case "toolSearch":
			return (
				nextArgs.kind === "toolSearch" &&
				currentArgs.query === nextArgs.query &&
				currentArgs.max_results === nextArgs.max_results
			);
		case "other":
			return (
				nextArgs.kind === "other" &&
				JSON.stringify(currentArgs.raw) === JSON.stringify(nextArgs.raw)
			);
	}
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

function extractPathFromToolArguments(
	toolArguments: ToolArguments | null | undefined
): string | null {
	if (!toolArguments) return null;

	switch (toolArguments.kind) {
		case "read":
		case "delete":
			return toolArguments.file_path ?? null;
		case "edit":
			return toolArguments.edits[0]?.filePath ?? null;
		case "search":
			return toolArguments.file_path ?? null;
		case "glob":
			return toolArguments.path ?? null;
		default:
			return null;
	}
}

function extractPathFromLocations(
	locations: ToolCall["locations"] | ToolCallUpdate["locations"] | null | undefined
): string | null {
	return locations?.[0]?.path ?? null;
}

function isGenericPathTitle(title: string | null | undefined): boolean {
	if (!title) return false;
	const trimmed = title.trim();
	return (
		trimmed === "Read File" ||
		trimmed === "Edit File" ||
		trimmed === "Delete File" ||
		trimmed === "View Image"
	);
}

function synthesizeToolTitle(toolArguments: ToolArguments, path: string): string | null {
	switch (toolArguments.kind) {
		case "read":
			return `Read ${path}`;
		case "edit":
			return `Edit ${path}`;
		case "delete":
			return `Delete ${path}`;
		default:
			return null;
	}
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

export class ToolCallManager implements IToolCallManager {
	// Track which tool call IDs belong to which session (for cleanup on clearSession)
	private sessionToolCallIds = new Map<string, Set<string>>();

	// Parsed streaming arguments from Rust (pre-parsed ToolArguments)
	// Uses SvelteMap for fine-grained reactivity
	private streamingArgumentsParsed = new SvelteMap<string, ToolArguments>();

	// Child-to-parent index for O(1) lookup when updating children
	private childToParentIndex = new Map<string, { sessionId: string; parentId: string }>();

	// Memory safety: limit tracked sessions for streaming cleanup
	private static readonly MAX_SESSIONS = 100;

	constructor(
		private readonly entryStore: IEntryStoreInternal,
		private readonly entryIndex: IEntryIndex
	) {}

	// ============================================
	// TOOL CALL CRUD
	// ============================================

	/**
	 * Create a new tool call entry from full ToolCallData.
	 * Backend handles parent-child reconciliation via TaskReconciler -
	 * taskChildren are already assembled when we receive the data.
	 */
	createEntry(sessionId: string, data: ToolCallData): Result<void, AppError> {
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
			const nextKind =
				existingToolCall.kind === "task" &&
				data.kind === "question" &&
				(data.normalizedQuestions?.length ?? 0) > 0
					? data.kind
					: (existingToolCall.kind ?? data.kind);
			const updatedToolCall: ToolCall = {
				...existingToolCall,
				name: data.name,
				arguments: mergeToolArguments(existingToolCall.arguments, data.arguments),
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
				awaitingPlanApproval: data.awaitingPlanApproval || existingToolCall.awaitingPlanApproval,
				planApprovalRequestId: data.planApprovalRequestId ?? existingToolCall.planApprovalRequestId,
				startedAtMs,
				completedAtMs,
			};

			const updatedEntry: SessionEntry = {
				...entry,
				message: updatedToolCall,
				isStreaming: isToolCallStreaming(nextStatus),
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
		// Extract result from update.result, update.rawOutput, or content (as fallback)
		const extractedResult =
			update.result ?? update.rawOutput ?? extractResultFromContent(update.content);

		const entryRef = this.findToolCallEntryRef(sessionId, update.toolCallId);

		if (!entryRef) {
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
		const pathFromArguments = extractPathFromToolArguments(nextArguments);
		const pathFromLocations = extractPathFromLocations(update.locations ?? toolCall.locations);
		const resolvedPath = pathFromArguments ?? pathFromLocations;
		const synthesizedTitle =
			update.title == null && isGenericPathTitle(toolCall.title) && resolvedPath != null
				? synthesizeToolTitle(nextArguments, resolvedPath)
				: null;
		const nextLocations =
			update.locations ??
			toolCall.locations ??
			(resolvedPath != null ? [{ path: resolvedPath }] : undefined);

		const updatedToolCall: ToolCall = {
			...toolCall,
			status: newStatus ?? toolCall.status,
			result: shouldPreserveStructuredResult
				? toolCall.result
				: (extractedResult ?? toolCall.result),
			title: update.title ?? synthesizedTitle ?? toolCall.title,
			locations: nextLocations,
			arguments: nextArguments,
			// Progressive normalized data from streaming accumulator
			normalizedTodos: update.normalizedTodos ?? toolCall.normalizedTodos,
			normalizedQuestions: update.normalizedQuestions ?? toolCall.normalizedQuestions,
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

		// Clean up streaming arguments when tool reaches a terminal status.
		// At this point the entry has authoritative data and streaming args are redundant.
		if (newStatus === "completed" || newStatus === "failed") {
			this.clearStreamingArguments(update.toolCallId);
		}

		return ok(undefined);
	}

	/**
	 * Update a child tool call within its parent's taskChildren array.
	 * Uses O(1) child-to-parent index for fast lookup.
	 * Falls back to regular updateEntry if child-parent relationship is unknown.
	 */
	updateChildInParent(sessionId: string, childUpdate: ToolCallUpdate): Result<void, AppError> {
		const parentInfo = this.childToParentIndex.get(childUpdate.toolCallId);

		if (!parentInfo) {
			// Not a known child - treat as regular update
			logger.debug("Child not indexed, falling back to regular update", {
				sessionId,
				toolCallId: childUpdate.toolCallId,
			});
			return this.updateEntry(sessionId, childUpdate);
		}

		// Verify session matches
		if (parentInfo.sessionId !== sessionId) {
			logger.warn("Session mismatch for child update", {
				expectedSession: parentInfo.sessionId,
				receivedSession: sessionId,
				toolCallId: childUpdate.toolCallId,
			});
			return this.updateEntry(sessionId, childUpdate);
		}

		const parentRef = this.findToolCallEntryRef(sessionId, parentInfo.parentId);
		if (!parentRef) {
			logger.warn("Parent not found for child update", {
				sessionId,
				parentId: parentInfo.parentId,
				childId: childUpdate.toolCallId,
			});
			return this.updateEntry(sessionId, childUpdate);
		}

		if (!isToolCallEntry(parentRef.entry)) {
			logger.warn("Parent entry is not a tool_call", {
				sessionId,
				parentId: parentInfo.parentId,
			});
			return ok(undefined);
		}

		const parent = parentRef.entry.message;
		if (!parent.taskChildren) {
			logger.warn("Parent has no taskChildren", {
				sessionId,
				parentId: parentInfo.parentId,
				childId: childUpdate.toolCallId,
			});
			return ok(undefined);
		}

		// Extract result from update
		const extractedResult =
			childUpdate.result ?? childUpdate.rawOutput ?? extractResultFromContent(childUpdate.content);

		// Update specific child in parent's taskChildren
		const updatedChildren = parent.taskChildren.map((child) => {
			if (child.id !== childUpdate.toolCallId) return child;
			const incomingStatus = childUpdate.status ?? child.status;
			const nextStatus = resolveNextStatus(child.status, incomingStatus);
			const nextArguments =
				childUpdate.arguments ?? childUpdate.streamingArguments ?? child.arguments;
			const mergedArguments =
				nextArguments === child.arguments
					? child.arguments
					: mergeToolArguments(child.arguments, nextArguments);
			return {
				...child,
				status: nextStatus ?? child.status,
				result: extractedResult ?? child.result,
				title: childUpdate.title ?? child.title,
				locations: childUpdate.locations ?? child.locations,
				arguments: mergedArguments,
			};
		});

		const updatedParent: ToolCall = { ...parent, taskChildren: updatedChildren };
		const updatedEntry: SessionEntry = {
			...parentRef.entry,
			message: updatedParent,
		};

		this.updateToolCallEntryRef(sessionId, parentRef, updatedEntry);
		logger.debug("Updated child in parent taskChildren", {
			sessionId,
			parentId: parentInfo.parentId,
			childId: childUpdate.toolCallId,
			status: childUpdate.status,
		});
		return ok(undefined);
	}

	// ============================================
	// STREAMING ARGUMENTS (parsed by Rust, stored here for progressive UI)
	// ============================================

	/**
	 * Store pre-parsed streaming arguments from Rust.
	 */
	setStreamingArguments(sessionId: string, toolCallId: string, args: ToolArguments): void {
		let toolCallIds = this.sessionToolCallIds.get(sessionId);
		if (!toolCallIds) {
			if (this.sessionToolCallIds.size >= ToolCallManager.MAX_SESSIONS) {
				logger.warn("Session limit exceeded, dropping streaming arguments", {
					sessionId,
					toolCallId,
					maxSessions: ToolCallManager.MAX_SESSIONS,
				});
				return;
			}
			toolCallIds = new Set();
			this.sessionToolCallIds.set(sessionId, toolCallIds);
		}
		toolCallIds.add(toolCallId);

		const existingArgs = this.streamingArgumentsParsed.get(toolCallId);
		if (areToolArgumentsEqual(existingArgs, args)) {
			return;
		}

		this.streamingArgumentsParsed.set(toolCallId, args);
	}

	/**
	 * Get the streaming arguments for a tool call.
	 */
	getStreamingArguments(toolCallId: string): ToolArguments | undefined {
		return this.streamingArgumentsParsed.get(toolCallId);
	}

	/**
	 * Clear streaming arguments for a tool call.
	 */
	clearStreamingArguments(toolCallId: string): void {
		this.streamingArgumentsParsed.delete(toolCallId);
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
				this.streamingArgumentsParsed.delete(toolCallId);
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
			this.childToParentIndex.set(child.id, { sessionId, parentId });
		}
	}
}
