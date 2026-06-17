/**
 * Session Store - Consolidated session management.
 *
 * Canonical session truth comes from Rust-authored SessionStateGraph envelopes.
 * Namespaced facades (read, write, connection, loading, presentation, composer,
 * viewport) delegate to composed sub-stores (see docs/adr/0002).
 */

import type { ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import type { SessionOpenFound, SessionStateEnvelope, SessionStateGraph, TranscriptDelta, SessionGraphRevision } from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import type { SessionEventHandler } from "./session-event-handler.js";
import type { SessionUsageTelemetry } from "./types.js";
import type { TurnErrorUpdate } from "../types/turn-error.js";
import type { SessionCold, SessionIdentity } from "./types.js";
import type { ViewportProjectionController } from "./viewport-projection-controller.svelte.js";
import type { SessionReadFacade } from "./session-read-facade.js";
import type { SessionWriteFacade } from "./session-write-facade.js";
import type { SessionConnectionManager } from "./services/session-connection-manager.js";
import type { SessionConnectionFacade } from "./session-connection-facade.js";
import type { SessionLoadingFacade } from "./session-loading-facade.js";
import type { ComposerMachineService } from "./composer-machine-service.svelte.js";
import type { SessionPresentationModel } from "./session-presentation-model.js";
import type { SessionEntryStore } from "./session-entry-store.svelte.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import { composeSessionStoreParts, type SessionStoreParts } from "./session-store-compose.js";

export {
	mergeInteractionSnapshots,
	mergeOperationSnapshots,
	operationSnapshotIndexes,
} from "./snapshot-merge.js";
export type { SessionQuestionInteractionSnapshot } from "./session-presentation-model.js";

const SESSION_STORE_KEY = Symbol("session-store");
let currentSessionStore: SessionStore | null = null;

export type CreatedSessionHydrator = {
	hydrateCreated(found: SessionOpenFound): ResultAsync<void, AppError>;
};

export type SessionCreationResult =
	| { readonly kind: "ready"; readonly session: SessionCold }
	| import("./services/session-connection-manager.js").CreatedPendingSessionResult;

export type LiveSessionStateGraphConsumer = {
	replaceSessionStateGraph(graph: SessionStateGraph): void;
	applySessionInteractionPatches?(snapshots: ReadonlyArray<import("../../services/acp-types.js").InteractionSnapshot>): void;
};

export interface SessionStoreCallbacks {
	onPlanUpdate?: (sessionId: string, planData: import("../../services/converted-session-types.js").PlanData) => void;
	onTurnComplete?: (sessionId: string) => void;
	onTurnInterrupted?: (sessionId: string) => void;
	onTurnError?: (sessionId: string) => void;
}

export class SessionStore implements SessionEventHandler {
	/** Global sessions list loading flag (distinct from the loading facade). */
	sessionsLoading = $state(false);

	readonly read: SessionReadFacade;
	readonly write: SessionWriteFacade;
	readonly presentation: SessionPresentationModel;
	readonly composer: ComposerMachineService;
	readonly connection: SessionConnectionFacade;
	readonly loading: SessionLoadingFacade;
	readonly viewport: ViewportProjectionController;

	readonly #parts: SessionStoreParts;

	get scanningProjectPaths(): SvelteSet<string> {
		return this.#parts.listState.scanningProjectPaths;
	}

	constructor() {
		const spine = {
			applySessionStateEnvelope: (sessionId: string, envelope: SessionStateEnvelope) => {
				this.#parts.envelopeApplier.applySessionStateEnvelope(sessionId, envelope);
			},
			updateUsageTelemetry: (sessionId: string, telemetry: SessionUsageTelemetry) => {
				this.#parts.transientProjectionStore.updateTransientProjection(sessionId, {
					usageTelemetry: telemetry,
				});
			},
		};

		this.#parts = composeSessionStoreParts({
			setLoading: (loading) => {
				this.sessionsLoading = loading;
			},
			applySessionStateEnvelope: spine.applySessionStateEnvelope,
			updateUsageTelemetry: spine.updateUsageTelemetry,
		});

		this.read = this.#parts.read;
		this.write = this.#parts.write;
		this.presentation = this.#parts.presentation;
		this.composer = this.#parts.composer;
		this.connection = this.#parts.connection;
		this.loading = this.#parts.loading;
		this.viewport = this.#parts.viewport;
	}

	// SessionEventHandler shim — narrow surface for event service
	getSessionCold(sessionId: string): SessionCold | undefined {
		return this.read.getSessionCold(sessionId);
	}

	getSessionIdentity(sessionId: string): SessionIdentity | undefined {
		return this.read.getSessionIdentity(sessionId);
	}

	getSessionCanSend(sessionId: string): boolean | null {
		return this.read.getSessionCanSend(sessionId);
	}

	hasPendingCreationSession(sessionId: string): boolean {
		return this.connection.hasPendingCreationSession(sessionId);
	}

	materializePendingCreationSession(sessionId: string): boolean {
		return this.connection.materializePendingCreationSession(sessionId);
	}

	failPendingCreationSession(sessionId: string, update: TurnErrorUpdate): void {
		this.connection.failPendingCreationSession(sessionId, update);
	}

	ensureSessionFromStateGraph(graph: SessionStateGraph): boolean {
		return this.#parts.openSnapshotApplier.ensureSessionFromStateGraph(graph);
	}

	updateUsageTelemetry(sessionId: string, telemetry: SessionUsageTelemetry): void {
		this.#parts.transientProjectionStore.updateTransientProjection(sessionId, {
			usageTelemetry: telemetry,
		});
	}

	applySessionStateEnvelope(sessionId: string, envelope: SessionStateEnvelope): void {
		this.#parts.envelopeApplier.applySessionStateEnvelope(sessionId, envelope);
	}

	applySessionStateGraph(graph: SessionStateGraph): void {
		this.#parts.envelopeApplier.applySessionStateGraph(graph);
	}

	applyTranscriptDelta(
		sessionId: string,
		delta: TranscriptDelta,
		revision?: SessionGraphRevision
	): void {
		this.#parts.envelopeApplier.applyTranscriptDelta(sessionId, delta, revision);
	}

	refreshCanonicalSessionState(sessionId: string): ResultAsync<void, AppError> {
		return this.#parts.stateRefreshController.refreshCanonicalSessionState(sessionId);
	}

	setCallbacks(callbacks: SessionStoreCallbacks): void {
		this.#parts.setCallbacks(callbacks);
	}

	onSessionRemoved(callback: (sessionId: string) => void): void {
		this.#parts.onRemoveCallbacks.push(callback);
	}

	clearSessionEntries(sessionId: string): void {
		this.#parts.lifecycleCleanup.clearSessionEntries(sessionId);
	}

	initializeSessionUpdates(): ResultAsync<void, AppError> {
		return this.#parts.eventService.initializeSessionUpdates(this);
	}

	cleanupSessionUpdates(): void {
		this.#parts.eventService.cleanupSessionUpdates();
		this.#parts.awaitingModelRefresh.clearAllAwaitingModelRefreshTimers();
	}

	getSessionStateGraphForTest(sessionId: string): SessionStateGraph | null {
		return this.#parts.getSessionStateGraphs().get(sessionId) ?? null;
	}

	/** Test seam — vitest stubs connection manager behavior through this reference. */
	get connectionMgr(): SessionConnectionManager {
		return this.#parts.connectionMgrRef.current;
	}

	set connectionMgr(mgr: SessionConnectionManager) {
		this.#parts.connectionMgrRef.current = mgr;
	}

	/** Test seam — event service for diagnostic update tests */
	get eventService(): SessionStoreParts["eventService"] {
		return this.#parts.eventService;
	}

	/** Test seam — entry store white-box access for projection tests */
	get entryStore(): SessionEntryStore {
		return this.#parts.entryStore;
	}

	/** Test seam — canonical projection map for parity/projection tests */
	get canonicalProjections(): import("svelte/reactivity").SvelteMap<string, CanonicalSessionProjection> {
		return this.#parts.projectionCore.canonicalProjections;
	}

	// White-box test seam — list indexes used by session-store-rename tests
	private get sessions(): SessionCold[] {
		return this.#parts.listState.sessions;
	}

	private get sessionsByProject(): import("svelte/reactivity").SvelteMap<string, SessionCold[]> {
		return this.#parts.listState.sessionsByProject;
	}
}

export function createSessionStore(): SessionStore {
	const store = new SessionStore();
	currentSessionStore = store;
	setContext(SESSION_STORE_KEY, store);
	return store;
}

export function getSessionStore(): SessionStore {
	const contextStore = getContext<SessionStore | undefined>(SESSION_STORE_KEY);
	if (contextStore !== undefined) {
		return contextStore;
	}
	if (currentSessionStore !== null) {
		return currentSessionStore;
	}
	const store = new SessionStore();
	currentSessionStore = store;
	return store;
}
