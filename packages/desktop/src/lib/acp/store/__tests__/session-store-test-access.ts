import type { SessionUpdate } from "$lib/services/converted-session-types.js";
import type { SessionStore } from "../session-store.svelte.js";

export function deliverDiagnosticSessionUpdate(store: SessionStore, update: SessionUpdate): void {
	store.eventService.handleSessionUpdate(update, store);
}
