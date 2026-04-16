/**
 * Session Entry Store - Manages conversation entries with synchronous mutations.
 *
 * Handles:
 * - Entry storage and retrieval (IEntryStoreInternal)
 * - Synchronous entry mutations for immediate UI updates
 *
 * Delegates to extracted managers:
 * - ToolCallManager: tool call CRUD, child-parent reconciliation, streaming args
 * - ChunkAggregator: assistant/user chunk aggregation and boundary management
 * - EntryIndexManager: O(1) messageId, toolCallId, and partId lookups
 *
 * Note: This file uses native Map/Set/Date for internal indexes and timestamps
 * that are NOT meant to be reactive. Only entriesById uses SvelteMap for
 * fine-grained reactivity. Streaming arguments reactivity is in ToolCallManager.
 */

import { SvelteMap } from "svelte/reactivity";

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
import { ToolCallManager } from "./services/tool-call-manager.svelte.js";
import { normalizeToolResult } from "./services/tool-result-normalizer.js";
import type { SessionEntry } from "./types.js";
import { isToolCallEntry } from "./types.js";

const logger = createLogger({ id: "session-entry-store", name: "SessionEntryStore" });

/**
 * Store for managing session entries with O(1) chunk aggregation.
 * Implements IEntryManager for external consumers and IEntryStoreInternal
 * for extracted services (ToolCallManager) to read/write entries.
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

	// Extracted tool call manager for CRUD, child-parent reconciliation, and streaming args
	private readonly toolCallManager: ToolCallManager;

	// Extracted chunk aggregator for assistant/user chunk aggregation and boundary management
	private readonly chunkAggregator = new ChunkAggregator(this, this.entryIndex);

	// Track which sessions have been preloaded
	private preloadedIds = new Set<string>();

	constructor(operationStore?: OperationStore) {
		this.operationStore = operationStore ?? new OperationStore();
		this.toolCallManager = new ToolCallManager(this, this.entryIndex, this.operationStore);
	}

	// ============================================
	// IEntryStoreInternal (consumed by ToolCallManager, ChunkAggregator)
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
		// SvelteMap provides fine-grained reactivity - only this session's subscribers re-render
		this.entriesById.set(sessionId, normalizedEntries);

		// Build indices for O(1) lookups
		this.entryIndex.rebuildMessageIdIndex(sessionId, normalizedEntries);
		this.entryIndex.rebuildToolCallIdIndex(sessionId, normalizedEntries);
		this.operationStore.clearSession(sessionId);
		for (const entry of normalizedEntries) {
			if (!isToolCallEntry(entry)) {
				continue;
			}

			this.operationStore.upsertFromToolCall(sessionId, entry.id, entry.message);
		}

		this.preloadedIds.add(sessionId);
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

		return collapsedEntries.map((entry) => {
			if (!isToolCallEntry(entry)) {
				return entry;
			}

			return {
				id: entry.id,
				type: entry.type,
				message: {
					...entry.message,
					normalizedResult: normalizeToolResult(entry.message),
				},
				timestamp: entry.timestamp,
				isStreaming: entry.isStreaming,
			};
		});
	}

	/**
	 * Add an entry to a session.
	 */
	addEntry(sessionId: string, entry: SessionEntry): void {
		const entries = this.entriesById.get(sessionId) ?? [];
		const newEntries = [...entries, entry];
		this.entriesById.set(sessionId, newEntries);
		const newIndex = newEntries.length - 1;
		if (entry.type === "assistant") {
			this.entryIndex.addMessageId(sessionId, entry.id, newIndex);
		} else if (isToolCallEntry(entry)) {
			this.entryIndex.addToolCallId(sessionId, entry.message.id, newIndex);
		}
		logger.debug("addEntry: appended entry", {
			sessionId,
			entryId: entry.id,
			entryType: entry.type,
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
		const newEntries = [...entries];
		newEntries[index] = updatedEntry;
		this.entriesById.set(sessionId, newEntries);
		logger.debug("updateEntry: replaced entry", {
			sessionId,
			index,
			entryId: updatedEntry.id,
			entryType: updatedEntry.type,
			entryCount: newEntries.length,
		});

		// Incremental index updates avoid O(n) rebuilds on every streamed/tool-call update.
		if (previousEntry.type === "assistant" && updatedEntry.type === "assistant") {
			if (previousEntry.id !== updatedEntry.id) {
				this.entryIndex.deleteMessageId(sessionId, previousEntry.id);
				this.entryIndex.addMessageId(sessionId, updatedEntry.id, index);
			}
		} else if (previousEntry.type === "assistant") {
			this.entryIndex.deleteMessageId(sessionId, previousEntry.id);
		} else if (updatedEntry.type === "assistant") {
			this.entryIndex.addMessageId(sessionId, updatedEntry.id, index);
		}

		const previousToolCallId = isToolCallEntry(previousEntry) ? previousEntry.message.id : null;
		const updatedToolCallId = isToolCallEntry(updatedEntry) ? updatedEntry.message.id : null;
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

		// Delegate cleanup to extracted managers
		this.chunkAggregator.clearSession(sessionId);
		this.toolCallManager.clearSession(sessionId);
		this.operationStore.clearSession(sessionId);
	}

	getOperationStore(): OperationStore {
		return this.operationStore;
	}

	// ============================================
	// TOOL CALLS (delegated to ToolCallManager)
	// ============================================

	/**
	 * Create a new tool call entry from full ToolCallData.
	 * Splits assistant aggregation boundary before delegating to ToolCallManager.
	 */
	createToolCallEntry(sessionId: string, toolCallData: ToolCallData): void {
		this.chunkAggregator.splitAssistantAggregationBoundary(sessionId);
		this.toolCallManager.createEntry(sessionId, toolCallData).match(
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
		this.toolCallManager.updateEntry(sessionId, update).match(
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
		return this.toolCallManager.getStreamingArguments(toolCallId);
	}

	/**
	 * Clear streaming arguments for a tool call.
	 */
	clearStreamingArguments(toolCallId: string): void {
		this.toolCallManager.clearStreamingArguments(toolCallId);
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
