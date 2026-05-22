export interface LinkPreviewLoadState {
	readonly isLoading: boolean;
	readonly loadError: boolean;
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
