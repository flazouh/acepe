/**
 * SessionStateRefreshController — deduplicated canonical snapshot refresh for
 * the session store (see docs/adr/0002).
 */
import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import type { SessionStateEnvelope } from "../../services/acp-types.js";
import { AgentError, AppError, SessionNotFoundError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import { api } from "./api.js";

const logger = createLogger({
	id: "session-state-refresh-controller",
	name: "SessionStateRefreshController",
});

type InflightSessionStateRefresh = Effect.Effect<void, AppError>;

export type SessionStateRefreshControllerDeps = {
	readonly applySessionStateEnvelope: (sessionId: string, envelope: SessionStateEnvelope) => void;
};

function toRefreshError(error: unknown): AppError {
	if (error instanceof AppError) {
		return error;
	}
	return new AgentError(
		"refreshSessionStateSnapshot",
		error instanceof Error ? error : new Error(String(error))
	);
}

export class SessionStateRefreshController {
	readonly #deps: SessionStateRefreshControllerDeps;
	readonly #inflightSessionStateRefreshes = new Map<string, Promise<void>>();

	constructor(deps: SessionStateRefreshControllerDeps) {
		this.#deps = deps;
	}

	refreshCanonicalSessionState(sessionId: string): Effect.Effect<void, AppError> {
		return this.refreshSessionStateSnapshot(sessionId);
	}

	refreshSessionStateSnapshot(sessionId: string): InflightSessionStateRefresh {
		const existing = this.#inflightSessionStateRefreshes.get(sessionId);
		if (existing) {
			return fromPromise(() => existing, toRefreshError);
		}

		const pending = Effect.runPromise(
			api.fetchCanonicalSessionStateEnvelope(sessionId).pipe(
				Effect.flatMap((envelope) => {
					this.#inflightSessionStateRefreshes.delete(sessionId);
					if (envelope.payload.kind !== "snapshot") {
						return Effect.fail(new SessionNotFoundError(sessionId));
					}

					this.#deps.applySessionStateEnvelope(sessionId, envelope);
					return Effect.succeed(undefined);
				}),
				Effect.catch((error) => {
					this.#inflightSessionStateRefreshes.delete(sessionId);
					logger.error("Failed to refresh session-state snapshot", {
						sessionId,
						error,
					});
					return Effect.fail(error);
				})
			)
		);

		this.#inflightSessionStateRefreshes.set(sessionId, pending);
		return fromPromise(() => pending, toRefreshError);
	}
}
