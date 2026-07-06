import { describe, expect, it } from "bun:test";
import { frameRateProbeTimingValid, summarizeFrameRateProbe } from "../frame-rate-probe-summary";
import type { FrameRateProbeResult } from "../schemas";

function foregroundProbe(): FrameRateProbeResult {
	return {
		route: "/",
		selector: ".message-scroller__viewport",
		selectorMatched: true,
		scrolled: true,
		sampleCount: 120,
		frameDeltasMs: [8.33, 8.34],
		averageFrameDeltaMs: 8.33,
		minFrameDeltaMs: 8.33,
		maxFrameDeltaMs: 8.34,
		estimatedFps: 120.05,
		jankFrameCount: 0,
		visibilityState: "visible",
		documentHasFocus: true,
		requestAnimationFrameAvailable: true,
		rafWaitCount: 120,
		timeoutWaitCount: 0,
		likelyThrottled: false,
		rowChurnSamples: [],
		maxMountedRowCount: null,
		maxUnmountedRowCount: null,
		maxDomRowCount: null,
		agentPanelProfileSamples: [],
		agentPanelProfilePhaseSummaries: [],
	};
}

function hiddenProbe(): FrameRateProbeResult {
	return {
		route: "/",
		selector: ".message-scroller__viewport",
		selectorMatched: true,
		scrolled: true,
		sampleCount: 1,
		frameDeltasMs: [53],
		averageFrameDeltaMs: 53,
		minFrameDeltaMs: 53,
		maxFrameDeltaMs: 53,
		estimatedFps: 18.87,
		jankFrameCount: 1,
		visibilityState: "hidden",
		documentHasFocus: false,
		requestAnimationFrameAvailable: true,
		rafWaitCount: 0,
		timeoutWaitCount: 2,
		likelyThrottled: true,
		rowChurnSamples: [
			{
				frameIndex: 0,
					scrollTopPx: 320,
					domRowCount: 16,
					firstRowIndex: 0,
					lastRowIndex: 15,
					mountedRowCount: 0,
					unmountedRowCount: 0,
				},
			],
			maxMountedRowCount: 0,
			maxUnmountedRowCount: 0,
			maxDomRowCount: 16,
			agentPanelProfileSamples: [],
			agentPanelProfilePhaseSummaries: [],
		};
	}

describe("frame rate probe summary", () => {
	it("reports foreground FPS as valid", () => {
		const probe = foregroundProbe();

		expect(frameRateProbeTimingValid(probe)).toBe(true);
		expect(summarizeFrameRateProbe(probe, { scrollStepPx: 320 })).toContain(
			"estimated fps: 120.05"
		);
	});

	it("accepts visible RAF samples even when automation steals document focus", () => {
		const probe = foregroundProbe();
		probe.documentHasFocus = false;

		expect(frameRateProbeTimingValid(probe)).toBe(true);
		expect(summarizeFrameRateProbe(probe, { scrollStepPx: 320 })).toContain(
			"estimated fps: 120.05"
		);
		expect(summarizeFrameRateProbe(probe, { scrollStepPx: 320 })).toContain(
			"frame env: visible focus=no raf=120 timeout=0 throttled=no"
		);
	});

	it("marks hidden or throttled FPS as invalid", () => {
		const probe = hiddenProbe();

		expect(frameRateProbeTimingValid(probe)).toBe(false);
		expect(summarizeFrameRateProbe(probe, { scrollStepPx: 320 })).toContain(
			"estimated fps: invalid (18.87 hidden/throttled sample)"
		);
		expect(summarizeFrameRateProbe(probe, { scrollStepPx: 320 })).toContain(
			"row churn: maxDom=16 maxMounted=0 maxUnmounted=0"
		);
		expect(summarizeFrameRateProbe(probe, { scrollStepPx: 320 })).toContain(
			"slowest frame: index=0 delta=53.00 ms scrollTop=320px rows=16 range=0-15 mounted=0 unmounted=0"
		);
	});

	it("reports the slowest frame context when row churn was collected", () => {
		const probe: FrameRateProbeResult = {
			route: "/",
			selector: ".message-scroller__viewport",
			selectorMatched: true,
			scrolled: true,
			sampleCount: 3,
			frameDeltasMs: [8, 42, 12],
			averageFrameDeltaMs: 20.67,
			minFrameDeltaMs: 8,
			maxFrameDeltaMs: 42,
			estimatedFps: 48.39,
			jankFrameCount: 1,
			visibilityState: "visible",
			documentHasFocus: true,
			requestAnimationFrameAvailable: true,
			rafWaitCount: 3,
			timeoutWaitCount: 0,
			likelyThrottled: false,
			rowChurnSamples: [
				{
					frameIndex: 1,
					scrollTopPx: 491_813,
					domRowCount: 16,
					firstRowIndex: 5120,
					lastRowIndex: 5135,
					mountedRowCount: 6,
					unmountedRowCount: 0,
				},
			],
			maxMountedRowCount: 6,
			maxUnmountedRowCount: 0,
			maxDomRowCount: 16,
			agentPanelProfileSamples: [],
			agentPanelProfilePhaseSummaries: [],
		};

		expect(summarizeFrameRateProbe(probe, { scrollStepPx: 96 })).toContain(
			"slowest frame: index=1 delta=42.00 ms scrollTop=491,813px rows=16 range=5,120-5,135 mounted=6 unmounted=0"
		);
	});

	it("summarizes agent panel profile phases when collected", () => {
		const probe = foregroundProbe();
		probe.agentPanelProfileSamples = [
			{
				phase: "message-scroller.virtual-window",
				durationMs: 1,
				itemCount: 256,
				nodeCount: null,
				timestampMs: 10,
			},
			{
				phase: "message-scroller.virtual-window",
				durationMs: 2,
				itemCount: 256,
				nodeCount: null,
				timestampMs: 12,
			},
		];
		probe.agentPanelProfilePhaseSummaries = [
			{
				phase: "message-scroller.virtual-window",
				count: 2,
				totalDurationMs: 3,
				averageDurationMs: 1.5,
				maxDurationMs: 2,
				maxItemCount: 256,
				maxNodeCount: null,
			},
		];

		expect(summarizeFrameRateProbe(probe, { scrollStepPx: 320 })).toContain(
			"agent panel profile: samples=2 phases=1 top=message-scroller.virtual-window total=3.00 ms max=2.00 ms count=2"
		);
	});
});
