/**
 * Internal Entry Store Interface
 *
 * Narrow interface for what extracted services need from the store facade.
 * SessionEntryStore implements this; extracted services consume it for
 * reading/writing entries without depending on the full IEntryManager.
 */

import type { SessionEntry } from "../../types.js";

export interface IEntryStoreInternal {
	/** Get entries for a session. */
	getEntries(sessionId: string): SessionEntry[];

	/** Add an entry to a session. */
	addEntry(sessionId: string, entry: SessionEntry): void;

	/** Update an entry by index. */
	updateEntry(sessionId: string, index: number, entry: SessionEntry): void;

	/** Check if a session exists in committed or preloaded state. */
	hasSession(sessionId: string): boolean;
}
