/**
 * Entry Index Interface
 *
 * Narrow interface for managing O(1) lookup indices.
 * EntryIndexManager implements this; services consume it for fast lookups.
 */

import type { SessionEntry } from "../../types.js";

export interface IEntryIndex {
	// MessageId index (assistant chunk aggregation)
	getMessageIdIndex(sessionId: string, messageId: string): number | undefined;
	addMessageId(sessionId: string, messageId: string, index: number): void;
	deleteMessageId(sessionId: string, messageId: string): void;
	rebuildMessageIdIndex(sessionId: string, entries: SessionEntry[]): void;

	// ToolCallId index (tool call lookups)
	getToolCallIdIndex(sessionId: string, toolCallId: string): number | undefined;
	addToolCallId(sessionId: string, toolCallId: string, index: number): void;
	rebuildToolCallIdIndex(sessionId: string, entries: SessionEntry[]): void;

	// Session cleanup
	clearSession(sessionId: string): void;
}
