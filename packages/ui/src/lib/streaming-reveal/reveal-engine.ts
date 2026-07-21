/**
 * Presentation-buffer engine for streaming text reveal.
 *
 * The model streams tokens in BURSTS (~15 words / ~470ms for Claude), not
 * smoothly. Painting each burst on arrival looks chunky. This engine accepts
 * bursty target-text updates and releases characters locally at a smooth,
 * rate-adaptive cadence, converting a pulsing input into continuous motion.
 *
 * Framework-agnostic and DOM-free: it computes a `visibleText` prefix and
 * hands it to `onUpdate`. Rendering (plain, per-word fade, per-block fade) is
 * a separate concern layered on top. The clock and frame scheduler are
 * injectable so the pacing is deterministically testable.
 *
 * Approach synthesized from Zed's `StreamingTextBuffer` (adaptive
 * bytes-per-tick) and assistant-ui's `useSmooth` (per-char interval floor +
 * sub-frame time banking).
 */

export type RevealMode = "instant" | "buffer" | "buffer-fade" | "block-fade";

/**
 * Modes that temporally drip characters. Only `instant` passes text through
 * whole — every other mode paces its reveal. `block-fade` drips like the buffer
 * modes; its consumer reveals only the completed-block prefix, so whole blocks
 * surface one at a time as the drip crosses each boundary (rather than a burst
 * of blocks appearing together, which reads no differently from `instant`).
 */
function isStreamingMode(mode: RevealMode): boolean {
	return mode === "buffer" || mode === "buffer-fade" || mode === "block-fade";
}

export interface RevealState {
	/** All text received so far (every byte pushed). */
	readonly targetText: string;
	/** The smoothed, currently-visible prefix. Equals `targetText` in passthrough modes. */
	readonly visibleText: string;
	/**
	 * `[start, end)` char range newly revealed on the tick that produced this
	 * state — the hook a per-word fade uses to animate only fresh words. `null`
	 * when nothing was revealed this update.
	 */
	readonly justRevealed: readonly [number, number] | null;
	/** True once `end()` was called and the buffer has fully drained. */
	readonly done: boolean;
}

export interface RevealControllerOptions {
	mode: RevealMode;
	/**
	 * Target time to drain the current backlog (ms). Tune to the input cadence:
	 * setting it near the inter-burst interval makes the buffer arrive empty just
	 * as the next burst lands, giving continuous motion. Default 450 (≈ Claude's
	 * ~470ms cadence). Zed uses 200, which produces a fast burst then a pause.
	 */
	drainMs?: number;
	/** Ceiling on per-char interval (ms) so a slow trickle still animates. Default 5. */
	maxCharIntervalMs?: number;
	/**
	 * Hard cap on how far `visibleText` may lag `targetText` (chars). A large
	 * paste past this is snapped forward rather than dripped for minutes.
	 * Default 600 (Claude's cap).
	 */
	maxBacklogChars?: number;
	/** Reveal everything immediately, ignoring the drip (prefers-reduced-motion). */
	reducedMotion?: boolean;
	/** Receives a fresh {@link RevealState} whenever visible text changes. */
	onUpdate: (state: RevealState) => void;
	/** Injectable clock (ms). Defaults to `performance.now()`. */
	now?: () => number;
	/** Injectable frame scheduler. Defaults to `requestAnimationFrame`. */
	scheduleFrame?: (cb: (nowMs: number) => void) => number;
	/** Injectable frame canceller. Defaults to `cancelAnimationFrame`. */
	cancelFrame?: (handle: number) => void;
}

export interface RevealController {
	/** Replace the full accumulated target text (diffed internally; handles corrections). */
	setTarget(fullText: string): void;
	/** Append a delta to the target text. */
	push(delta: string): void;
	/** Reveal everything now — call on boundaries (tool call, block switch, tab hidden). */
	flush(): void;
	/** Signal the stream ended; the buffer drains, then `done` flips true. */
	end(): void;
	/** Stop the frame loop and release resources. */
	destroy(): void;
	/** Current immutable snapshot. */
	readonly state: RevealState;
}

const DEFAULTS = {
	drainMs: 450,
	maxCharIntervalMs: 5,
	maxBacklogChars: 600,
} as const;

export function createRevealController(options: RevealControllerOptions): RevealController {
	const drainMs = options.drainMs ?? DEFAULTS.drainMs;
	const maxCharIntervalMs = options.maxCharIntervalMs ?? DEFAULTS.maxCharIntervalMs;
	const maxBacklogChars = options.maxBacklogChars ?? DEFAULTS.maxBacklogChars;
	const now = options.now ?? (() => performance.now());
	const scheduleFrame =
		options.scheduleFrame ?? ((cb) => requestAnimationFrame(cb));
	const cancelFrame = options.cancelFrame ?? ((h) => cancelAnimationFrame(h));

	// Character array so indexing/slicing respects code points, not UTF-16 units —
	// a surrogate pair (emoji) counts as one reveal step and never splits.
	let targetChars: string[] = [];
	let visibleCount = 0;
	let ended = false;
	let done = false;
	let frameHandle: number | null = null;
	let lastTickMs: number | null = null;
	/** Sub-frame carry so the effective rate isn't quantized to frame boundaries. */
	let charBank = 0;

	const passthrough = !isStreamingMode(options.mode) || options.reducedMotion === true;

	function snapshot(justRevealed: readonly [number, number] | null): RevealState {
		return {
			targetText: targetChars.join(""),
			visibleText: targetChars.slice(0, visibleCount).join(""),
			justRevealed,
			done,
		};
	}

	function emit(justRevealed: readonly [number, number] | null): void {
		options.onUpdate(snapshot(justRevealed));
	}

	function ensureFrameLoop(): void {
		if (passthrough || frameHandle !== null || done) return;
		lastTickMs = null;
		frameHandle = scheduleFrame(tick);
	}

	function stopFrameLoop(): void {
		if (frameHandle !== null) {
			cancelFrame(frameHandle);
			frameHandle = null;
		}
		lastTickMs = null;
		charBank = 0;
	}

	function tick(): void {
		frameHandle = null;
		const remaining = targetChars.length - visibleCount;

		if (remaining <= 0) {
			if (ended && !done) {
				done = true;
				emit(null);
			}
			return; // idle: no backlog. A later push() restarts the loop.
		}

		const t = now();
		if (lastTickMs === null) {
			// First frame of a run: establish the baseline, reveal nothing yet.
			lastTickMs = t;
			frameHandle = scheduleFrame(tick);
			return;
		}

		const elapsed = t - lastTickMs;
		lastTickMs = t;

		const prevVisible = visibleCount;

		// Snap the overflow: never hold back more than the cap. A huge paste
		// jumps forward so only the last `maxBacklogChars` actually drip.
		if (remaining > maxBacklogChars) {
			visibleCount = targetChars.length - maxBacklogChars;
		}

		const stillRemaining = targetChars.length - visibleCount;
		// Adaptive: bigger backlog → smaller interval → faster reveal, but never
		// slower than the ceiling, so a 1-char trickle still animates.
		const msPerChar = Math.min(maxCharIntervalMs, drainMs / stillRemaining);

		charBank += elapsed;
		let revealCount = Math.floor(charBank / msPerChar);
		if (revealCount > 0) {
			charBank -= revealCount * msPerChar; // keep the fractional remainder
			revealCount = Math.min(revealCount, stillRemaining);
			visibleCount += revealCount;
		}

		if (visibleCount > prevVisible) {
			emit([prevVisible, visibleCount]);
		}

		if (visibleCount >= targetChars.length) {
			if (ended) {
				done = true;
				emit(null);
			}
			return; // drained; loop restarts on the next push()
		}

		frameHandle = scheduleFrame(tick);
	}

	function setTargetChars(next: string[]): void {
		targetChars = next;
		if (passthrough) {
			const prev = visibleCount;
			visibleCount = targetChars.length;
			if (ended) done = true;
			emit(visibleCount > prev ? [prev, visibleCount] : null);
			return;
		}
		if (visibleCount > targetChars.length) {
			// Target shrank (a correction): clamp visible into range.
			visibleCount = targetChars.length;
		}
		ensureFrameLoop();
	}

	return {
		setTarget(fullText: string): void {
			if (done) return;
			setTargetChars(Array.from(fullText));
		},
		push(delta: string): void {
			if (done || delta.length === 0) return;
			setTargetChars(targetChars.concat(Array.from(delta)));
		},
		flush(): void {
			if (done) return;
			stopFrameLoop();
			const prev = visibleCount;
			visibleCount = targetChars.length;
			if (ended) done = true;
			emit(visibleCount > prev ? [prev, visibleCount] : null);
		},
		end(): void {
			if (ended) return;
			ended = true;
			if (passthrough || visibleCount >= targetChars.length) {
				done = true;
				stopFrameLoop();
				emit(null);
				return;
			}
			ensureFrameLoop(); // let the remaining backlog drain, then mark done
		},
		destroy(): void {
			stopFrameLoop();
		},
		get state(): RevealState {
			return snapshot(null);
		},
	};
}
