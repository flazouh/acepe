/**
 * Presentational item contract for {@link ./message-scroller.svelte}. The host
 * (desktop Controller) maps canonical rows → these; the scroller uses the
 * estimate to reserve space when a large transcript is virtualized.
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

export type MessageScrollerItemSource = {
	readonly length: number;
	getItem(index: number): MessageScrollerItem | undefined;
	getItems(startIndex: number, endIndex: number): readonly MessageScrollerItem[];
	getKey(index: number): string | null;
	getRowId(index: number): string | null;
	getEstimatePx(index: number): number;
	isActiveTail(index: number): boolean;
	isAnchorEligible(index: number): boolean;
	findIndexByRowId(rowId: string): number | null;
};

export type MessageScrollerRangeState = {
	readonly startIndex: number;
	readonly endIndex: number;
	readonly itemCount: number;
	readonly beforePx: number;
	readonly afterPx: number;
	readonly totalPx: number;
	readonly isVirtualized: boolean;
};

export function createArrayMessageScrollerItemSource(
	items: readonly MessageScrollerItem[]
): MessageScrollerItemSource {
	return {
		get length() {
			return items.length;
		},
		getItem(index: number): MessageScrollerItem | undefined {
			return items[index];
		},
		getItems(startIndex: number, endIndex: number): readonly MessageScrollerItem[] {
			return items.slice(startIndex, endIndex);
		},
		getKey(index: number): string | null {
			return items[index]?.key ?? null;
		},
		getRowId(index: number): string | null {
			return items[index]?.rowId ?? null;
		},
		getEstimatePx(index: number): number {
			return items[index]?.estimatePx ?? DEFAULT_ROW_ESTIMATE_PX.assistantText;
		},
		isActiveTail(index: number): boolean {
			return items[index]?.isActiveTail ?? false;
		},
		isAnchorEligible(index: number): boolean {
			return items[index]?.anchorEligible ?? false;
		},
		findIndexByRowId(rowId: string): number | null {
			for (let index = 0; index < items.length; index += 1) {
				if (items[index]?.rowId === rowId) {
					return index;
				}
			}
			return null;
		},
	};
}

/** Per-kind intrinsic-size seeds (px). Initial values; refined in dev-app QA. */
export const DEFAULT_ROW_ESTIMATE_PX = {
	user: 80,
	assistantText: 150,
	assistantThought: 120,
	tool: 96,
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
