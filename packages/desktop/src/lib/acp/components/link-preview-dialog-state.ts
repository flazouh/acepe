export interface LinkPreviewLoadState {
	readonly isLoading: boolean;
	readonly loadError: boolean;
}

export type LinkPreviewToolbarStatus = "loading" | "error" | "ready";

export interface LinkPreviewToolbarState {
	readonly domain: string;
	readonly status: LinkPreviewToolbarStatus;
}

export function getLinkPreviewDomain(urlString: string): string {
	try {
		return new URL(urlString).hostname;
	} catch {
		return urlString;
	}
}

export function getLinkPreviewResetState(): LinkPreviewLoadState {
	return {
		isLoading: true,
		loadError: false,
	};
}

export function getLinkPreviewLoadedState(): LinkPreviewLoadState {
	return {
		isLoading: false,
		loadError: false,
	};
}

export function getLinkPreviewErrorState(): LinkPreviewLoadState {
	return {
		isLoading: false,
		loadError: true,
	};
}

export function getLinkPreviewToolbarState(input: {
	readonly currentUrl: string;
	readonly isLoading: boolean;
	readonly loadError: boolean;
}): LinkPreviewToolbarState {
	return {
		domain: getLinkPreviewDomain(input.currentUrl),
		status: input.isLoading ? "loading" : input.loadError ? "error" : "ready",
	};
}
