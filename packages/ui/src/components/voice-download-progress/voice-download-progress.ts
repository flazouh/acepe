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
	return buildDiscreteFilledSegments(filledSegments, segmentCount);
}

export function buildDiscreteFilledSegments(
	filledSegmentCount: number,
	segmentCount: number
): boolean[] {
	if (segmentCount <= 0) {
		return [];
	}

	const clampedFilled = Math.max(0, Math.min(filledSegmentCount, segmentCount));
	return Array.from({ length: segmentCount }, (_, index) => index < clampedFilled);
}

export function formatVoiceDownloadPercent(percent: number): string {
	return `${Math.round(clampVoiceDownloadPercent(percent))}%`;
}

export type SegmentFillPalette = "download" | "level";

function mixLevelStageFillColor(ratio: number): string {
	const clampedRatio = Math.max(0, Math.min(1, ratio));
	const successWeight = Math.round((1 - clampedRatio) * 100);
	const orangeWeight = Math.round(clampedRatio * 100);
	return `color-mix(in srgb, var(--success) ${successWeight}%, var(--token-download-progress) ${orangeWeight}%)`;
}

export function getLevelStageFillColor(segmentRank: number, segmentCount: number): string {
	if (segmentCount <= 0 || segmentRank <= 0) {
		return "var(--token-download-progress)";
	}

	if (segmentRank >= segmentCount) {
		return "var(--destructive)";
	}

	if (segmentRank === segmentCount - 1) {
		return "var(--token-download-progress)";
	}

	if (segmentRank === 1) {
		return "var(--success)";
	}

	if (segmentRank >= 2 && segmentRank <= segmentCount - 2) {
		const ratio = (segmentRank - 1) / (segmentCount - 2);
		return mixLevelStageFillColor(ratio);
	}

	return "var(--token-download-progress)";
}
