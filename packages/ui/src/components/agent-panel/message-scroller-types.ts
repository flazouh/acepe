/**
 * Presentational item contract for {@link ./message-scroller.svelte}. The host
 * (desktop Controller) maps canonical rows → these; the scroller renders them as
 * real DOM with `content-visibility`, never a virtualized window.
 */
export type MessageScrollerItem = {
	/** Render identity — `rowId:version`. Changes ⇒ the item remounts/updates. */
	readonly key: string;
	/** Stable row id, surfaced as `data-row-id` for anchor/on-send resolution. */
	readonly rowId: string;
	/**
	 * Intrinsic-size estimate (px) for `contain-intrinsic-size: auto <est>`, so
	 * off-screen items reserve plausible space before first paint. Tuned per kind
	 * in dev-app QA (the Unit 4 hard criterion).
	 */
	readonly estimatePx: number;
	/** Active streaming tail ⇒ never skip rendering (`content-visibility:visible`). */
	readonly isActiveTail: boolean;
	/** Eligible to be the held anchor while the reader is scrolled up. */
	readonly anchorEligible: boolean;
};

/** Per-kind intrinsic-size seeds (px). Initial values; refined in dev-app QA. */
export const DEFAULT_ROW_ESTIMATE_PX = {
	user: 80,
	assistantText: 150,
	assistantThought: 120,
	tool: 96,
	sessionActivity: 76,
	awaitingPlaceholder: 48,
} as const;

export type MessageScrollerRowKind = keyof typeof DEFAULT_ROW_ESTIMATE_PX;

/** Estimate for a kind, falling back to the assistant-text seed. */
export function rowEstimatePx(kind: string): number {
	return (
		(DEFAULT_ROW_ESTIMATE_PX as Record<string, number>)[kind] ??
		DEFAULT_ROW_ESTIMATE_PX.assistantText
	);
}
