/**
 * SessionStateRefreshController — deduplicated canonical snapshot refresh for
 * the session store (see docs/adr/0002).
 */
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type { SessionStateEnvelope } from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import { SessionNotFoundError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import { api } from "./api.js";

const logger = createLogger({
	id: "session-state-refresh-controller",
	name: "SessionStateRefreshController",
});

type InflightSessionStateRefresh = ResultAsync<void, AppError>;

export type SessionStateRefreshControllerDeps = {
	readonly applySessionStateEnvelope: (
		sessionId: string,
		envelope: SessionStateEnvelope
	) => void;
};

export class SessionStateRefreshController {
	readonly #deps: SessionStateRefreshControllerDeps;
	readonly #inflightSessionStateRefreshes = new Map<string, InflightSessionStateRefresh>();

	constructor(deps: SessionStateRefreshControllerDeps) {
		this.#deps = deps;
	}

	refreshCanonicalSessionState(sessionId: string): ResultAsync<void, AppError> {
		return this.refreshSessionStateSnapshot(sessionId);
	}

	refreshSessionStateSnapshot(sessionId: string): InflightSessionStateRefresh {
		const existing = this.#inflightSessionStateRefreshes.get(sessionId);
		if (existing) {
			return existing;
		}

		const refresh = api
			.fetchCanonicalSessionStateEnvelope(sessionId)
			.andThen((envelope) => {
				this.#inflightSessionStateRefreshes.delete(sessionId);
				if (envelope.payload.kind !== "snapshot") {
					return errAsync(new SessionNotFoundError(sessionId));
				}

				this.#deps.applySessionStateEnvelope(sessionId, envelope);
				return okAsync(undefined);
			})
			.orElse((error) => {
				this.#inflightSessionStateRefreshes.delete(sessionId);
				logger.error("Failed to refresh session-state snapshot", {
					sessionId,
					error,
				});
				return errAsync(error);
			});

		this.#inflightSessionStateRefreshes.set(sessionId, refresh);
		return refresh;
	}
}
