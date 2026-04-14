import type { StreamingAnimationMode } from "$lib/acp/types/streaming-animation-mode.js";

export const LIVE_REFRESH_CLASS = "streaming-live-refresh";
export const SMOOTH_FADE_CLASS = "streaming-smooth-fade";

export interface StreamingTailRefreshParams {
	active: boolean;
	value: string;
	mode?: StreamingAnimationMode;
}

function setModeDataAttribute(node: HTMLElement, mode: StreamingAnimationMode) {
	node.dataset.streamingAnimationMode = mode;
}

function restartRefreshAnimation(node: HTMLElement) {
	node.classList.add(LIVE_REFRESH_CLASS);
}

function stopRefreshAnimation(node: HTMLElement) {
	node.classList.remove(LIVE_REFRESH_CLASS);
	node.classList.remove(SMOOTH_FADE_CLASS);
}

function applySmoothFade(node: HTMLElement) {
	node.classList.remove(SMOOTH_FADE_CLASS);
	void node.offsetWidth;
	node.classList.add(SMOOTH_FADE_CLASS);
}

export function streamingTailRefresh(node: HTMLElement, params: StreamingTailRefreshParams) {
	let isActive = params.active;
	let hasContent = params.value.length > 0;
	let currentMode = params.mode ?? "classic";

	setModeDataAttribute(node, currentMode);

	if (isActive && hasContent) {
		restartRefreshAnimation(node);
		if (currentMode === "smooth") {
			applySmoothFade(node);
		}
	}

	return {
		update(next: StreamingTailRefreshParams) {
			const nextMode = next.mode ?? "classic";
			hasContent = next.value.length > 0;
			setModeDataAttribute(node, nextMode);

			if (!next.active || !hasContent) {
				isActive = false;
				currentMode = nextMode;
				stopRefreshAnimation(node);
				return;
			}

			if (!isActive) {
				restartRefreshAnimation(node);
			}

			if (nextMode === "smooth") {
				applySmoothFade(node);
			}

			isActive = true;
			currentMode = nextMode;
		},
		destroy() {
			stopRefreshAnimation(node);
		},
	};
}
