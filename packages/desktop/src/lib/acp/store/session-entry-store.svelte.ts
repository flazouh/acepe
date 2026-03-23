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
	ToolArguments,
	ToolCallData,
} from "../../services/converted-session-types.js";
import type { ToolCallUpdate } from "../types/tool-call.js";
import { createLogger } from "../utils/logger.js";
import { ChunkAggregator } from "./services/chunk-aggregator.js";
import { EntryIndexManager } from "./services/entry-index-manager";
import type { IEntryStoreInternal } from "./services/interfaces/entry-store-internal.js";
import type { IEntryManager } from "./services/interfaces/index.js";
import { ToolCallManager } from "./services/tool-call-manager.svelte.js";
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
	// Entries stored with SvelteMap for fine-grained per-session reactivity
	// Only components reading a specific session re-render when that session changes
	private entriesById = new SvelteMap<string, SessionEntry[]>();

	// Extracted index manager for O(1) messageId, toolCallId, and partId lookups
	private readonly entryIndex = new EntryIndexManager();

	// Extracted tool call manager for CRUD, child-parent reconciliation, and streaming args
	private readonly toolCallManager = new ToolCallManager(this, this.entryIndex);

	// Extracted chunk aggregator for assistant/user chunk aggregation and boundary management
	private readonly chunkAggregator = new ChunkAggregator(this, this.entryIndex);

	// Track which sessions have been preloaded
	private preloadedIds = new Set<string>();

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
		// SvelteMap provides fine-grained reactivity - only this session's subscribers re-render
		this.entriesById.set(sessionId, entries);

		// Build indices for O(1) lookups
		this.entryIndex.rebuildMessageIdIndex(sessionId, entries);
		this.entryIndex.rebuildToolCallIdIndex(sessionId, entries);

		this.preloadedIds.add(sessionId);
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
	 * Update tool call entry.
	 * Splits assistant aggregation boundary only when this update creates
	 * a new tool entry (missing initial toolCall event). Routine status/result
	 * updates should not fragment assistant text boundaries.
	 */
	updateToolCallEntry(sessionId: string, update: ToolCallUpdate): void {
		const hasExistingToolEntry = this.getEntries(sessionId).some(
			(entry) => isToolCallEntry(entry) && entry.message.id === update.toolCallId
		);
		if (!hasExistingToolEntry) {
			this.chunkAggregator.splitAssistantAggregationBoundary(sessionId);
		}
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
	 * Update a child tool call within its parent's taskChildren array.
	 */
	updateChildInParent(sessionId: string, childUpdate: ToolCallUpdate): void {
		this.toolCallManager.updateChildInParent(sessionId, childUpdate).match(
			() => {},
			(e) =>
				logger.warn("Failed to update child in parent", {
					sessionId,
					toolCallId: childUpdate.toolCallId,
					error: e,
				})
		);
	}

	/**
	 * Store pre-parsed streaming arguments from Rust.
	 */
	setStreamingArguments(sessionId: string, toolCallId: string, args: ToolArguments): void {
		this.toolCallManager.setStreamingArguments(sessionId, toolCallId, args);
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
		chunk: { content: ContentBlock },
		messageId: string | undefined,
		isThought: boolean
	) {
		return this.chunkAggregator.aggregateAssistantChunk(sessionId, chunk, messageId, isThought);
	}

	clearStreamingAssistantEntry(sessionId: string): void {
		this.chunkAggregator.clearStreamingAssistantEntry(sessionId);
	}
}
