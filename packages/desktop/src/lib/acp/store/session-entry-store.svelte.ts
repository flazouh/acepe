/**
 * Session Entry Store - Manages conversation entries with synchronous mutations.
 *
 * Handles:
 * - Entry storage and retrieval (IEntryStoreInternal)
 * - Synchronous entry mutations for immediate UI updates
 *
 * Delegates to extracted managers:
 * - TranscriptToolCallBuffer: tool call CRUD, child-parent reconciliation, streaming args
 * - EntryIndexManager: O(1) entryId and toolCallId lookups
 *
 * Note: This file uses native Map/Set/Date for internal indexes and timestamps
 * that are NOT meant to be reactive. Only entriesById uses SvelteMap for
 * fine-grained reactivity. Streaming arguments reactivity is in TranscriptToolCallBuffer.
 */

import { SvelteMap } from "svelte/reactivity";
import type { TranscriptDelta, TranscriptSnapshot } from "../../services/acp-types.js";
import type { ToolCallData } from "../../services/converted-session-types.js";
import { resolveTranscriptToolCallCreate } from "../session-state/session-state-query-service.js";
import type { ToolCall, ToolCallUpdate } from "../types/tool-call.js";
import { createLogger } from "../utils/logger.js";
import { OperationStore } from "./operation-store.svelte.js";
import { EntryIndexManager } from "./services/entry-index-manager";
import type { IEntryStoreInternal, ToolCallEntryRef } from "./services/interfaces/entry-store-internal.js";
import type { IEntryManager } from "./services/interfaces/index.js";
import { normalizeToolResult } from "./services/tool-result-normalizer.js";
import {
	appendTranscriptSegmentToSessionEntry,
	convertTranscriptEntryToSessionEntry,
	convertTranscriptSnapshotToSessionEntries,
} from "./services/transcript-snapshot-entry-adapter.js";
import { TranscriptToolCallBuffer } from "./services/transcript-tool-call-buffer.svelte.js";
import type { SessionEntry } from "./types.js";
import { isToolCallEntry } from "./types.js";

const logger = createLogger({ id: "session-entry-store", name: "SessionEntryStore" });

/**
 * Store for managing session entries with O(1) chunk aggregation.
 * Implements IEntryManager for external consumers and IEntryStoreInternal
 * for extracted services (TranscriptToolCallBuffer) to read/write entries.
 *
 * Uses SvelteMap for fine-grained reactivity: when session A's entries change,
 * only components reading session A re-render, not components reading session B.
 */
export class SessionEntryStore implements IEntryManager, IEntryStoreInternal {
	private readonly operationStore: OperationStore;

	// Entries stored with SvelteMap for fine-grained per-session reactivity
	// Only components reading a specific session re-render when that session changes
	private entriesById = new SvelteMap<string, SessionEntry[]>();

	// Extracted index manager for O(1) entryId and toolCallId lookups
	private readonly entryIndex = new EntryIndexManager();

	// Transcript-only tool row buffer; product operation state lives in OperationStore.
	private readonly transcriptToolCallBuffer: TranscriptToolCallBuffer;

	// Track which sessions have been preloaded
	private preloadedIds = new Set<string>();
	private readonly transcriptRevisionBySession = new Map<string, number>();

	constructor(operationStore?: OperationStore) {
		this.operationStore = operationStore ?? new OperationStore();
		this.transcriptToolCallBuffer = new TranscriptToolCallBuffer(this, this.entryIndex);
	}

	// ============================================
	// IEntryStoreInternal (consumed by TranscriptToolCallBuffer)
	// ============================================

	/** Check if a session exists in committed or preloaded state. */
	hasSession(sessionId: string): boolean {
		return this.entriesById.has(sessionId) || this.preloadedIds.has(sessionId);
	}

	// ============================================
	// ENTRY ACCESS
	// ============================================

	findToolCallEntryRef(sessionId: string, toolCallId: string): ToolCallEntryRef | null {
		const entries = this.entriesById.get(sessionId) ?? [];
		const indexedPosition = this.entryIndex.getToolCallIdIndex(sessionId, toolCallId);
		if (indexedPosition !== undefined) {
			const indexedEntry = entries[indexedPosition];
			if (isToolCallEntry(indexedEntry) && indexedEntry.message.id === toolCallId) {
				return { entry: indexedEntry, index: indexedPosition };
			}
		}

		const fallbackIndex = entries.findIndex(
			(entry) => isToolCallEntry(entry) && entry.message.id === toolCallId
		);
		if (fallbackIndex === -1) {
			return null;
		}

		const fallbackEntry = entries[fallbackIndex];
		if (!isToolCallEntry(fallbackEntry)) {
			return null;
		}

		this.entryIndex.addToolCallId(sessionId, toolCallId, fallbackIndex);
		return { entry: fallbackEntry, index: fallbackIndex };
	}

	/**
	 * Check if a session has entries.
	 */
	hasEntries(sessionId: string): boolean {
		return this.entriesById.has(sessionId);
	}

	/**
	 * Check if session is preloaded.
	 */
	isPreloaded(sessionId: string): boolean {
		return this.preloadedIds.has(sessionId);
	}

	getTranscriptRevision(sessionId: string): number | undefined {
		return this.transcriptRevisionBySession.get(sessionId);
	}

	/**
	 * Mark session as preloaded.
	 */
	markPreloaded(sessionId: string): void {
		this.preloadedIds.add(sessionId);
	}

	/**
	 * Unmark session as preloaded.
	 */
	unmarkPreloaded(sessionId: string): void {
		this.preloadedIds.delete(sessionId);
	}

	// ============================================
	// ENTRY MUTATIONS
	// ============================================

	/**
	 * Compatibility-only preload path for legacy SessionEntry rows.
	 * Product transcript truth must use replaceTranscriptSnapshot/applyTranscriptDelta.
	 */
	private preloadCompatibilityEntriesAndBuildIndex(sessionId: string, entries: SessionEntry[]): void {
		const normalizedEntries = this.normalizePreloadedEntries(sessionId, entries);
		this.setEntriesAndBuildIndices(sessionId, normalizedEntries);
		this.preloadedIds.add(sessionId);
	}

	private setEntriesAndBuildIndices(sessionId: string, entries: SessionEntry[]): void {
		// SvelteMap provides fine-grained reactivity - only this session's subscribers re-render
		this.entriesById.set(sessionId, entries);

		// Build indices for O(1) lookups
		this.entryIndex.rebuildEntryIdIndex(sessionId, entries);
		this.entryIndex.rebuildToolCallIdIndex(sessionId, entries);
		this.preloadedIds.add(sessionId);
	}

	replaceTranscriptSnapshot(
		sessionId: string,
		snapshot: TranscriptSnapshot,
		timestamp: Date
	): void {
		const entries = convertTranscriptSnapshotToSessionEntries(snapshot, timestamp);
		this.setEntriesAndBuildIndices(sessionId, entries);
		this.transcriptRevisionBySession.set(sessionId, snapshot.revision);
	}

	applyTranscriptDelta(sessionId: string, delta: TranscriptDelta, timestamp: Date): void {
		const currentRevision = this.transcriptRevisionBySession.get(sessionId);
		if (currentRevision !== undefined && delta.snapshotRevision <= currentRevision) {
			return;
		}

		for (const operation of delta.operations) {
			if (operation.kind === "replaceSnapshot") {
				this.replaceTranscriptSnapshot(sessionId, operation.snapshot, timestamp);
				continue;
			}

			if (operation.kind === "appendEntry") {
				const existingIndex = this.entryIndex.getEntryIdIndex(sessionId, operation.entry.entryId);
				const convertedEntry = convertTranscriptEntryToSessionEntry(operation.entry, timestamp);
				if (existingIndex === undefined) {
					this.appendTranscriptEntry(sessionId, convertedEntry);
				} else {
					this.replaceTranscriptEntry(sessionId, existingIndex, convertedEntry);
				}
				continue;
			}

			const existingIndex = this.entryIndex.getEntryIdIndex(sessionId, operation.entryId);
			if (existingIndex === undefined) {
				const nextEntry = convertTranscriptEntryToSessionEntry(
					{
						entryId: operation.entryId,
						role: operation.role,
						segments: [operation.segment],
					},
					timestamp
				);
				this.appendTranscriptEntry(sessionId, nextEntry);
				continue;
			}

			const existingEntries = this.entriesById.get(sessionId) ?? [];
			const existingEntry = existingEntries[existingIndex];
			if (existingEntry === undefined) {
				continue;
			}
			const updatedEntry = appendTranscriptSegmentToSessionEntry(existingEntry, operation.segment);
			if (updatedEntry === null) {
				continue;
			}
			this.replaceTranscriptEntry(sessionId, existingIndex, updatedEntry);
		}

		this.transcriptRevisionBySession.set(sessionId, delta.snapshotRevision);
	}

	private normalizeRuntimeEntry(entry: SessionEntry): SessionEntry {
		if (!isToolCallEntry(entry)) {
			return entry;
		}

		return {
			id: entry.id,
			type: entry.type,
			message: {
				id: entry.message.id,
				name: entry.message.name,
				arguments: entry.message.arguments,
				progressiveArguments: entry.message.progressiveArguments,
				rawInput: entry.message.rawInput,
				status: entry.message.status,
				result: entry.message.result,
				kind: entry.message.kind,
				title: entry.message.title,
				locations: entry.message.locations,
				skillMeta: entry.message.skillMeta,
				normalizedQuestions: entry.message.normalizedQuestions,
				normalizedTodos: entry.message.normalizedTodos,
				parentToolUseId: entry.message.parentToolUseId,
				taskChildren: entry.message.taskChildren,
				questionAnswer: entry.message.questionAnswer,
				awaitingPlanApproval: entry.message.awaitingPlanApproval,
				planApprovalRequestId: entry.message.planApprovalRequestId,
				normalizedResult: normalizeToolResult(entry.message),
			},
			timestamp: entry.timestamp,
			isStreaming: entry.isStreaming,
		};
	}

	private normalizePreloadedEntries(sessionId: string, entries: SessionEntry[]): SessionEntry[] {
		const seenToolCallIds = new Set<string>();
		let hasDuplicateToolCall = false;
		for (const entry of entries) {
			if (!isToolCallEntry(entry)) {
				continue;
			}

			if (seenToolCallIds.has(entry.message.id)) {
				hasDuplicateToolCall = true;
				break;
			}

			seenToolCallIds.add(entry.message.id);
		}

		let collapsedEntries = entries;
		if (hasDuplicateToolCall) {
			const normalizedEntries: SessionEntry[] = [];
			const normalizedToolCallIds = new Set<string>();
			for (const entry of entries) {
				if (!isToolCallEntry(entry)) {
					normalizedEntries.push(entry);
					continue;
				}

				if (!normalizedToolCallIds.has(entry.message.id)) {
					normalizedToolCallIds.add(entry.message.id);
					normalizedEntries.push(entry);
					continue;
				}

				this.mergeDuplicatePreloadedToolCall(normalizedEntries, entry);
			}

			collapsedEntries = normalizedEntries;
		}

		return collapsedEntries.map((entry) => this.normalizeRuntimeEntry(entry));
	}

	private mergeDuplicatePreloadedToolCall(
		entries: SessionEntry[],
		incomingEntry: Extract<SessionEntry, { readonly type: "tool_call" }>
	): void {
		const existingIndex = entries.findIndex(
			(entry) => isToolCallEntry(entry) && entry.message.id === incomingEntry.message.id
		);
		const existingEntry = entries[existingIndex];
		if (!isToolCallEntry(existingEntry)) {
			entries.push(incomingEntry);
			return;
		}

		const incomingData: ToolCallData = {
			id: incomingEntry.message.id,
			name: incomingEntry.message.name,
			arguments: incomingEntry.message.arguments,
			rawInput: incomingEntry.message.rawInput,
			status: incomingEntry.message.status,
			result: incomingEntry.message.result,
			kind: incomingEntry.message.kind,
			title: incomingEntry.message.title,
			locations: incomingEntry.message.locations,
			skillMeta: incomingEntry.message.skillMeta,
			normalizedQuestions: incomingEntry.message.normalizedQuestions,
			normalizedTodos: incomingEntry.message.normalizedTodos,
			parentToolUseId: incomingEntry.message.parentToolUseId,
			taskChildren: incomingEntry.message.taskChildren,
			questionAnswer: incomingEntry.message.questionAnswer,
			awaitingPlanApproval: incomingEntry.message.awaitingPlanApproval,
			planApprovalRequestId: incomingEntry.message.planApprovalRequestId,
		};
		const existingStartedAtMs = existingEntry.timestamp?.getTime() ?? Date.now();
		const incomingTimestampMs = incomingEntry.timestamp?.getTime() ?? existingStartedAtMs;
		const createResolution = resolveTranscriptToolCallCreate(
			existingEntry.message,
			incomingData,
			existingStartedAtMs,
			incomingTimestampMs
		);
		const updatedToolCall: ToolCall = {
			id: existingEntry.message.id,
			name: incomingEntry.message.name,
			arguments: createResolution.nextArguments,
			rawInput: createResolution.nextRawInput,
			status: createResolution.nextStatus ?? existingEntry.message.status,
			result: createResolution.nextResult,
			kind: createResolution.nextKind,
			title: incomingEntry.message.title ?? existingEntry.message.title,
			locations: incomingEntry.message.locations ?? existingEntry.message.locations,
			skillMeta: incomingEntry.message.skillMeta ?? existingEntry.message.skillMeta,
			normalizedQuestions:
				incomingEntry.message.normalizedQuestions ?? existingEntry.message.normalizedQuestions,
			normalizedTodos:
				incomingEntry.message.normalizedTodos ?? existingEntry.message.normalizedTodos,
			normalizedTodoUpdate:
				incomingEntry.message.normalizedTodoUpdate ?? existingEntry.message.normalizedTodoUpdate,
			normalizedResult: normalizeToolResult({
				kind: createResolution.nextKind,
				arguments: createResolution.nextArguments,
				result: createResolution.nextResult,
			}),
			parentToolUseId: incomingEntry.message.parentToolUseId ?? existingEntry.message.parentToolUseId,
			taskChildren: incomingEntry.message.taskChildren ?? existingEntry.message.taskChildren,
			questionAnswer: incomingEntry.message.questionAnswer ?? existingEntry.message.questionAnswer,
			awaitingPlanApproval: createResolution.nextAwaitingPlanApproval,
			planApprovalRequestId: createResolution.nextPlanApprovalRequestId,
			progressiveArguments: createResolution.nextProgressiveArguments,
			startedAtMs: createResolution.startedAtMs,
			completedAtMs: createResolution.completedAtMs,
			presentationStatus: incomingEntry.message.presentationStatus ?? existingEntry.message.presentationStatus,
		};

		entries[existingIndex] = {
			id: existingEntry.id,
			type: "tool_call",
			message: updatedToolCall,
			timestamp: existingEntry.timestamp,
			isStreaming: createResolution.isStreaming,
		};
	}

	/**
	 * Append a canonical transcript row.
	 */
	appendTranscriptEntry(sessionId: string, entry: SessionEntry): void {
		const normalizedEntry = this.normalizeRuntimeEntry(entry);
		const entries = this.entriesById.get(sessionId) ?? [];
		const newEntries = [...entries, normalizedEntry];
		this.entriesById.set(sessionId, newEntries);
		const newIndex = newEntries.length - 1;
		this.entryIndex.addEntryId(sessionId, normalizedEntry.id, newIndex);
		if (isToolCallEntry(normalizedEntry)) {
			this.entryIndex.addToolCallId(sessionId, normalizedEntry.message.id, newIndex);
		}
		logger.debug("appendTranscriptEntry: appended entry", {
			sessionId,
			entryId: normalizedEntry.id,
			entryType: normalizedEntry.type,
			entryCount: newEntries.length,
		});
	}

	/**
	 * Replace a canonical transcript row.
	 */
	replaceTranscriptEntry(sessionId: string, index: number, updatedEntry: SessionEntry): void {
		const entries = this.entriesById.get(sessionId);
		if (!entries || index < 0 || index >= entries.length) return;
		const previousEntry = entries[index];
		const normalizedEntry = this.normalizeRuntimeEntry(updatedEntry);
		const newEntries = [...entries];
		newEntries[index] = normalizedEntry;
		this.entriesById.set(sessionId, newEntries);
		logger.debug("replaceTranscriptEntry: replaced entry", {
			sessionId,
			index,
			entryId: normalizedEntry.id,
			entryType: normalizedEntry.type,
			entryCount: newEntries.length,
		});

		if (previousEntry.id !== normalizedEntry.id) {
			this.entryIndex.deleteEntryId(sessionId, previousEntry.id);
		}
		this.entryIndex.addEntryId(sessionId, normalizedEntry.id, index);

		const previousToolCallId = isToolCallEntry(previousEntry) ? previousEntry.message.id : null;
		const updatedToolCallId = isToolCallEntry(normalizedEntry) ? normalizedEntry.message.id : null;
		if (previousToolCallId !== null && updatedToolCallId !== null) {
			if (previousToolCallId !== updatedToolCallId) {
				// No delete API for tool index; fallback to rebuild when ID changes.
				this.entryIndex.rebuildToolCallIdIndex(sessionId, newEntries);
			} else {
				this.entryIndex.addToolCallId(sessionId, updatedToolCallId, index);
			}
		} else if (previousToolCallId !== null || updatedToolCallId !== null) {
			this.entryIndex.rebuildToolCallIdIndex(sessionId, newEntries);
		}
	}

	/**
	 * Clear entries for a session.
	 */
	clearEntries(sessionId: string): void {
		// SvelteMap: .delete() triggers fine-grained reactivity for this session only
		this.entriesById.delete(sessionId);

		this.entryIndex.clearSession(sessionId);
		this.preloadedIds.delete(sessionId);
		this.transcriptRevisionBySession.delete(sessionId);

		this.transcriptToolCallBuffer.clearSession(sessionId);
		this.operationStore.clearSession(sessionId);
	}

	// ============================================
	// TOOL CALLS (delegated to TranscriptToolCallBuffer)
	// ============================================

	/**
	 * Compatibility-only transcript tool-call row writer from full ToolCallData.
	 */
	private recordCompatibilityToolCallTranscriptEntry(sessionId: string, toolCallData: ToolCallData): void {
		this.transcriptToolCallBuffer.createEntry(sessionId, toolCallData).match(
			() => {},
			(e) =>
				logger.warn("Failed to create tool call entry", {
					sessionId,
					toolCallId: toolCallData.id,
					error: e,
				})
		);
	}

	/**
	 * Compatibility-only transcript tool-call row update.
	 * Operation truth is not created here; canonical operation data arrives through
	 * Rust-authored session graph snapshots and patches.
	 */
	private updateCompatibilityToolCallTranscriptEntry(sessionId: string, update: ToolCallUpdate): void {
		this.transcriptToolCallBuffer.updateEntry(sessionId, update).match(
			() => {},
			(e) =>
				logger.warn("Failed to update tool call entry", {
					sessionId,
					toolCallId: update.toolCallId,
					error: e,
				})
		);
	}

	/**
	 * Clear streaming arguments for a tool call.
	 */
	clearStreamingArguments(toolCallId: string): void {
		this.transcriptToolCallBuffer.clearStreamingArguments(toolCallId);
	}

	/**
	 * Mark all still-streaming tool call entries as not streaming.
	 * Called on turn completion so pending tools stop shimmering.
	 */
	finalizeStreamingEntries(sessionId: string): void {
		const entries = this.entriesById.get(sessionId);
		if (!entries) return;

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry.type === "tool_call" && entry.isStreaming) {
				entries[i] = { ...entry, isStreaming: false };
			}
		}
	}
}
