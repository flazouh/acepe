/**
 * Entry Manager Interface
 *
 * Narrow interface for managing session entries.
 * Extracted services use this for entry CRUD and chunk aggregation.
 */

import type { ResultAsync } from "neverthrow";

import type { ContentBlock, ToolCallData } from "../../../../services/converted-session-types.js";
import type { AppError } from "../../../errors/app-error.js";
import type { ToolCallUpdate } from "../../../types/tool-call.js";
import type { SessionEntry } from "../../types.js";

/**
 * Interface for managing session entries.
 */
export interface IEntryManager {
	/**
	 * Get entries for a session.
	 */
	getEntries(sessionId: string): SessionEntry[];

	/**
	 * Check if a session has entries.
	 */
	hasEntries(sessionId: string): boolean;

	/**
	 * Check if session is preloaded.
	 */
	isPreloaded(sessionId: string): boolean;

	/**
	 * Mark session as preloaded.
	 */
	markPreloaded(sessionId: string): void;

	/**
	 * Unmark session as preloaded.
	 */
	unmarkPreloaded(sessionId: string): void;

	/**
	 * Store entries and build message index.
	 */
	storeEntriesAndBuildIndex(sessionId: string, entries: SessionEntry[]): void;

	/**
	 * Add an entry to a session.
	 */
	addEntry(sessionId: string, entry: SessionEntry): void;

	/**
	 * Remove an entry from a session.
	 */
	removeEntry(sessionId: string, entryId: string): void;

	/**
	 * Update an existing entry.
	 */
	updateEntry(sessionId: string, index: number, updatedEntry: SessionEntry): void;

	/**
	 * Clear entries for a session.
	 */
	clearEntries(sessionId: string): void;

	/**
	 * Create a new tool call entry from full ToolCallData.
	 */
	createToolCallEntry(sessionId: string, toolCallData: ToolCallData): void;

	/**
	 * Update tool call entry.
	 */
	updateToolCallEntry(sessionId: string, update: ToolCallUpdate): void;

	/**
	 * Update a child tool call within its parent's taskChildren array.
	 * Uses O(1) child-to-parent index for fast lookup.
	 * Falls back to regular updateToolCallEntry if child-parent relationship is unknown.
	 */
	updateChildInParent(sessionId: string, childUpdate: ToolCallUpdate): void;

	/**
	 * Aggregate assistant chunk.
	 * Appends chunk content to the current assistant entry, creating a new entry if needed.
	 */
	aggregateAssistantChunk(
		sessionId: string,
		chunk: { content: ContentBlock },
		messageId: string | undefined,
		isThought: boolean
	): ResultAsync<void, AppError>;

	/**
	 * Clear any in-progress assistant aggregation state for a session.
	 */
	clearStreamingAssistantEntry(sessionId: string): void;

	/**
	 * Mark all still-streaming tool call entries as not streaming.
	 * Called on turn completion so pending tools stop shimmering.
	 */
	finalizeStreamingEntries(sessionId: string): void;
}
