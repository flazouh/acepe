import type { StreamingAnimationMode } from "$lib/acp/types/streaming-animation-mode.js";

export type RevealMode =
	| "idle"
	| "streaming"
	| "paused-awaiting-more"
	| "completion-catchup"
	| "complete";

export const CSS_DRAIN_TIMEOUT_MS = 200;
export const REVEAL_TICK_MS = 50;
const MIN_STREAMING_ADVANCE_CHARS = 4;
const MAX_STREAMING_ADVANCE_CHARS = 18;
const MIN_COMPLETION_ADVANCE_CHARS = 48;
const MAX_COMPLETION_ADVANCE_CHARS = 512;
const STREAMING_BACKLOG_DIVISOR = 10;
const COMPLETION_BACKLOG_DIVISOR = 2;

type MotionMediaQuery = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;

export interface StreamingRevealController {
	setState(sourceText: string, isStreaming: boolean, options?: { seedFromSource?: boolean }): void;
	setMode(mode: StreamingAnimationMode): void;
	reset(): void;
	destroy(): void;
	readonly displayedText: string;
	readonly mode: RevealMode;
	readonly isRevealActive: boolean;
}

function getMotionMediaQuery(): MotionMediaQuery | null {
	if (typeof globalThis.window !== "undefined" && typeof globalThis.window.matchMedia === "function") {
		return globalThis.window.matchMedia("(prefers-reduced-motion: reduce)");
	}

	if (typeof globalThis.matchMedia === "function") {
		return globalThis.matchMedia("(prefers-reduced-motion: reduce)");
	}

	return null;
}

export function createStreamingRevealController(
	_initialMode: StreamingAnimationMode
): StreamingRevealController {
	let displayedText = $state("");
	let targetText = "";
	let mode = $state<RevealMode>("idle");
	let isRevealActive = $state(false);
	let isStreamingSource = false;
	let prefersReducedMotion = false;
	let drainTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let revealTimeoutId: ReturnType<typeof setTimeout> | null = null;
	const motionMediaQuery = getMotionMediaQuery();

	function clearDrainTimeout(): void {
		if (drainTimeoutId !== null) {
			clearTimeout(drainTimeoutId);
			drainTimeoutId = null;
		}
	}

	function clearRevealTimeout(): void {
		if (revealTimeoutId !== null) {
			clearTimeout(revealTimeoutId);
			revealTimeoutId = null;
		}
	}

	function syncRevealActivity(): void {
		isRevealActive = isStreamingSource || revealTimeoutId !== null || drainTimeoutId !== null;
	}

	function syncMode(): void {
		if (displayedText.length === 0 && targetText.length === 0 && !isStreamingSource) {
			mode = "idle";
			return;
		}

		if (isStreamingSource) {
			mode =
				targetText.length > displayedText.length || targetText.length === 0
					? "streaming"
					: "paused-awaiting-more";
			return;
		}

		mode = displayedText.length < targetText.length ? "completion-catchup" : "complete";
	}

	function canDrain(): boolean {
		return displayedText.length > 0 && !prefersReducedMotion;
	}

	function cancelDrain(): void {
		clearDrainTimeout();
		syncRevealActivity();
	}

	function scheduleDrain(): void {
		clearDrainTimeout();
		syncRevealActivity();
		drainTimeoutId = setTimeout(() => {
			drainTimeoutId = null;
			syncMode();
			syncRevealActivity();
		}, CSS_DRAIN_TIMEOUT_MS);
		syncRevealActivity();
	}

	function canPaceReveal(): boolean {
		return targetText.length > displayedText.length && !prefersReducedMotion;
	}

	function computeAdvanceLength(backlog: number): number {
		if (isStreamingSource) {
			return Math.min(
				MAX_STREAMING_ADVANCE_CHARS,
				Math.max(
					MIN_STREAMING_ADVANCE_CHARS,
					Math.ceil(backlog / STREAMING_BACKLOG_DIVISOR)
				)
			);
		}

		return Math.min(
			MAX_COMPLETION_ADVANCE_CHARS,
			Math.max(
				MIN_COMPLETION_ADVANCE_CHARS,
				Math.ceil(backlog / COMPLETION_BACKLOG_DIVISOR)
			)
		);
	}

	function scheduleRevealTick(): void {
		if (revealTimeoutId !== null || !canPaceReveal()) {
			syncRevealActivity();
			return;
		}

		revealTimeoutId = setTimeout(() => {
			revealTimeoutId = null;

			if (!canPaceReveal()) {
				syncMode();
				if (!isStreamingSource && displayedText === targetText && canDrain()) {
					scheduleDrain();
				} else {
					syncRevealActivity();
				}
				return;
			}

			const backlog = targetText.length - displayedText.length;
			const nextLength = Math.min(
				targetText.length,
				displayedText.length + computeAdvanceLength(backlog)
			);
			displayedText = targetText.slice(0, nextLength);
			syncMode();

			if (canPaceReveal()) {
				scheduleRevealTick();
				return;
			}

			if (!isStreamingSource && displayedText === targetText && canDrain()) {
				scheduleDrain();
				return;
			}

			syncRevealActivity();
		}, REVEAL_TICK_MS);
		syncRevealActivity();
	}

	function setState(
		sourceText: string,
		isStreaming: boolean,
		options?: { seedFromSource?: boolean }
	): void {
		targetText = sourceText;
		isStreamingSource = isStreaming;
		clearDrainTimeout();

		const shouldSeedFromSource = options?.seedFromSource === true;
		const hasNonPrefixRewrite = displayedText.length > 0 && !sourceText.startsWith(displayedText);
		const shouldSnapToSource =
			shouldSeedFromSource ||
			prefersReducedMotion ||
			sourceText.length < displayedText.length ||
			hasNonPrefixRewrite;

		if (shouldSnapToSource) {
			clearRevealTimeout();
			displayedText = sourceText;
		}

		syncMode();

		if (sourceText.length === 0 && !isStreaming) {
			clearRevealTimeout();
			displayedText = "";
			targetText = "";
			syncMode();
			syncRevealActivity();
			return;
		}

		if (canPaceReveal()) {
			scheduleRevealTick();
			return;
		}

		clearRevealTimeout();

		if (!isStreaming && displayedText === targetText && canDrain()) {
			scheduleDrain();
			return;
		}

		syncRevealActivity();
	}

	function setMode(_nextMode: StreamingAnimationMode): void {}

	function reset(): void {
		clearDrainTimeout();
		clearRevealTimeout();
		displayedText = "";
		targetText = "";
		isStreamingSource = false;
		mode = "idle";
		isRevealActive = false;
	}

	function handleReducedMotionChange(event: MediaQueryListEvent): void {
		prefersReducedMotion = event.matches;
		if (prefersReducedMotion) {
			clearRevealTimeout();
			clearDrainTimeout();
			displayedText = targetText;
			syncMode();
			syncRevealActivity();
			return;
		}

		if (targetText.length > displayedText.length) {
			scheduleRevealTick();
			return;
		}

		if (drainTimeoutId !== null && !canDrain()) {
			cancelDrain();
		}
	}

	if (motionMediaQuery !== null) {
		prefersReducedMotion = motionMediaQuery.matches;
		motionMediaQuery.addEventListener("change", handleReducedMotionChange);
	}

	function destroy(): void {
		clearDrainTimeout();
		clearRevealTimeout();
		if (motionMediaQuery !== null) {
			motionMediaQuery.removeEventListener("change", handleReducedMotionChange);
		}
	}

	return {
		setState,
		setMode,
		reset,
		destroy,
		get displayedText() {
			return displayedText;
		},
		get mode() {
			return mode;
		},
		get isRevealActive() {
			return isRevealActive;
		},
	};
}
