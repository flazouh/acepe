export function clampVoiceDownloadPercent(percent: number): number {
	if (percent < 0) {
		return 0;
	}

	if (percent > 100) {
		return 100;
	}

	return percent;
}

export function countFilledVoiceDownloadSegments(percent: number, segmentCount: number): number {
	const clampedPercent = clampVoiceDownloadPercent(percent);
	if (clampedPercent <= 0) {
		return 0;
	}

	const filledSegments = Math.round((clampedPercent / 100) * segmentCount);
	if (filledSegments < 1) {
		return 1;
	}

	if (filledSegments > segmentCount) {
		return segmentCount;
	}

	return filledSegments;
}

export function buildVoiceDownloadSegments(percent: number, segmentCount: number): boolean[] {
	const filledSegments = countFilledVoiceDownloadSegments(percent, segmentCount);
	return Array.from({ length: segmentCount }, (_, index) => index < filledSegments);
}

export function formatVoiceDownloadPercent(percent: number): string {
	return `${Math.round(clampVoiceDownloadPercent(percent))}%`;
}
