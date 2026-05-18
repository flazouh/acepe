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

export type AssistantEntryRef = EntryStoreEntryRef & {
	readonly entry: Extract<SessionEntry, { readonly type: "assistant" }>;
};

export type UserEntryRef = EntryStoreEntryRef & {
	readonly entry: Extract<SessionEntry, { readonly type: "user" }>;
};

export type ToolCallEntryRef = EntryStoreEntryRef & {
	readonly entry: Extract<SessionEntry, { readonly type: "tool_call" }>;
};

export interface IEntryStoreInternal {
	/** Find an assistant compatibility entry by Acepe-owned entry id. */
	findAssistantEntryRef(sessionId: string, entryId: string): AssistantEntryRef | null;

	/** Check whether an assistant compatibility entry exists. */
	hasAssistantEntry(sessionId: string, entryId: string): boolean;

	/** Find the latest compatibility entry only when it is a user row. */
	findLatestUserEntryRef(sessionId: string): UserEntryRef | null;

	/** Find a tool-call compatibility entry by canonical tool-call id. */
	findToolCallEntryRef(sessionId: string, toolCallId: string): ToolCallEntryRef | null;

	/** Add an entry to a session. */
	addEntry(sessionId: string, entry: SessionEntry): void;

	/** Update an entry by index. */
	updateEntry(sessionId: string, index: number, entry: SessionEntry): void;

	/** Check if a session exists in committed or preloaded state. */
	hasSession(sessionId: string): boolean;
}
