export const LIVE_REFRESH_CLASS = "streaming-live-refresh";

export interface StreamingTailRefreshParams {
	active: boolean;
	value: string;
}

function restartRefreshAnimation(node: HTMLElement) {
	node.classList.add(LIVE_REFRESH_CLASS);
}

function stopRefreshAnimation(node: HTMLElement) {
	node.classList.remove(LIVE_REFRESH_CLASS);
}

export function streamingTailRefresh(node: HTMLElement, params: StreamingTailRefreshParams) {
	let isActive = params.active;
	let hasContent = params.value.length > 0;

	if (isActive && hasContent) {
		restartRefreshAnimation(node);
	}

	return {
		update(next: StreamingTailRefreshParams) {
			hasContent = next.value.length > 0;

			if (!next.active || !hasContent) {
				isActive = false;
				stopRefreshAnimation(node);
				return;
			}

			if (!isActive) {
				restartRefreshAnimation(node);
			}

			isActive = true;
		},
		destroy() {
			stopRefreshAnimation(node);
		},
	};
}
