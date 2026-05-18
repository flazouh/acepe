/**
 * Internal Entry Store Interface
 *
 * Narrow interface for what extracted services need from the store facade.
 * SessionEntryStore implements this; extracted services consume it for
 * reading/writing entries without depending on the full IEntryManager.
 */

import type { SessionEntry } from "../../types.js";

export interface EntryStoreEntryRef {
	readonly entry: SessionEntry;
	readonly index: number;
}

export type ToolCallEntryRef = EntryStoreEntryRef & {
	readonly entry: Extract<SessionEntry, { readonly type: "tool_call" }>;
};

export interface IEntryStoreInternal {
	/** Find a canonical tool-call transcript row by canonical tool-call id. */
	findToolCallEntryRef(sessionId: string, toolCallId: string): ToolCallEntryRef | null;

	/** Append a canonical transcript display row. */
	appendTranscriptEntry(sessionId: string, entry: SessionEntry): void;

	/** Replace a canonical transcript display row by index. */
	replaceTranscriptEntry(sessionId: string, index: number, entry: SessionEntry): void;

	/** Check if a session exists in committed or preloaded state. */
	hasSession(sessionId: string): boolean;
}
