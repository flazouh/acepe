import type { StreamingAnimationMode } from "$lib/acp/types/streaming-animation-mode.js";

export interface StreamingTailRefreshParams {
	active: boolean;
	value: string;
	/**
	 * @deprecated No longer used. Retained for compile-time compatibility until
	 * Unit 5b removes the call site in markdown-text.svelte.
	 */
	mode?: StreamingAnimationMode;
}

export function streamingTailRefresh(node: HTMLElement, params: StreamingTailRefreshParams) {
	function applyActive(active: boolean): void {
		if (active) {
			node.dataset.streamingActive = "true";
		} else {
			delete node.dataset.streamingActive;
		}
	}

	applyActive(params.active && params.value.length > 0);

	return {
		update(next: StreamingTailRefreshParams) {
			applyActive(next.active && next.value.length > 0);
		},
		destroy() {
			delete node.dataset.streamingActive;
		},
	};
}
