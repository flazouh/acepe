import type {
	SessionGraphRevision,
	SessionStateEnvelope,
	TranscriptViewportRow,
} from "../../../../services/acp-types.js";
import type {
	BufferProjection,
	ViewportClientScrollState,
} from "../../../store/transcript-viewport-store.svelte.js";
import type { AppError } from "../../../errors/app-error.js";
import {
	revealTranscriptViewportRow,
	resizeTranscriptViewport,
	scrollTranscriptViewport,
} from "../../../session-state/session-state-viewport-command-service.js";
import { TranscriptViewportHeightConfirmCoordinator } from "./transcript-viewport-height-confirm.js";
import {
	accumulateQueuedScrollIntentAtEdge,
	detachedModeScrollTargetPx,
	isCanonicalBottomScrollIntent,
	outsideBufferScrollRecovery,
	selectPhysicalScrollCommand,
	shouldApplyPhysicalScrollCommand,
	shouldContinueBottomPinRecovery,
	shouldDispatchFollowTailPinOnLayoutGrowth,
	shouldDispatchOutsideBufferRecovery,
	shouldDispatchTailDetachScrollIntent,
	shouldEmitSettledBottomPin,
	shouldEmitSettledTopPin,
	shouldIgnoreStaleScrollTopTarget,
	shouldPinFollowingTailToRenderedBottom,
	shouldPinHydratedFollowingTailProjection,
	shouldSuppressProgrammaticScrollEvent,
	semanticScrollIntentAtRenderedBufferEdge,
} from "./transcript-viewport-scroll-controller.js";
import type {
	TranscriptViewportPhysicalScrollCommand,
	TranscriptViewportPhysicalScrollReason,
} from "./transcript-viewport-scroll-controller.js";

const NEAR_EDGE_THRESHOLD_PX = 24;
const REFILL_THRESHOLD_PX = 800;
const OUTSIDE_BUFFER_RECOVERY_FRAME_LIMIT = 240;
const OUTSIDE_BUFFER_RECOVERY_RETRY_MS = 750;
const BOTTOM_PIN_RECOVERY_FRAME_LIMIT = 24;
const BOTTOM_REVEAL_RETRY_MS = 750;

export type TranscriptViewportDispatchScrollOptions = {
	readonly forceFresh?: boolean;
};

export type TranscriptViewportAdapterAction = {
	readonly destroy: () => void;
};

export type TranscriptViewportWebviewViewportState = {
	readonly isOutsideBuffer: (
		sessionId: string,
		scrollTopPx: number,
		viewportHeightPx: number
	) => boolean;
	readonly needsRefill: (
		sessionId: string,
		scrollTopPx: number,
		viewportHeightPx: number,
		thresholdPx: number
	) => boolean;
	readonly setPendingOutsideBufferScrollTopPx: (
		sessionId: string,
		pendingOutsideBufferScrollTopPx: number | null,
		activeOutsideBufferRequestedScrollTopPx: number | null
	) => void;
	readonly setLastOutsideBufferRecoveryDispatchMs: (
		sessionId: string,
		lastOutsideBufferRecoveryDispatchMs: number | null
	) => void;
	readonly setLastBottomRevealDispatchMs: (
		sessionId: string,
		lastBottomRevealDispatchMs: number | null
	) => void;
	readonly setPendingQueuedScrollIntentPx: (
		sessionId: string,
		pendingQueuedScrollIntentPx: number | null
	) => void;
	readonly clearOutsideBufferRecovery: (sessionId: string) => void;
	readonly consumeScrollCorrectionPx: (sessionId: string) => number;
};

export type TranscriptViewportWebviewAdapterDeps = {
	readonly getSessionId: () => string | null;
	readonly getBufferProjection: () => BufferProjection | null;
	readonly getBufferRows: () => readonly TranscriptViewportRow[];
	readonly getViewportClientScroll: () => ViewportClientScrollState;
	readonly getTotalHeightPx: () => number;
	readonly getLastViewportHeightPx: () => number;
	readonly setLastViewportHeightPx: (heightPx: number) => void;
	readonly getRevision: () => SessionGraphRevision | null;
	readonly isDispatchSuppressed: () => boolean;
	readonly nextViewportRequestGeneration: () => number;
	readonly applyEnvelope: (envelope: SessionStateEnvelope | null) => void;
	readonly handleDispatchError: (error: AppError) => void;
	readonly dispatchScrollIntent?: (
		offsetPx: number,
		options?: TranscriptViewportDispatchScrollOptions
	) => void;
	readonly dispatchRevealIntent?: (rowId: string | null) => void;
	readonly dispatchResizeIntent?: (heightPx: number) => void;
	readonly viewportState: TranscriptViewportWebviewViewportState;
	readonly onNearBottomChange?: (isNearBottom: boolean) => void;
	readonly onNearTopChange?: (isNearTop: boolean) => void;
	readonly afterRender: () => Promise<void>;
	readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
	readonly nowMs: () => number;
};

export class TranscriptViewportWebviewAdapter {
	readonly #deps: TranscriptViewportWebviewAdapterDeps;
	readonly #heightConfirmCoordinator: TranscriptViewportHeightConfirmCoordinator;
	#scrollContainerRef: HTMLDivElement | null = null;
	#pendingViewportHeightPx: number | null = null;
	#scrollOwnerSessionId: string | null = null;
	#lastAppliedScrollEmissionSeq = -1;
	#lastAppliedCorrectionEmissionSeq = -1;
	#lastFollowTailTotalHeightPx = -1;
	#suppressedProgrammaticScrollTopPx: number | null = null;
	#scrollIntentRafPending = false;
	#locallyDetachedFromTail = false;
	#userScrollingAwayFromTail = false;
	#bottomJumpPinRequested = false;
	#outsideBufferRecoveryRafPending = false;
	#outsideBufferRecoveryFramesRemaining = 0;
	#bottomPinRecoveryRafPending = false;
	#bottomPinRecoveryFramesRemaining = 0;
	#queuedScrollIntentRafPending = false;
	#queuedScrollIntentInFlight = false;
	#physicalScrollRafPending = false;
	#pendingPhysicalScrollCommand: TranscriptViewportPhysicalScrollCommand | null = null;

	constructor(deps: TranscriptViewportWebviewAdapterDeps) {
		this.#deps = deps;
		this.#heightConfirmCoordinator = new TranscriptViewportHeightConfirmCoordinator({
			getSessionId: deps.getSessionId,
			getRevision: deps.getRevision,
			getLastViewportHeightPx: deps.getLastViewportHeightPx,
			getLocallyPinnedToTop: () => this.#isViewportTopRecoveryActive(),
			getLiveDetachedViewportOffsetPx: () => this.#liveDetachedViewportOffsetPx(),
			isDispatchSuppressed: deps.isDispatchSuppressed,
			nextViewportRequestGeneration: deps.nextViewportRequestGeneration,
			applyEnvelope: deps.applyEnvelope,
			handleDispatchError: deps.handleDispatchError,
		});
	}

	attachScrollContainer(node: HTMLDivElement): TranscriptViewportAdapterAction {
		this.#scrollContainerRef = node;
		return {
			destroy: () => {
				if (this.#scrollContainerRef === node) {
					this.#scrollContainerRef = null;
				}
			},
		};
	}

	observeViewport(node: HTMLDivElement): TranscriptViewportAdapterAction {
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry === undefined) {
				return;
			}
			const heightPx = Math.max(0, Math.round(entry.contentRect.height));
			if (heightPx === this.#deps.getLastViewportHeightPx()) {
				return;
			}
			this.#deps.setLastViewportHeightPx(heightPx);
			this.#requestResizeIntent(heightPx);
		});
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

	createConfirmRowHeightAction(): (
		node: HTMLDivElement,
		row: TranscriptViewportRow
	) => {
		readonly update: (nextRow: TranscriptViewportRow) => void;
		readonly destroy: () => void;
	} {
		return this.#heightConfirmCoordinator.createConfirmRowHeightAction({
			isRowNearLiveViewport: (node) => this.#isRowNearLiveViewport(node),
		});
	}

	syncSessionOwner(): void {
		const sessionId = this.#deps.getSessionId();
		if (sessionId === this.#scrollOwnerSessionId) {
			return;
		}
		this.#scrollOwnerSessionId = sessionId;
		this.#userScrollingAwayFromTail = false;
		this.#locallyDetachedFromTail = false;
		this.#bottomJumpPinRequested = false;
		this.#outsideBufferRecoveryFramesRemaining = 0;
		this.#bottomPinRecoveryFramesRemaining = 0;
		this.#pendingPhysicalScrollCommand = null;
		this.#lastAppliedScrollEmissionSeq = -1;
		this.#lastAppliedCorrectionEmissionSeq = -1;
		this.#lastFollowTailTotalHeightPx = -1;
		this.#suppressedProgrammaticScrollTopPx = null;
		this.#scrollIntentRafPending = false;
		this.#queuedScrollIntentInFlight = false;
		this.#queuedScrollIntentRafPending = false;
		this.#outsideBufferRecoveryRafPending = false;
		this.#bottomPinRecoveryRafPending = false;
		this.#physicalScrollRafPending = false;
	}

	flushPendingViewportHeight(): void {
		if (this.#deps.getBufferProjection() === null || this.#pendingViewportHeightPx === null) {
			return;
		}
		const heightPx = this.#pendingViewportHeightPx;
		this.#pendingViewportHeightPx = null;
		this.#requestResizeIntent(heightPx);
	}

	reconcileRenderedProjection(): void {
		const projection = this.#deps.getBufferProjection();
		if (projection === null) {
			return;
		}
		const clientScroll = this.#deps.getViewportClientScroll();
		const requestedScrollTopPx =
			clientScroll.pendingOutsideBufferScrollTopPx ??
			clientScroll.activeOutsideBufferRequestedScrollTopPx;
		const shouldPinBottomAfterRenderedRecovery =
			requestedScrollTopPx !== null &&
			projection.bufferEndIndex >= projection.layoutRowCount &&
			isCanonicalBottomScrollIntent({
				requestedScrollTopPx,
				totalHeightPx: this.#deps.getTotalHeightPx(),
				viewportHeightPx: this.#deps.getLastViewportHeightPx(),
				thresholdPx: NEAR_EDGE_THRESHOLD_PX,
			});
		void this.#deps.afterRender().then(() => {
			if (
				this.#isViewportTopRecoveryActive() &&
				this.#scrollContainerRef !== null &&
				projection.bufferStartIndex === 0
			) {
				this.#queuePhysicalScrollCommand("resolvedOutsideBufferTarget", 0, "immediate");
				this.#scheduleVisibleHeightConfirmations();
				return;
			}
			const settledBottomPin =
				this.#shouldEmitBottomPin() ||
				(shouldPinBottomAfterRenderedRecovery && this.#bottomJumpPinRequested);
			if (settledBottomPin && this.#pinLiveScrollTopToRenderedBottom()) {
				this.#scheduleBottomPinRecovery();
				this.#scheduleVisibleHeightConfirmations();
				return;
			}
			if (
				shouldPinHydratedFollowingTailProjection({
					modeKind: projection.mode.kind,
					bufferEndIndex: projection.bufferEndIndex,
					layoutRowCount: projection.layoutRowCount,
					locallyDetachedFromTail: this.#locallyDetachedFromTail,
				}) &&
				this.#pinLiveScrollTopToRenderedBottom()
			) {
				this.#scheduleBottomPinRecovery();
				this.#scheduleVisibleHeightConfirmations();
				return;
			}
			if (!this.#clampLiveScrollTopIntoRenderedBuffer()) {
				this.#restoreDetachedScrollTargetIfOutsideBuffer();
			}
			this.#scheduleVisibleHeightConfirmations();
		});
	}

	reconcileOutsideBufferRequest(): void {
		const projection = this.#deps.getBufferProjection();
		const clientScroll = this.#deps.getViewportClientScroll();
		const requestedScrollTopPx =
			clientScroll.pendingOutsideBufferScrollTopPx ??
			clientScroll.activeOutsideBufferRequestedScrollTopPx;
		const sessionId = this.#deps.getSessionId();
		if (projection === null || requestedScrollTopPx === null || sessionId === null) {
			return;
		}
		const activeOutsideBufferRequestedScrollTopPx =
			clientScroll.activeOutsideBufferRequestedScrollTopPx;
		void this.#deps.afterRender().then(() => {
			const currentSessionId = this.#deps.getSessionId();
			if (
				this.#scrollContainerRef === null ||
				currentSessionId === null ||
				activeOutsideBufferRequestedScrollTopPx === null ||
				this.#deps.viewportState.isOutsideBuffer(
					currentSessionId,
					requestedScrollTopPx,
					this.#deps.getLastViewportHeightPx()
				)
			) {
				this.#scheduleOutsideBufferRecovery();
				return;
			}
			if (Math.abs(this.#scrollContainerRef.scrollTop - requestedScrollTopPx) <= 1) {
				this.#deps.viewportState.clearOutsideBufferRecovery(currentSessionId);
				this.#outsideBufferRecoveryFramesRemaining = 0;
				return;
			}
			if (
				isCanonicalBottomScrollIntent({
					requestedScrollTopPx,
					totalHeightPx: this.#deps.getTotalHeightPx(),
					viewportHeightPx: this.#deps.getLastViewportHeightPx(),
					thresholdPx: NEAR_EDGE_THRESHOLD_PX,
				})
			) {
				if (!this.#shouldEmitBottomPin() && !this.#bottomJumpPinRequested) {
					return;
				}
				if (!this.#pinLiveScrollTopToRenderedBottom()) {
					return;
				}
				this.#deps.viewportState.clearOutsideBufferRecovery(currentSessionId);
				this.#outsideBufferRecoveryFramesRemaining = 0;
				this.#scheduleBottomPinRecovery();
				return;
			}
			this.#queuePhysicalScrollCommand(
				"resolvedOutsideBufferTarget",
				requestedScrollTopPx,
				"immediate"
			);
			this.#deps.viewportState.clearOutsideBufferRecovery(currentSessionId);
			this.#outsideBufferRecoveryFramesRemaining = 0;
		});
	}

	reconcileRustScrollTopTarget(): void {
		const projection = this.#deps.getBufferProjection();
		if (this.#scrollContainerRef === null || projection === null) {
			return;
		}
		const target = projection.scrollTopTarget;
		if (target === null || projection.emissionSeq === this.#lastAppliedScrollEmissionSeq) {
			return;
		}
		const hasAppliedAnyScrollTarget = this.#lastAppliedScrollEmissionSeq >= 0;
		this.#lastAppliedScrollEmissionSeq = projection.emissionSeq;
		void this.#deps.afterRender().then(() => {
			if (this.#scrollContainerRef === null) {
				return;
			}
			if (this.#deps.getViewportClientScroll().pendingOutsideBufferScrollTopPx !== null) {
				return;
			}
			if (
				shouldIgnoreStaleScrollTopTarget({
					modeKind: projection.mode.kind,
					liveNearBottom: this.#isLiveViewportNearBottom(),
					locallyDetachedFromTail: this.#locallyDetachedFromTail,
					userScrollingAwayFromTail: this.#userScrollingAwayFromTail,
					hasAppliedAnyScrollTarget,
				})
			) {
				return;
			}
			if (Math.abs(this.#scrollContainerRef.scrollTop - target) <= 1) {
				return;
			}
			this.#queuePhysicalScrollCommand("rustScrollTarget", target);
		});
	}

	reconcileScrollAnchorCorrection(): void {
		const projection = this.#deps.getBufferProjection();
		const sessionId = this.#deps.getSessionId();
		if (this.#scrollContainerRef === null || projection === null || sessionId === null) {
			return;
		}
		if (projection.emissionSeq === this.#lastAppliedCorrectionEmissionSeq) {
			return;
		}
		this.#lastAppliedCorrectionEmissionSeq = projection.emissionSeq;
		const targetSessionId = sessionId;
		void this.#deps.afterRender().then(() => {
			if (this.#scrollContainerRef === null) {
				return;
			}
			const correction = this.#deps.viewportState.consumeScrollCorrectionPx(targetSessionId);
			if (correction === 0) {
				return;
			}
			const currentProjection = this.#deps.getBufferProjection();
			if (this.#isViewportTopRecoveryActive() && currentProjection?.bufferStartIndex === 0) {
				return;
			}
			if (
				this.#shouldEmitBottomPin() &&
				currentProjection?.bufferEndIndex === currentProjection?.layoutRowCount
			) {
				this.#pinLiveScrollTopToRenderedBottom();
				return;
			}
			const current = this.#scrollContainerRef.scrollTop;
			const maxTop = Math.max(
				0,
				this.#scrollContainerRef.scrollHeight - this.#scrollContainerRef.clientHeight
			);
			const next = Math.min(maxTop, Math.max(0, current + correction));
			if (Math.abs(next - current) <= 0.5) {
				return;
			}
			this.#queuePhysicalScrollCommand("anchorCorrection", next);
		});
	}

	reconcileFollowingTailLayoutGrowth(): void {
		const projection = this.#deps.getBufferProjection();
		if (this.#scrollContainerRef === null || projection === null) {
			return;
		}
		if (projection.mode.kind !== "followingTail") {
			this.#lastFollowTailTotalHeightPx = -1;
			return;
		}
		if (this.#locallyDetachedFromTail) {
			return;
		}
		const totalHeightPx = this.#deps.getTotalHeightPx();
		if (
			!shouldDispatchFollowTailPinOnLayoutGrowth({
				modeKind: projection.mode.kind,
				locallyDetachedFromTail: this.#locallyDetachedFromTail,
				previousTotalHeightPx: this.#lastFollowTailTotalHeightPx,
				currentTotalHeightPx: totalHeightPx,
			})
		) {
			return;
		}
		this.#lastFollowTailTotalHeightPx = totalHeightPx;
		void this.#deps.afterRender().then(() => {
			if (this.#scrollContainerRef === null) {
				return;
			}
			const renderedTarget = this.#renderedBottomScrollTargetPx();
			const maxTop = Math.max(
				0,
				this.#scrollContainerRef.scrollHeight - this.#scrollContainerRef.clientHeight
			);
			const target = Math.min(maxTop, renderedTarget ?? maxTop);
			if (
				!shouldPinFollowingTailToRenderedBottom({
					currentScrollTopPx: this.#scrollContainerRef.scrollTop,
					renderedBottomTargetPx: target,
					nearCanonicalBottom: this.#isLiveViewportNearBottom(),
					thresholdPx: NEAR_EDGE_THRESHOLD_PX,
				})
			) {
				return;
			}
			if (Math.abs(this.#scrollContainerRef.scrollTop - target) <= 1) {
				return;
			}
			this.#queuePhysicalScrollCommand("followTailRenderedBottom", target);
		});
	}

	handleScroll(event: Event): void {
		if (!(event.currentTarget instanceof HTMLDivElement)) {
			return;
		}
		const offsetPx = event.currentTarget.scrollTop;
		this.#updateEdgeFlags(offsetPx);
		const liveNearBottomNow = this.#isLiveViewportNearBottom();
		if (liveNearBottomNow && !this.#userScrollingAwayFromTail) {
			if (this.#deps.getBufferProjection()?.mode.kind === "followingTail") {
				this.#scheduleBottomPinRecovery();
			}
			const sessionId = this.#deps.getSessionId();
			if (sessionId !== null) {
				const clientScroll = this.#deps.getViewportClientScroll();
				const activeOutsideBufferRequestedScrollTopPx =
					clientScroll.activeOutsideBufferRequestedScrollTopPx;
				const pendingOutsideBufferScrollTopPx = clientScroll.pendingOutsideBufferScrollTopPx;
				if (
					activeOutsideBufferRequestedScrollTopPx !== null &&
					activeOutsideBufferRequestedScrollTopPx <= NEAR_EDGE_THRESHOLD_PX
				) {
					this.#deps.viewportState.setPendingOutsideBufferScrollTopPx(
						sessionId,
						pendingOutsideBufferScrollTopPx,
						null
					);
				}
				if (
					pendingOutsideBufferScrollTopPx !== null &&
					pendingOutsideBufferScrollTopPx <= NEAR_EDGE_THRESHOLD_PX
				) {
					this.#deps.viewportState.setPendingOutsideBufferScrollTopPx(sessionId, null, null);
				}
			}
			if (
				this.#pendingPhysicalScrollCommand?.reason === "resolvedOutsideBufferTarget" &&
				this.#pendingPhysicalScrollCommand.targetScrollTopPx <= NEAR_EDGE_THRESHOLD_PX
			) {
				this.#pendingPhysicalScrollCommand = null;
			}
		}
		if (
			shouldSuppressProgrammaticScrollEvent({
				expectedScrollTopPx: this.#suppressedProgrammaticScrollTopPx,
				observedScrollTopPx: offsetPx,
			})
		) {
			this.#suppressedProgrammaticScrollTopPx = null;
			return;
		}
		this.#suppressedProgrammaticScrollTopPx = null;
		const immediateScrollTopPx = Math.max(0, Math.round(offsetPx));
		if (liveNearBottomNow && !this.#userScrollingAwayFromTail) {
			this.#dispatchBottomRevealIntent();
		}
		if (immediateScrollTopPx <= NEAR_EDGE_THRESHOLD_PX) {
			this.#bottomJumpPinRequested = false;
			this.#bottomPinRecoveryFramesRemaining = 0;
		}
		if (this.#deps.getSessionId() !== null && this.#recoverOutsideBufferScrollTop(immediateScrollTopPx)) {
			return;
		}
		if (this.#clampLiveScrollTopIntoRenderedBuffer()) {
			if (this.#deps.getSessionId() !== null) {
				this.#dispatchScrollIntent(immediateScrollTopPx, { forceFresh: true });
			}
			return;
		}
		if (this.#scrollIntentRafPending) {
			return;
		}
		this.#scrollIntentRafPending = true;
		this.#deps.requestAnimationFrame(() => {
			this.#scrollIntentRafPending = false;
			const sessionId = this.#deps.getSessionId();
			if (this.#scrollContainerRef === null || sessionId === null) {
				return;
			}
			const scrollTopPx = Math.max(0, Math.round(this.#scrollContainerRef.scrollTop));
			if (this.#deps.getViewportClientScroll().pendingOutsideBufferScrollTopPx !== null) {
				this.#scheduleOutsideBufferRecovery();
				return;
			}
			if (this.#clampLiveScrollTopIntoRenderedBuffer()) {
				return;
			}
			const liveNearBottom = this.#isLiveViewportNearBottom();
			if (liveNearBottom && !this.#userScrollingAwayFromTail) {
				this.#locallyDetachedFromTail = false;
			}
			if (
				shouldDispatchTailDetachScrollIntent({
					modeKind: this.#deps.getBufferProjection()?.mode.kind ?? "detached",
					liveNearBottom,
					userScrollingAwayFromTail: this.#userScrollingAwayFromTail,
					alreadyLocallyDetached: this.#locallyDetachedFromTail,
				})
			) {
				this.#locallyDetachedFromTail = true;
				this.#dispatchScrollIntent(scrollTopPx);
				return;
			}
			const outside = this.#deps.viewportState.isOutsideBuffer(
				sessionId,
				scrollTopPx,
				this.#deps.getLastViewportHeightPx()
			);
			const needsRefill = this.#deps.viewportState.needsRefill(
				sessionId,
				scrollTopPx,
				this.#deps.getLastViewportHeightPx(),
				REFILL_THRESHOLD_PX
			);
			if (outside) {
				this.#recoverOutsideBufferScrollTop(scrollTopPx);
				return;
			}
			if (needsRefill) {
				this.#dispatchScrollIntent(scrollTopPx);
			}
		});
	}

	handleWheel(event: WheelEvent): void {
		if (event.deltaY > 0) {
			this.#userScrollingAwayFromTail = false;
			const projection = this.#deps.getBufferProjection();
			const sessionId = this.#deps.getSessionId();
			if (
				this.#scrollContainerRef !== null &&
				sessionId !== null &&
				projection !== null &&
				projection.bufferEndIndex < projection.layoutRowCount
			) {
				const current = Math.max(0, Math.round(this.#scrollContainerRef.scrollTop));
				const target = semanticScrollIntentAtRenderedBufferEdge({
					direction: "down",
					currentScrollTopPx: current,
					renderedBottomTargetPx: this.#renderedBottomScrollTargetPx(),
					bufferTopPx: projection.offsetsPx[0] ?? 0,
					bufferStartIndex: projection.bufferStartIndex,
					bufferEndIndex: projection.bufferEndIndex,
					layoutRowCount: projection.layoutRowCount,
					viewportHeightPx: this.#deps.getLastViewportHeightPx(),
					wheelDeltaYPx: event.deltaY,
					totalHeightPx: this.#deps.getTotalHeightPx(),
					thresholdPx: NEAR_EDGE_THRESHOLD_PX,
				});
				if (target !== null) {
					event.preventDefault();
					this.#queueScrollIntent(
						accumulateQueuedScrollIntentAtEdge({
							direction: "down",
							queuedScrollIntentPx:
								this.#deps.getViewportClientScroll().pendingQueuedScrollIntentPx,
							nextScrollIntentPx: target,
							viewportHeightPx: this.#deps.getLastViewportHeightPx(),
							wheelDeltaYPx: event.deltaY,
							totalHeightPx: this.#deps.getTotalHeightPx(),
						})
					);
				}
			}
		}
		if (event.deltaY < 0) {
			this.#userScrollingAwayFromTail = true;
			this.#bottomJumpPinRequested = false;
			this.#bottomPinRecoveryFramesRemaining = 0;
			const projection = this.#deps.getBufferProjection();
			const sessionId = this.#deps.getSessionId();
			if (
				this.#scrollContainerRef !== null &&
				sessionId !== null &&
				projection !== null &&
				projection.bufferStartIndex > 0
			) {
				const current = Math.max(0, Math.round(this.#scrollContainerRef.scrollTop));
				const target = semanticScrollIntentAtRenderedBufferEdge({
					direction: "up",
					currentScrollTopPx: current,
					renderedBottomTargetPx: this.#renderedBottomScrollTargetPx(),
					bufferTopPx: projection.offsetsPx[0] ?? 0,
					bufferStartIndex: projection.bufferStartIndex,
					bufferEndIndex: projection.bufferEndIndex,
					layoutRowCount: projection.layoutRowCount,
					viewportHeightPx: this.#deps.getLastViewportHeightPx(),
					wheelDeltaYPx: event.deltaY,
					totalHeightPx: this.#deps.getTotalHeightPx(),
					thresholdPx: NEAR_EDGE_THRESHOLD_PX,
				});
				if (target !== null) {
					event.preventDefault();
					this.#queueScrollIntent(
						accumulateQueuedScrollIntentAtEdge({
							direction: "up",
							queuedScrollIntentPx:
								this.#deps.getViewportClientScroll().pendingQueuedScrollIntentPx,
							nextScrollIntentPx: target,
							viewportHeightPx: this.#deps.getLastViewportHeightPx(),
							wheelDeltaYPx: event.deltaY,
							totalHeightPx: this.#deps.getTotalHeightPx(),
						})
					);
				}
			}
		}
	}

	scrollToBottom(): void {
		this.#userScrollingAwayFromTail = false;
		this.#locallyDetachedFromTail = false;
		this.#bottomJumpPinRequested = true;
		this.#pinLiveScrollTopToRenderedBottom();
		this.#scheduleBottomPinRecovery();
		this.#dispatchRevealIntent(null);
	}

	prepareForNextUserReveal(rowId: string | null): void {
		this.#dispatchRevealIntent(rowId);
	}

	scrollToTop(): void {
		this.#dispatchScrollIntent(0, { forceFresh: true });
	}

	dispatchRevealForRow(rowId: string | null): void {
		this.#dispatchRevealIntent(rowId);
	}

	#revisionInput(): SessionGraphRevision | null {
		return this.#deps.getRevision();
	}

	#dispatchScrollIntent(
		offsetPx: number,
		options?: TranscriptViewportDispatchScrollOptions
	): void {
		if (this.#deps.dispatchScrollIntent !== undefined) {
			this.#deps.dispatchScrollIntent(offsetPx, options);
			return;
		}
		const sessionId = this.#deps.getSessionId();
		const revision = this.#revisionInput();
		if (sessionId === null || revision === null || this.#deps.isDispatchSuppressed()) {
			return;
		}
		scrollTranscriptViewport({
			sessionId,
			revision,
			viewportHeightPx: this.#deps.getLastViewportHeightPx(),
			offsetPx,
			requestGeneration: this.#deps.nextViewportRequestGeneration(),
			forceFresh: options?.forceFresh ?? false,
		}).match(this.#deps.applyEnvelope, this.#deps.handleDispatchError);
	}

	#dispatchQueuedScrollIntent(offsetPx: number): void {
		const sessionId = this.#deps.getSessionId();
		const revision = this.#revisionInput();
		if (sessionId === null || revision === null || this.#deps.isDispatchSuppressed()) {
			return;
		}
		if (this.#deps.dispatchScrollIntent !== undefined) {
			this.#queuedScrollIntentInFlight = true;
			this.#deps.dispatchScrollIntent(offsetPx);
			this.#completeQueuedScrollIntent();
			return;
		}
		this.#queuedScrollIntentInFlight = true;
		scrollTranscriptViewport({
			sessionId,
			revision,
			viewportHeightPx: this.#deps.getLastViewportHeightPx(),
			offsetPx,
			requestGeneration: this.#deps.nextViewportRequestGeneration(),
		}).match(
			(envelope) => {
				this.#deps.applyEnvelope(envelope);
				this.#completeQueuedScrollIntent();
			},
			(error) => {
				this.#deps.handleDispatchError(error);
				this.#completeQueuedScrollIntent();
			}
		);
	}

	#dispatchRevealIntent(rowId: string | null): void {
		if (this.#deps.dispatchRevealIntent !== undefined) {
			this.#deps.dispatchRevealIntent(rowId);
			return;
		}
		const sessionId = this.#deps.getSessionId();
		const revision = this.#revisionInput();
		if (sessionId === null || revision === null || this.#deps.isDispatchSuppressed()) {
			return;
		}
		revealTranscriptViewportRow({
			sessionId,
			revision,
			viewportHeightPx: this.#deps.getLastViewportHeightPx(),
			rowId,
			requestGeneration: this.#deps.nextViewportRequestGeneration(),
		}).match(this.#deps.applyEnvelope, this.#deps.handleDispatchError);
	}

	#dispatchBottomRevealIntent(): void {
		const sessionId = this.#deps.getSessionId();
		if (sessionId === null) {
			return;
		}
		const nowMs = this.#deps.nowMs();
		const lastBottomRevealDispatchMs =
			this.#deps.getViewportClientScroll().lastBottomRevealDispatchMs;
		if (
			lastBottomRevealDispatchMs !== null &&
			nowMs - lastBottomRevealDispatchMs < BOTTOM_REVEAL_RETRY_MS
		) {
			return;
		}
		this.#deps.viewportState.setLastBottomRevealDispatchMs(sessionId, nowMs);
		this.#dispatchRevealIntent(null);
	}

	#requestResizeIntent(heightPx: number): void {
		const sessionId = this.#deps.getSessionId();
		const revision = this.#revisionInput();
		if (sessionId === null || revision === null || this.#deps.isDispatchSuppressed()) {
			this.#pendingViewportHeightPx = heightPx;
			return;
		}
		if (this.#deps.dispatchResizeIntent !== undefined) {
			this.#deps.dispatchResizeIntent(heightPx);
			return;
		}
		resizeTranscriptViewport({
			sessionId,
			revision,
			viewportHeightPx: heightPx,
			requestGeneration: this.#deps.nextViewportRequestGeneration(),
		}).match(this.#deps.applyEnvelope, this.#deps.handleDispatchError);
	}

	#queueScrollIntent(offsetPx: number): void {
		const sessionId = this.#deps.getSessionId();
		if (sessionId === null) {
			return;
		}
		this.#deps.viewportState.setPendingQueuedScrollIntentPx(
			sessionId,
			Math.max(0, Math.round(offsetPx))
		);
		this.#scheduleQueuedScrollIntent();
	}

	#scheduleQueuedScrollIntent(): void {
		if (this.#queuedScrollIntentRafPending) {
			return;
		}
		this.#queuedScrollIntentRafPending = true;
		this.#deps.requestAnimationFrame(() => this.#flushQueuedScrollIntent());
	}

	#flushQueuedScrollIntent(): void {
		this.#queuedScrollIntentRafPending = false;
		if (this.#queuedScrollIntentInFlight) {
			return;
		}
		const nextOffsetPx = this.#deps.getViewportClientScroll().pendingQueuedScrollIntentPx;
		const sessionId = this.#deps.getSessionId();
		if (sessionId !== null) {
			this.#deps.viewportState.setPendingQueuedScrollIntentPx(sessionId, null);
		}
		if (nextOffsetPx === null) {
			return;
		}
		this.#dispatchQueuedScrollIntent(nextOffsetPx);
	}

	#completeQueuedScrollIntent(): void {
		this.#queuedScrollIntentInFlight = false;
		if (this.#deps.getViewportClientScroll().pendingQueuedScrollIntentPx !== null) {
			this.#scheduleQueuedScrollIntent();
		}
	}

	#isRowNearLiveViewport(node: HTMLElement): boolean {
		if (this.#scrollContainerRef === null) {
			return true;
		}
		const rowRect = node.getBoundingClientRect();
		const viewportRect = this.#scrollContainerRef.getBoundingClientRect();
		const marginPx = Math.max(this.#deps.getLastViewportHeightPx(), REFILL_THRESHOLD_PX);
		return rowRect.bottom >= viewportRect.top - marginPx && rowRect.top <= viewportRect.bottom + marginPx;
	}

	#scheduleVisibleHeightConfirmations(): void {
		if (this.#scrollContainerRef === null) {
			return;
		}
		this.#heightConfirmCoordinator.scheduleVisibleHeightConfirmations({
			scrollContainer: this.#scrollContainerRef,
			bufferRows: this.#deps.getBufferRows(),
			isRowNearLiveViewport: (node) => this.#isRowNearLiveViewport(node),
		});
	}

	#liveDetachedViewportOffsetPx(): number | null {
		if (this.#scrollContainerRef === null) {
			return null;
		}
		if (this.#isLiveViewportNearBottom()) {
			return null;
		}
		return Math.max(0, Math.round(this.#scrollContainerRef.scrollTop));
	}

	#isLiveViewportNearBottom(): boolean {
		if (this.#scrollContainerRef === null) {
			return true;
		}
		const maxTop = Math.max(
			0,
			this.#scrollContainerRef.scrollHeight - this.#scrollContainerRef.clientHeight
		);
		return maxTop - this.#scrollContainerRef.scrollTop <= NEAR_EDGE_THRESHOLD_PX;
	}

	#renderedBottomScrollTargetPx(): number | null {
		if (this.#scrollContainerRef === null) {
			return null;
		}
		const rows = this.#scrollContainerRef.querySelectorAll<HTMLElement>("[data-entry-key]");
		const lastRow = rows.item(rows.length - 1);
		if (lastRow === null) {
			return null;
		}
		const viewportRect = this.#scrollContainerRef.getBoundingClientRect();
		const lastRowRect = lastRow.getBoundingClientRect();
		const renderedBottomPx = Math.max(
			0,
			Math.round(lastRowRect.bottom - viewportRect.top + this.#scrollContainerRef.scrollTop)
		);
		return Math.max(0, renderedBottomPx - this.#scrollContainerRef.clientHeight);
	}

	#viewportHasVisibleRows(): boolean {
		if (this.#scrollContainerRef === null) {
			return true;
		}
		const viewportRect = this.#scrollContainerRef.getBoundingClientRect();
		for (const row of this.#scrollContainerRef.querySelectorAll<HTMLElement>("[data-entry-key]")) {
			const rowRect = row.getBoundingClientRect();
			if (rowRect.bottom > viewportRect.top && rowRect.top < viewportRect.bottom) {
				return true;
			}
		}
		return false;
	}

	#queuePhysicalScrollCommand(
		reason: TranscriptViewportPhysicalScrollReason,
		targetScrollTopPx: number,
		timing: "frame" | "immediate" = "frame"
	): void {
		const candidate: TranscriptViewportPhysicalScrollCommand = {
			kind: "physicalScroll",
			reason,
			targetScrollTopPx,
			suppressScrollEvent: true,
		};
		this.#pendingPhysicalScrollCommand = selectPhysicalScrollCommand({
			current: this.#pendingPhysicalScrollCommand,
			candidate,
		});
		if (timing === "immediate") {
			this.#flushPhysicalScrollCommand();
			return;
		}
		if (this.#physicalScrollRafPending) {
			return;
		}
		this.#physicalScrollRafPending = true;
		this.#deps.requestAnimationFrame(() => this.#flushPhysicalScrollCommand());
	}

	#flushPhysicalScrollCommand(): void {
		this.#physicalScrollRafPending = false;
		const command = this.#pendingPhysicalScrollCommand;
		this.#pendingPhysicalScrollCommand = null;
		if (command === null) {
			return;
		}
		this.#applyViewportScrollCommand(command);
	}

	#applyViewportScrollCommand(command: TranscriptViewportPhysicalScrollCommand): void {
		if (this.#scrollContainerRef === null) {
			return;
		}
		const maxTop = Math.max(
			0,
			this.#scrollContainerRef.scrollHeight - this.#scrollContainerRef.clientHeight
		);
		const target = Math.min(maxTop, Math.max(0, command.targetScrollTopPx));
		if (
			!shouldApplyPhysicalScrollCommand({
				currentScrollTopPx: this.#scrollContainerRef.scrollTop,
				targetScrollTopPx: target,
				thresholdPx: 1,
			})
		) {
			this.#updateEdgeFlags(target);
			return;
		}
		if (command.suppressScrollEvent) {
			this.#suppressedProgrammaticScrollTopPx = target;
		}
		this.#scrollContainerRef.scrollTop = target;
		this.#updateEdgeFlags(target);
	}

	#restoreDetachedScrollTargetIfOutsideBuffer(): boolean {
		const projection = this.#deps.getBufferProjection();
		const sessionId = this.#deps.getSessionId();
		if (
			this.#scrollContainerRef === null ||
			projection === null ||
			sessionId === null ||
			this.#deps.getViewportClientScroll().pendingOutsideBufferScrollTopPx !== null
		) {
			return false;
		}
		const scrollTopPx = Math.max(0, Math.round(this.#scrollContainerRef.scrollTop));
		const outsideBuffer = this.#deps.viewportState.isOutsideBuffer(
			sessionId,
			scrollTopPx,
			this.#deps.getLastViewportHeightPx()
		);
		if (!outsideBuffer && this.#viewportHasVisibleRows()) {
			return false;
		}
		const target = detachedModeScrollTargetPx({
			mode: projection.mode,
			rows: projection.rows,
			offsetsPx: projection.offsetsPx,
		});
		if (target === null) {
			return false;
		}
		const maxTop = Math.max(
			0,
			this.#scrollContainerRef.scrollHeight - this.#scrollContainerRef.clientHeight
		);
		const next = Math.min(maxTop, target);
		if (Math.abs(this.#scrollContainerRef.scrollTop - next) > 1) {
			this.#queuePhysicalScrollCommand("detachedRestore", next);
		}
		this.#updateEdgeFlags(next);
		return true;
	}

	#clampLiveScrollTopIntoRenderedBuffer(): boolean {
		const projection = this.#deps.getBufferProjection();
		if (
			this.#scrollContainerRef === null ||
			projection === null ||
			projection.offsetsPx.length === 0
		) {
			return false;
		}
		const current = Math.max(0, Math.round(this.#scrollContainerRef.scrollTop));
		const bufferTopPx = projection.offsetsPx[0] ?? 0;
		if (this.#isViewportTopRecoveryActive()) {
			this.#queuePhysicalScrollCommand("resolvedOutsideBufferTarget", 0, "immediate");
			return true;
		}
		if (this.#viewportHasVisibleRows()) {
			return false;
		}
		const canonicalBufferBottomPx = Math.max(
			bufferTopPx,
			projection.bufferEndOffsetPx - this.#deps.getLastViewportHeightPx()
		);
		const renderedBufferBottomPx = this.#renderedBottomScrollTargetPx();
		const bufferBottomPx =
			renderedBufferBottomPx === null
				? canonicalBufferBottomPx
				: Math.max(bufferTopPx, Math.min(canonicalBufferBottomPx, renderedBufferBottomPx));
		const target = current < bufferTopPx ? bufferTopPx : bufferBottomPx;
		this.#queuePhysicalScrollCommand("outsideBufferClamp", target, "immediate");
		return true;
	}

	#pinLiveScrollTopToRenderedBottom(): boolean {
		const projection = this.#deps.getBufferProjection();
		if (this.#scrollContainerRef === null || projection === null) {
			return false;
		}
		const renderedTarget = this.#renderedBottomScrollTargetPx();
		const maxTop = Math.max(
			0,
			this.#scrollContainerRef.scrollHeight - this.#scrollContainerRef.clientHeight
		);
		const target = Math.min(maxTop, renderedTarget ?? maxTop);
		this.#queuePhysicalScrollCommand("followTailRenderedBottom", target, "immediate");
		return true;
	}

	#scheduleBottomPinRecovery(resetFrameBudget = true): void {
		if (resetFrameBudget) {
			this.#bottomPinRecoveryFramesRemaining = BOTTOM_PIN_RECOVERY_FRAME_LIMIT;
		}
		if (this.#bottomPinRecoveryRafPending) {
			return;
		}
		this.#bottomPinRecoveryRafPending = true;
		this.#deps.requestAnimationFrame(() => {
			this.#bottomPinRecoveryRafPending = false;
			const projection = this.#deps.getBufferProjection();
			if (
				!shouldContinueBottomPinRecovery({
					modeKind: projection?.mode.kind ?? "detached",
					bottomJumpPinRequested: this.#bottomJumpPinRequested,
					framesRemaining: this.#bottomPinRecoveryFramesRemaining,
					userScrollingAwayFromTail: this.#userScrollingAwayFromTail,
				})
			) {
				this.#bottomPinRecoveryFramesRemaining = 0;
				return;
			}
			this.#bottomPinRecoveryFramesRemaining -= 1;
			if (
				this.#bottomJumpPinRequested &&
				projection !== null &&
				projection.bufferEndIndex < projection.layoutRowCount
			) {
				this.#scheduleBottomPinRecovery(false);
				return;
			}
			this.#pinLiveScrollTopToRenderedBottom();
			if (
				this.#bottomJumpPinRequested &&
				projection !== null &&
				projection.bufferEndIndex >= projection.layoutRowCount
			) {
				this.#bottomJumpPinRequested = false;
			}
			this.#scheduleBottomPinRecovery(false);
		});
	}

	#recoverOutsideBufferScrollTop(observedScrollTopPx: number, resetFrameBudget = true): boolean {
		const projection = this.#deps.getBufferProjection();
		const sessionId = this.#deps.getSessionId();
		if (
			this.#scrollContainerRef === null ||
			projection === null ||
			projection.offsetsPx.length === 0 ||
			sessionId === null
		) {
			return false;
		}
		const clientScroll = this.#deps.getViewportClientScroll();
		const bufferTopPx = projection.offsetsPx[0] ?? 0;
		const recovery = outsideBufferScrollRecovery({
			observedScrollTopPx,
			pendingRequestedScrollTopPx: clientScroll.pendingOutsideBufferScrollTopPx,
			viewportHeightPx: this.#deps.getLastViewportHeightPx(),
			bufferTopPx,
			bufferEndOffsetPx: projection.bufferEndOffsetPx,
		});
		if (recovery === null) {
			return false;
		}
		const nowMs = this.#deps.nowMs();
		const shouldDispatch = shouldDispatchOutsideBufferRecovery({
			pendingRequestedScrollTopPx: clientScroll.pendingOutsideBufferScrollTopPx,
			requestedScrollTopPx: recovery.requestedScrollTopPx,
			lastDispatchMs: clientScroll.lastOutsideBufferRecoveryDispatchMs,
			nowMs,
			retryIntervalMs: OUTSIDE_BUFFER_RECOVERY_RETRY_MS,
		});
		this.#deps.viewportState.setPendingOutsideBufferScrollTopPx(
			sessionId,
			recovery.requestedScrollTopPx,
			recovery.requestedScrollTopPx
		);
		if (recovery.requestedScrollTopPx <= NEAR_EDGE_THRESHOLD_PX) {
			this.#bottomPinRecoveryFramesRemaining = 0;
		}
		if (
			isCanonicalBottomScrollIntent({
				requestedScrollTopPx: recovery.requestedScrollTopPx,
				totalHeightPx: this.#deps.getTotalHeightPx(),
				viewportHeightPx: this.#deps.getLastViewportHeightPx(),
				thresholdPx: NEAR_EDGE_THRESHOLD_PX,
			})
		) {
			this.#bottomJumpPinRequested = true;
			this.#scheduleBottomPinRecovery();
		}
		if (resetFrameBudget) {
			this.#outsideBufferRecoveryFramesRemaining = OUTSIDE_BUFFER_RECOVERY_FRAME_LIMIT;
		}
		if (Math.abs(recovery.clampedScrollTopPx - this.#scrollContainerRef.scrollTop) > 1) {
			this.#queuePhysicalScrollCommand("outsideBufferClamp", recovery.clampedScrollTopPx, "immediate");
		}
		if (shouldDispatch) {
			this.#deps.viewportState.setLastOutsideBufferRecoveryDispatchMs(sessionId, nowMs);
			this.#dispatchScrollIntent(recovery.requestedScrollTopPx, { forceFresh: true });
		}
		this.#scheduleOutsideBufferRecovery();
		return true;
	}

	#scheduleOutsideBufferRecovery(): void {
		if (this.#outsideBufferRecoveryRafPending) {
			return;
		}
		this.#outsideBufferRecoveryRafPending = true;
		this.#deps.requestAnimationFrame(() => {
			this.#outsideBufferRecoveryRafPending = false;
			const sessionId = this.#deps.getSessionId();
			if (this.#scrollContainerRef === null || sessionId === null) {
				this.#outsideBufferRecoveryFramesRemaining = 0;
				return;
			}
			if (this.#outsideBufferRecoveryFramesRemaining <= 0) {
				return;
			}
			this.#outsideBufferRecoveryFramesRemaining -= 1;
			const observedScrollTopPx = Math.max(0, Math.round(this.#scrollContainerRef.scrollTop));
			const recoveryScrollTopPx =
				this.#deps.getViewportClientScroll().pendingOutsideBufferScrollTopPx ?? observedScrollTopPx;
			const recovered = this.#recoverOutsideBufferScrollTop(recoveryScrollTopPx, false);
			if (!recovered && this.#deps.getViewportClientScroll().pendingOutsideBufferScrollTopPx !== null) {
				this.#scheduleOutsideBufferRecovery();
			}
		});
	}

	#updateEdgeFlags(scrollTopPx: number): void {
		const projection = this.#deps.getBufferProjection();
		if (projection === null) {
			return;
		}
		const atLayoutTop =
			projection.bufferStartIndex === 0 && scrollTopPx <= NEAR_EDGE_THRESHOLD_PX;
		this.#deps.onNearTopChange?.(atLayoutTop);
		const atLayoutBottom =
			projection.bufferEndIndex >= projection.layoutRowCount &&
			this.#deps.getTotalHeightPx() -
				this.#deps.getLastViewportHeightPx() -
				scrollTopPx <=
				NEAR_EDGE_THRESHOLD_PX;
		this.#deps.onNearBottomChange?.(atLayoutBottom || projection.mode.kind === "followingTail");
	}

	#tailBufferHydrated(): boolean {
		const projection = this.#deps.getBufferProjection();
		if (projection === null) {
			return false;
		}
		return projection.bufferEndIndex >= projection.layoutRowCount;
	}

	#shouldEmitBottomPin(): boolean {
		const projection = this.#deps.getBufferProjection();
		if (projection === null) {
			return false;
		}
		return shouldEmitSettledBottomPin({
			modeKind: projection.mode.kind,
			tailBufferHydrated: this.#tailBufferHydrated(),
			bottomJumpPinRequested: this.#bottomJumpPinRequested,
		});
	}

	#isViewportTopRecoveryActive(): boolean {
		const projection = this.#deps.getBufferProjection();
		if (projection === null) {
			return false;
		}
		return shouldEmitSettledTopPin({
			bufferStartAtLayoutTop: projection.bufferStartIndex === 0,
			pendingRecoveryScrollTopPx:
				this.#deps.getViewportClientScroll().pendingOutsideBufferScrollTopPx,
			nearEdgeThresholdPx: NEAR_EDGE_THRESHOLD_PX,
		});
	}
}
