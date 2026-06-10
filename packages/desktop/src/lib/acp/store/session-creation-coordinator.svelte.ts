/**
 * SessionCreationCoordinator — owns the pending-creation session state,
 * session-open hydrator, and live state-graph consumer of the session store
 * (see docs/adr/0002).
 *
 * The parent `SessionStore` holds one instance. The coordinator owns the
 * state maps and references; the parent's public creation/loading methods
 * read/write these through the coordinator's public fields.
 */
import { SvelteMap } from "svelte/reactivity";
import type { ResultAsync } from "neverthrow";
import type { AppError } from "../errors/app-error.js";
import type { InteractionSnapshot, SessionOpenFound } from "../../services/acp-types.js";
import type { SessionStateGraph } from "../../services/acp-types.js";
import type { TurnErrorUpdate } from "../types/turn-error.js";
import type { SessionMessagingService } from "./services/session-messaging-service.js";
import type { CreatedPendingSessionResult } from "./services/session-connection-manager.js";

export type CreatedSessionHydrator = {
	hydrateCreated(found: SessionOpenFound): ResultAsync<void, AppError>;
};

export type LiveSessionStateGraphConsumer = {
	replaceSessionStateGraph(graph: SessionStateGraph): void;
	applySessionInteractionPatches?(snapshots: ReadonlyArray<InteractionSnapshot>): void;
};

export class SessionCreationCoordinator {
	readonly pendingCreationSessions = new SvelteMap<string, CreatedPendingSessionResult>();
	sessionOpenHydrator: CreatedSessionHydrator | null = null;
	liveSessionStateGraphConsumer: LiveSessionStateGraphConsumer | null = null;

	readonly #messagingSvc: SessionMessagingService;
	readonly #onTurnError?: (sessionId: string) => void;

	constructor(deps: {
		messagingSvc: SessionMessagingService;
		onTurnError?: (sessionId: string) => void;
	}) {
		this.#messagingSvc = deps.messagingSvc;
		this.#onTurnError = deps.onTurnError;
	}

	hasPendingCreationSession(sessionId: string): boolean {
		return this.pendingCreationSessions.has(sessionId);
	}

	failPendingCreationSession(sessionId: string, update: TurnErrorUpdate): void {
		if (!this.pendingCreationSessions.has(sessionId)) {
			return;
		}
		this.#messagingSvc.handleCanonicalTurnFailure(sessionId, update);
		this.pendingCreationSessions.delete(sessionId);
		this.#onTurnError?.(sessionId);
	}
}
