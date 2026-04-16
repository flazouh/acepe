import type { StreamingAnimationMode } from "$lib/acp/types/streaming-animation-mode.js";

export type RevealMode =
	| "idle"
	| "streaming"
	| "paused-awaiting-more"
	| "completion-catchup"
	| "complete";

export const CSS_DRAIN_TIMEOUT_MS = 200;

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

function isAnimatedMode(mode: StreamingAnimationMode): boolean {
	return mode !== "instant";
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
	initialMode: StreamingAnimationMode
): StreamingRevealController {
	let displayedText = $state("");
	let mode = $state<RevealMode>("idle");
	let isRevealActive = $state(false);
	let animationMode = initialMode;
	let isStreamingSource = false;
	let prefersReducedMotion = false;
	let drainTimeoutId: ReturnType<typeof setTimeout> | null = null;
	const motionMediaQuery = getMotionMediaQuery();

	function clearDrainTimeout(): void {
		if (drainTimeoutId !== null) {
			clearTimeout(drainTimeoutId);
			drainTimeoutId = null;
		}
	}

	function syncMode(): void {
		if (displayedText.length === 0 && !isStreamingSource) {
			mode = "idle";
			return;
		}

		mode = isStreamingSource ? "streaming" : "complete";
	}

	function canDrain(): boolean {
		return displayedText.length > 0 && isAnimatedMode(animationMode) && !prefersReducedMotion;
	}

	function cancelDrain(): void {
		clearDrainTimeout();
		if (!isStreamingSource) {
			isRevealActive = false;
		}
	}

	function scheduleDrain(): void {
		clearDrainTimeout();
		isRevealActive = true;
		drainTimeoutId = setTimeout(() => {
			drainTimeoutId = null;
			if (!isStreamingSource) {
				isRevealActive = false;
			}
		}, CSS_DRAIN_TIMEOUT_MS);
	}

	function setState(
		sourceText: string,
		isStreaming: boolean,
		_options?: { seedFromSource?: boolean }
	): void {
		displayedText = sourceText;
		isStreamingSource = isStreaming;
		syncMode();

		if (isStreaming) {
			clearDrainTimeout();
			isRevealActive = true;
			return;
		}

		if (sourceText.length === 0) {
			cancelDrain();
			return;
		}

		if (canDrain()) {
			scheduleDrain();
			return;
		}

		cancelDrain();
	}

	function setMode(nextMode: StreamingAnimationMode): void {
		animationMode = nextMode;
		if (isStreamingSource) {
			isRevealActive = true;
			return;
		}

		if (drainTimeoutId !== null && !canDrain()) {
			cancelDrain();
		}
	}

	function reset(): void {
		clearDrainTimeout();
		displayedText = "";
		isStreamingSource = false;
		mode = "idle";
		isRevealActive = false;
	}

	function handleReducedMotionChange(event: MediaQueryListEvent): void {
		prefersReducedMotion = event.matches;
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
