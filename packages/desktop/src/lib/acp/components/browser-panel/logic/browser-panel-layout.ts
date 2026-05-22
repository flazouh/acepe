export function getBrowserPanelWidthStyle(input: {
	readonly width: number;
	readonly isFullscreenEmbedded?: boolean;
	readonly isFillContainer?: boolean;
}): string {
	if (input.isFullscreenEmbedded || input.isFillContainer) {
		return "width: 100%; height: 100%;";
	}
	return `width: ${input.width}px;`;
}

export function shouldShowBrowserPanelResizeEdge(input: {
	readonly isFullscreenEmbedded?: boolean;
}): boolean {
	return !input.isFullscreenEmbedded;
}
