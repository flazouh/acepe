export type NativeMarkdownMode = "static" | "streaming";

export type NativeMarkdownAnimation = false | undefined;

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
