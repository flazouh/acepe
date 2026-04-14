export type RevealMode =
	| "idle"
	| "streaming"
	| "paused-awaiting-more"
	| "completion-catchup"
	| "complete";

export interface StreamingRevealSnapshot {
	sourceText: string;
	displayedText: string;
	revealedLength: number;
	backlogLength: number;
	mode: RevealMode;
	cursorVisible: boolean;
	isRevealActive: boolean;
	isStreaming: boolean;
}

const PAUSE_THRESHOLD_MS = 120;
const FAIL_OPEN_FRAME_GAP_MS = 200;
const STREAMING_BASE_CHARS_PER_SECOND = 180;
const STREAMING_BACKLOG_CHARS_PER_SECOND = 6;
const COMPLETION_BASE_CHARS_PER_SECOND = 540;
const COMPLETION_BACKLOG_CHARS_PER_SECOND = 10;
const MAX_STREAMING_CHARS_PER_FRAME = 12;
const MAX_COMPLETION_CHARS_PER_FRAME = 40;
const FAIL_OPEN_MAX_CHARS_PER_FRAME = 96;
import { splitGraphemes } from "./grapheme-utils.js";

function clampRevealAdvance(
	backlogLength: number,
	deltaMs: number,
	mode: "streaming" | "completion-catchup"
): number {
	if (backlogLength <= 0) {
		return 0;
	}

	if (deltaMs >= FAIL_OPEN_FRAME_GAP_MS) {
		return Math.min(backlogLength, FAIL_OPEN_MAX_CHARS_PER_FRAME);
	}

	const baseCharsPerSecond =
		mode === "completion-catchup"
			? COMPLETION_BASE_CHARS_PER_SECOND
			: STREAMING_BASE_CHARS_PER_SECOND;
	const backlogCharsPerSecond =
		mode === "completion-catchup"
			? backlogLength * COMPLETION_BACKLOG_CHARS_PER_SECOND
			: backlogLength * STREAMING_BACKLOG_CHARS_PER_SECOND;
	const maxCharsPerFrame =
		mode === "completion-catchup"
			? MAX_COMPLETION_CHARS_PER_FRAME
			: MAX_STREAMING_CHARS_PER_FRAME;
	const revealEstimate = Math.ceil(((baseCharsPerSecond + backlogCharsPerSecond) * deltaMs) / 1000);
	const boundedReveal = Math.max(1, Math.min(revealEstimate, maxCharsPerFrame));
	return Math.min(backlogLength, boundedReveal);
}

export class StreamingRevealEngine {
	private sourceText = "";
	private sourceGraphemes: string[] = [];
	private revealedLength = 0;
	private sourceIdleMs = 0;
	private isStreaming = false;
	private mode: RevealMode = "idle";

	setSourceText(
		nextSourceText: string,
		nextIsStreaming: boolean,
		options?: { seedFromSource?: boolean }
	): void {
		const sourceChanged = nextSourceText !== this.sourceText;
		const isAppendOnly = sourceChanged && nextSourceText.startsWith(this.sourceText);

		if (sourceChanged) {
			if (this.sourceText.length === 0) {
				this.sourceText = nextSourceText;
				this.sourceGraphemes = splitGraphemes(nextSourceText);
				this.revealedLength = options?.seedFromSource ? this.sourceGraphemes.length : 0;
			} else if (isAppendOnly) {
				this.sourceText = nextSourceText;
				this.sourceGraphemes = splitGraphemes(nextSourceText);
			} else {
				this.sourceText = nextSourceText;
				this.sourceGraphemes = splitGraphemes(nextSourceText);
				this.revealedLength = nextIsStreaming ? 0 : this.sourceGraphemes.length;
			}

			this.sourceIdleMs = 0;
		}

		this.isStreaming = nextIsStreaming;
		if (this.revealedLength > this.sourceGraphemes.length) {
			this.revealedLength = this.sourceGraphemes.length;
		}
		this.recomputeMode();
	}

	advance(deltaMs: number): void {
		if (deltaMs <= 0) {
			this.recomputeMode();
			return;
		}

		this.sourceIdleMs += deltaMs;
		const backlogLength = this.sourceGraphemes.length - this.revealedLength;
		if (backlogLength > 0) {
			const revealAdvance = clampRevealAdvance(
				backlogLength,
				deltaMs,
				this.isStreaming ? "streaming" : "completion-catchup"
			);
			this.revealedLength = Math.min(this.sourceGraphemes.length, this.revealedLength + revealAdvance);
		}

		this.recomputeMode();
	}

	reset(): void {
		this.sourceText = "";
		this.sourceGraphemes = [];
		this.revealedLength = 0;
		this.sourceIdleMs = 0;
		this.isStreaming = false;
		this.mode = "idle";
	}

	getSnapshot(): StreamingRevealSnapshot {
		const backlogLength = this.sourceGraphemes.length - this.revealedLength;
		return {
			sourceText: this.sourceText,
			displayedText: this.sourceGraphemes.slice(0, this.revealedLength).join(""),
			revealedLength: this.revealedLength,
			backlogLength,
			mode: this.mode,
			cursorVisible:
				this.mode === "streaming" ||
				this.mode === "paused-awaiting-more" ||
				this.mode === "completion-catchup",
			isRevealActive: backlogLength > 0,
			isStreaming: this.isStreaming,
		};
	}

	private recomputeMode(): void {
		if (this.sourceText.length === 0) {
			this.mode = "idle";
			return;
		}

		if (this.revealedLength < this.sourceGraphemes.length) {
			this.mode = this.isStreaming ? "streaming" : "completion-catchup";
			return;
		}

		if (this.isStreaming) {
			this.mode =
				this.sourceIdleMs >= PAUSE_THRESHOLD_MS ? "paused-awaiting-more" : "streaming";
			return;
		}

		this.mode = "complete";
	}
}
