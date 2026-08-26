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

// A definitive answer (the fetch itself fails, e.g. a real SESSION_NOT_FOUND
// from the transport) is not a transient hiccup worth hammering forever.
// Callers that resync a refresh on a timer (AwaitingModelRefreshStore) or on
// every graph patch that outruns the canonical projection
// (reduce-command.ts's reduceApplyGraphPatches) would otherwise retry
// indefinitely -- the 90+ second SESSION_NOT_FOUND loop from AC issue #266.
// Cap consecutive failures per session; a later success resets the count.
const MAX_CONSECUTIVE_REFRESH_FAILURES = 3;

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
	readonly #consecutiveFailureCounts = new Map<string, number>();

	constructor(deps: SessionStateRefreshControllerDeps) {
		this.#deps = deps;
	}

	refreshCanonicalSessionState(sessionId: string): Effect.Effect<void, AppError> {
		return this.refreshSessionStateSnapshot(sessionId);
	}

	/**
	 * True once this session has failed to refresh
	 * MAX_CONSECUTIVE_REFRESH_FAILURES times in a row with no success in
	 * between. Callers that would otherwise keep re-arming a refresh (e.g.
	 * AwaitingModelRefreshStore's stuck-turn timer) should stop scheduling
	 * more attempts once this is true instead of retrying forever.
	 */
	hasGivenUpOnSession(sessionId: string): boolean {
		return (this.#consecutiveFailureCounts.get(sessionId) ?? 0) >= MAX_CONSECUTIVE_REFRESH_FAILURES;
	}

	refreshSessionStateSnapshot(sessionId: string): InflightSessionStateRefresh {
		const existing = this.#inflightSessionStateRefreshes.get(sessionId);
		if (existing) {
			return fromPromise(() => existing, toRefreshError);
		}

		if (this.hasGivenUpOnSession(sessionId)) {
			return Effect.fail(new SessionNotFoundError(sessionId));
		}

		// A fully synchronous effect (e.g. a test double built from
		// Effect.succeed/Effect.fail, with no real I/O) can run to completion --
		// including the cleanup below -- before Effect.runPromise even returns,
		// which would otherwise make the `.set()` after it insert an
		// already-stale entry that never gets cleaned up again. `settled` makes
		// cleanup idempotent and lets the post-run `.set()` below no-op when
		// that already happened.
		let settled = false;
		const cleanupInflightEntry = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			this.#inflightSessionStateRefreshes.delete(sessionId);
		};

		const pending = Effect.runPromise(
			api.fetchCanonicalSessionStateEnvelope(sessionId).pipe(
				Effect.flatMap((envelope) => {
					cleanupInflightEntry();
					this.#consecutiveFailureCounts.delete(sessionId);
					// Every payload kind SessionStateEnvelope can carry (snapshot,
					// lifecycle, capabilities, telemetry, ...) is a real, current fact
					// about this session -- routeSessionStateEnvelope already knows how
					// to turn each one into a canonical-projection update.
					// getSessionState (the only implementation behind
					// fetchCanonicalSessionStateEnvelope under the Bun/Electrobun
					// backend) intentionally answers with the narrower "lifecycle"
					// kind, never "snapshot". Treating "not a snapshot" as
					// SessionNotFoundError turned every refresh into a false-positive
					// SESSION_NOT_FOUND, for any session, real or not (AC issue #266).
					// A genuine "no such session" is not representable as a payload
					// kind on this endpoint today -- it must come from the fetch
					// itself failing (see the Effect.catch below).
					this.#deps.applySessionStateEnvelope(sessionId, envelope);
					return Effect.succeed(undefined);
				}),
				Effect.catch((error) => {
					cleanupInflightEntry();
					const nextFailureCount = (this.#consecutiveFailureCounts.get(sessionId) ?? 0) + 1;
					this.#consecutiveFailureCounts.set(sessionId, nextFailureCount);
					if (nextFailureCount >= MAX_CONSECUTIVE_REFRESH_FAILURES) {
						logger.error(
							"Giving up on session-state snapshot refresh after repeated failures; further automatic retries for this session are suppressed",
							{ sessionId, consecutiveFailures: nextFailureCount, error }
						);
					} else {
						logger.error("Failed to refresh session-state snapshot", {
							sessionId,
							consecutiveFailures: nextFailureCount,
							error,
						});
					}
					return Effect.fail(error);
				})
			)
		);

		if (!settled) {
			this.#inflightSessionStateRefreshes.set(sessionId, pending);
		}
		return fromPromise(() => pending, toRefreshError);
	}
}
