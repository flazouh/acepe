import type { FrameRateProbeResult } from "./schemas";

export type FrameRateProbeSummaryOptions = {
	readonly scrollStepPx: number | null;
};

function formatOptionalMs(value: number | null): string {
	if (value === null) {
		return "unavailable";
	}
	return `${value.toFixed(2)} ms`;
}

function formatOptionalCount(value: number | null): string {
	if (value === null) {
		return "unavailable";
	}
	return value.toLocaleString();
}

function findSlowestFrameIndex(frameDeltasMs: readonly number[]): number | null {
	let slowestIndex: number | null = null;
	let slowestDelta = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < frameDeltasMs.length; index += 1) {
		const delta = frameDeltasMs[index];
		if (delta === undefined || !Number.isFinite(delta)) {
			continue;
		}
		if (delta > slowestDelta) {
			slowestDelta = delta;
			slowestIndex = index;
		}
	}
	return slowestIndex;
}

function summarizeSlowestFrame(probe: FrameRateProbeResult): string {
	const slowestIndex = findSlowestFrameIndex(probe.frameDeltasMs);
	if (slowestIndex === null) {
		return "slowest frame: unavailable";
	}
	const deltaMs = probe.frameDeltasMs[slowestIndex] ?? null;
	const churn = probe.rowChurnSamples.find((sample) => sample.frameIndex === slowestIndex);
	if (churn === undefined) {
		return `slowest frame: index=${slowestIndex.toString()} delta=${formatOptionalMs(deltaMs)} rowChurn=unavailable`;
	}
	return [
		`slowest frame: index=${slowestIndex.toString()}`,
		`delta=${formatOptionalMs(deltaMs)}`,
		`scrollTop=${Math.round(churn.scrollTopPx).toLocaleString()}px`,
		`rows=${formatOptionalCount(churn.domRowCount)}`,
		`range=${formatOptionalCount(churn.firstRowIndex)}-${formatOptionalCount(churn.lastRowIndex)}`,
		`mounted=${formatOptionalCount(churn.mountedRowCount)}`,
		`unmounted=${formatOptionalCount(churn.unmountedRowCount)}`,
	].join(" ");
}

function summarizeAgentPanelProfile(probe: FrameRateProbeResult): string {
	if (probe.agentPanelProfileSamples.length === 0) {
		return "agent panel profile: not collected (add --with-profile)";
	}
	const topPhases = probe.agentPanelProfilePhaseSummaries.slice(0, 5);
	const phaseLabel =
		topPhases.length === 0
			? "none"
			: topPhases
					.map(
						(phase) =>
							`${phase.phase} total=${formatOptionalMs(phase.totalDurationMs)} max=${formatOptionalMs(phase.maxDurationMs)} count=${phase.count.toLocaleString()}`
					)
					.join("; ");
	return `agent panel profile: samples=${probe.agentPanelProfileSamples.length.toLocaleString()} phases=${probe.agentPanelProfilePhaseSummaries.length.toLocaleString()} top=${phaseLabel}`;
}

export function frameRateProbeTimingValid(probe: FrameRateProbeResult): boolean {
	return probe.visibilityState === "visible" && !probe.likelyThrottled;
}

export function summarizeFrameRateProbe(
	probe: FrameRateProbeResult,
	options: FrameRateProbeSummaryOptions
): readonly string[] {
	const focusLabel = `${probe.visibilityState ?? "unknown"} focus=${
		probe.documentHasFocus === null ? "unknown" : probe.documentHasFocus ? "yes" : "no"
	}`;
	const timingValid = frameRateProbeTimingValid(probe);
	const fpsLabel =
		probe.estimatedFps === null
			? "unavailable"
			: timingValid
				? probe.estimatedFps.toFixed(2)
				: `invalid (${probe.estimatedFps.toFixed(2)} hidden/throttled sample)`;
	return [
		`route: ${probe.route ?? "unknown"}`,
		`selector: ${probe.selector ?? "none"} matched=${probe.selectorMatched ? "yes" : "no"} scrolled=${probe.scrolled ? "yes" : "no"}`,
		options.scrollStepPx === null
			? "scroll step: full range"
			: `scroll step: ${options.scrollStepPx.toLocaleString()}px/frame`,
		`frames: samples=${probe.sampleCount.toString()} jank=${probe.jankFrameCount.toString()} avg=${formatOptionalMs(probe.averageFrameDeltaMs)} min=${formatOptionalMs(probe.minFrameDeltaMs)} max=${formatOptionalMs(probe.maxFrameDeltaMs)}`,
		probe.rowChurnSamples.length === 0
			? "row churn: not collected (add --with-row-churn)"
			: `row churn: maxDom=${probe.maxDomRowCount === null ? "unavailable" : probe.maxDomRowCount.toLocaleString()} maxMounted=${probe.maxMountedRowCount === null ? "unavailable" : probe.maxMountedRowCount.toLocaleString()} maxUnmounted=${probe.maxUnmountedRowCount === null ? "unavailable" : probe.maxUnmountedRowCount.toLocaleString()}`,
		summarizeAgentPanelProfile(probe),
		summarizeSlowestFrame(probe),
		`estimated fps: ${fpsLabel}`,
		`frame env: ${focusLabel} raf=${probe.rafWaitCount.toString()} timeout=${probe.timeoutWaitCount.toString()} throttled=${probe.likelyThrottled ? "likely" : "no"}`,
	];
}
