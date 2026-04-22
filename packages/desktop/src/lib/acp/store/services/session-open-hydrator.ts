import { ResultAsync } from "neverthrow";

import type { SessionOpenFound, SessionStateGraph } from "../../../services/acp-types.js";
import { AgentError, type AppError } from "../../errors/app-error.js";
import { materializeSnapshotFromOpenFound } from "../../session-state/session-state-protocol.js";

interface SessionOpenStore {
	replaceSessionOpenSnapshot(snapshot: SessionOpenFound): void;
}

interface PanelSessionBinder {
	updatePanelSession(panelId: string, sessionId: string | null): void;
}

interface SessionStateConsumer {
	replaceSessionStateGraph(graph: SessionStateGraph): void;
}

interface AppliedSnapshotRevision {
	readonly canonicalSessionId: string;
	readonly graphRevision: number;
}

export interface SessionOpenHydrationResult {
	readonly canonicalSessionId: string;
	readonly openToken: string;
	readonly applied: boolean;
}

function toAppError(error: Error | AppError | unknown): AppError {
	if (error instanceof AgentError) {
		return error;
	}
	if (error instanceof Error) {
		return new AgentError("sessionOpenHydrator", error);
	}
	return new AgentError("sessionOpenHydrator", new Error(String(error)));
}

export class SessionOpenHydrator {
	private readonly panelChains = new Map<string, Promise<SessionOpenHydrationResult>>();
	private readonly activeRequestTokens = new Map<string, string>();
	private readonly appliedSnapshotRevisions = new Map<string, AppliedSnapshotRevision>();
	private nextRequestSequence = 1;

	constructor(
		private readonly sessionStore: SessionOpenStore,
		private readonly panelStore: PanelSessionBinder,
		private readonly stateConsumer: SessionStateConsumer
	) {}

	beginAttempt(panelId: string): string {
		const token = `session-open-${this.nextRequestSequence}`;
		this.nextRequestSequence += 1;
		this.activeRequestTokens.set(panelId, token);
		return token;
	}

	clearAttempt(panelId: string): void {
		this.activeRequestTokens.delete(panelId);
	}

	isCurrentAttempt(panelId: string, requestToken: string): boolean {
		return this.activeRequestTokens.get(panelId) === requestToken;
	}

	hydrateFound(
		panelId: string,
		requestToken: string,
		found: SessionOpenFound
	): ResultAsync<SessionOpenHydrationResult, AppError> {
		const prior =
			this.panelChains.get(panelId) ??
			Promise.resolve({
				canonicalSessionId: found.canonicalSessionId,
				openToken: found.openToken,
				applied: false,
			});
		const queued = prior.then(() => this.applyFound(panelId, requestToken, found));
		const cleanup = queued.finally(() => {
			if (this.panelChains.get(panelId) === cleanup) {
				this.panelChains.delete(panelId);
			}
		});
		this.panelChains.set(panelId, cleanup);
		return ResultAsync.fromPromise(queued, toAppError);
	}

	hydrateCreated(found: SessionOpenFound): ResultAsync<void, AppError> {
		return ResultAsync.fromPromise(
			Promise.resolve().then(() => {
				this.applySnapshot(found);
			}),
			toAppError
		);
	}

	private applySnapshot(found: SessionOpenFound): void {
		const snapshotMaterialization = materializeSnapshotFromOpenFound(found);
		this.sessionStore.replaceSessionOpenSnapshot(found);
		this.stateConsumer.replaceSessionStateGraph(snapshotMaterialization.graph);
	}

	private async applyFound(
		panelId: string,
		requestToken: string,
		found: SessionOpenFound
	): Promise<SessionOpenHydrationResult> {
		if (this.activeRequestTokens.get(panelId) !== requestToken) {
			return {
				canonicalSessionId: found.canonicalSessionId,
				openToken: found.openToken,
				applied: false,
			};
		}

		const appliedRevision = this.appliedSnapshotRevisions.get(panelId);
		if (
			appliedRevision &&
			appliedRevision.canonicalSessionId === found.canonicalSessionId &&
			found.graphRevision <= appliedRevision.graphRevision
		) {
			return {
				canonicalSessionId: found.canonicalSessionId,
				openToken: found.openToken,
				applied: false,
			};
		}

		this.applySnapshot(found);
		this.panelStore.updatePanelSession(panelId, found.canonicalSessionId);
		this.appliedSnapshotRevisions.set(panelId, {
			canonicalSessionId: found.canonicalSessionId,
			graphRevision: found.graphRevision,
		});

		return {
			canonicalSessionId: found.canonicalSessionId,
			openToken: found.openToken,
			applied: true,
		};
	}
}
