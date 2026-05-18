import type { SessionEntry } from "../types.js";
import type { SessionEntryStore } from "../session-entry-store.svelte.js";

type CompatibilityEntryStorage = {
	entriesById: {
		get(sessionId: string): SessionEntry[] | undefined;
	};
};

export function readCompatibilityEntries(
	store: SessionEntryStore,
	sessionId: string
): SessionEntry[] {
	return (store as never as CompatibilityEntryStorage).entriesById.get(sessionId) ?? [];
}
