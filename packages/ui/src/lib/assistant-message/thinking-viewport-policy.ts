export interface ThinkingViewportPolicy {
	readonly lineHeightRem: number;
}

export const DEFAULT_THINKING_VIEWPORT_POLICY: ThinkingViewportPolicy = {
	lineHeightRem: 1,
};

export function thinkingViewportCssText(policy: ThinkingViewportPolicy): string {
	return `--thinking-line-height:${String(policy.lineHeightRem)}rem`;
}
