/**
 * Single source of truth for inline thinking stream viewport geometry (line budget,
 * line height, snap mode). Consumed by `assistant-message` CSS variables.
 */
export type ThinkingViewportSnapMode = "block-proximity" | "none";

export interface ThinkingViewportPolicy {
	readonly visibleLineCount: number;
	readonly lineHeightRem: number;
	readonly snap: ThinkingViewportSnapMode;
}

export const DEFAULT_THINKING_VIEWPORT_POLICY: ThinkingViewportPolicy = {
	visibleLineCount: 4,
	lineHeightRem: 1.4,
	snap: "block-proximity",
};

/**
 * Inline `style` fragment setting `--thinking-*` CSS variables on the scroll container.
 */
export function thinkingViewportCssText(policy: ThinkingViewportPolicy): string {
	return [
		`--thinking-visible-lines:${String(policy.visibleLineCount)}`,
		`--thinking-line-height:${String(policy.lineHeightRem)}rem`,
	].join(";");
}

export function clampVisibleLineCount(count: number): number {
	if (!Number.isFinite(count)) return DEFAULT_THINKING_VIEWPORT_POLICY.visibleLineCount;
	const rounded = Math.floor(count);
	if (!Number.isFinite(rounded)) return DEFAULT_THINKING_VIEWPORT_POLICY.visibleLineCount;
	return Math.max(1, rounded);
}
