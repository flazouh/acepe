import { ResultAsync, type ResultAsync as ResultAsyncType } from "neverthrow";
import type { InteractionSnapshot, SessionProjectionSnapshot } from "../../../services/acp-types.js";
import { AgentError, AppError } from "../../errors/app-error.js";
import { api } from "../api.js";

interface SessionProjectionConsumer {
	replaceSessionProjection(projection: SessionProjectionSnapshot): void;
	clearSession(sessionId: string): void;
}

export interface SessionProjectionHydrationOptions {
	readonly includePendingTurnInputs?: boolean;
}

export class SessionProjectionHydrator {
	private readonly inflight = new Map<string, ResultAsyncType<void, AppError>>();
	private readonly inflightPendingTurnInputs = new Map<string, boolean>();
	private readonly queuedRefreshes = new Map<string, boolean>();

	constructor(private readonly interactions: SessionProjectionConsumer) {}

	hydrateSession(
		sessionId: string,
		options?: SessionProjectionHydrationOptions
	): ResultAsync<void, AppError> {
		const includePendingTurnInputs = options?.includePendingTurnInputs ?? true;
		const existing = this.inflight.get(sessionId);
		if (existing !== undefined) {
			const inflightIncludePendingTurnInputs =
				this.inflightPendingTurnInputs.get(sessionId) ?? true;
			const queuedIncludePendingTurnInputs =
				this.queuedRefreshes.get(sessionId) ?? inflightIncludePendingTurnInputs;
			const desiredIncludePendingTurnInputs =
				queuedIncludePendingTurnInputs || includePendingTurnInputs;
			if (desiredIncludePendingTurnInputs !== inflightIncludePendingTurnInputs) {
				this.queuedRefreshes.set(sessionId, desiredIncludePendingTurnInputs);
			}
			return existing;
		}

		const request = ResultAsync.fromPromise(
			this.hydrateUntilSettled(sessionId, includePendingTurnInputs),
			(error) => toAppError(error)
		);

		this.inflight.set(sessionId, request);
		this.inflightPendingTurnInputs.set(sessionId, includePendingTurnInputs);
		void request.match(
			() => {
				this.inflight.delete(sessionId);
				this.inflightPendingTurnInputs.delete(sessionId);
			},
			() => {
				this.inflight.delete(sessionId);
				this.inflightPendingTurnInputs.delete(sessionId);
			}
		);
		return request;
	}

	clearSession(sessionId: string): void {
		this.queuedRefreshes.delete(sessionId);
		this.interactions.clearSession(sessionId);
	}

	private async hydrateUntilSettled(
		sessionId: string,
		includePendingTurnInputs: boolean
	): Promise<void> {
		let currentIncludePendingTurnInputs = includePendingTurnInputs;
		while (true) {
			this.inflightPendingTurnInputs.set(sessionId, currentIncludePendingTurnInputs);
			const result = await api.getSessionProjection(sessionId).match(
				(projection) => {
					this.interactions.replaceSessionProjection(
						currentIncludePendingTurnInputs ? projection : stripPendingTurnInputs(projection)
					);
					return { ok: true as const };
				},
				(error) => ({ ok: false as const, error })
			);
			if (!result.ok) {
				throw result.error;
			}

			const queuedIncludePendingTurnInputs = this.queuedRefreshes.get(sessionId);
			if (
				queuedIncludePendingTurnInputs === undefined ||
				queuedIncludePendingTurnInputs === currentIncludePendingTurnInputs
			) {
				this.queuedRefreshes.delete(sessionId);
				return;
			}

			this.queuedRefreshes.delete(sessionId);
			currentIncludePendingTurnInputs = queuedIncludePendingTurnInputs;
		}
	}
}

function stripPendingTurnInputs(
	projection: SessionProjectionSnapshot
): SessionProjectionSnapshot {
	return {
		session: projection.session,
		operations: projection.operations,
		interactions: projection.interactions.filter(
			(interaction) => !isPendingTurnInputInteraction(interaction)
		),
	};
}

function isPendingTurnInputInteraction(interaction: InteractionSnapshot): boolean {
	if (interaction.state !== "Pending") {
		return false;
	}

	return (
		"Permission" in interaction.payload ||
		"Question" in interaction.payload ||
		"PlanApproval" in interaction.payload
	);
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
