import type { AgentPanelStressPreset } from "./agent-panel-stress-fixture.js";
import type { AgentPanelPerformanceSample } from "@acepe/ui/agent-panel";

export type AgentPanelStressRendererMode = "full" | "text-only" | "shell-only";

export type AgentPanelStressMemoryMeasurement = {
	readonly usedJSHeapSize: number;
	readonly totalJSHeapSize: number;
	readonly jsHeapSizeLimit: number;
};

export type AgentPanelStressPerformanceWithMemory = {
	readonly memory?: {
		readonly usedJSHeapSize?: number;
		readonly totalJSHeapSize?: number;
		readonly jsHeapSizeLimit?: number;
	};
};

export type AgentPanelStressFrameEnvironment = {
	readonly visibilityState: string;
	readonly documentHasFocus: boolean | null;
	readonly requestAnimationFrameAvailable: boolean;
	readonly longAnimationFrameObserverAvailable: boolean;
	readonly rafWaitCount: number;
	readonly timeoutWaitCount: number;
};

export type AgentPanelStressScrollUpdateMeasurement = {
	readonly scrollTopPx: number;
	readonly updateMs: number;
	readonly domRowCount: number;
	readonly firstRowIndex: number | null;
	readonly lastRowIndex: number | null;
	readonly mountedRowCount: number;
	readonly unmountedRowCount: number;
	readonly profileSampleCount: number;
	readonly profileDurationMs: number;
	readonly profileMaxDurationMs: number | null;
	readonly profileSlowestPhase: string | null;
};

export type AgentPanelStressFrameAttributionCause =
	| "within-120hz-budget"
	| "js-profile-work"
	| "dom-window-churn"
	| "probe-overhead"
	| "browser-layout-paint-suspected";

export type AgentPanelStressFrameAttributionInput = {
	readonly frameDeltaMs: number;
	readonly scrollSetMs: number;
	readonly afterFrameInspectionMs: number;
	readonly browserRenderMs: number;
	readonly previousBrowserRenderMs: number;
	readonly preFrameGapMs: number;
	readonly domRowCount: number;
	readonly mountedRowCount: number;
	readonly unmountedRowCount: number;
	readonly coldRevealedRowCount: number;
	readonly staticEstimateRowCount: number;
	readonly measuredEstimateRowCount: number;
	readonly maxStaticEstimateErrorPx: number | null;
	readonly averageStaticEstimateErrorPx: number | null;
	readonly profileDurationMs: number;
};

export type AgentPanelStressFrameAttribution = {
	readonly frameIndex: number;
	readonly targetScrollTopPx: number;
	readonly frameDeltaMs: number;
	readonly frameBudgetOverrunMs: number;
	readonly scrollSetMs: number;
	readonly afterFrameInspectionMs: number;
	readonly browserRenderMs: number;
	readonly previousBrowserRenderMs: number;
	readonly preFrameGapMs: number;
	readonly domRowCount: number;
	readonly firstRowIndex: number | null;
	readonly lastRowIndex: number | null;
	readonly mountedRowCount: number;
	readonly unmountedRowCount: number;
	readonly coldRevealedRowCount: number;
	readonly staticEstimateRowCount: number;
	readonly measuredEstimateRowCount: number;
	readonly maxStaticEstimateErrorPx: number | null;
	readonly averageStaticEstimateErrorPx: number | null;
	readonly profileSampleCount: number;
	readonly profileDurationMs: number;
	readonly profileMaxDurationMs: number | null;
	readonly profileSlowestPhase: string | null;
	readonly cause: AgentPanelStressFrameAttributionCause;
};

export type AgentPanelStressMetricInput = {
	readonly generationMs: number | null;
	readonly renderSettleMs: number | null;
	readonly domRowCount: number;
	readonly scrollToTopMs: number | null;
	readonly scrollToBottomMs: number | null;
	readonly scrollUpdateMeasurements: readonly AgentPanelStressScrollUpdateMeasurement[];
	readonly frameDeltasMs: readonly number[];
	readonly frameAttributions?: readonly AgentPanelStressFrameAttribution[];
	readonly frameEnvironment: AgentPanelStressFrameEnvironment | null;
	readonly memory: AgentPanelStressMemoryMeasurement | null;
};

export type AgentPanelStressMetricSummary = {
	readonly generationMsLabel: string;
	readonly renderSettleMsLabel: string;
	readonly domRowCount: number;
	readonly scrollToTopMsLabel: string;
	readonly scrollToBottomMsLabel: string;
	readonly scrollUpdateSampleCount: number;
	readonly averageScrollUpdateMs: number | null;
	readonly maxScrollUpdateMs: number | null;
	readonly maxScrollUpdateDomRowCount: number | null;
	readonly maxScrollUpdateMountedRowCount: number | null;
	readonly maxScrollUpdateUnmountedRowCount: number | null;
	readonly maxScrollUpdateProfileDurationMs: number | null;
	readonly maxScrollUpdateProfileSlowestPhase: string | null;
	readonly frameSampleCount: number;
	readonly jankFrameCount: number;
	readonly averageFrameDeltaMs: number | null;
	readonly maxFrameDeltaMs: number | null;
	readonly estimatedFps: number | null;
	readonly targetFrameBudgetMs: number;
	readonly missed120HzFrameCount: number;
	readonly maxFrameBudgetOverrunMs: number | null;
	readonly slowestFrameIndex: number | null;
	readonly slowestFrameDeltaMs: number | null;
	readonly slowestFrameCause: AgentPanelStressFrameAttributionCause | null;
	readonly slowestFrameProfileDurationMs: number | null;
	readonly slowestFrameBrowserRenderMs: number | null;
	readonly slowestFramePreviousBrowserRenderMs: number | null;
	readonly slowestFramePreFrameGapMs: number | null;
	readonly slowestFrameMountedRowCount: number | null;
	readonly slowestFrameUnmountedRowCount: number | null;
	readonly slowestFrameColdRevealedRowCount: number | null;
	readonly slowestFrameStaticEstimateRowCount: number | null;
	readonly slowestFrameMeasuredEstimateRowCount: number | null;
	readonly slowestFrameMaxStaticEstimateErrorPx: number | null;
	readonly slowestFrameAverageStaticEstimateErrorPx: number | null;
	readonly slowestFrameDomRowCount: number | null;
	readonly maxFrameColdRevealedRowCount: number | null;
	readonly maxFrameStaticEstimateErrorPx: number | null;
	readonly frameSamplingLikelyThrottled: boolean;
	readonly frameEnvironmentLabel: string;
	readonly memoryLabel: string;
};

export type AgentPanelStressProfilePhaseSummary = {
	readonly phase: string;
	readonly count: number;
	readonly totalDurationMs: number;
	readonly maxDurationMs: number;
	readonly averageDurationMs: number;
	readonly maxItemCount: number | null;
	readonly maxNodeCount: number | null;
};

export type AgentPanelStressProfileSummary = {
	readonly sampleCount: number;
	readonly totalDurationMs: number;
	readonly phases: readonly AgentPanelStressProfilePhaseSummary[];
};

export type AgentPanelStressDumpInput = {
	readonly route: string;
	readonly preset: AgentPanelStressPreset;
	readonly rendererMode: AgentPanelStressRendererMode;
	readonly rowCount: number;
	readonly seed: number;
	readonly timestampIso: string;
	readonly metrics: AgentPanelStressMetricInput;
	readonly profileSamples?: readonly AgentPanelPerformanceSample[];
};

export type AgentPanelStressDump = {
	readonly route: string;
	readonly preset: AgentPanelStressPreset;
	readonly rendererMode: AgentPanelStressRendererMode;
	readonly rowCount: number;
	readonly seed: number;
	readonly timestampIso: string;
	readonly metrics: AgentPanelStressMetricInput;
	readonly summary: AgentPanelStressMetricSummary;
	readonly profileSamples: readonly AgentPanelPerformanceSample[];
	readonly profileSummary: AgentPanelStressProfileSummary;
};

const JANK_FRAME_THRESHOLD_MS = 32;
const TARGET_FRAME_BUDGET_MS = 1_000 / 120;
const MISSED_120HZ_FRAME_THRESHOLD_MS = TARGET_FRAME_BUDGET_MS * 1.5;
const FRAME_PROFILE_WORK_THRESHOLD_MS = 4;
const FRAME_PROBE_OVERHEAD_THRESHOLD_MS = 4;
const FRAME_DOM_CHURN_THRESHOLD = 96;
const FRAME_DOM_ROW_COUNT_THRESHOLD = 80;
const TIMER_THROTTLE_FRAME_THRESHOLD_MS = 250;
const UNFOCUSED_THROTTLE_FRAME_THRESHOLD_MS = 100;
const BYTES_PER_MB = 1024 * 1024;

function isFiniteNumber(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function roundMetric(value: number): number {
	return Math.round(value * 100) / 100;
}

type MutableProfilePhaseSummary = {
	phase: string;
	count: number;
	totalDurationMs: number;
	maxDurationMs: number;
	maxItemCount: number | null;
	maxNodeCount: number | null;
};

function formatNumber(value: number): string {
	const rounded = roundMetric(value);
	if (rounded === 0) {
		return "0";
	}
	return rounded.toFixed(2).replace(/\.?0+$/, "");
}

export function formatMetricMs(value: number | null): string {
	if (!isFiniteNumber(value)) {
		return "unavailable";
	}
	return `${formatNumber(value)} ms`;
}

function formatBytesAsMb(bytes: number): string {
	return `${formatNumber(bytes / BYTES_PER_MB)} MB`;
}

function formatMemory(memory: AgentPanelStressMemoryMeasurement | null): string {
	if (memory === null) {
		return "unavailable";
	}
	return `${formatBytesAsMb(memory.usedJSHeapSize)} / ${formatBytesAsMb(memory.totalJSHeapSize)}`;
}

function averageFrameDelta(frameDeltasMs: readonly number[]): number | null {
	if (frameDeltasMs.length === 0) {
		return null;
	}
	let total = 0;
	let count = 0;
	for (const delta of frameDeltasMs) {
		if (!Number.isFinite(delta)) {
			continue;
		}
		total += delta;
		count += 1;
	}
	if (count === 0) {
		return null;
	}
	return roundMetric(total / count);
}

function maxFrameDelta(frameDeltasMs: readonly number[]): number | null {
	let max: number | null = null;
	for (const delta of frameDeltasMs) {
		if (!Number.isFinite(delta)) {
			continue;
		}
		if (max === null || delta > max) {
			max = delta;
		}
	}
	return max === null ? null : roundMetric(max);
}

function countJankFrames(frameDeltasMs: readonly number[]): number {
	let count = 0;
	for (const delta of frameDeltasMs) {
		if (Number.isFinite(delta) && delta > JANK_FRAME_THRESHOLD_MS) {
			count += 1;
		}
	}
	return count;
}

export function calculateAgentPanelStressFrameBudgetOverrunMs(frameDeltaMs: number): number {
	if (!Number.isFinite(frameDeltaMs)) {
		return 0;
	}
	return roundMetric(Math.max(0, frameDeltaMs - TARGET_FRAME_BUDGET_MS));
}

export function classifyAgentPanelStressFrameAttribution(
	input: AgentPanelStressFrameAttributionInput
): AgentPanelStressFrameAttributionCause {
	if (
		!Number.isFinite(input.frameDeltaMs) ||
		input.frameDeltaMs <= MISSED_120HZ_FRAME_THRESHOLD_MS
	) {
		return "within-120hz-budget";
	}
	if (
		input.profileDurationMs >= FRAME_PROFILE_WORK_THRESHOLD_MS &&
		input.profileDurationMs >= input.frameDeltaMs * 0.35
	) {
		return "js-profile-work";
	}
	const browserRenderMs = Math.max(input.browserRenderMs, input.previousBrowserRenderMs);
	if (
		browserRenderMs >= FRAME_PROFILE_WORK_THRESHOLD_MS &&
		browserRenderMs >= input.frameDeltaMs * 0.35
	) {
		return "browser-layout-paint-suspected";
	}
	if (
		input.preFrameGapMs >= FRAME_PROFILE_WORK_THRESHOLD_MS &&
		input.preFrameGapMs >= input.frameDeltaMs * 0.35
	) {
		return "browser-layout-paint-suspected";
	}
	if (
		input.coldRevealedRowCount > 0 &&
		(input.maxStaticEstimateErrorPx ?? 0) >= FRAME_PROFILE_WORK_THRESHOLD_MS
	) {
		return "browser-layout-paint-suspected";
	}
	if (
		input.mountedRowCount + input.unmountedRowCount >= FRAME_DOM_CHURN_THRESHOLD ||
		input.domRowCount >= FRAME_DOM_ROW_COUNT_THRESHOLD
	) {
		return "dom-window-churn";
	}
	if (input.afterFrameInspectionMs >= FRAME_PROBE_OVERHEAD_THRESHOLD_MS) {
		return "probe-overhead";
	}
	return "browser-layout-paint-suspected";
}

function missed120HzFrameCount(
	attributions: readonly AgentPanelStressFrameAttribution[],
	frameDeltasMs: readonly number[]
): number {
	let count = 0;
	const measuredFrames = attributions.length > 0 ? attributions : null;
	if (measuredFrames !== null) {
		for (const attribution of measuredFrames) {
			if (attribution.frameDeltaMs > MISSED_120HZ_FRAME_THRESHOLD_MS) {
				count += 1;
			}
		}
		return count;
	}
	for (const frameDeltaMs of frameDeltasMs) {
		if (Number.isFinite(frameDeltaMs) && frameDeltaMs > MISSED_120HZ_FRAME_THRESHOLD_MS) {
			count += 1;
		}
	}
	return count;
}

function maxFrameBudgetOverrunMs(
	attributions: readonly AgentPanelStressFrameAttribution[],
	frameDeltasMs: readonly number[]
): number | null {
	let max: number | null = null;
	const measuredFrames = attributions.length > 0 ? attributions : null;
	if (measuredFrames !== null) {
		for (const attribution of measuredFrames) {
			if (max === null || attribution.frameBudgetOverrunMs > max) {
				max = attribution.frameBudgetOverrunMs;
			}
		}
		return max === null ? null : roundMetric(max);
	}
	for (const frameDeltaMs of frameDeltasMs) {
		const overrunMs = calculateAgentPanelStressFrameBudgetOverrunMs(frameDeltaMs);
		if (max === null || overrunMs > max) {
			max = overrunMs;
		}
	}
	return max === null ? null : roundMetric(max);
}

function slowestFrameAttribution(
	attributions: readonly AgentPanelStressFrameAttribution[]
): AgentPanelStressFrameAttribution | null {
	let slowest: AgentPanelStressFrameAttribution | null = null;
	for (const attribution of attributions) {
		if (!Number.isFinite(attribution.frameDeltaMs)) {
			continue;
		}
		if (slowest === null || attribution.frameDeltaMs > slowest.frameDeltaMs) {
			slowest = attribution;
		}
	}
	return slowest;
}

function maxFrameColdRevealedRowCount(
	attributions: readonly AgentPanelStressFrameAttribution[]
): number | null {
	let max: number | null = null;
	for (const attribution of attributions) {
		if (!Number.isFinite(attribution.coldRevealedRowCount)) {
			continue;
		}
		if (max === null || attribution.coldRevealedRowCount > max) {
			max = attribution.coldRevealedRowCount;
		}
	}
	return max;
}

function maxFrameStaticEstimateErrorPx(
	attributions: readonly AgentPanelStressFrameAttribution[]
): number | null {
	let max: number | null = null;
	for (const attribution of attributions) {
		const value = attribution.maxStaticEstimateErrorPx;
		if (!isFiniteNumber(value)) {
			continue;
		}
		if (max === null || value > max) {
			max = value;
		}
	}
	return max === null ? null : roundMetric(max);
}

function averageScrollUpdateMs(
	measurements: readonly AgentPanelStressScrollUpdateMeasurement[]
): number | null {
	if (measurements.length === 0) {
		return null;
	}
	let total = 0;
	let count = 0;
	for (const measurement of measurements) {
		if (!Number.isFinite(measurement.updateMs)) {
			continue;
		}
		total += measurement.updateMs;
		count += 1;
	}
	if (count === 0) {
		return null;
	}
	return roundMetric(total / count);
}

function maxScrollUpdateMs(
	measurements: readonly AgentPanelStressScrollUpdateMeasurement[]
): number | null {
	let max: number | null = null;
	for (const measurement of measurements) {
		if (!Number.isFinite(measurement.updateMs)) {
			continue;
		}
		if (max === null || measurement.updateMs > max) {
			max = measurement.updateMs;
		}
	}
	return max === null ? null : roundMetric(max);
}

function maxScrollUpdateDomRowCount(
	measurements: readonly AgentPanelStressScrollUpdateMeasurement[]
): number | null {
	let max: number | null = null;
	for (const measurement of measurements) {
		if (!Number.isFinite(measurement.domRowCount)) {
			continue;
		}
		if (max === null || measurement.domRowCount > max) {
			max = measurement.domRowCount;
		}
	}
	return max;
}

function maxScrollUpdateMountedRowCount(
	measurements: readonly AgentPanelStressScrollUpdateMeasurement[]
): number | null {
	let max: number | null = null;
	for (const measurement of measurements) {
		if (!Number.isFinite(measurement.mountedRowCount)) {
			continue;
		}
		if (max === null || measurement.mountedRowCount > max) {
			max = measurement.mountedRowCount;
		}
	}
	return max;
}

function maxScrollUpdateUnmountedRowCount(
	measurements: readonly AgentPanelStressScrollUpdateMeasurement[]
): number | null {
	let max: number | null = null;
	for (const measurement of measurements) {
		if (!Number.isFinite(measurement.unmountedRowCount)) {
			continue;
		}
		if (max === null || measurement.unmountedRowCount > max) {
			max = measurement.unmountedRowCount;
		}
	}
	return max;
}

function slowestScrollUpdateProfile(
	measurements: readonly AgentPanelStressScrollUpdateMeasurement[]
): {
	readonly durationMs: number | null;
	readonly phase: string | null;
} {
	let durationMs: number | null = null;
	let phase: string | null = null;
	for (const measurement of measurements) {
		if (!Number.isFinite(measurement.profileDurationMs)) {
			continue;
		}
		if (durationMs === null || measurement.profileDurationMs > durationMs) {
			durationMs = measurement.profileDurationMs;
			phase = measurement.profileSlowestPhase;
		}
	}
	return {
		durationMs: durationMs === null ? null : roundMetric(durationMs),
		phase,
	};
}

function estimateFps(averageDeltaMs: number | null): number | null {
	if (averageDeltaMs === null || averageDeltaMs <= 0) {
		return null;
	}
	return roundMetric(1_000 / averageDeltaMs);
}

function focusLabel(documentHasFocus: boolean | null): string {
	if (documentHasFocus === null) {
		return "unknown";
	}
	return documentHasFocus ? "yes" : "no";
}

function rafLabel(environment: AgentPanelStressFrameEnvironment): string {
	if (!environment.requestAnimationFrameAvailable) {
		return "unavailable";
	}
	return environment.rafWaitCount.toString();
}

function isFrameSamplingLikelyThrottled(
	environment: AgentPanelStressFrameEnvironment | null,
	averageFrameDeltaMs: number | null
): boolean {
	if (averageFrameDeltaMs !== null && averageFrameDeltaMs > TIMER_THROTTLE_FRAME_THRESHOLD_MS) {
		return true;
	}
	if (environment === null) {
		return false;
	}
	if (environment.visibilityState !== "visible") {
		return true;
	}
	if (environment.timeoutWaitCount > environment.rafWaitCount) {
		return true;
	}
	return (
		environment.documentHasFocus === false &&
		averageFrameDeltaMs !== null &&
		averageFrameDeltaMs > UNFOCUSED_THROTTLE_FRAME_THRESHOLD_MS
	);
}

function formatFrameEnvironment(
	environment: AgentPanelStressFrameEnvironment | null,
	frameSamplingLikelyThrottled: boolean
): string {
	if (environment === null) {
		return "unavailable";
	}
	return `${environment.visibilityState} focus=${focusLabel(environment.documentHasFocus)} raf=${rafLabel(environment)} timeout=${environment.timeoutWaitCount.toString()} loaf=${environment.longAnimationFrameObserverAvailable ? "yes" : "no"} throttled=${frameSamplingLikelyThrottled ? "yes" : "no"}`;
}

export function summarizeAgentPanelStressMetrics(
	input: AgentPanelStressMetricInput
): AgentPanelStressMetricSummary {
	const averageFrameDeltaMs = averageFrameDelta(input.frameDeltasMs);
	const scrollUpdateMeasurements = input.scrollUpdateMeasurements ?? [];
	const frameAttributions = input.frameAttributions ?? [];
	const slowestProfile = slowestScrollUpdateProfile(scrollUpdateMeasurements);
	const slowestFrame = slowestFrameAttribution(frameAttributions);
	const frameSamplingLikelyThrottled = isFrameSamplingLikelyThrottled(
		input.frameEnvironment,
		averageFrameDeltaMs
	);
	return {
		generationMsLabel: formatMetricMs(input.generationMs),
		renderSettleMsLabel: formatMetricMs(input.renderSettleMs),
		domRowCount: input.domRowCount,
		scrollToTopMsLabel: formatMetricMs(input.scrollToTopMs),
		scrollToBottomMsLabel: formatMetricMs(input.scrollToBottomMs),
		scrollUpdateSampleCount: scrollUpdateMeasurements.length,
		averageScrollUpdateMs: averageScrollUpdateMs(scrollUpdateMeasurements),
		maxScrollUpdateMs: maxScrollUpdateMs(scrollUpdateMeasurements),
		maxScrollUpdateDomRowCount: maxScrollUpdateDomRowCount(scrollUpdateMeasurements),
		maxScrollUpdateMountedRowCount: maxScrollUpdateMountedRowCount(scrollUpdateMeasurements),
		maxScrollUpdateUnmountedRowCount: maxScrollUpdateUnmountedRowCount(scrollUpdateMeasurements),
		maxScrollUpdateProfileDurationMs: slowestProfile.durationMs,
		maxScrollUpdateProfileSlowestPhase: slowestProfile.phase,
		frameSampleCount: input.frameDeltasMs.length,
		jankFrameCount: countJankFrames(input.frameDeltasMs),
		averageFrameDeltaMs,
		maxFrameDeltaMs: maxFrameDelta(input.frameDeltasMs),
		estimatedFps: estimateFps(averageFrameDeltaMs),
		targetFrameBudgetMs: roundMetric(TARGET_FRAME_BUDGET_MS),
		missed120HzFrameCount: missed120HzFrameCount(frameAttributions, input.frameDeltasMs),
		maxFrameBudgetOverrunMs: maxFrameBudgetOverrunMs(frameAttributions, input.frameDeltasMs),
		slowestFrameIndex: slowestFrame?.frameIndex ?? null,
		slowestFrameDeltaMs: slowestFrame?.frameDeltaMs ?? null,
		slowestFrameCause: slowestFrame?.cause ?? null,
		slowestFrameProfileDurationMs: slowestFrame?.profileDurationMs ?? null,
		slowestFrameBrowserRenderMs: slowestFrame?.browserRenderMs ?? null,
		slowestFramePreviousBrowserRenderMs: slowestFrame?.previousBrowserRenderMs ?? null,
		slowestFramePreFrameGapMs: slowestFrame?.preFrameGapMs ?? null,
		slowestFrameMountedRowCount: slowestFrame?.mountedRowCount ?? null,
		slowestFrameUnmountedRowCount: slowestFrame?.unmountedRowCount ?? null,
		slowestFrameColdRevealedRowCount: slowestFrame?.coldRevealedRowCount ?? null,
		slowestFrameStaticEstimateRowCount: slowestFrame?.staticEstimateRowCount ?? null,
		slowestFrameMeasuredEstimateRowCount: slowestFrame?.measuredEstimateRowCount ?? null,
		slowestFrameMaxStaticEstimateErrorPx:
			slowestFrame?.maxStaticEstimateErrorPx === null ||
			slowestFrame?.maxStaticEstimateErrorPx === undefined
				? null
				: roundMetric(slowestFrame.maxStaticEstimateErrorPx),
		slowestFrameAverageStaticEstimateErrorPx:
			slowestFrame?.averageStaticEstimateErrorPx === null ||
			slowestFrame?.averageStaticEstimateErrorPx === undefined
				? null
				: roundMetric(slowestFrame.averageStaticEstimateErrorPx),
		slowestFrameDomRowCount: slowestFrame?.domRowCount ?? null,
		maxFrameColdRevealedRowCount: maxFrameColdRevealedRowCount(frameAttributions),
		maxFrameStaticEstimateErrorPx: maxFrameStaticEstimateErrorPx(frameAttributions),
		frameSamplingLikelyThrottled,
		frameEnvironmentLabel: formatFrameEnvironment(
			input.frameEnvironment,
			frameSamplingLikelyThrottled
		),
		memoryLabel: formatMemory(input.memory),
	};
}

export function summarizeAgentPanelStressProfile(
	samples: readonly AgentPanelPerformanceSample[]
): AgentPanelStressProfileSummary {
	const phases = new Map<string, MutableProfilePhaseSummary>();
	let totalDurationMs = 0;
	for (const sample of samples) {
		const durationMs = Number.isFinite(sample.durationMs) ? sample.durationMs : 0;
		totalDurationMs += durationMs;
		const existing = phases.get(sample.phase);
		if (existing === undefined) {
			phases.set(sample.phase, {
				phase: sample.phase,
				count: 1,
				totalDurationMs: durationMs,
				maxDurationMs: durationMs,
				maxItemCount: sample.itemCount,
				maxNodeCount: sample.nodeCount,
			});
			continue;
		}
		existing.count += 1;
		existing.totalDurationMs += durationMs;
		existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
		if (sample.itemCount !== null) {
			existing.maxItemCount =
				existing.maxItemCount === null
					? sample.itemCount
					: Math.max(existing.maxItemCount, sample.itemCount);
		}
		if (sample.nodeCount !== null) {
			existing.maxNodeCount =
				existing.maxNodeCount === null
					? sample.nodeCount
					: Math.max(existing.maxNodeCount, sample.nodeCount);
		}
	}

	const summarized: AgentPanelStressProfilePhaseSummary[] = [];
	for (const phase of phases.values()) {
		summarized.push({
			phase: phase.phase,
			count: phase.count,
			totalDurationMs: roundMetric(phase.totalDurationMs),
			maxDurationMs: roundMetric(phase.maxDurationMs),
			averageDurationMs: roundMetric(phase.totalDurationMs / phase.count),
			maxItemCount: phase.maxItemCount,
			maxNodeCount: phase.maxNodeCount,
		});
	}
	summarized.sort((left, right) => right.totalDurationMs - left.totalDurationMs);
	return {
		sampleCount: samples.length,
		totalDurationMs: roundMetric(totalDurationMs),
		phases: summarized,
	};
}

export function readAgentPanelStressMemory(
	performanceLike: AgentPanelStressPerformanceWithMemory
): AgentPanelStressMemoryMeasurement | null {
	const memory = performanceLike.memory;
	if (memory === undefined) {
		return null;
	}
	if (
		!isFiniteNumber(memory.usedJSHeapSize) ||
		!isFiniteNumber(memory.totalJSHeapSize) ||
		!isFiniteNumber(memory.jsHeapSizeLimit)
	) {
		return null;
	}
	return {
		usedJSHeapSize: memory.usedJSHeapSize,
		totalJSHeapSize: memory.totalJSHeapSize,
		jsHeapSizeLimit: memory.jsHeapSizeLimit,
	};
}

export function createAgentPanelStressDump(input: AgentPanelStressDumpInput): AgentPanelStressDump {
	const profileSamples = input.profileSamples ?? [];
	return {
		route: input.route,
		preset: input.preset,
		rendererMode: input.rendererMode,
		rowCount: input.rowCount,
		seed: input.seed,
		timestampIso: input.timestampIso,
		metrics: {
			generationMs: input.metrics.generationMs,
			renderSettleMs: input.metrics.renderSettleMs,
			domRowCount: input.metrics.domRowCount,
			scrollToTopMs: input.metrics.scrollToTopMs,
			scrollToBottomMs: input.metrics.scrollToBottomMs,
			scrollUpdateMeasurements: input.metrics.scrollUpdateMeasurements ?? [],
			frameDeltasMs: input.metrics.frameDeltasMs,
			frameAttributions: input.metrics.frameAttributions ?? [],
			frameEnvironment: input.metrics.frameEnvironment,
			memory: input.metrics.memory,
		},
		summary: summarizeAgentPanelStressMetrics(input.metrics),
		profileSamples,
		profileSummary: summarizeAgentPanelStressProfile(profileSamples),
	};
}
