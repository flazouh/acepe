import { ResultAsync, okAsync, type ResultAsync as ResultAsyncType } from "neverthrow";
import type { SessionProjectionSnapshot } from "../../../services/acp-types.js";
import { AgentError, AppError } from "../../errors/app-error.js";
import { api } from "../api.js";

interface SessionProjectionConsumer {
	replaceSessionProjection(projection: SessionProjectionSnapshot): void;
	clearSession(sessionId: string): void;
}

export class SessionProjectionHydrator {
	private readonly inflight = new Map<string, ResultAsyncType<void, AppError>>();
	private readonly queuedRefreshes = new Set<string>();

	constructor(private readonly interactions: SessionProjectionConsumer) {}

	hydrateSession(sessionId: string): ResultAsync<void, AppError> {
		const existing = this.inflight.get(sessionId);
		if (existing !== undefined) {
			this.queuedRefreshes.add(sessionId);
			return existing;
		}

		const request = ResultAsync.fromPromise(
			this.hydrateUntilSettled(sessionId),
			(error) => toAppError(error)
		);

		this.inflight.set(sessionId, request);
		void request.match(
			() => {
				this.inflight.delete(sessionId);
			},
			() => {
				this.inflight.delete(sessionId);
			}
		);
		return request;
	}

	clearSession(sessionId: string): void {
		this.queuedRefreshes.delete(sessionId);
		this.interactions.clearSession(sessionId);
	}

	private async hydrateUntilSettled(sessionId: string): Promise<void> {
		while (true) {
			this.queuedRefreshes.delete(sessionId);
			const result = await api.getSessionProjection(sessionId).match(
				(projection) => {
					this.interactions.replaceSessionProjection(projection);
					return { ok: true as const };
				},
				(error) => ({ ok: false as const, error })
			);
			if (!result.ok) {
				throw result.error;
			}

			if (!this.queuedRefreshes.has(sessionId)) {
				return;
			}
		}
	}
}

function toAppError(error: AppError | Error | unknown): AppError {
	if (error instanceof AppError) {
		return error;
	}

	return new AgentError(
		"getSessionProjection",
		error instanceof Error ? error : new Error(String(error))
	);
}
