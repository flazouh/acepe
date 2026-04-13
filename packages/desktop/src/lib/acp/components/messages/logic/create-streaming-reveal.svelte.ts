import { StreamingRevealEngine, type RevealMode } from "./streaming-reveal-engine.js";

export function createStreamingReveal() {
	const engine = new StreamingRevealEngine();
	let displayedText = $state("");
	let mode = $state<RevealMode>("idle");
	let cursorVisible = $state(false);
	let isRevealActive = $state(false);
	let rafId: number | null = null;
	let lastFrameTime: number | null = null;

	function stopAnimationFrame(): void {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		lastFrameTime = null;
	}

	function syncState(): void {
		const snapshot = engine.getSnapshot();
		displayedText = snapshot.displayedText;
		mode = snapshot.mode;
		cursorVisible = snapshot.cursorVisible;
		isRevealActive = snapshot.isRevealActive;

		if (!snapshot.isRevealActive) {
			stopAnimationFrame();
		}
	}

	function step(frameTime: number): void {
		const previousFrameTime = lastFrameTime === null ? frameTime - 16 : lastFrameTime;
		lastFrameTime = frameTime;
		engine.advance(Math.max(0, frameTime - previousFrameTime));
		syncState();

		if (!engine.getSnapshot().isRevealActive) {
			return;
		}

		rafId = requestAnimationFrame(step);
	}

	function ensureAnimationFrame(): void {
		if (rafId !== null) {
			return;
		}

		rafId = requestAnimationFrame(step);
	}

	function setState(
		sourceText: string,
		isStreaming: boolean,
		options?: { seedFromSource?: boolean }
	): void {
		engine.setSourceText(sourceText, isStreaming, options);
		syncState();

		if (engine.getSnapshot().isRevealActive) {
			ensureAnimationFrame();
		}
	}

	function reset(): void {
		stopAnimationFrame();
		engine.reset();
		syncState();
	}

	function destroy(): void {
		stopAnimationFrame();
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
		get cursorVisible() {
			return cursorVisible;
		},
		get isRevealActive() {
			return isRevealActive;
		},
	};
}
