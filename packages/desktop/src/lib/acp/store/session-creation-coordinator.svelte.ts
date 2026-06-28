/**
 * SessionCreationCoordinator — owns the pending-creation session state,
 * session-open hydrator, and live state-graph consumer of the session store
 * (see docs/adr/0002).
 *
 * The parent `SessionStore` holds one instance. The coordinator owns the
 * creation-lifecycle slice; the parent delegates through verb methods.
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
	#pendingCreationSessions = new SvelteMap<string, CreatedPendingSessionResult>();
	#sessionOpenHydrator: CreatedSessionHydrator | null = null;
	#liveSessionStateGraphConsumer: LiveSessionStateGraphConsumer | null = null;

	readonly #messagingSvc: SessionMessagingService;
	readonly #onTurnError?: (sessionId: string) => void;
	readonly #registerOptimisticSession?: (result: CreatedPendingSessionResult) => void;
	readonly #removeOptimisticSession?: (sessionId: string) => void;

	constructor(deps: {
		messagingSvc: SessionMessagingService;
		onTurnError?: (sessionId: string) => void;
		/**
		 * Register the optimistic cold session for a deferred creation so the
		 * agent panel resolves identity + title before canonical promotion.
		 */
		registerOptimisticSession?: (result: CreatedPendingSessionResult) => void;
		/** Remove the optimistic cold session if the creation fails pre-promotion. */
		removeOptimisticSession?: (sessionId: string) => void;
	}) {
		this.#messagingSvc = deps.messagingSvc;
		this.#onTurnError = deps.onTurnError;
		this.#registerOptimisticSession = deps.registerOptimisticSession;
		this.#removeOptimisticSession = deps.removeOptimisticSession;
	}

	attachSessionConsumers(consumers: {
		sessionOpenHydrator?: CreatedSessionHydrator;
		liveSessionStateGraphConsumer?: LiveSessionStateGraphConsumer;
	}): void {
		if (consumers.sessionOpenHydrator !== undefined) {
			this.#sessionOpenHydrator = consumers.sessionOpenHydrator;
		}
		if (consumers.liveSessionStateGraphConsumer !== undefined) {
			this.#liveSessionStateGraphConsumer = consumers.liveSessionStateGraphConsumer;
		}
	}

	beginPendingCreation(sessionId: string, result: CreatedPendingSessionResult): void {
		this.#pendingCreationSessions.set(sessionId, result);
		this.#registerOptimisticSession?.(result);
	}

	hasPendingCreation(sessionId: string): boolean {
		return this.#pendingCreationSessions.has(sessionId);
	}

	getPendingCreation(sessionId: string): CreatedPendingSessionResult | null {
		return this.#pendingCreationSessions.get(sessionId) ?? null;
	}

	completePendingCreation(sessionId: string): void {
		this.#pendingCreationSessions.delete(sessionId);
	}

	failPendingCreation(sessionId: string, update: TurnErrorUpdate): void {
		if (!this.#pendingCreationSessions.has(sessionId)) {
			return;
		}
		this.#messagingSvc.handleCanonicalTurnFailure(sessionId, update);
		this.#pendingCreationSessions.delete(sessionId);
		// Drop the optimistic cold record — the session was never confirmed by
		// the backend, so it must not linger as a phantom list row.
		this.#removeOptimisticSession?.(sessionId);
		this.#onTurnError?.(sessionId);
	}

	hasPendingCreationSession(sessionId: string): boolean {
		return this.hasPendingCreation(sessionId);
	}

	failPendingCreationSession(sessionId: string, update: TurnErrorUpdate): void {
		this.failPendingCreation(sessionId, update);
	}

	hasSessionOpenHydrator(): boolean {
		return this.#sessionOpenHydrator !== null;
	}

	hydrateCreatedSession(found: SessionOpenFound): ResultAsync<void, AppError> {
		if (this.#sessionOpenHydrator === null) {
			throw new Error("SessionCreationCoordinator: session open hydrator is not attached");
		}
		return this.#sessionOpenHydrator.hydrateCreated(found);
	}

	replaceLiveSessionStateGraph(graph: SessionStateGraph): void {
		this.#liveSessionStateGraphConsumer?.replaceSessionStateGraph(graph);
	}

	applyLiveSessionInteractionPatches(snapshots: ReadonlyArray<InteractionSnapshot>): void {
		this.#liveSessionStateGraphConsumer?.applySessionInteractionPatches?.(snapshots);
	}
}
