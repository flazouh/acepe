import type { QaStatus } from "./schemas";

type StressLabFrameEnvironment = {
	readonly visibilityState: string;
	readonly documentHasFocus: boolean | null;
	readonly requestAnimationFrameAvailable: boolean;
	readonly rafWaitCount: number;
};

type StressLabMeasurementStatusInput = {
	readonly hookAvailable: boolean;
	readonly opened: boolean;
	readonly labPresent: boolean;
	readonly frameSampleCount: number;
	readonly estimatedFps: number | null;
	readonly frameSamplingLikelyThrottled: boolean | null;
	readonly dump: {
		readonly metrics: {
			readonly frameEnvironment: StressLabFrameEnvironment | null;
		};
	} | null;
};

export function agentPanelStressLabMeasurementWarnings(
	lab: StressLabMeasurementStatusInput
): string[] {
	if (!lab.hookAvailable || !lab.opened || !lab.labPresent) {
		return [];
	}

	const warnings: string[] = [];
	if (lab.dump === null) {
		warnings.push("stress dump unavailable");
	}
	if (lab.frameSampleCount <= 0) {
		warnings.push("no frame samples were captured");
	}
	if (lab.estimatedFps === null) {
		warnings.push("estimated FPS unavailable");
	}
	if (lab.frameSamplingLikelyThrottled === true) {
		warnings.push("frame sampler was likely throttled");
	}

	const environment = lab.dump?.metrics.frameEnvironment ?? null;
	if (environment === null) {
		warnings.push("frame environment unavailable");
		return warnings;
	}
	if (environment.visibilityState !== "visible") {
		warnings.push(`document visibility was ${environment.visibilityState}`);
	}
	if (environment.documentHasFocus !== true) {
		warnings.push("document did not have focus");
	}
	if (!environment.requestAnimationFrameAvailable) {
		warnings.push("requestAnimationFrame unavailable");
	}
	if (environment.rafWaitCount <= 0) {
		warnings.push("requestAnimationFrame did not produce samples");
	}

	return warnings;
}

export function agentPanelStressLabStatus(lab: StressLabMeasurementStatusInput): QaStatus {
	if (!lab.hookAvailable || !lab.opened || !lab.labPresent) {
		return "warn";
	}
	return agentPanelStressLabMeasurementWarnings(lab).length === 0 ? "ok" : "warn";
}
