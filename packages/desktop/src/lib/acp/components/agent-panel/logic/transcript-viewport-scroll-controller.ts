export type TranscriptViewportModeKind = "detached" | "followingTail";

export type TranscriptViewportScrollMode =
	| { readonly kind: "followingTail" }
	| {
			readonly kind: "detached";
			readonly anchorRowId: string;
			readonly offsetFromAnchorPx: number;
	  };

export type TranscriptViewportPhysicalScrollReason =
	| "outsideBufferClamp"
	| "anchorCorrection"
	| "resolvedOutsideBufferTarget"
	| "rustScrollTarget"
	| "followTailRenderedBottom"
	| "detachedRestore";

export type TranscriptViewportPhysicalScrollCommand = {
	readonly kind: "physicalScroll";
	readonly reason: TranscriptViewportPhysicalScrollReason;
	readonly targetScrollTopPx: number;
	readonly suppressScrollEvent: boolean;
};

function physicalScrollPriority(reason: TranscriptViewportPhysicalScrollReason): number {
	if (reason === "outsideBufferClamp") {
		return 0;
	}
	if (reason === "anchorCorrection") {
		return 1;
	}
	if (reason === "followTailRenderedBottom") {
		return 2;
	}
	if (reason === "resolvedOutsideBufferTarget") {
		return 3;
	}
	if (reason === "rustScrollTarget") {
		return 4;
	}
	return 5;
}

export function selectPhysicalScrollCommand(input: {
	readonly current: TranscriptViewportPhysicalScrollCommand | null;
	readonly candidate: TranscriptViewportPhysicalScrollCommand | null;
}): TranscriptViewportPhysicalScrollCommand | null {
	if (input.candidate === null) {
		return input.current;
	}
	if (input.current === null) {
		return input.candidate;
	}
	const currentPriority = physicalScrollPriority(input.current.reason);
	const candidatePriority = physicalScrollPriority(input.candidate.reason);
	if (candidatePriority < currentPriority) {
		return input.candidate;
	}
	if (candidatePriority > currentPriority) {
		return input.current;
	}
	return input.candidate;
}

export function shouldApplyPhysicalScrollCommand(input: {
	readonly currentScrollTopPx: number;
	readonly targetScrollTopPx: number;
	readonly thresholdPx: number;
}): boolean {
	return Math.abs(input.currentScrollTopPx - input.targetScrollTopPx) > input.thresholdPx;
}

export function detachedModeScrollTargetPx(input: {
	readonly mode: TranscriptViewportScrollMode;
	readonly rows: readonly { readonly rowId: string }[];
	readonly offsetsPx: readonly number[];
}): number | null {
	if (input.mode.kind !== "detached") {
		return null;
	}
	const mode = input.mode;
	const anchorIndex = input.rows.findIndex((row) => row.rowId === mode.anchorRowId);
	if (anchorIndex < 0) {
		return null;
	}
	const anchorOffsetPx = input.offsetsPx[anchorIndex];
	if (anchorOffsetPx === undefined) {
		return null;
	}
	return Math.max(0, Math.round(anchorOffsetPx + mode.offsetFromAnchorPx));
}

export function shouldDispatchTailDetachScrollIntent(input: {
	readonly modeKind: TranscriptViewportModeKind;
	readonly liveNearBottom: boolean;
	readonly alreadyLocallyDetached: boolean;
}): boolean {
	return (
		input.modeKind === "followingTail" &&
		!input.liveNearBottom &&
		!input.alreadyLocallyDetached
	);
}

export function shouldIgnoreStaleFollowingTailTarget(input: {
	readonly modeKind: TranscriptViewportModeKind;
	readonly liveNearBottom: boolean;
	readonly locallyDetachedFromTail: boolean;
	readonly hasAppliedAnyScrollTarget: boolean;
}): boolean {
	return (
		input.modeKind === "followingTail" &&
		input.locallyDetachedFromTail &&
		!input.liveNearBottom &&
		input.hasAppliedAnyScrollTarget
	);
}

export function shouldSuppressProgrammaticScrollEvent(input: {
	readonly expectedScrollTopPx: number | null;
	readonly observedScrollTopPx: number;
}): boolean {
	return (
		input.expectedScrollTopPx !== null &&
		Math.abs(input.observedScrollTopPx - input.expectedScrollTopPx) <= 1
	);
}

export function clampScrollTopToBufferedRange(input: {
	readonly requestedScrollTopPx: number;
	readonly viewportHeightPx: number;
	readonly bufferTopPx: number;
	readonly bufferEndOffsetPx: number;
}): number {
	if (input.requestedScrollTopPx + input.viewportHeightPx <= input.bufferTopPx) {
		return input.bufferTopPx;
	}
	if (input.requestedScrollTopPx >= input.bufferEndOffsetPx) {
		return Math.max(input.bufferTopPx, input.bufferEndOffsetPx - input.viewportHeightPx);
	}
	return input.requestedScrollTopPx;
}

export function outsideBufferScrollRecovery(input: {
	readonly observedScrollTopPx: number;
	readonly pendingRequestedScrollTopPx: number | null;
	readonly viewportHeightPx: number;
	readonly bufferTopPx: number;
	readonly bufferEndOffsetPx: number;
}): { readonly requestedScrollTopPx: number; readonly clampedScrollTopPx: number } | null {
	const clampedScrollTopPx = clampScrollTopToBufferedRange({
		requestedScrollTopPx: input.observedScrollTopPx,
		viewportHeightPx: input.viewportHeightPx,
		bufferTopPx: input.bufferTopPx,
		bufferEndOffsetPx: input.bufferEndOffsetPx,
	});
	if (Math.abs(clampedScrollTopPx - input.observedScrollTopPx) <= 1) {
		return null;
	}
	const pendingRequestStillMatches =
		input.pendingRequestedScrollTopPx !== null &&
		(Math.abs(input.pendingRequestedScrollTopPx - input.observedScrollTopPx) <=
			input.viewportHeightPx ||
			Math.abs(input.observedScrollTopPx - clampedScrollTopPx) <= 1);
	return {
		requestedScrollTopPx: pendingRequestStillMatches
			? input.pendingRequestedScrollTopPx
			: input.observedScrollTopPx,
		clampedScrollTopPx,
	};
}

export function shouldDispatchOutsideBufferRecovery(input: {
	readonly pendingRequestedScrollTopPx: number | null;
	readonly requestedScrollTopPx: number;
	readonly lastDispatchMs: number | null;
	readonly nowMs: number;
	readonly retryIntervalMs: number;
}): boolean {
	if (input.pendingRequestedScrollTopPx !== input.requestedScrollTopPx) {
		return true;
	}
	if (input.lastDispatchMs === null) {
		return true;
	}
	return input.nowMs - input.lastDispatchMs >= input.retryIntervalMs;
}

export function shouldPinFollowingTailToRenderedBottom(input: {
	readonly currentScrollTopPx: number;
	readonly renderedBottomTargetPx: number;
	readonly nearCanonicalBottom: boolean;
	readonly thresholdPx: number;
}): boolean {
	const distanceFromRenderedTargetPx =
		input.currentScrollTopPx - input.renderedBottomTargetPx;
	if (distanceFromRenderedTargetPx > input.thresholdPx) {
		return true;
	}
	if (Math.abs(distanceFromRenderedTargetPx) <= input.thresholdPx) {
		return true;
	}
	return input.nearCanonicalBottom;
}

export function shouldPinHydratedFollowingTailProjection(input: {
	readonly modeKind: TranscriptViewportModeKind;
	readonly bufferEndIndex: number;
	readonly layoutRowCount: number;
	readonly locallyDetachedFromTail: boolean;
}): boolean {
	return (
		input.modeKind === "followingTail" &&
		input.bufferEndIndex >= input.layoutRowCount &&
		!input.locallyDetachedFromTail
	);
}

export function isCanonicalBottomScrollIntent(input: {
	readonly requestedScrollTopPx: number;
	readonly totalHeightPx: number;
	readonly viewportHeightPx: number;
	readonly thresholdPx: number;
}): boolean {
	const maxTop = Math.max(0, input.totalHeightPx - input.viewportHeightPx);
	return maxTop - input.requestedScrollTopPx <= input.thresholdPx;
}

export function semanticScrollIntentAtRenderedBufferEdge(input: {
	readonly direction: "down" | "up";
	readonly currentScrollTopPx: number;
	readonly renderedBottomTargetPx: number | null;
	readonly bufferTopPx: number;
	readonly bufferStartIndex: number;
	readonly bufferEndIndex: number;
	readonly layoutRowCount: number;
	readonly viewportHeightPx: number;
	readonly wheelDeltaYPx: number;
	readonly totalHeightPx: number;
	readonly thresholdPx: number;
}): number | null {
	const stepPx = Math.max(input.viewportHeightPx, Math.round(Math.abs(input.wheelDeltaYPx)));
	if (input.direction === "down") {
		if (input.bufferEndIndex >= input.layoutRowCount || input.renderedBottomTargetPx === null) {
			return null;
		}
		if (input.renderedBottomTargetPx - input.currentScrollTopPx > input.thresholdPx) {
			return null;
		}
		const maxTop = Math.max(0, input.totalHeightPx - input.viewportHeightPx);
		return Math.min(maxTop, input.currentScrollTopPx + stepPx);
	}
	if (input.bufferStartIndex <= 0) {
		return null;
	}
	if (input.currentScrollTopPx - input.bufferTopPx > input.thresholdPx) {
		return null;
	}
	return Math.max(0, input.currentScrollTopPx - stepPx);
}

export function accumulateQueuedScrollIntentAtEdge(input: {
	readonly direction: "down" | "up";
	readonly queuedScrollIntentPx: number | null;
	readonly nextScrollIntentPx: number;
	readonly viewportHeightPx: number;
	readonly wheelDeltaYPx: number;
	readonly totalHeightPx: number;
}): number {
	if (input.queuedScrollIntentPx === null) {
		return input.nextScrollIntentPx;
	}
	const stepPx = Math.max(input.viewportHeightPx, Math.round(Math.abs(input.wheelDeltaYPx)));
	if (input.direction === "down") {
		const maxTop = Math.max(0, input.totalHeightPx - input.viewportHeightPx);
		return Math.min(maxTop, input.queuedScrollIntentPx + stepPx);
	}
	return Math.max(0, input.queuedScrollIntentPx - stepPx);
}
