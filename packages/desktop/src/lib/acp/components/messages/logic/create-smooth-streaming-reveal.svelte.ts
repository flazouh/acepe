import { splitGraphemes, splitGraphemesSuffix } from "./grapheme-utils.js";
import type { RevealMode } from "./streaming-reveal-engine.js";

const PAUSE_THRESHOLD_MS = 120;
const FLUSH_INTERVAL_MS = 60;
const STREAMING_MIN_CHARS_PER_FLUSH = 40;
const STREAMING_MAX_CHARS_PER_FLUSH = 100;
const COMPLETION_MIN_CHARS_PER_FLUSH = 100;
const COMPLETION_MAX_CHARS_PER_FLUSH = 200;
function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(value, maximum));
}

function computeStreamingChunk(backlogLength: number): number {
	if (backlogLength <= 1) {
		return backlogLength;
	}

	if (backlogLength <= 12) {
		return backlogLength;
	}

	if (backlogLength <= STREAMING_MIN_CHARS_PER_FLUSH) {
		return Math.max(1, Math.ceil(backlogLength / 2));
	}

	const scaledChunk = Math.ceil(backlogLength / 4);
	return Math.min(backlogLength, clamp(scaledChunk, STREAMING_MIN_CHARS_PER_FLUSH, STREAMING_MAX_CHARS_PER_FLUSH));
}

function computeCompletionChunk(backlogLength: number): number {
	if (backlogLength <= COMPLETION_MIN_CHARS_PER_FLUSH) {
		return backlogLength;
	}

	const scaledChunk = Math.ceil(backlogLength / 2);
	return Math.min(backlogLength, clamp(scaledChunk, COMPLETION_MIN_CHARS_PER_FLUSH, COMPLETION_MAX_CHARS_PER_FLUSH));
}

function computeMode(
	sourceLength: number,
	revealedLength: number,
	isStreaming: boolean,
	sourceIdleMs: number
): RevealMode {
	if (sourceLength === 0) {
		return "idle";
	}

	if (revealedLength < sourceLength) {
		return isStreaming ? "streaming" : "completion-catchup";
	}

	if (isStreaming) {
		return sourceIdleMs >= PAUSE_THRESHOLD_MS ? "paused-awaiting-more" : "streaming";
	}

	return "complete";
}

export function createSmoothStreamingReveal() {
	let displayedText = $state("");
	let mode = $state<RevealMode>("idle");
	let isRevealActive = $state(false);
	let sourceText = "";
	let sourceGraphemes: string[] = [];
	let revealedLength = 0;
	let lastSyncedRevealedLength = -1;
	let isStreaming = false;
	let sourceIdleMs = 0;
	let bufferedMs = 0;
	let rafId: number | null = null;
	let lastFrameTime: number | null = null;
	let generation = 0;
	let shouldWatchForPause = false;

	function stopAnimationFrame(): void {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		lastFrameTime = null;
	}

	function resetFrameGeneration(): void {
		generation += 1;
		bufferedMs = 0;
		shouldWatchForPause = false;
		stopAnimationFrame();
	}

	function syncState(): void {
		if (revealedLength !== lastSyncedRevealedLength) {
			displayedText = sourceGraphemes.slice(0, revealedLength).join("");
			lastSyncedRevealedLength = revealedLength;
		}
		mode = computeMode(sourceGraphemes.length, revealedLength, isStreaming, sourceIdleMs);
		isRevealActive = revealedLength < sourceGraphemes.length;
		const keepTicking = isRevealActive || (shouldWatchForPause && isStreaming && mode === "streaming");

		if (!keepTicking) {
			stopAnimationFrame();
		}
	}

	function shouldContinueTicking(): boolean {
		return isRevealActive || (shouldWatchForPause && isStreaming && mode === "streaming");
	}

	function revealChunk(chunkSize: number): void {
		if (chunkSize <= 0) {
			return;
		}

		revealedLength = Math.min(sourceGraphemes.length, revealedLength + chunkSize);
	}

	function advance(deltaMs: number): void {
		if (deltaMs <= 0) {
			syncState();
			return;
		}

		sourceIdleMs += deltaMs;
		const backlogLength = sourceGraphemes.length - revealedLength;
		if (backlogLength <= 0) {
			syncState();
			return;
		}

		if (!isStreaming) {
			revealChunk(computeCompletionChunk(backlogLength));
			bufferedMs = 0;
			syncState();
			return;
		}

		bufferedMs += deltaMs;
		if (bufferedMs < FLUSH_INTERVAL_MS) {
			syncState();
			return;
		}

		revealChunk(computeStreamingChunk(backlogLength));
		bufferedMs = 0;
		syncState();
	}

	function step(frameTime: number, frameGeneration: number): void {
		if (frameGeneration !== generation) {
			return;
		}

		const previousFrameTime = lastFrameTime === null ? frameTime - 16 : lastFrameTime;
		lastFrameTime = frameTime;
		advance(Math.max(0, frameTime - previousFrameTime));

		if (!shouldContinueTicking() || frameGeneration !== generation) {
			return;
		}

		rafId = requestAnimationFrame((nextFrameTime) => {
			step(nextFrameTime, frameGeneration);
		});
	}

	function ensureAnimationFrame(): void {
		if (rafId !== null || !isRevealActive) {
			return;
		}

		const frameGeneration = generation;
		rafId = requestAnimationFrame((frameTime) => {
			step(frameTime, frameGeneration);
		});
	}

	function setState(
		nextSourceText: string,
		nextIsStreaming: boolean,
		options?: { seedFromSource?: boolean }
	): void {
		const sourceChanged = nextSourceText !== sourceText;
		const isAppendOnly = sourceChanged && nextSourceText.startsWith(sourceText);

		if (sourceChanged) {
			if (sourceText.length === 0) {
				sourceText = nextSourceText;
				sourceGraphemes = splitGraphemes(nextSourceText);
				revealedLength =
					options?.seedFromSource || !nextIsStreaming ? sourceGraphemes.length : 0;
			} else if (isAppendOnly) {
				sourceGraphemes = splitGraphemesSuffix(sourceGraphemes, nextSourceText, sourceText);
				sourceText = nextSourceText;
			} else {
				resetFrameGeneration();
				sourceText = nextSourceText;
				sourceGraphemes = splitGraphemes(nextSourceText);
				revealedLength = nextIsStreaming ? 0 : sourceGraphemes.length;
			}

			sourceIdleMs = 0;
			bufferedMs = 0;
			lastSyncedRevealedLength = -1;
		}

		isStreaming = nextIsStreaming;
		if (!nextIsStreaming) {
			shouldWatchForPause = false;
		} else if (sourceGraphemes.length > revealedLength) {
			shouldWatchForPause = true;
		}

		if (revealedLength > sourceGraphemes.length) {
			revealedLength = sourceGraphemes.length;
		}

		syncState();
		if (isRevealActive) {
			ensureAnimationFrame();
		}
	}

	function reset(): void {
		resetFrameGeneration();
		sourceText = "";
		sourceGraphemes = [];
		revealedLength = 0;
		lastSyncedRevealedLength = -1;
		isStreaming = false;
		sourceIdleMs = 0;
		syncState();
	}

	function destroy(): void {
		resetFrameGeneration();
	}

	return {
		setState,
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
