/**
 * SessionLifecycleCleanup — cross-slice teardown when removing a session or
 * clearing cached transcript/graph projection (see docs/adr/0002).
 */
import * as preferencesStore from "./agent-model-preferences-store.svelte.js";
import type { ComposerMachineService } from "./composer-machine-service.svelte.js";
import type { SessionEntryStore } from "./session-entry-store.svelte.js";
import type { SessionMessagingService } from "./services/session-messaging-service.js";
import type { SessionRepository } from "./services/session-repository.js";
import type { SessionProjectionCore } from "./session-projection-core.svelte.js";
import type { SessionTransientProjectionStore } from "./session-transient-projection-store.svelte.js";
import type { ViewportProjectionController } from "./viewport-projection-controller.svelte.js";

export type SessionLifecycleCleanupDeps = {
	readonly repository: SessionRepository;
	readonly transientProjectionStore: SessionTransientProjectionStore;
	readonly projectionCore: SessionProjectionCore;
	readonly viewport: ViewportProjectionController;
	readonly messagingSvc: SessionMessagingService;
	readonly composerMachineService: ComposerMachineService;
	readonly entryStore: SessionEntryStore;
	readonly onRemoveCallbacks: ReadonlyArray<(sessionId: string) => void>;
};

export class SessionLifecycleCleanup {
	readonly #deps: SessionLifecycleCleanupDeps;

	constructor(deps: SessionLifecycleCleanupDeps) {
		this.#deps = deps;
	}

	removeSession(sessionId: string): void {
		this.#deps.repository.removeSession(sessionId);
		this.#deps.transientProjectionStore.removeTransientProjection(sessionId);
		this.#deps.projectionCore.canonicalProjections.delete(sessionId);
		this.#deps.projectionCore.sessionStateGraphs.delete(sessionId);
		this.#deps.viewport.removeSession(sessionId);
		this.#deps.projectionCore.canonicalCapabilitiesMaterialized.delete(sessionId);
		this.#deps.projectionCore.rowTokenStreamsByRowId.delete(sessionId);
		this.#deps.messagingSvc.clearSessionState(sessionId);
		this.#deps.composerMachineService.removeMachine(sessionId);
		preferencesStore.clearSessionModelPerMode(sessionId);
		for (const callback of this.#deps.onRemoveCallbacks) {
			callback(sessionId);
		}
	}

	clearSessionEntries(sessionId: string): void {
		this.#deps.entryStore.clearEntries(sessionId);
		this.#deps.projectionCore.sessionStateGraphs.delete(sessionId);
		this.#deps.projectionCore.canonicalProjections.delete(sessionId);
		this.#deps.projectionCore.rowTokenStreamsByRowId.delete(sessionId);
		this.#deps.messagingSvc.clearSessionState(sessionId);
	}
}
