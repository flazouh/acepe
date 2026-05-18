/**
 * Entry Index Manager
 *
 * Manages O(1) lookup indices for session entries.
 * Owns: entryIdIndex, toolCallIdIndex.
 *
 * Pure data structure with no business logic — just index maintenance.
 * Used by the store facade during flush and by extracted services for lookups.
 */

import type { SessionEntry } from "../types.js";
import { isToolCallEntry } from "../types.js";
import type { IEntryIndex } from "./interfaces/entry-index.js";

export class EntryIndexManager implements IEntryIndex {
	private readonly entryIdIndex = new Map<string, Map<string, number>>();

	// ToolCallId -> index lookup for O(1) tool call updates
	// Key: sessionId -> toolCallId -> entryIndex
	private readonly toolCallIdIndex = new Map<string, Map<string, number>>();

	getEntryIdIndex(sessionId: string, entryId: string): number | undefined {
		return this.entryIdIndex.get(sessionId)?.get(entryId);
	}

	addEntryId(sessionId: string, entryId: string, index: number): void {
		let sessionIndex = this.entryIdIndex.get(sessionId);
		if (!sessionIndex) {
			sessionIndex = new Map<string, number>();
			this.entryIdIndex.set(sessionId, sessionIndex);
		}
		sessionIndex.set(entryId, index);
	}

	deleteEntryId(sessionId: string, entryId: string): void {
		this.entryIdIndex.get(sessionId)?.delete(entryId);
	}

	rebuildEntryIdIndex(sessionId: string, entries: SessionEntry[]): void {
		const sessionIndex = new Map<string, number>();

		for (let i = 0; i < entries.length; i++) {
			sessionIndex.set(entries[i].id, i);
		}

		this.entryIdIndex.set(sessionId, sessionIndex);
	}

	// ============================================
	// TOOL CALL ID INDEX
	// ============================================

	getToolCallIdIndex(sessionId: string, toolCallId: string): number | undefined {
		return this.toolCallIdIndex.get(sessionId)?.get(toolCallId);
	}

	addToolCallId(sessionId: string, toolCallId: string, index: number): void {
		let sessionIndex = this.toolCallIdIndex.get(sessionId);
		if (!sessionIndex) {
			sessionIndex = new Map<string, number>();
			this.toolCallIdIndex.set(sessionId, sessionIndex);
		}
		sessionIndex.set(toolCallId, index);
	}

	rebuildToolCallIdIndex(sessionId: string, entries: SessionEntry[]): void {
		const sessionIndex = new Map<string, number>();

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (isToolCallEntry(entry)) {
				sessionIndex.set(entry.message.id, i);
			}
		}

		this.toolCallIdIndex.set(sessionId, sessionIndex);
	}

	// ============================================
	// SESSION CLEANUP
	// ============================================

	clearSession(sessionId: string): void {
		this.entryIdIndex.delete(sessionId);
		this.toolCallIdIndex.delete(sessionId);
	}
}
