import { describe, expect, it } from "bun:test";
import {
	agentPanelStressLabMeasurementWarnings,
	agentPanelStressLabStatus,
} from "../agent-panel-stress-lab-summary";

describe("agent panel stress lab summary", () => {
	it("keeps a foreground frame sample ok", () => {
		const lab = {
			hookAvailable: true,
			opened: true,
			labPresent: true,
			frameSampleCount: 120,
			estimatedFps: 120.2,
			frameSamplingLikelyThrottled: false,
			dump: {
				metrics: {
					frameEnvironment: {
						visibilityState: "visible",
						documentHasFocus: true,
						requestAnimationFrameAvailable: true,
						rafWaitCount: 120,
					},
				},
			},
		};

		expect(agentPanelStressLabStatus(lab)).toBe("ok");
		expect(agentPanelStressLabMeasurementWarnings(lab)).toEqual([]);
	});

	it("warns when the WebView is hidden and FPS cannot be trusted", () => {
		const lab = {
			hookAvailable: true,
			opened: true,
			labPresent: true,
			frameSampleCount: 0,
			estimatedFps: null,
			frameSamplingLikelyThrottled: true,
			dump: {
				metrics: {
					frameEnvironment: {
						visibilityState: "hidden",
						documentHasFocus: false,
						requestAnimationFrameAvailable: true,
						rafWaitCount: 0,
					},
				},
			},
		};

		expect(agentPanelStressLabStatus(lab)).toBe("warn");
		expect(agentPanelStressLabMeasurementWarnings(lab)).toEqual([
			"no frame samples were captured",
			"estimated FPS unavailable",
			"frame sampler was likely throttled",
			"document visibility was hidden",
			"document did not have focus",
			"requestAnimationFrame did not produce samples",
		]);
	});
});
