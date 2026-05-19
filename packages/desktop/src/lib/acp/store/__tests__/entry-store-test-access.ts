import type { SessionEntry } from "../types.js";
import type { SessionEntryStore } from "../session-entry-store.svelte.js";

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
