import type { FirstSendTimelineProbeResult } from "./schemas";

const PLACEHOLDER_HEIGHT_FAIL_PX = 200;
const SENT_ROW_HIDDEN_WARN_MS = 500;
const MAX_DFB_WARN_PX = 24;

export type FirstSendProbeSummary = {
	readonly status: "ok" | "warn" | "fail";
	readonly lines: readonly string[];
};

function maxNumber(values: readonly number[]): number | null {
	let maxValue: number | null = null;
	for (const value of values) {
		if (maxValue === null || value > maxValue) {
			maxValue = value;
		}
	}
	return maxValue;
}

function maxPlaceholderHeight(samples: FirstSendTimelineProbeResult["samples"]): number | null {
	const heights: number[] = [];
	for (const sample of samples) {
		if (sample.placeholderHeightPx !== null) {
			heights.push(sample.placeholderHeightPx);
		}
	}
	return maxNumber(heights);
}

function maxOnscreenRowHeight(samples: FirstSendTimelineProbeResult["samples"]): number | null {
	const heights: number[] = [];
	for (const sample of samples) {
		heights.push(sample.maxOnscreenRowHeightPx);
	}
	return maxNumber(heights);
}

function isSendWindowSample(sample: FirstSendTimelineProbeResult["samples"][number]): boolean {
	return (
		sample.messageVisibleInTranscript ||
		sample.placeholderHeightPx !== null ||
		sample.planningVisible
	);
}

function maxDistFromBottom(samples: FirstSendTimelineProbeResult["samples"]): number | null {
	const distances: number[] = [];
	for (const sample of samples) {
		if (isSendWindowSample(sample)) {
			distances.push(sample.distFromBottomPx);
		}
	}
	return maxNumber(distances);
}

function sentRowHiddenDurationMs(samples: FirstSendTimelineProbeResult["samples"]): number {
	let firstHiddenAtMs: number | null = null;
	let lastHiddenAtMs: number | null = null;
	for (const sample of samples) {
		if (sample.sentRowVisibleInViewport || sample.planningVisible === false) {
			continue;
		}
		if (firstHiddenAtMs === null) {
			firstHiddenAtMs = sample.elapsedMs;
		}
		lastHiddenAtMs = sample.elapsedMs;
	}
	if (firstHiddenAtMs === null || lastHiddenAtMs === null) {
		return 0;
	}
	return Math.max(0, lastHiddenAtMs - firstHiddenAtMs);
}

export function summarizeFirstSendProbe(
	probe: FirstSendTimelineProbeResult
): FirstSendProbeSummary {
	const placeholderMaxHeightPx = maxPlaceholderHeight(probe.samples);
	const rowMaxHeightPx = maxOnscreenRowHeight(probe.samples);
	const maxDfbPx = maxDistFromBottom(probe.samples);
	const hiddenDurationMs = sentRowHiddenDurationMs(probe.samples);
	const lines = [
		`composer: ${probe.composerFound ? "found" : "missing"}`,
		`composer index: ${probe.selectedComposerIndex === null ? "none" : probe.selectedComposerIndex.toString()}`,
		`composer name: ${probe.selectedComposerName ?? "none"}`,
		`send: ${probe.sendFound ? "found" : "missing"}`,
		`send ready: ${probe.sendReadyBeforeClick ? "yes" : "no"}`,
		`sent: ${probe.sent ? "yes" : "no"}`,
		`placeholder max height: ${placeholderMaxHeightPx === null ? "none" : `${Math.round(placeholderMaxHeightPx).toString()}px`}`,
		`onscreen row max height: ${rowMaxHeightPx === null ? "none" : `${Math.round(rowMaxHeightPx).toString()}px`}`,
		`max dfb: ${maxDfbPx === null ? "none" : `${Math.round(maxDfbPx).toString()}px`}`,
		`sent row hidden before stream: ${hiddenDurationMs.toString()}ms`,
		`samples: ${probe.samples.length.toString()}`,
	];

	if (!probe.sent || (placeholderMaxHeightPx !== null && placeholderMaxHeightPx > PLACEHOLDER_HEIGHT_FAIL_PX)) {
		return { status: "fail", lines };
	}
	if (hiddenDurationMs > SENT_ROW_HIDDEN_WARN_MS || (maxDfbPx !== null && maxDfbPx > MAX_DFB_WARN_PX)) {
		return { status: "warn", lines };
	}
	return { status: "ok", lines };
}
