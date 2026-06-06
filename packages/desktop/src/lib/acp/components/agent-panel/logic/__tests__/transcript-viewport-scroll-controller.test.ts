import { describe, expect, it } from "vitest";
import {
	accumulateQueuedScrollIntentAtEdge,
	clampScrollTopToBufferedRange,
	detachedModeScrollTargetPx,
	isCanonicalBottomScrollIntent,
	outsideBufferScrollRecovery,
	selectPhysicalScrollCommand,
	shouldApplyPhysicalScrollCommand,
	shouldDispatchOutsideBufferRecovery,
	shouldPinFollowingTailToRenderedBottom,
	shouldPinHydratedFollowingTailProjection,
	shouldDispatchTailDetachScrollIntent,
	shouldIgnoreStaleFollowingTailTarget,
	shouldSuppressProgrammaticScrollEvent,
	semanticScrollIntentAtRenderedBufferEdge,
} from "../transcript-viewport-scroll-controller.js";

describe("transcript viewport scroll controller", () => {
	it("selects one physical scroll command when several paths compete in a frame", () => {
		const rustTarget = {
			kind: "physicalScroll" as const,
			reason: "rustScrollTarget" as const,
			targetScrollTopPx: 90_000,
			suppressScrollEvent: true,
		};
		const outsideBufferClamp = {
			kind: "physicalScroll" as const,
			reason: "outsideBufferClamp" as const,
			targetScrollTopPx: 64_000,
			suppressScrollEvent: true,
		};

		expect(
			selectPhysicalScrollCommand({
				current: rustTarget,
				candidate: outsideBufferClamp,
			})
		).toBe(outsideBufferClamp);
	});

	it("keeps anchor correction ahead of a stale absolute Rust scroll target", () => {
		const rustTarget = {
			kind: "physicalScroll" as const,
			reason: "rustScrollTarget" as const,
			targetScrollTopPx: 655_000,
			suppressScrollEvent: true,
		};
		const anchorCorrection = {
			kind: "physicalScroll" as const,
			reason: "anchorCorrection" as const,
			targetScrollTopPx: 654_812,
			suppressScrollEvent: true,
		};

		expect(
			selectPhysicalScrollCommand({
				current: rustTarget,
				candidate: anchorCorrection,
			})
		).toBe(anchorCorrection);
	});

	it("keeps the rendered bottom pin ahead of a canonical Rust bottom target", () => {
		const rustTarget = {
			kind: "physicalScroll" as const,
			reason: "rustScrollTarget" as const,
			targetScrollTopPx: 202_438,
			suppressScrollEvent: true,
		};
		const renderedBottom = {
			kind: "physicalScroll" as const,
			reason: "followTailRenderedBottom" as const,
			targetScrollTopPx: 202_237,
			suppressScrollEvent: true,
		};

		expect(
			selectPhysicalScrollCommand({
				current: rustTarget,
				candidate: renderedBottom,
			})
		).toBe(renderedBottom);
	});

	it("keeps the rendered bottom pin ahead of an outside-buffer recovery target", () => {
		const resolvedRecovery = {
			kind: "physicalScroll" as const,
			reason: "resolvedOutsideBufferTarget" as const,
			targetScrollTopPx: 216_718,
			suppressScrollEvent: true,
		};
		const renderedBottom = {
			kind: "physicalScroll" as const,
			reason: "followTailRenderedBottom" as const,
			targetScrollTopPx: 215_842,
			suppressScrollEvent: true,
		};

		expect(
			selectPhysicalScrollCommand({
				current: resolvedRecovery,
				candidate: renderedBottom,
			})
		).toBe(renderedBottom);
	});

	it("uses the latest physical scroll command when two commands have the same priority", () => {
		const firstClamp = {
			kind: "physicalScroll" as const,
			reason: "outsideBufferClamp" as const,
			targetScrollTopPx: 640_000,
			suppressScrollEvent: true,
		};
		const nextClamp = {
			kind: "physicalScroll" as const,
			reason: "outsideBufferClamp" as const,
			targetScrollTopPx: 641_000,
			suppressScrollEvent: true,
		};

		expect(
			selectPhysicalScrollCommand({
				current: firstClamp,
				candidate: nextClamp,
			})
		).toBe(nextClamp);
	});

	it("does not write physical scrollTop again for an equivalent target", () => {
		expect(
			shouldApplyPhysicalScrollCommand({
				currentScrollTopPx: 664_548,
				targetScrollTopPx: 664_549,
				thresholdPx: 1,
			})
		).toBe(false);
	});

	it("writes physical scrollTop when the selected target differs enough", () => {
		expect(
			shouldApplyPhysicalScrollCommand({
				currentScrollTopPx: 664_548,
				targetScrollTopPx: 664_552,
				thresholdPx: 1,
			})
		).toBe(true);
	});

	it("dispatches one scroll intent when a user leaves following-tail inside the current buffer", () => {
		expect(
			shouldDispatchTailDetachScrollIntent({
				modeKind: "followingTail",
				liveNearBottom: false,
				alreadyLocallyDetached: false,
			})
		).toBe(true);
	});

	it("does not repeat the local detach intent once it is already pending", () => {
		expect(
			shouldDispatchTailDetachScrollIntent({
				modeKind: "followingTail",
				liveNearBottom: false,
				alreadyLocallyDetached: true,
			})
		).toBe(false);
	});

	it("ignores stale following-tail targets after the user locally detached", () => {
		expect(
			shouldIgnoreStaleFollowingTailTarget({
				modeKind: "followingTail",
				liveNearBottom: false,
				locallyDetachedFromTail: true,
				hasAppliedAnyScrollTarget: true,
			})
		).toBe(true);
	});

	it("keeps the initial following-tail target allowed", () => {
		expect(
			shouldIgnoreStaleFollowingTailTarget({
				modeKind: "followingTail",
				liveNearBottom: false,
				locallyDetachedFromTail: true,
				hasAppliedAnyScrollTarget: false,
			})
		).toBe(false);
	});

	it("suppresses only the scroll event caused by our exact programmatic target", () => {
		expect(
			shouldSuppressProgrammaticScrollEvent({
				expectedScrollTopPx: 664_548,
				observedScrollTopPx: 664_548,
			})
		).toBe(true);
	});

	it("does not swallow a fast user scroll that lands far from the programmatic target", () => {
		expect(
			shouldSuppressProgrammaticScrollEvent({
				expectedScrollTopPx: 664_548,
				observedScrollTopPx: 0,
			})
		).toBe(false);
	});

	it("clamps a jump above the buffered rows to the buffered top while refilling", () => {
		expect(
			clampScrollTopToBufferedRange({
				requestedScrollTopPx: 0,
				viewportHeightPx: 500,
				bufferTopPx: 640_000,
				bufferEndOffsetPx: 655_000,
			})
		).toBe(640_000);
	});

	it("clamps a jump below the buffered rows to the buffered bottom while refilling", () => {
		expect(
			clampScrollTopToBufferedRange({
				requestedScrollTopPx: 700_000,
				viewportHeightPx: 500,
				bufferTopPx: 640_000,
				bufferEndOffsetPx: 655_000,
			})
		).toBe(654_500);
	});

	it("does not clamp a scroll position that is already inside the buffer", () => {
		expect(
			clampScrollTopToBufferedRange({
				requestedScrollTopPx: 642_000,
				viewportHeightPx: 500,
				bufferTopPx: 640_000,
				bufferEndOffsetPx: 655_000,
			})
		).toBe(642_000);
	});

	it("recovers a browser scroll position that escaped above the current buffer", () => {
		expect(
			outsideBufferScrollRecovery({
				observedScrollTopPx: 0,
				pendingRequestedScrollTopPx: null,
				viewportHeightPx: 512,
				bufferTopPx: 645_205,
				bufferEndOffsetPx: 651_249,
			})
		).toEqual({
			requestedScrollTopPx: 0,
			clampedScrollTopPx: 645_205,
		});
	});

	it("keeps the first outside-buffer request while repeated momentum scroll events arrive", () => {
		expect(
			outsideBufferScrollRecovery({
				observedScrollTopPx: 5,
				pendingRequestedScrollTopPx: 0,
				viewportHeightPx: 512,
				bufferTopPx: 645_205,
				bufferEndOffsetPx: 651_249,
			})
		).toEqual({
			requestedScrollTopPx: 0,
			clampedScrollTopPx: 645_205,
		});
	});

	it("replaces stale outside-buffer intent when the user jumps to the opposite edge", () => {
		expect(
			outsideBufferScrollRecovery({
				observedScrollTopPx: 0,
				pendingRequestedScrollTopPx: 9_000,
				viewportHeightPx: 512,
				bufferTopPx: 2_143,
				bufferEndOffsetPx: 9_260,
			})
		).toEqual({
			requestedScrollTopPx: 0,
			clampedScrollTopPx: 2_143,
		});
	});

	it("dispatches a new outside-buffer recovery request immediately", () => {
		expect(
			shouldDispatchOutsideBufferRecovery({
				pendingRequestedScrollTopPx: null,
				requestedScrollTopPx: 0,
				lastDispatchMs: null,
				nowMs: 1000,
				retryIntervalMs: 750,
			})
		).toBe(true);
	});

	it("throttles repeated outside-buffer recovery requests briefly", () => {
		expect(
			shouldDispatchOutsideBufferRecovery({
				pendingRequestedScrollTopPx: 0,
				requestedScrollTopPx: 0,
				lastDispatchMs: 1000,
				nowMs: 1200,
				retryIntervalMs: 750,
			})
		).toBe(false);
	});

	it("retries an outside-buffer recovery request if the first reply did not land", () => {
		expect(
			shouldDispatchOutsideBufferRecovery({
				pendingRequestedScrollTopPx: 0,
				requestedScrollTopPx: 0,
				lastDispatchMs: 1000,
				nowMs: 1800,
				retryIntervalMs: 750,
			})
		).toBe(true);
	});

	it("pins following-tail back when canonical max scroll is below the rendered rows", () => {
		expect(
			shouldPinFollowingTailToRenderedBottom({
				currentScrollTopPx: 655_836,
				renderedBottomTargetPx: 654_981,
				nearCanonicalBottom: true,
				thresholdPx: 24,
			})
		).toBe(true);
	});

	it("pins following-tail back when blank space appears below the rendered rows", () => {
		expect(
			shouldPinFollowingTailToRenderedBottom({
				currentScrollTopPx: 655_836,
				renderedBottomTargetPx: 654_981,
				nearCanonicalBottom: false,
				thresholdPx: 24,
			})
		).toBe(true);
	});

	it("does not pull a user back down when they scrolled above the rendered tail", () => {
		expect(
			shouldPinFollowingTailToRenderedBottom({
				currentScrollTopPx: 653_000,
				renderedBottomTargetPx: 654_981,
				nearCanonicalBottom: false,
				thresholdPx: 24,
			})
		).toBe(false);
	});

	it("pins a hydrated following-tail projection when the buffer contains the tail", () => {
		expect(
			shouldPinHydratedFollowingTailProjection({
				modeKind: "followingTail",
				bufferEndIndex: 1_692,
				layoutRowCount: 1_692,
				locallyDetachedFromTail: false,
			})
		).toBe(true);
	});

	it("does not pin a stale following-tail projection after local user detach", () => {
		expect(
			shouldPinHydratedFollowingTailProjection({
				modeKind: "followingTail",
				bufferEndIndex: 1_692,
				layoutRowCount: 1_692,
				locallyDetachedFromTail: true,
			})
		).toBe(false);
	});

	it("detects a jump request to the canonical bottom", () => {
		expect(
			isCanonicalBottomScrollIntent({
				requestedScrollTopPx: 9_390,
				totalHeightPx: 10_000,
				viewportHeightPx: 600,
				thresholdPx: 24,
			})
		).toBe(true);
	});

	it("does not treat an ordinary detached scroll as a bottom jump", () => {
		expect(
			isCanonicalBottomScrollIntent({
				requestedScrollTopPx: 7_000,
				totalHeightPx: 10_000,
				viewportHeightPx: 600,
				thresholdPx: 24,
			})
		).toBe(false);
	});

	it("resolves the canonical detached scroll target from the buffered anchor row", () => {
		expect(
			detachedModeScrollTargetPx({
				mode: {
					kind: "detached",
					anchorRowId: "row-2",
					offsetFromAnchorPx: 43,
				},
				rows: [{ rowId: "row-1" }, { rowId: "row-2" }, { rowId: "row-3" }],
				offsetsPx: [1200, 2143, 2600],
			})
		).toBe(2186);
	});

	it("does not invent a detached target when the anchor row is outside the buffer", () => {
		expect(
			detachedModeScrollTargetPx({
				mode: {
					kind: "detached",
					anchorRowId: "row-9",
					offsetFromAnchorPx: 0,
				},
				rows: [{ rowId: "row-1" }, { rowId: "row-2" }],
				offsetsPx: [0, 120],
			})
		).toBeNull();
	});

	it("turns a down-wheel at the rendered buffer bottom into one canonical scroll target", () => {
		expect(
			semanticScrollIntentAtRenderedBufferEdge({
				direction: "down",
				currentScrollTopPx: 9_950,
				renderedBottomTargetPx: 9_960,
				bufferTopPx: 3_000,
				bufferStartIndex: 40,
				bufferEndIndex: 120,
				layoutRowCount: 240,
				viewportHeightPx: 600,
				wheelDeltaYPx: 1_400,
				totalHeightPx: 24_000,
				thresholdPx: 24,
			})
		).toBe(11_350);
	});

	it("does not request a down-wheel refill before the rendered buffer edge is reached", () => {
		expect(
			semanticScrollIntentAtRenderedBufferEdge({
				direction: "down",
				currentScrollTopPx: 9_000,
				renderedBottomTargetPx: 9_960,
				bufferTopPx: 3_000,
				bufferStartIndex: 40,
				bufferEndIndex: 120,
				layoutRowCount: 240,
				viewportHeightPx: 600,
				wheelDeltaYPx: 1_400,
				totalHeightPx: 24_000,
				thresholdPx: 24,
			})
		).toBeNull();
	});

	it("turns an up-wheel at the rendered buffer top into one canonical scroll target", () => {
		expect(
			semanticScrollIntentAtRenderedBufferEdge({
				direction: "up",
				currentScrollTopPx: 3_010,
				renderedBottomTargetPx: 9_960,
				bufferTopPx: 3_000,
				bufferStartIndex: 40,
				bufferEndIndex: 120,
				layoutRowCount: 240,
				viewportHeightPx: 600,
				wheelDeltaYPx: -1_400,
				totalHeightPx: 24_000,
				thresholdPx: 24,
			})
		).toBe(1_610);
	});

	it("accumulates repeated down-wheel deltas while a semantic scroll command is in flight", () => {
		expect(
			accumulateQueuedScrollIntentAtEdge({
				direction: "down",
				queuedScrollIntentPx: 11_350,
				nextScrollIntentPx: 11_350,
				viewportHeightPx: 600,
				wheelDeltaYPx: 1_400,
				totalHeightPx: 24_000,
			})
		).toBe(12_750);
	});

	it("accumulates repeated up-wheel deltas while a semantic scroll command is in flight", () => {
		expect(
			accumulateQueuedScrollIntentAtEdge({
				direction: "up",
				queuedScrollIntentPx: 1_610,
				nextScrollIntentPx: 1_610,
				viewportHeightPx: 600,
				wheelDeltaYPx: -1_400,
				totalHeightPx: 24_000,
			})
		).toBe(210);
	});
});
