/**
 * SessionWriteFacade — namespaced write surface for the session store (ADR-0002).
 */
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type { SessionOpenFound } from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import { SessionNotFoundError } from "../errors/app-error.js";
import { api } from "./api.js";
import type { ISessionStateWriter } from "./services/interfaces/index.js";
import type { SessionLifecycleCleanup } from "./session-lifecycle-cleanup.js";
import type { SessionListState } from "./session-list-state.svelte.js";
import type { SessionOpenSnapshotApplier } from "./session-open-snapshot-applier.svelte.js";
import type { SessionCold, SessionMutableColdUpdates } from "./types.js";

export type SessionWriteFacadeDeps = {
	readonly listState: SessionListState;
	readonly lifecycleCleanup: SessionLifecycleCleanup;
	readonly openSnapshotApplier: SessionOpenSnapshotApplier;
	readonly getSessionMetadata: (
		sessionId: string
	) => import("./types.js").SessionMetadata | undefined;
};

export class SessionWriteFacade implements ISessionStateWriter {
	readonly #deps: SessionWriteFacadeDeps;

	constructor(deps: SessionWriteFacadeDeps) {
		this.#deps = deps;
	}

	setSessions(sessions: SessionCold[]): void {
		this.#deps.listState.setSessions(sessions);
	}

	setLoading(_loading: boolean): void {
		// loading $state lives on SessionStore spine
	}

	addSession(session: SessionCold): void {
		this.#deps.listState.addSession(session);
	}

	updateSession(
		id: string,
		updates: SessionMutableColdUpdates,
		options?: { touchUpdatedAt?: boolean }
	): void {
		this.#deps.listState.updateSession(id, updates, options);
	}

	removeSession(sessionId: string): void {
		this.#deps.lifecycleCleanup.removeSession(sessionId);
	}

	replaceSessionOpenSnapshot(snapshot: SessionOpenFound): void {
		this.#deps.openSnapshotApplier.replaceSessionOpenSnapshot(snapshot);
	}

	addScanningProjects(paths: string[]): void {
		this.#deps.listState.addScanningProjects(paths);
	}

	removeScanningProjects(paths: string[]): void {
		this.#deps.listState.removeScanningProjects(paths);
	}

	renameSession(sessionId: string, title: string): ResultAsync<void, AppError> {
		const sessionMetadata = this.#deps.getSessionMetadata(sessionId);
		if (!sessionMetadata) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const trimmedTitle = title.trim();
		if (trimmedTitle === "" || trimmedTitle === sessionMetadata.title) {
			return okAsync(undefined);
		}

		return api.setSessionTitle(sessionId, trimmedTitle).map(() => {
			this.updateSession(
				sessionId,
				{
					title: trimmedTitle,
				},
				{ touchUpdatedAt: false }
			);
			return undefined;
		});
	}
}
