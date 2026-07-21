import { errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";

import type {
	SessionOpenFound,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionStateSnapshotMaterialization,
} from "../../../services/acp-types.js";
import { AgentError, type AppError } from "../../errors/app-error.js";
import { materializeSnapshotFromOpenFound } from "../../session-state/session-state-protocol.js";
import type { SessionStore } from "../session-store.svelte.js";

interface SessionOpenStore {
	write: Pick<SessionStore["write"], "replaceSessionOpenSnapshot">;
	viewport: Pick<SessionStore["viewport"], "applyInitialRowPage" | "ensureRowsBootstrap">;
	applySessionStateEnvelope(sessionId: string, envelope: SessionStateEnvelope): void;
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

export interface SessionOpenHydrationTimingRecord {
	readonly panelId: string;
	readonly requestedSessionId: string;
	readonly canonicalSessionId: string;
	readonly applied: boolean;
	readonly skippedReason: "stale_request" | "older_revision" | null;
	readonly totalMs: number;
	readonly materializeSnapshotMs: number;
	readonly replaceOpenSnapshotMs: number;
	readonly replaceStateGraphMs: number;
	readonly applyViewportEnvelopeMs: number;
	readonly applyInitialRowPageMs: number;
	readonly ensureRowsBootstrapMs: number;
	readonly updatePanelSessionMs: number;
	readonly initialRowPageRowCount: number | null;
	readonly totalRowCount: number | null;
	readonly rowPayloadBytes: number | null;
}

type SessionOpenHydratorTimingRecorder = (record: SessionOpenHydrationTimingRecord) => void;

let timingRecorder: SessionOpenHydratorTimingRecorder | null = null;

export function setSessionOpenHydratorTimingRecorder(
	recorder: SessionOpenHydratorTimingRecorder | null
): () => void {
	const previousRecorder = timingRecorder;
	timingRecorder = recorder;
	return () => {
		timingRecorder = previousRecorder;
	};
}

interface SnapshotApplyTiming {
	readonly materializeSnapshotMs: number;
	readonly replaceOpenSnapshotMs: number;
	readonly replaceStateGraphMs: number;
	readonly applyViewportEnvelopeMs: number;
	readonly applyInitialRowPageMs: number;
	readonly ensureRowsBootstrapMs: number;
}

function nowMs(): number {
	return typeof performance === "undefined" ? Date.now() : performance.now();
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function elapsedSince(startedAtMs: number): number {
	return roundMs(nowMs() - startedAtMs);
}

function emitTiming(record: SessionOpenHydrationTimingRecord): void {
	if (timingRecorder === null) {
		return;
	}
	timingRecorder(record);
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
		const immediateResult = this.hydrateFoundNow(panelId, requestToken, found);
		if (immediateResult.isErr()) {
			return errAsync(immediateResult.error);
		}
		if (immediateResult.value !== null) {
			return okAsync(immediateResult.value);
		}
		const prior = this.panelChains.get(panelId);
		if (prior === undefined) {
			return okAsync({
				canonicalSessionId: found.canonicalSessionId,
				openToken: found.openToken,
				applied: false,
			});
		}
		const queued = prior.then(() => this.applyFound(panelId, requestToken, found));
		const cleanup = queued.finally(() => {
			if (this.panelChains.get(panelId) === cleanup) {
				this.panelChains.delete(panelId);
			}
		});
		this.panelChains.set(
			panelId,
			cleanup.catch(() => ({
				canonicalSessionId: found.canonicalSessionId,
				openToken: found.openToken,
				applied: false,
			}))
		);
		return ResultAsync.fromPromise(queued, toAppError);
	}

	hydrateFoundNow(panelId: string, requestToken: string, found: SessionOpenFound) {
		if (this.panelChains.get(panelId) !== undefined) {
			return ok(null);
		}
		return Result.fromThrowable(() => this.applyFound(panelId, requestToken, found), toAppError)();
	}

	hydrateCreated(found: SessionOpenFound): ResultAsync<void, AppError> {
		return ResultAsync.fromPromise(
			Promise.resolve().then(() => {
				this.applySnapshot(found);
			}),
			toAppError
		);
	}

	private applySnapshot(found: SessionOpenFound): SnapshotApplyTiming {
		const materializeStartedAtMs = nowMs();
		const snapshotMaterialization: SessionStateSnapshotMaterialization =
			materializeSnapshotFromOpenFound(found);
		const materializeSnapshotMs = elapsedSince(materializeStartedAtMs);
		return this.applyMaterializedSnapshot(found, snapshotMaterialization, materializeSnapshotMs);
	}

	private applyMaterializedSnapshot(
		found: SessionOpenFound,
		snapshotMaterialization: SessionStateSnapshotMaterialization,
		materializeSnapshotMs: number
	): SnapshotApplyTiming {
		const replaceOpenSnapshotStartedAtMs = nowMs();
		this.sessionStore.write.replaceSessionOpenSnapshot(found);
		const replaceOpenSnapshotMs = elapsedSince(replaceOpenSnapshotStartedAtMs);

		const replaceStateGraphStartedAtMs = nowMs();
		this.stateConsumer.replaceSessionStateGraph(snapshotMaterialization.graph);
		const replaceStateGraphMs = elapsedSince(replaceStateGraphStartedAtMs);

		let applyViewportEnvelopeMs = 0;
		let applyInitialRowPageMs = 0;
		let ensureRowsBootstrapMs = 0;
		if (found.initialTranscriptRowPage !== null && found.initialTranscriptRowPage !== undefined) {
			const applyInitialRowPageStartedAtMs = nowMs();
			this.sessionStore.viewport.applyInitialRowPage(
				found.canonicalSessionId,
				found.initialTranscriptRowPage
			);
			applyInitialRowPageMs = elapsedSince(applyInitialRowPageStartedAtMs);
			return {
				materializeSnapshotMs,
				replaceOpenSnapshotMs,
				replaceStateGraphMs,
				applyViewportEnvelopeMs,
				applyInitialRowPageMs,
				ensureRowsBootstrapMs,
			};
		}
		if (found.initialViewportEnvelope !== null && found.initialViewportEnvelope !== undefined) {
			const applyViewportEnvelopeStartedAtMs = nowMs();
			this.sessionStore.applySessionStateEnvelope(
				found.initialViewportEnvelope.sessionId,
				found.initialViewportEnvelope
			);
			applyViewportEnvelopeMs = elapsedSince(applyViewportEnvelopeStartedAtMs);
			return {
				materializeSnapshotMs,
				replaceOpenSnapshotMs,
				replaceStateGraphMs,
				applyViewportEnvelopeMs,
				applyInitialRowPageMs,
				ensureRowsBootstrapMs,
			};
		}
		if (found.messageCount > 0) {
			const ensureRowsBootstrapStartedAtMs = nowMs();
			this.sessionStore.viewport.ensureRowsBootstrap(found.canonicalSessionId);
			ensureRowsBootstrapMs = elapsedSince(ensureRowsBootstrapStartedAtMs);
		}
		return {
			materializeSnapshotMs,
			replaceOpenSnapshotMs,
			replaceStateGraphMs,
			applyViewportEnvelopeMs,
			applyInitialRowPageMs,
			ensureRowsBootstrapMs,
		};
	}

	private applyFound(
		panelId: string,
		requestToken: string,
		found: SessionOpenFound
	): SessionOpenHydrationResult {
		const startedAtMs = nowMs();
		if (this.activeRequestTokens.get(panelId) !== requestToken) {
			emitTiming({
				panelId,
				requestedSessionId: found.requestedSessionId,
				canonicalSessionId: found.canonicalSessionId,
				applied: false,
				skippedReason: "stale_request",
				totalMs: elapsedSince(startedAtMs),
				materializeSnapshotMs: 0,
				replaceOpenSnapshotMs: 0,
				replaceStateGraphMs: 0,
				applyViewportEnvelopeMs: 0,
				applyInitialRowPageMs: 0,
				ensureRowsBootstrapMs: 0,
				updatePanelSessionMs: 0,
				initialRowPageRowCount: found.initialTranscriptRowPage?.rows.length ?? null,
				totalRowCount: found.initialTranscriptRowPage?.totalRowCount ?? null,
				rowPayloadBytes: found.initialTranscriptRowPage?.rowPayloadBytes ?? null,
			});
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
			found.graphRevision < appliedRevision.graphRevision
		) {
			emitTiming({
				panelId,
				requestedSessionId: found.requestedSessionId,
				canonicalSessionId: found.canonicalSessionId,
				applied: false,
				skippedReason: "older_revision",
				totalMs: elapsedSince(startedAtMs),
				materializeSnapshotMs: 0,
				replaceOpenSnapshotMs: 0,
				replaceStateGraphMs: 0,
				applyViewportEnvelopeMs: 0,
				applyInitialRowPageMs: 0,
				ensureRowsBootstrapMs: 0,
				updatePanelSessionMs: 0,
				initialRowPageRowCount: found.initialTranscriptRowPage?.rows.length ?? null,
				totalRowCount: found.initialTranscriptRowPage?.totalRowCount ?? null,
				rowPayloadBytes: found.initialTranscriptRowPage?.rowPayloadBytes ?? null,
			});
			return {
				canonicalSessionId: found.canonicalSessionId,
				openToken: found.openToken,
				applied: false,
			};
		}

		const applyTiming = this.applySnapshot(found);
		const updatePanelStartedAtMs = nowMs();
		this.panelStore.updatePanelSession(panelId, found.canonicalSessionId);
		const updatePanelSessionMs = elapsedSince(updatePanelStartedAtMs);
		this.appliedSnapshotRevisions.set(panelId, {
			canonicalSessionId: found.canonicalSessionId,
			graphRevision: found.graphRevision,
		});
		emitTiming({
			panelId,
			requestedSessionId: found.requestedSessionId,
			canonicalSessionId: found.canonicalSessionId,
			applied: true,
			skippedReason: null,
			totalMs: elapsedSince(startedAtMs),
			materializeSnapshotMs: applyTiming.materializeSnapshotMs,
			replaceOpenSnapshotMs: applyTiming.replaceOpenSnapshotMs,
			replaceStateGraphMs: applyTiming.replaceStateGraphMs,
			applyViewportEnvelopeMs: applyTiming.applyViewportEnvelopeMs,
			applyInitialRowPageMs: applyTiming.applyInitialRowPageMs,
			ensureRowsBootstrapMs: applyTiming.ensureRowsBootstrapMs,
			updatePanelSessionMs,
			initialRowPageRowCount: found.initialTranscriptRowPage?.rows.length ?? null,
			totalRowCount: found.initialTranscriptRowPage?.totalRowCount ?? null,
			rowPayloadBytes: found.initialTranscriptRowPage?.rowPayloadBytes ?? null,
		});

		return {
			canonicalSessionId: found.canonicalSessionId,
			openToken: found.openToken,
			applied: true,
		};
	}
}
