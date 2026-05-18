import type { SessionEntry } from "../types.js";
import type { SessionEntryStore } from "../session-entry-store.svelte.js";

type CompatibilityEntryReader = {
	getEntries(sessionId: string): SessionEntry[];
};

export function readCompatibilityEntries(
	store: SessionEntryStore,
	sessionId: string
): SessionEntry[] {
	return (store as never as CompatibilityEntryReader).getEntries(sessionId);
}
