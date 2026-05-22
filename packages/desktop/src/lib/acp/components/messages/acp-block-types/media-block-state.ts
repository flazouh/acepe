export interface ImageBlockDisplayState {
	src: string | null;
	fallbackLabel: string;
}

export interface AudioBlockDisplayState {
	src: string;
	label: string;
}

export function buildImageBlockDisplayState(input: {
	data: string;
	mimeType: string;
	uri?: string;
}): ImageBlockDisplayState {
	return {
		src: input.uri || (input.data ? getBase64DataUrl(input.mimeType, input.data) : null),
		fallbackLabel: `Image (${input.mimeType})`,
	};
}

export function buildAudioBlockDisplayState(input: {
	data: string;
	mimeType: string;
}): AudioBlockDisplayState {
	return {
		src: getBase64DataUrl(input.mimeType, input.data),
		label: `Audio (${input.mimeType})`,
	};
}

export function getBase64DataUrl(mimeType: string, data: string): string {
	return `data:${mimeType};base64,${data}`;
}
