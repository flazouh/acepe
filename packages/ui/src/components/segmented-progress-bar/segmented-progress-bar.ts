export type SegmentedProgressBarFillMode = "uniform" | "wholeBarRamp";

export const SEGMENTED_PROGRESS_USAGE_COMPACT_SEGMENT_COUNT = 10;
export const SEGMENTED_PROGRESS_USAGE_FILL_WIDTH_SEGMENT_COUNT = 18;

export function clampSegmentedPercent(percent: number): number {
	if (percent < 0) {
		return 0;
	}

	if (percent > 100) {
		return 100;
	}

	return percent;
}

export function countFilledSegments(percent: number, segmentCount: number): number {
	const clampedPercent = clampSegmentedPercent(percent);
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

export function buildPercentFilledSegments(percent: number, segmentCount: number): boolean[] {
	const filledSegments = countFilledSegments(percent, segmentCount);
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

export function formatSegmentedPercent(percent: number): string {
	return `${Math.round(clampSegmentedPercent(percent))}%`;
}

export type SegmentFillPalette = "download" | "level";

function mixLevelStageFillColor(ratio: number): string {
	const clampedRatio = Math.max(0, Math.min(1, ratio));
	const successWeight = Math.round((1 - clampedRatio) * 100);
	const orangeWeight = Math.round(clampedRatio * 100);
	return `color-mix(in srgb, var(--success) ${successWeight}%, var(--token-download-progress) ${orangeWeight}%)`;
}

function mixCompletenessRampFillColor(ratio: number): string {
	const clampedRatio = Math.max(0, Math.min(1, ratio));
	const successWeight = Math.round((1 - clampedRatio) * 100);
	const orangeWeight = Math.round(clampedRatio * 100);
	return `color-mix(in srgb, var(--success) ${successWeight}%, var(--token-completeness-mid) ${orangeWeight}%)`;
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

export function getCompletenessRampFillColor(segmentRank: number, segmentCount: number): string {
	if (segmentCount <= 0 || segmentRank <= 0) {
		return "var(--token-completeness-mid)";
	}

	if (segmentRank >= segmentCount) {
		return "var(--destructive)";
	}

	if (segmentRank === segmentCount - 1) {
		return "var(--token-completeness-mid)";
	}

	if (segmentRank === 1) {
		return "var(--success)";
	}

	if (segmentRank >= 2 && segmentRank <= segmentCount - 2) {
		const ratio = (segmentRank - 1) / (segmentCount - 2);
		return mixCompletenessRampFillColor(ratio);
	}

	return "var(--token-completeness-mid)";
}

export function getIntensityRampFillColor(level: number, segmentCount = 5): string {
	const clampedLevel = Math.max(0, Math.min(1, level));
	if (clampedLevel <= 0.02) {
		return "color-mix(in oklab, var(--border) 80%, transparent)";
	}

	const segmentRank = Math.max(1, Math.ceil(clampedLevel * segmentCount));
	return getCompletenessRampFillColor(segmentRank, segmentCount);
}
