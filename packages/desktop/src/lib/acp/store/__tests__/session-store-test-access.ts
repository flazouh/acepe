import type { SessionUpdate } from "$lib/services/converted-session-types.js";
import type { SessionStore } from "../session-store.svelte.js";

type DiagnosticSessionUpdateAccess = {
	eventService: {
		handleSessionUpdate(update: SessionUpdate, handler: SessionStore): void;
	};
};

export function deliverDiagnosticSessionUpdate(store: SessionStore, update: SessionUpdate): void {
	(store as never as DiagnosticSessionUpdateAccess).eventService.handleSessionUpdate(update, store);
}
