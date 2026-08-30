/**
 * SessionCreationCoordinator — owns the pending-creation session state,
 * session-open hydrator, and live state-graph consumer of the session store
 * (see docs/adr/0002).
 *
 * The parent `SessionStore` holds one instance. The coordinator owns the
 * creation-lifecycle slice; the parent delegates through verb methods.
 */

import type * as Effect from "effect/Effect";
import { SvelteMap } from "svelte/reactivity";
import type {
	InteractionSnapshot,
	SessionOpenFound,
	SessionStateGraph,
} from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import type { CreatedPendingSessionResult } from "./services/session-connection-manager.js";

export type CreatedSessionHydrator = {
	hydrateCreated(found: SessionOpenFound): Effect.Effect<void, AppError>;
};

export type LiveSessionStateGraphConsumer = {
	replaceSessionStateGraph(graph: SessionStateGraph): void;
	applySessionInteractionPatches?(snapshots: ReadonlyArray<InteractionSnapshot>): void;
};

export class SessionCreationCoordinator {
	#pendingCreationSessions = new SvelteMap<string, CreatedPendingSessionResult>();
	#sessionOpenHydrator: CreatedSessionHydrator | null = null;
	#liveSessionStateGraphConsumer: LiveSessionStateGraphConsumer | null = null;

	readonly #registerOptimisticSession?: (result: CreatedPendingSessionResult) => void;
	readonly #removeOptimisticSession?: (sessionId: string) => void;

	constructor(deps: {
		/**
		 * Register the optimistic cold session for a deferred creation so the
		 * agent panel resolves identity + title before canonical promotion.
		 */
		registerOptimisticSession?: (result: CreatedPendingSessionResult) => void;
		/** Remove the optimistic cold session if the creation fails pre-promotion. */
		removeOptimisticSession?: (sessionId: string) => void;
	}) {
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

	/**
	 * Undo `beginPendingCreation` for a creation that died before the backend
	 * confirmed it. The optimistic record was never materialized, so the row
	 * goes with the pending entry rather than lingering as a phantom.
	 */
	abandonPendingCreation(sessionId: string): void {
		if (!this.#pendingCreationSessions.has(sessionId)) {
			return;
		}
		this.#pendingCreationSessions.delete(sessionId);
		this.#removeOptimisticSession?.(sessionId);
	}

	hasPendingCreationSession(sessionId: string): boolean {
		return this.hasPendingCreation(sessionId);
	}

	hasSessionOpenHydrator(): boolean {
		return this.#sessionOpenHydrator !== null;
	}

	hydrateCreatedSession(found: SessionOpenFound): Effect.Effect<void, AppError> {
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
