export interface StreamingTailRefreshParams {
	active: boolean;
	value: string;
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
