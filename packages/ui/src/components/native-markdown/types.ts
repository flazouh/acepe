export type NativeMarkdownMode = "static" | "streaming";

export type NativeMarkdownAnimation = false | undefined;

export interface NativeMarkdownTokenRevealTiming {
	readonly revealCount: number;
	readonly revealedCharCount: number;
	readonly baselineMs: number;
	readonly tokStepMs: number;
	readonly tokFadeDurMs: number;
	readonly mode: "smooth" | "instant";
}

/**
 * Payload emitted when the user toggles the link state on a rendered GitHub PR chip.
 * `isLinked` reflects the chip's state at click time, so the host knows whether to
 * link or unlink. Presentational only; the host owns the canonical write.
 */
export interface TogglePrLinkPayload {
	readonly owner: string;
	readonly repo: string;
	readonly prNumber: number;
	readonly href: string;
	readonly isLinked: boolean;
}
