/**
 * Session Entry Store - Manages conversation entries with synchronous mutations.
 *
 * Handles:
 * - Entry storage and retrieval (IEntryStoreInternal)
 * - Synchronous entry mutations for immediate UI updates
 *
 * Delegates to extracted managers:
 * - TranscriptToolCallBuffer: tool call CRUD, child-parent reconciliation, streaming args
 * - ChunkAggregator: assistant/user chunk aggregation and boundary management
 * - EntryIndexManager: O(1) messageId, toolCallId, and partId lookups
 *
 * Note: This file uses native Map/Set/Date for internal indexes and timestamps
 * that are NOT meant to be reactive. Only entriesById uses SvelteMap for
 * fine-grained reactivity. Streaming arguments reactivity is in TranscriptToolCallBuffer.
 */

import { SvelteMap } from "svelte/reactivity";
import type {
	TranscriptDelta,
	TranscriptEntry,
	TranscriptSnapshot,
} from "../../services/acp-types.js";
import type {
	ContentBlock,
	ContentChunk,
	ToolArguments,
	ToolCallData,
} from "../../services/converted-session-types.js";
import type { ToolCallUpdate } from "../types/tool-call.js";
import { createLogger } from "../utils/logger.js";
import { OperationStore } from "./operation-store.svelte.js";
import { ChunkAggregator } from "./services/chunk-aggregator.js";
import { EntryIndexManager } from "./services/entry-index-manager";
import type { IEntryStoreInternal } from "./services/interfaces/entry-store-internal.js";
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

	// Extracted index manager for O(1) messageId, toolCallId, and partId lookups
	private readonly entryIndex = new EntryIndexManager();

	// Transcript-only tool row buffer; product operation state lives in OperationStore.
	private readonly transcriptToolCallBuffer: TranscriptToolCallBuffer;

	// Extracted chunk aggregator for assistant/user chunk aggregation and boundary management
	private readonly chunkAggregator = new ChunkAggregator(this, this.entryIndex);

	// Track which sessions have been preloaded
	private preloadedIds = new Set<string>();
	private readonly transcriptRevisionBySession = new Map<string, number>();
	private readonly canonicalAssistantEntryRemaps = new Map<string, Map<string, string>>();

	constructor(operationStore?: OperationStore) {
		this.operationStore = operationStore ?? new OperationStore();
		this.transcriptToolCallBuffer = new TranscriptToolCallBuffer(
			this,
			this.entryIndex,
			this.operationStore
		);
	}

	// ============================================
	// IEntryStoreInternal (consumed by TranscriptToolCallBuffer, ChunkAggregator)
	// ============================================

	/** Check if a session exists in committed or preloaded state. */
	hasSession(sessionId: string): boolean {
		return this.entriesById.has(sessionId) || this.preloadedIds.has(sessionId);
	}

	// ============================================
	// ENTRY ACCESS
	// ============================================

	/**
	 * Get entries for a session.
	 */
	getEntries(sessionId: string): SessionEntry[] {
		return this.entriesById.get(sessionId) ?? [];
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
	 * Store entries and build indices for O(1) lookups.
	 */
	storeEntriesAndBuildIndex(sessionId: string, entries: SessionEntry[]): void {
		const normalizedEntries = this.normalizePreloadedEntries(sessionId, entries);
		this.setEntriesAndBuildIndices(sessionId, normalizedEntries);

		this.operationStore.clearSession(sessionId);
		for (const entry of normalizedEntries) {
			if (!isToolCallEntry(entry)) {
				continue;
			}

			this.operationStore.upsertFromToolCall(sessionId, entry.id, entry.message);
		}

		this.preloadedIds.add(sessionId);
	}

	private setEntriesAndBuildIndices(sessionId: string, entries: SessionEntry[]): void {
		this.canonicalAssistantEntryRemaps.delete(sessionId);
		// SvelteMap provides fine-grained reactivity - only this session's subscribers re-render
		this.entriesById.set(sessionId, entries);

		// Build indices for O(1) lookups
		this.entryIndex.rebuildEntryIdIndex(sessionId, entries);
		this.entryIndex.rebuildMessageIdIndex(sessionId, entries);
		this.entryIndex.rebuildToolCallIdIndex(sessionId, entries);
		this.preloadedIds.add(sessionId);
	}

	replaceTranscriptSnapshot(
		sessionId: string,
		snapshot: TranscriptSnapshot,
		timestamp: Date
	): void {
		const entries = this.mergeTranscriptSnapshotEntries(
			sessionId,
			convertTranscriptSnapshotToSessionEntries(snapshot, timestamp)
		);
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
				const appendTarget = this.resolveCanonicalAppendEntryTarget(
					sessionId,
					operation.entry,
					delta.eventSeq
				);
				const existingIndex = appendTarget.existingIndex;
				const convertedEntry = convertTranscriptEntryToSessionEntry(appendTarget.entry, timestamp);
				const reconciledIndex =
					existingIndex ?? this.findMirroredOptimisticUserEntryIndex(sessionId, convertedEntry);
				const nextEntry = this.preserveTranscriptEntry(
					this.getEntries(sessionId)[reconciledIndex ?? -1],
					convertedEntry
				);
				if (reconciledIndex === undefined) {
					this.addEntry(sessionId, nextEntry);
				} else {
					this.updateEntry(sessionId, reconciledIndex, nextEntry);
				}
				continue;
			}

			const segmentTarget = this.resolveCanonicalAppendSegmentTarget(
				sessionId,
				operation.entryId,
				operation.role,
				delta.eventSeq
			);
			const existingIndex = segmentTarget.existingIndex;
			if (existingIndex === undefined) {
				const nextEntry = convertTranscriptEntryToSessionEntry(
					{
						entryId: segmentTarget.entryId,
						role: operation.role,
						segments: [operation.segment],
					},
					timestamp
				);
				this.addEntry(sessionId, nextEntry);
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
			this.updateEntry(sessionId, existingIndex, updatedEntry);
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

	private resolveCanonicalAppendEntryTarget(
		sessionId: string,
		entry: TranscriptEntry,
		eventSeq: number
	): { entry: TranscriptEntry; existingIndex: number | undefined } {
		if (entry.role !== "assistant") {
			return {
				entry,
				existingIndex: this.entryIndex.getEntryIdIndex(sessionId, entry.entryId),
			};
		}

		const target = this.resolveCanonicalAssistantTarget(sessionId, entry.entryId, eventSeq);
		if (target.entryId === entry.entryId) {
			return {
				entry,
				existingIndex: target.existingIndex,
			};
		}

		return {
			entry: {
				entryId: target.entryId,
				role: entry.role,
				segments: entry.segments,
			},
			existingIndex: target.existingIndex,
		};
	}

	private resolveCanonicalAppendSegmentTarget(
		sessionId: string,
		entryId: string,
		role: TranscriptEntry["role"],
		eventSeq: number
	): { entryId: string; existingIndex: number | undefined } {
		if (role !== "assistant") {
			return {
				entryId,
				existingIndex: this.entryIndex.getEntryIdIndex(sessionId, entryId),
			};
		}

		return this.resolveCanonicalAssistantTarget(sessionId, entryId, eventSeq);
	}

	private resolveCanonicalAssistantTarget(
		sessionId: string,
		entryId: string,
		eventSeq: number
	): { entryId: string; existingIndex: number | undefined } {
		const entries = this.getEntries(sessionId);
		const lastUserIndex = this.findLastUserEntryIndex(entries);
		const remaps = this.canonicalAssistantEntryRemaps.get(sessionId);
		const remappedEntryId = remaps?.get(entryId);
		if (remappedEntryId) {
			const remappedIndex = this.entryIndex.getEntryIdIndex(sessionId, remappedEntryId);
			if (remappedIndex !== undefined && remappedIndex > lastUserIndex) {
				return { entryId: remappedEntryId, existingIndex: remappedIndex };
			}
		}

		const existingIndex = this.entryIndex.getEntryIdIndex(sessionId, entryId);
		if (existingIndex === undefined || existingIndex > lastUserIndex) {
			return { entryId, existingIndex };
		}

		const nextEntryId = `${entryId}:turn:${eventSeq}`;
		let nextRemaps = remaps;
		if (!nextRemaps) {
			nextRemaps = new Map<string, string>();
			this.canonicalAssistantEntryRemaps.set(sessionId, nextRemaps);
		}
		nextRemaps.set(entryId, nextEntryId);
		return { entryId: nextEntryId, existingIndex: undefined };
	}

	private findLastUserEntryIndex(entries: readonly SessionEntry[]): number {
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			if (entries[index]?.type === "user") {
				return index;
			}
		}
		return -1;
	}

	private syncOperationStoreForEntry(sessionId: string, entry: SessionEntry): void {
		if (!isToolCallEntry(entry)) {
			return;
		}

		this.operationStore.upsertFromToolCall(sessionId, entry.id, entry.message);
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
			const normalizedStore = new SessionEntryStore(new OperationStore());
			const normalizedToolCallIds = new Set<string>();
			for (const entry of entries) {
				if (!isToolCallEntry(entry)) {
					normalizedStore.addEntry(sessionId, entry);
					continue;
				}

				if (!normalizedToolCallIds.has(entry.message.id)) {
					normalizedToolCallIds.add(entry.message.id);
					normalizedStore.addEntry(sessionId, entry);
					continue;
				}

				normalizedStore.createToolCallEntry(sessionId, entry.message);
			}

			collapsedEntries = normalizedStore.getEntries(sessionId);
		}

		return collapsedEntries.map((entry) => this.normalizeRuntimeEntry(entry));
	}

	/**
	 * Add an entry to a session.
	 */
	addEntry(sessionId: string, entry: SessionEntry): void {
		const normalizedEntry = this.normalizeRuntimeEntry(entry);
		const entries = this.entriesById.get(sessionId) ?? [];
		const newEntries = [...entries, normalizedEntry];
		this.entriesById.set(sessionId, newEntries);
		const newIndex = newEntries.length - 1;
		this.entryIndex.addEntryId(sessionId, normalizedEntry.id, newIndex);
		if (normalizedEntry.type === "assistant") {
			this.entryIndex.addMessageId(sessionId, normalizedEntry.id, newIndex);
		} else if (isToolCallEntry(normalizedEntry)) {
			this.entryIndex.addToolCallId(sessionId, normalizedEntry.message.id, newIndex);
		}
		this.syncOperationStoreForEntry(sessionId, normalizedEntry);
		logger.debug("addEntry: appended entry", {
			sessionId,
			entryId: normalizedEntry.id,
			entryType: normalizedEntry.type,
			entryCount: newEntries.length,
		});
	}

	/**
	 * Remove an entry from a session.
	 */
	removeEntry(sessionId: string, entryId: string): void {
		const currentEntries = this.entriesById.get(sessionId) ?? [];
		const newEntries = currentEntries.filter((e) => e.id !== entryId);

		this.entriesById.set(sessionId, newEntries);

		// Rebuild indices since indices shifted after removal
		this.entryIndex.rebuildEntryIdIndex(sessionId, newEntries);
		this.entryIndex.rebuildMessageIdIndex(sessionId, newEntries);
		this.entryIndex.rebuildToolCallIdIndex(sessionId, newEntries);
	}

	/**
	 * Update an existing entry by index.
	 */
	updateEntry(sessionId: string, index: number, updatedEntry: SessionEntry): void {
		const entries = this.entriesById.get(sessionId);
		if (!entries || index < 0 || index >= entries.length) return;
		const previousEntry = entries[index];
		const normalizedEntry = this.normalizeRuntimeEntry(updatedEntry);
		const newEntries = [...entries];
		newEntries[index] = normalizedEntry;
		this.entriesById.set(sessionId, newEntries);
		logger.debug("updateEntry: replaced entry", {
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

		// Incremental index updates avoid O(n) rebuilds on every streamed/tool-call update.
		if (previousEntry.type === "assistant" && normalizedEntry.type === "assistant") {
			if (previousEntry.id !== normalizedEntry.id) {
				this.entryIndex.deleteMessageId(sessionId, previousEntry.id);
				this.entryIndex.addMessageId(sessionId, normalizedEntry.id, index);
			}
		} else if (previousEntry.type === "assistant") {
			this.entryIndex.deleteMessageId(sessionId, previousEntry.id);
		} else if (normalizedEntry.type === "assistant") {
			this.entryIndex.addMessageId(sessionId, normalizedEntry.id, index);
		}

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
		this.syncOperationStoreForEntry(sessionId, normalizedEntry);
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
		this.canonicalAssistantEntryRemaps.delete(sessionId);

		// Delegate cleanup to extracted managers
		this.chunkAggregator.clearSession(sessionId);
		this.transcriptToolCallBuffer.clearSession(sessionId);
		this.operationStore.clearSession(sessionId);
	}

	getOperationStore(): OperationStore {
		return this.operationStore;
	}

	private mergeTranscriptSnapshotEntries(
		sessionId: string,
		entries: SessionEntry[]
	): SessionEntry[] {
		const existingEntries = this.getEntries(sessionId);
		const existingEntryById = new Map(existingEntries.map((entry) => [entry.id, entry] as const));
		return entries.map((entry) =>
			this.preserveStructuredTranscriptEntry(existingEntryById.get(entry.id), entry)
		);
	}

	private preserveStructuredTranscriptEntry(
		existingEntry: SessionEntry | undefined,
		nextEntry: SessionEntry
	): SessionEntry {
		if (
			existingEntry === undefined ||
			existingEntry.type !== "tool_call" ||
			nextEntry.type !== "tool_call"
		) {
			return nextEntry;
		}

		const nextTitle = nextEntry.message.title ?? null;
		const nextName = nextEntry.message.name;
		return {
			id: nextEntry.id,
			type: "tool_call",
			message: {
				id: existingEntry.message.id,
				name: nextName.length > 0 ? nextName : existingEntry.message.name,
				arguments: existingEntry.message.arguments,
				progressiveArguments: existingEntry.message.progressiveArguments,
				rawInput: existingEntry.message.rawInput,
				status: existingEntry.message.status,
				result: existingEntry.message.result,
				kind: existingEntry.message.kind,
				title: nextTitle !== null && nextTitle.length > 0 ? nextTitle : existingEntry.message.title,
				locations: existingEntry.message.locations,
				skillMeta: existingEntry.message.skillMeta,
				normalizedQuestions: existingEntry.message.normalizedQuestions,
				normalizedTodos: existingEntry.message.normalizedTodos,
				parentToolUseId: existingEntry.message.parentToolUseId,
				taskChildren: existingEntry.message.taskChildren,
				questionAnswer: existingEntry.message.questionAnswer,
				awaitingPlanApproval: existingEntry.message.awaitingPlanApproval,
				planApprovalRequestId: existingEntry.message.planApprovalRequestId,
				normalizedResult: existingEntry.message.normalizedResult,
			},
			timestamp: existingEntry.timestamp,
			isStreaming: existingEntry.isStreaming,
		};
	}

	private preserveTranscriptEntry(
		existingEntry: SessionEntry | undefined,
		nextEntry: SessionEntry
	): SessionEntry {
		const structuredEntry = this.preserveStructuredTranscriptEntry(existingEntry, nextEntry);
		if (
			existingEntry === undefined ||
			existingEntry.type !== "user" ||
			nextEntry.type !== "user" ||
			existingEntry.message.sentAt === undefined
		) {
			return structuredEntry;
		}

		return {
			id: nextEntry.id,
			type: "user",
			message: {
				id: nextEntry.message.id,
				content: nextEntry.message.content,
				chunks: nextEntry.message.chunks,
				sentAt: existingEntry.message.sentAt,
				checkpoint: existingEntry.message.checkpoint,
			},
			timestamp: existingEntry.timestamp,
		};
	}

	private findMirroredOptimisticUserEntryIndex(
		sessionId: string,
		nextEntry: SessionEntry
	): number | undefined {
		if (nextEntry.type !== "user" || nextEntry.message.content.type !== "text") {
			return undefined;
		}

		const entries = this.getEntries(sessionId);
		const optimisticIndex = entries.length - 1;
		if (optimisticIndex < 0) {
			return undefined;
		}

		const optimisticEntry = entries[optimisticIndex];
		if (
			optimisticEntry?.type !== "user" ||
			optimisticEntry.message.sentAt === undefined ||
			optimisticEntry.message.content.type !== "text"
		) {
			return undefined;
		}

		if (optimisticEntry.message.content.text !== nextEntry.message.content.text) {
			return undefined;
		}

		return optimisticIndex;
	}

	// ============================================
	// TOOL CALLS (delegated to TranscriptToolCallBuffer)
	// ============================================

	/**
	 * Create a new tool call entry from full ToolCallData.
	 * Splits assistant aggregation boundary before delegating to TranscriptToolCallBuffer.
	 */
	createToolCallEntry(sessionId: string, toolCallData: ToolCallData): void {
		this.chunkAggregator.splitAssistantAggregationBoundary(sessionId);
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
	 * Update an existing tool call entry.
	 * Canonical tool rows are created by toolCall events; update events are
	 * mutation-only and must not create synthetic placeholders.
	 */
	updateToolCallEntry(sessionId: string, update: ToolCallUpdate): void {
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
	 * Get the streaming arguments for a tool call.
	 */
	getStreamingArguments(toolCallId: string): ToolArguments | undefined {
		return this.transcriptToolCallBuffer.getStreamingArguments(toolCallId);
	}

	/**
	 * Clear streaming arguments for a tool call.
	 */
	clearStreamingArguments(toolCallId: string): void {
		this.transcriptToolCallBuffer.clearStreamingArguments(toolCallId);
	}

	// ============================================
	// CHUNK AGGREGATION (delegated to ChunkAggregator)
	// ============================================

	aggregateUserChunk(sessionId: string, chunk: { content: ContentBlock }) {
		return this.chunkAggregator.aggregateUserChunk(sessionId, chunk);
	}

	aggregateAssistantChunk(
		sessionId: string,
		chunk: ContentChunk,
		messageId: string | undefined,
		isThought: boolean
	) {
		return this.chunkAggregator.aggregateAssistantChunk(sessionId, chunk, messageId, isThought);
	}

	clearStreamingAssistantEntry(sessionId: string): void {
		this.chunkAggregator.clearStreamingAssistantEntry(sessionId);
	}

	startNewAssistantTurn(sessionId: string): void {
		this.chunkAggregator.startNewAssistantTurn(sessionId);
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
