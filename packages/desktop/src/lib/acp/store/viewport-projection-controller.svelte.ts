/**
 * ViewportProjectionController — the transcript-viewport slice of the session
 * store, extracted as a composed sub-store (see docs/adr/0002). Owns the
 * `TranscriptViewportStore` (buffer projection + scroll-correction + attachment
 * status), the per-session reattach-watchdog timers, and the gap-recovery latch.
 * Orchestrates buffer push/delta application and attachment recovery.
 *
 * Cross-domain reads/effects flow through injected accessor closures
 * (`connectSession`, `getGraphRevision`, `applySessionStateEnvelope`) — the same
 * dependency pattern used by the agent-panel controllers — so this slice never
 * dual-owns canonical session-graph truth. GOD-safe: viewport buffer state is
 * display-projection state derived from canonical envelopes, not canonical truth.
 */
import type { ResultAsync } from "neverthrow";
import type {
	SessionGraphRevision,
	SessionStateEnvelope,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import type { SessionCold } from "./types.js";
import {
	TranscriptViewportStore,
	type BufferProjection,
	type ViewportAttachmentStatus,
	type ViewportClientScrollState,
} from "./transcript-viewport-store.svelte.js";
import { requestTranscriptViewportBuffer } from "../session-state/session-state-viewport-command-service.js";

const logger = createLogger({
	id: "viewport-projection-controller",
	name: "ViewportProjectionController",
});

export interface ViewportProjectionDeps {
	readonly connectSession: (
		sessionId: string,
		options?: { openToken?: string; forceReconnect?: boolean }
	) => ResultAsync<SessionCold, AppError>;
	readonly getGraphRevision: (sessionId: string) => SessionGraphRevision | undefined;
	readonly applySessionStateEnvelope: (sessionId: string, envelope: SessionStateEnvelope) => void;
}

export class ViewportProjectionController {
	private readonly transcriptViewportStore = new TranscriptViewportStore();
	private readonly viewportReattachWatchdogTimers = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();
	// Per-session latch: a forced fresh-buffer request is in flight after a
	// delta gap. Prevents a burst of out-of-order deltas from spawning a storm
	// of redundant fresh-push requests (each would bump emission_seq). Cleared
	// when a push with a higher seq lands or the request settles. Local control
	// state only — not canonical truth.
	private readonly bufferGapRecoveryInFlight = new Set<string>();

	private static readonly VIEWPORT_REATTACH_WATCHDOG_MS = 8_000;

	constructor(private readonly deps: ViewportProjectionDeps) {}

	getBufferProjection(sessionId: string | null): BufferProjection | null {
		return this.transcriptViewportStore.getBufferProjection(sessionId);
	}

	nextRequestGeneration(sessionId: string | null): number {
		return this.transcriptViewportStore.nextRequestGeneration(sessionId);
	}

	needsRefill(
		sessionId: string | null,
		scrollTopPx: number,
		viewportHeightPx: number,
		thresholdPx: number
	): boolean {
		return this.transcriptViewportStore.needsRefill(
			sessionId,
			scrollTopPx,
			viewportHeightPx,
			thresholdPx
		);
	}

	isOutsideBuffer(
		sessionId: string | null,
		scrollTopPx: number,
		viewportHeightPx: number
	): boolean {
		return this.transcriptViewportStore.isOutsideBuffer(sessionId, scrollTopPx, viewportHeightPx);
	}

	/**
	 * Reactive read of the accumulated, unconsumed relative scroll correction
	 * (px) for a session WITHOUT clearing it. Pure pass-through so the component
	 * never reaches into the transcript viewport store directly.
	 */
	peekScrollCorrectionPx(sessionId: string | null): number {
		return this.transcriptViewportStore.peekPendingScrollCorrectionPx(sessionId);
	}

	/**
	 * Consume (return and zero) the accumulated relative scroll correction (px)
	 * for a session. Idempotent: returns 0 once drained.
	 */
	consumeScrollCorrectionPx(sessionId: string | null): number {
		return this.transcriptViewportStore.consumePendingScrollCorrectionPx(sessionId);
	}

	getClientScrollState(sessionId: string | null): ViewportClientScrollState {
		return this.transcriptViewportStore.getClientScrollState(sessionId);
	}

	setPendingOutsideBufferScrollTopPx(
		sessionId: string,
		pendingOutsideBufferScrollTopPx: number | null,
		activeOutsideBufferRequestedScrollTopPx: number | null
	): void {
		this.transcriptViewportStore.setPendingOutsideBufferScrollTopPx(
			sessionId,
			pendingOutsideBufferScrollTopPx,
			activeOutsideBufferRequestedScrollTopPx
		);
	}

	setLastOutsideBufferRecoveryDispatchMs(
		sessionId: string,
		lastOutsideBufferRecoveryDispatchMs: number | null
	): void {
		this.transcriptViewportStore.setLastOutsideBufferRecoveryDispatchMs(
			sessionId,
			lastOutsideBufferRecoveryDispatchMs
		);
	}

	setLastBottomRevealDispatchMs(sessionId: string, lastBottomRevealDispatchMs: number | null): void {
		this.transcriptViewportStore.setLastBottomRevealDispatchMs(sessionId, lastBottomRevealDispatchMs);
	}

	setPendingQueuedScrollIntentPx(sessionId: string, pendingQueuedScrollIntentPx: number | null): void {
		this.transcriptViewportStore.setPendingQueuedScrollIntentPx(sessionId, pendingQueuedScrollIntentPx);
	}

	clearOutsideBufferRecovery(sessionId: string): void {
		this.transcriptViewportStore.clearOutsideBufferRecovery(sessionId);
	}

	getAttachmentStatus(sessionId: string | null): ViewportAttachmentStatus {
		return this.transcriptViewportStore.getAttachmentStatus(sessionId);
	}

	/**
	 * Bootstrap the buffer for a freshly-mounted viewport. Idempotent: no-op once
	 * a buffer projection exists.
	 */
	ensureBufferBootstrap(sessionId: string): void {
		if (this.transcriptViewportStore.getBufferProjection(sessionId) !== null) {
			return;
		}
		this.requestFreshBuffer(sessionId);
	}

	/**
	 * Recover a viewport that the backend reports as not attached. Forces a
	 * reconnect, then arms a bounded watchdog that fails the episode if the
	 * live visible-window envelope never arrives. Attempted at most once per
	 * episode (no-op while "reattaching" or after "reattachFailed").
	 */
	recoverAttachment(sessionId: string): void {
		const status = this.transcriptViewportStore.getAttachmentStatus(sessionId);
		if (status !== "attached") {
			return;
		}
		this.transcriptViewportStore.markReattaching(sessionId);
		void this.deps.connectSession(sessionId, { forceReconnect: true }).match(
			() => {
				this.armReattachWatchdog(sessionId);
			},
			() => {
				this.clearReattachWatchdog(sessionId);
				this.transcriptViewportStore.markReattachFailed(sessionId);
			}
		);
	}

	applyBufferPush(push: ViewportBufferPush): void {
		const applied = this.transcriptViewportStore.applyBufferPush(push);
		if (applied) {
			// A fresh push re-baselines emission_seq, so any pending gap-recovery
			// request has served its purpose; release the latch.
			this.bufferGapRecoveryInFlight.delete(push.sessionId);
			this.clearReattachWatchdog(push.sessionId);
			return;
		}
		logger.debug("Ignoring stale viewport buffer push", {
			sessionId: push.sessionId,
			emissionSeq: push.emissionSeq,
		});
	}

	applyBufferDelta(delta: ViewportBufferDelta): void {
		const result = this.transcriptViewportStore.applyBufferDelta(delta);
		if (result.status === "applied") {
			this.clearReattachWatchdog(delta.sessionId);
			return;
		}
		if (result.status === "gap") {
			// The total-order chain broke (a delta arrived out of order across the
			// command-reply and event-stream channels). Request a forced fresh push
			// to re-baseline. Latch so a burst of gaps does not storm the backend.
			this.requestFreshBuffer(delta.sessionId);
			return;
		}
		// "stale" (duplicate / reordered older) and "rejected" (wrong protocol /
		// no base) are idempotent no-ops.
		logger.debug("Viewport buffer delta not applied", {
			sessionId: delta.sessionId,
			status: result.status,
			emissionSeq: delta.emissionSeq,
		});
	}

	/** Drop all viewport state for a removed session. */
	removeSession(sessionId: string): void {
		this.transcriptViewportStore.removeSession(sessionId);
	}

	private requestFreshBuffer(sessionId: string): void {
		if (this.bufferGapRecoveryInFlight.has(sessionId)) {
			return;
		}
		const revision = this.deps.getGraphRevision(sessionId);
		if (revision === undefined) {
			return;
		}
		this.bufferGapRecoveryInFlight.add(sessionId);
		void requestTranscriptViewportBuffer({ sessionId, revision }).match(
			(envelope) => {
				if (envelope !== null) {
					this.deps.applySessionStateEnvelope(sessionId, envelope);
				}
				// applyBufferPush clears the latch on a successful re-baseline; if the
				// backend returned null (NoOp is impossible for a forced push, but be
				// defensive) release the latch so a later gap can retry.
				this.bufferGapRecoveryInFlight.delete(sessionId);
			},
			() => {
				this.bufferGapRecoveryInFlight.delete(sessionId);
			}
		);
	}

	private armReattachWatchdog(sessionId: string): void {
		this.clearReattachWatchdog(sessionId);
		const timerId = setTimeout(() => {
			this.viewportReattachWatchdogTimers.delete(sessionId);
			// No-ops unless still "reattaching" (guarded in the store), so a window
			// that already arrived keeps the session attached.
			this.transcriptViewportStore.markReattachFailed(sessionId);
		}, ViewportProjectionController.VIEWPORT_REATTACH_WATCHDOG_MS);
		this.viewportReattachWatchdogTimers.set(sessionId, timerId);
	}

	clearReattachWatchdog(sessionId: string): void {
		const timerId = this.viewportReattachWatchdogTimers.get(sessionId);
		if (timerId !== undefined) {
			clearTimeout(timerId);
			this.viewportReattachWatchdogTimers.delete(sessionId);
		}
	}
}
