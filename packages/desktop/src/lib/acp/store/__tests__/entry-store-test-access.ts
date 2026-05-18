import type { SessionEntry } from "../types.js";
import type { SessionEntryStore } from "../session-entry-store.svelte.js";
import type {
	ToolCallData,
	ToolCallUpdateData,
} from "../../../services/converted-session-types.js";

type EntryStoreStorage = {
	entriesById: {
		get(sessionId: string): SessionEntry[] | undefined;
	};
};

export function readStoredEntries(
	store: SessionEntryStore,
	sessionId: string
): SessionEntry[] {
	return (store as never as EntryStoreStorage).entriesById.get(sessionId) ?? [];
}

type EntryStoreTestMutations = {
	preloadEntriesAndBuildIndex(sessionId: string, entries: SessionEntry[]): void;
	recordTranscriptToolCallEntry(sessionId: string, toolCallData: ToolCallData): void;
	updateTranscriptToolCallEntry(sessionId: string, update: ToolCallUpdateData): void;
};

export function preloadEntriesAndBuildIndex(
	store: SessionEntryStore,
	sessionId: string,
	entries: SessionEntry[]
): void {
	(store as never as EntryStoreTestMutations).preloadEntriesAndBuildIndex(
		sessionId,
		entries
	);
}

export function recordTranscriptToolCallEntry(
	store: SessionEntryStore,
	sessionId: string,
	toolCallData: ToolCallData
): void {
	(store as never as EntryStoreTestMutations).recordTranscriptToolCallEntry(
		sessionId,
		toolCallData
	);
}

export function updateTranscriptToolCallEntry(
	store: SessionEntryStore,
	sessionId: string,
	update: ToolCallUpdateData
): void {
	(store as never as EntryStoreTestMutations).updateTranscriptToolCallEntry(
		sessionId,
		update
	);
}
