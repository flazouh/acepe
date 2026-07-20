/**
 * TranscriptRowsController — rows-only session-store slice for the
 * DOM-authority transcript viewport. It owns per-session ordered rows and the
 * revision-driven request loop. It does not store pixels, scroll mode, offsets,
 * or viewport height; the WebView DOM owns those.
 */
import { SvelteMap } from "svelte/reactivity";
import type {
	SessionGraphRevision,
	SessionOpenTranscriptRowPage,
	SessionStateEnvelope,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../services/acp-types.js";
import {
	readTranscriptRowPage,
	requestTranscriptViewportBuffer,
} from "../session-state/session-state-viewport-command-service.js";
import { createLogger } from "../utils/logger.js";
import type { TranscriptRowsState } from "./transcript-rows-store.js";
import { TranscriptRowsStore } from "./transcript-rows-store.svelte.js";

const TRANSCRIPT_ROW_PAGE_SIZE = 256;

const logger = createLogger({
	id: "transcript-rows-controller",
	name: "TranscriptRowsController",
});

export interface TranscriptRowsControllerDeps {
	readonly getGraphRevision: (sessionId: string) => SessionGraphRevision | undefined;
	readonly applySessionStateEnvelope: (sessionId: string, envelope: SessionStateEnvelope) => void;
}

export type TranscriptRowsControllerDiagnostic = {
	readonly action: string;
	readonly status: string;
	readonly rowCount: number | null;
	readonly previousRowCount: number | null;
	readonly emissionSeq: number | null;
	readonly requestGeneration: number | null;
	readonly reason: string | null;
};

function revisionLabel(revision: SessionGraphRevision | null): string {
	if (revision === null) {
		return "none";
	}
	return `${revision.graphRevision}/${revision.transcriptRevision}/${revision.lastEventSeq}`;
}

export class TranscriptRowsController {
	readonly #rowsBySession = new SvelteMap<string, TranscriptRowsStore>();
	readonly #freshRowsRequestInFlight = new Set<string>();
	readonly #olderRowsRequestInFlight = new Set<string>();
	readonly #freshRowsRequestGenerationBySession = new Map<string, number>();
	readonly #freshRowsRequestReasonBySession = new Map<string, string>();
	readonly #diagnosticsBySession = new SvelteMap<string, TranscriptRowsControllerDiagnostic>();
	#projectionRevision = $state(0);

	constructor(private readonly deps: TranscriptRowsControllerDeps) {}

	getRowsProjection(sessionId: string | null): TranscriptRowsState | null {
		this.#projectionRevision;
		if (sessionId === null) {
			return null;
		}
		return this.#rowsBySession.get(sessionId)?.state ?? null;
	}

	getRowsDiagnostics(sessionId: string | null): TranscriptRowsControllerDiagnostic | null {
		this.#projectionRevision;
		if (sessionId === null) {
			return null;
		}
		return this.#diagnosticsBySession.get(sessionId) ?? null;
	}

	ensureRowsBootstrap(sessionId: string): void {
		if (this.#rowsBySession.has(sessionId)) {
			return;
		}
		this.requestFreshRows(sessionId, "bootstrap");
	}

	applyBufferPush(push: ViewportBufferPush): void {
		const previousState = this.#rowsBySession.get(push.sessionId)?.state ?? null;
		const previousRowCount = previousState?.rows.length ?? null;
		const isRequestGeneratedPush =
			push.requestGeneration !== null && push.requestGeneration !== undefined;
		const hasLoadedLedgerWindow =
			previousState !== null &&
			previousState.rows.length > 0 &&
			previousState.loadedStartRowIndex !== null;
		if (push.rows.length === 0 && hasLoadedLedgerWindow) {
			const previousDiagnostic = this.#diagnosticsBySession.get(push.sessionId) ?? null;
			const reason = isRequestGeneratedPush
				? `empty-request-push-after-ledger-page:${
						this.#freshRowsRequestReasonBySession.get(push.sessionId) ?? "unknown"
					}:${previousDiagnostic?.reason ?? "none"}`
				: `empty-live-push-after-ledger-page:${previousDiagnostic?.reason ?? "none"}`;
			this.recordDiagnostic(push.sessionId, {
				action: "apply-push",
				status: "ignored",
				rowCount: push.rows.length,
				previousRowCount,
				emissionSeq: push.emissionSeq,
				requestGeneration: push.requestGeneration ?? null,
				reason,
			});
			if (isRequestGeneratedPush) {
				this.#freshRowsRequestInFlight.delete(push.sessionId);
			}
			this.bumpProjectionRevision();
			return;
		}
		const status = this.storeFor(push.sessionId).applyPush(push);
		this.recordDiagnostic(push.sessionId, {
			action: "apply-push",
			status,
			rowCount: push.rows.length,
			previousRowCount,
			emissionSeq: push.emissionSeq,
			requestGeneration: push.requestGeneration ?? null,
			reason:
				push.requestGeneration === null || push.requestGeneration === undefined
					? null
					: (this.#freshRowsRequestReasonBySession.get(push.sessionId) ?? null),
		});
		if (status === "applied") {
			this.bumpProjectionRevision();
			this.#freshRowsRequestInFlight.delete(push.sessionId);
			return;
		}
		logger.debug("Ignoring stale transcript rows push", {
			sessionId: push.sessionId,
			emissionSeq: push.emissionSeq,
		});
	}

	applyInitialRowPage(sessionId: string, page: SessionOpenTranscriptRowPage): void {
		const previousRowCount = this.#rowsBySession.get(sessionId)?.state.rows.length ?? null;
		const status = this.storeFor(sessionId).applyPage(sessionId, page);
		this.recordDiagnostic(sessionId, {
			action: "apply-page",
			status,
			rowCount: page.rows.length,
			previousRowCount,
			emissionSeq: null,
			requestGeneration: null,
			reason: "initial",
		});
		if (status === "applied") {
			this.invalidateFreshRowsRequest(sessionId);
			this.bumpProjectionRevision();
			return;
		}
		logger.debug("Initial transcript row page not applied", {
			sessionId,
			status,
			startRowIndex: page.startRowIndex,
		});
	}

	requestOlderRows(sessionId: string): void {
		if (this.#olderRowsRequestInFlight.has(sessionId)) {
			return;
		}
		const store = this.#rowsBySession.get(sessionId);
		if (store === undefined) {
			return;
		}
		const currentState = store.state;
		const loadedStartRowIndex = currentState.loadedStartRowIndex;
		if (loadedStartRowIndex === null || loadedStartRowIndex <= 0) {
			return;
		}
		const revision = currentState.revision ?? this.deps.getGraphRevision(sessionId);
		if (revision === undefined || revision === null) {
			return;
		}

		const startRowIndex = Math.max(0, loadedStartRowIndex - TRANSCRIPT_ROW_PAGE_SIZE);
		const limit = loadedStartRowIndex - startRowIndex;
		this.#olderRowsRequestInFlight.add(sessionId);
		void readTranscriptRowPage({
			sessionId,
			scope: { kind: "root" },
			startRowIndex,
			limit,
			expectedRevision: revision,
		}).match(
			(result) => {
				if (result.status === "current") {
					const stateBeforeApply = this.#rowsBySession.get(sessionId)?.state ?? null;
					const previousRowCount = stateBeforeApply?.rows.length ?? null;
					const status = this.storeFor(sessionId).applyPage(sessionId, result);
					const pageApplyReason =
						status === "stale"
							? `older-current:state=${revisionLabel(
									stateBeforeApply?.revision ?? null
								)}:page=${result.graphRevision}/${result.transcriptRevision}/${result.lastEventSeq}`
							: "older-current";
					this.recordDiagnostic(sessionId, {
						action: "apply-page",
						status,
						rowCount: result.rows.length,
						previousRowCount,
						emissionSeq: null,
						requestGeneration: null,
						reason: pageApplyReason,
					});
					if (status === "stale") {
						this.requestFreshRows(sessionId, `older-page-apply-stale:${pageApplyReason}`);
					}
				} else if (result.status === "stale") {
					this.recordDiagnostic(sessionId, {
						action: "read-page",
						status: "stale",
						rowCount: null,
						previousRowCount: currentState.rows.length,
						emissionSeq: null,
						requestGeneration: null,
						reason: "older-stale",
					});
					this.requestFreshRows(sessionId, "older-stale");
				}
				this.#olderRowsRequestInFlight.delete(sessionId);
			},
			() => {
				this.#olderRowsRequestInFlight.delete(sessionId);
			}
		);
	}

	applyBufferDelta(delta: ViewportBufferDelta): void {
		const existingStore = this.#rowsBySession.get(delta.sessionId);
		if (existingStore === undefined) {
			this.requestFreshRows(delta.sessionId, "delta-gap");
			return;
		}
		const status = existingStore.applyDelta(delta);
		if (status === "applied") {
			this.bumpProjectionRevision();
			return;
		}
		if (status === "gap") {
			this.requestFreshRows(delta.sessionId, "delta-gap");
			return;
		}
		logger.debug("Transcript rows delta not applied", {
			sessionId: delta.sessionId,
			status,
			emissionSeq: delta.emissionSeq,
		});
	}

	removeSession(sessionId: string): void {
		this.#rowsBySession.delete(sessionId);
		this.#freshRowsRequestInFlight.delete(sessionId);
		this.#olderRowsRequestInFlight.delete(sessionId);
		this.#freshRowsRequestGenerationBySession.delete(sessionId);
		this.#freshRowsRequestReasonBySession.delete(sessionId);
		this.#diagnosticsBySession.delete(sessionId);
		this.bumpProjectionRevision();
	}

	private bumpProjectionRevision(): void {
		this.#projectionRevision += 1;
	}

	private storeFor(sessionId: string): TranscriptRowsStore {
		const existing = this.#rowsBySession.get(sessionId);
		if (existing !== undefined) {
			return existing;
		}
		const store = new TranscriptRowsStore();
		this.#rowsBySession.set(sessionId, store);
		return store;
	}

	private nextFreshRowsRequestGeneration(sessionId: string): number {
		const nextGeneration = (this.#freshRowsRequestGenerationBySession.get(sessionId) ?? 0) + 1;
		this.#freshRowsRequestGenerationBySession.set(sessionId, nextGeneration);
		return nextGeneration;
	}

	private invalidateFreshRowsRequest(sessionId: string): void {
		this.nextFreshRowsRequestGeneration(sessionId);
		this.#freshRowsRequestInFlight.delete(sessionId);
		this.#freshRowsRequestReasonBySession.delete(sessionId);
	}

	private recordDiagnostic(
		sessionId: string,
		diagnostic: TranscriptRowsControllerDiagnostic
	): void {
		this.#diagnosticsBySession.set(sessionId, diagnostic);
	}

	private requestFreshRows(sessionId: string, reason: string): void {
		if (this.#freshRowsRequestInFlight.has(sessionId)) {
			return;
		}
		const revision = this.deps.getGraphRevision(sessionId);
		if (revision === undefined) {
			return;
		}
		const requestGeneration = this.nextFreshRowsRequestGeneration(sessionId);
		this.#freshRowsRequestReasonBySession.set(sessionId, reason);
		this.recordDiagnostic(sessionId, {
			action: "request-fresh",
			status: "started",
			rowCount: null,
			previousRowCount: this.#rowsBySession.get(sessionId)?.state.rows.length ?? null,
			emissionSeq: null,
			requestGeneration,
			reason,
		});
		this.#freshRowsRequestInFlight.add(sessionId);
		void requestTranscriptViewportBuffer({ sessionId, revision, requestGeneration }).match(
			(envelope) => {
				if (this.#freshRowsRequestGenerationBySession.get(sessionId) !== requestGeneration) {
					this.recordDiagnostic(sessionId, {
						action: "request-fresh",
						status: "ignored",
						rowCount: null,
						previousRowCount: this.#rowsBySession.get(sessionId)?.state.rows.length ?? null,
						emissionSeq: null,
						requestGeneration,
						reason: "generation-mismatch",
					});
					return;
				}
				if (envelope !== null) {
					this.deps.applySessionStateEnvelope(sessionId, envelope);
				}
				this.#freshRowsRequestInFlight.delete(sessionId);
			},
			() => {
				if (this.#freshRowsRequestGenerationBySession.get(sessionId) !== requestGeneration) {
					this.recordDiagnostic(sessionId, {
						action: "request-fresh",
						status: "ignored",
						rowCount: null,
						previousRowCount: this.#rowsBySession.get(sessionId)?.state.rows.length ?? null,
						emissionSeq: null,
						requestGeneration,
						reason: "generation-mismatch-error",
					});
					return;
				}
				this.#freshRowsRequestInFlight.delete(sessionId);
			}
		);
	}
}
