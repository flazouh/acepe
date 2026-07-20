/**
 * AwaitingModelRefreshStore — owns the awaiting-model refresh timer state of the
 * session store (see docs/adr/0002). Manages per-session timers that trigger a
 * session-state snapshot refresh when a session has been stuck in the
 * "awaiting_model" activity for too long, preventing stale UI.
 *
 * The parent `SessionStore` holds one instance and calls the public methods
 * from its lifecycle/disconnect paths.
 */
import type { ResultAsync } from "neverthrow";
import type { SessionGraphActivity, SessionTurnState } from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";

const logger = createLogger({ id: "awaiting-model-refresh", name: "AwaitingModelRefreshStore" });

const AWAITING_MODEL_SNAPSHOT_REFRESH_MS = 5_000;

type InflightSessionStateRefresh = ResultAsync<void, AppError>;

export interface AwaitingModelRefreshDeps {
	refreshSessionStateSnapshot: (sessionId: string) => InflightSessionStateRefresh;
	getCanonicalProjection: (sessionId: string) => CanonicalSessionProjection | null;
}

export class AwaitingModelRefreshStore {
	readonly #deps: AwaitingModelRefreshDeps;

	private readonly timerMap = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(deps: AwaitingModelRefreshDeps) {
		this.#deps = deps;
	}

	syncAwaitingModelRefreshTimer(
		sessionId: string,
		activity: SessionGraphActivity,
		turnState: SessionTurnState
	): void {
		this.clearAwaitingModelRefreshTimer(sessionId);
		if (activity.kind !== "awaiting_model" && turnState !== "Running") {
			return;
		}

		const timerId = setTimeout(() => {
			this.timerMap.delete(sessionId);
			const projection = this.#deps.getCanonicalProjection(sessionId);
			if (
				projection === null ||
				(projection.activity.kind !== "awaiting_model" && projection.turnState !== "Running")
			) {
				return;
			}
			logger.warn("Refreshing session-state snapshot after stale awaiting-model state", {
				sessionId,
				graphRevision: projection.revision.graphRevision,
				lastEventSeq: projection.revision.lastEventSeq,
			});
			void this.#deps.refreshSessionStateSnapshot(sessionId).match(
				() => undefined,
				() => undefined
			);
		}, AWAITING_MODEL_SNAPSHOT_REFRESH_MS);
		this.timerMap.set(sessionId, timerId);
	}

	clearAwaitingModelRefreshTimer(sessionId: string): void {
		const timerId = this.timerMap.get(sessionId);
		if (timerId === undefined) {
			return;
		}
		clearTimeout(timerId);
		this.timerMap.delete(sessionId);
	}

	clearAllAwaitingModelRefreshTimers(): void {
		for (const timerId of this.timerMap.values()) {
			clearTimeout(timerId);
		}
		this.timerMap.clear();
	}
}
