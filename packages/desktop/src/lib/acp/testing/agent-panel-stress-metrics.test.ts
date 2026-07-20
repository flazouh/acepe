import { describe, expect, it } from "vitest";
import {
	type AgentPanelStressPerformanceWithMemory,
	classifyAgentPanelStressFrameAttribution,
	createAgentPanelStressDump,
	formatMetricMs,
	readAgentPanelStressMemory,
	summarizeAgentPanelStressMetrics,
	summarizeAgentPanelStressProfile,
} from "./agent-panel-stress-metrics.js";

describe("agent panel stress metrics", () => {
	it("formats finite millisecond values", () => {
		expect(formatMetricMs(12.3456)).toBe("12.35 ms");
		expect(formatMetricMs(0)).toBe("0 ms");
		expect(formatMetricMs(null)).toBe("unavailable");
	});

	it("summarizes frame samples and jank", () => {
		const summary = summarizeAgentPanelStressMetrics({
			generationMs: 4.2,
			renderSettleMs: 12.8,
			domRowCount: 1_000,
			scrollToTopMs: 2.4,
			scrollToBottomMs: 3.9,
			scrollUpdateMeasurements: [
				{
					scrollTopPx: 1_000,
					updateMs: 1.2,
					domRowCount: 42,
					firstRowIndex: 10,
					lastRowIndex: 51,
					mountedRowCount: 6,
					unmountedRowCount: 4,
					profileSampleCount: 2,
					profileDurationMs: 3,
					profileMaxDurationMs: 2,
					profileSlowestPhase: "message-scroller.virtual-window",
				},
				{
					scrollTopPx: 2_000,
					updateMs: 2.8,
					domRowCount: 48,
					firstRowIndex: 20,
					lastRowIndex: 67,
					mountedRowCount: 9,
					unmountedRowCount: 8,
					profileSampleCount: 3,
					profileDurationMs: 5,
					profileMaxDurationMs: 4,
					profileSlowestPhase: "message-scroller.virtual-layout",
				},
			],
			frameDeltasMs: [16, 17, 33, 48],
			frameEnvironment: {
				visibilityState: "visible",
				documentHasFocus: true,
				requestAnimationFrameAvailable: true,
				longAnimationFrameObserverAvailable: true,
				rafWaitCount: 4,
				timeoutWaitCount: 0,
			},
			memory: {
				usedJSHeapSize: 20_000_000,
				totalJSHeapSize: 40_000_000,
				jsHeapSizeLimit: 80_000_000,
			},
		});

		expect(summary.domRowCount).toBe(1_000);
		expect(summary.jankFrameCount).toBe(2);
		expect(summary.maxFrameDeltaMs).toBe(48);
		expect(summary.averageFrameDeltaMs).toBe(28.5);
		expect(summary.estimatedFps).toBe(35.09);
		expect(summary.targetFrameBudgetMs).toBe(8.33);
		expect(summary.missed120HzFrameCount).toBe(4);
		expect(summary.maxFrameBudgetOverrunMs).toBe(39.67);
		expect(summary.scrollUpdateSampleCount).toBe(2);
		expect(summary.averageScrollUpdateMs).toBe(2);
		expect(summary.maxScrollUpdateMs).toBe(2.8);
		expect(summary.maxScrollUpdateDomRowCount).toBe(48);
		expect(summary.maxScrollUpdateMountedRowCount).toBe(9);
		expect(summary.maxScrollUpdateUnmountedRowCount).toBe(8);
		expect(summary.maxScrollUpdateProfileDurationMs).toBe(5);
		expect(summary.maxScrollUpdateProfileSlowestPhase).toBe("message-scroller.virtual-layout");
		expect(summary.frameSamplingLikelyThrottled).toBe(false);
		expect(summary.frameEnvironmentLabel).toBe(
			"visible focus=yes raf=4 timeout=0 loaf=yes throttled=no"
		);
		expect(summary.memoryLabel).toBe("19.07 MB / 38.15 MB");
	});

	it("attributes long frames with cheap app work to browser layout or paint", () => {
		const summary = summarizeAgentPanelStressMetrics({
			generationMs: null,
			renderSettleMs: null,
			domRowCount: 67,
			scrollToTopMs: null,
			scrollToBottomMs: null,
			scrollUpdateMeasurements: [],
			frameDeltasMs: [8, 9, 24],
			frameAttributions: [
				{
					frameIndex: 0,
					targetScrollTopPx: 100,
					frameDeltaMs: 8,
					frameBudgetOverrunMs: 0,
					scrollSetMs: 0.1,
					afterFrameInspectionMs: 0.2,
					browserRenderMs: 0.6,
					previousBrowserRenderMs: 0.3,
					preFrameGapMs: 0.2,
					domRowCount: 67,
					firstRowIndex: 1,
					lastRowIndex: 67,
					mountedRowCount: 2,
					unmountedRowCount: 2,
					coldRevealedRowCount: 1,
					staticEstimateRowCount: 1,
					measuredEstimateRowCount: 66,
					maxStaticEstimateErrorPx: 12,
					averageStaticEstimateErrorPx: 12,
					profileSampleCount: 1,
					profileDurationMs: 0.3,
					profileMaxDurationMs: 0.3,
					profileSlowestPhase: "message-scroller.virtual-window",
					cause: "within-120hz-budget",
				},
				{
					frameIndex: 1,
					targetScrollTopPx: 200,
					frameDeltaMs: 9,
					frameBudgetOverrunMs: 0.67,
					scrollSetMs: 0.1,
					afterFrameInspectionMs: 0.2,
					browserRenderMs: 0.7,
					previousBrowserRenderMs: 0.6,
					preFrameGapMs: 0.2,
					domRowCount: 67,
					firstRowIndex: 68,
					lastRowIndex: 134,
					mountedRowCount: 3,
					unmountedRowCount: 3,
					coldRevealedRowCount: 2,
					staticEstimateRowCount: 2,
					measuredEstimateRowCount: 65,
					maxStaticEstimateErrorPx: 16,
					averageStaticEstimateErrorPx: 11,
					profileSampleCount: 1,
					profileDurationMs: 0.4,
					profileMaxDurationMs: 0.4,
					profileSlowestPhase: "message-scroller.virtual-window",
					cause: "within-120hz-budget",
				},
				{
					frameIndex: 2,
					targetScrollTopPx: 300,
					frameDeltaMs: 24,
					frameBudgetOverrunMs: 15.67,
					scrollSetMs: 0.1,
					afterFrameInspectionMs: 0.2,
					browserRenderMs: 10,
					previousBrowserRenderMs: 1,
					preFrameGapMs: 0.2,
					domRowCount: 67,
					firstRowIndex: 135,
					lastRowIndex: 201,
					mountedRowCount: 4,
					unmountedRowCount: 4,
					coldRevealedRowCount: 4,
					staticEstimateRowCount: 10,
					measuredEstimateRowCount: 57,
					maxStaticEstimateErrorPx: 44,
					averageStaticEstimateErrorPx: 18.5,
					profileSampleCount: 1,
					profileDurationMs: 0.4,
					profileMaxDurationMs: 0.4,
					profileSlowestPhase: "message-scroller.virtual-window",
					cause: "browser-layout-paint-suspected",
				},
			],
			frameEnvironment: null,
			memory: null,
		});

		expect(summary.missed120HzFrameCount).toBe(1);
		expect(summary.maxFrameBudgetOverrunMs).toBe(15.67);
		expect(summary.slowestFrameIndex).toBe(2);
		expect(summary.slowestFrameDeltaMs).toBe(24);
		expect(summary.slowestFrameCause).toBe("browser-layout-paint-suspected");
		expect(summary.slowestFrameProfileDurationMs).toBe(0.4);
		expect(summary.slowestFrameBrowserRenderMs).toBe(10);
		expect(summary.slowestFramePreviousBrowserRenderMs).toBe(1);
		expect(summary.slowestFramePreFrameGapMs).toBe(0.2);
		expect(summary.slowestFrameMountedRowCount).toBe(4);
		expect(summary.slowestFrameUnmountedRowCount).toBe(4);
		expect(summary.slowestFrameColdRevealedRowCount).toBe(4);
		expect(summary.slowestFrameStaticEstimateRowCount).toBe(10);
		expect(summary.slowestFrameMeasuredEstimateRowCount).toBe(57);
		expect(summary.slowestFrameMaxStaticEstimateErrorPx).toBe(44);
		expect(summary.slowestFrameAverageStaticEstimateErrorPx).toBe(18.5);
		expect(summary.slowestFrameDomRowCount).toBe(67);
		expect(summary.maxFrameColdRevealedRowCount).toBe(4);
		expect(summary.maxFrameStaticEstimateErrorPx).toBe(44);
	});

	it("classifies browser render residual as the likely frame cause", () => {
		const cause = classifyAgentPanelStressFrameAttribution({
			frameDeltaMs: 24,
			scrollSetMs: 0.1,
			afterFrameInspectionMs: 0.2,
			browserRenderMs: 10,
			previousBrowserRenderMs: 1,
			preFrameGapMs: 0.2,
			domRowCount: 67,
			mountedRowCount: 4,
			unmountedRowCount: 4,
			coldRevealedRowCount: 4,
			staticEstimateRowCount: 10,
			measuredEstimateRowCount: 57,
			maxStaticEstimateErrorPx: 44,
			averageStaticEstimateErrorPx: 18.5,
			profileDurationMs: 0.4,
		});

		expect(cause).toBe("browser-layout-paint-suspected");
	});

	it("flags frame samples that look timer throttled", () => {
		const summary = summarizeAgentPanelStressMetrics({
			generationMs: null,
			renderSettleMs: null,
			domRowCount: 20,
			scrollToTopMs: null,
			scrollToBottomMs: null,
			scrollUpdateMeasurements: [],
			frameDeltasMs: [998, 1_002],
			frameEnvironment: {
				visibilityState: "visible",
				documentHasFocus: false,
				requestAnimationFrameAvailable: true,
				longAnimationFrameObserverAvailable: false,
				rafWaitCount: 0,
				timeoutWaitCount: 3,
			},
			memory: null,
		});

		expect(summary.frameSamplingLikelyThrottled).toBe(true);
		expect(summary.frameEnvironmentLabel).toBe(
			"visible focus=no raf=0 timeout=3 loaf=no throttled=yes"
		);
	});

	it("handles empty frame and memory data without fake numbers", () => {
		const summary = summarizeAgentPanelStressMetrics({
			generationMs: null,
			renderSettleMs: null,
			domRowCount: 0,
			scrollToTopMs: null,
			scrollToBottomMs: null,
			scrollUpdateMeasurements: [],
			frameDeltasMs: [],
			frameEnvironment: null,
			memory: null,
		});

		expect(summary.averageFrameDeltaMs).toBeNull();
		expect(summary.maxFrameDeltaMs).toBeNull();
		expect(summary.estimatedFps).toBeNull();
		expect(summary.memoryLabel).toBe("unavailable");
	});

	it("reads optional WebKit memory when available", () => {
		const performanceLike: AgentPanelStressPerformanceWithMemory = {
			memory: {
				usedJSHeapSize: 1,
				totalJSHeapSize: 2,
				jsHeapSizeLimit: 3,
			},
		};

		expect(readAgentPanelStressMemory(performanceLike)).toEqual({
			usedJSHeapSize: 1,
			totalJSHeapSize: 2,
			jsHeapSizeLimit: 3,
		});
		expect(readAgentPanelStressMemory({})).toBeNull();
	});

	it("creates a JSON-safe performance dump", () => {
		const dump = createAgentPanelStressDump({
			route: "/test-agent-panel-stress",
			preset: "mixed",
			rendererMode: "shell-only",
			rowCount: 5_000,
			seed: 9,
			timestampIso: "2026-07-02T00:00:00.000Z",
			metrics: {
				generationMs: 10,
				renderSettleMs: 20,
				domRowCount: 5_000,
				scrollToTopMs: 3,
				scrollToBottomMs: 4,
				scrollUpdateMeasurements: [
					{
						scrollTopPx: 100,
						updateMs: 1,
						domRowCount: 30,
						firstRowIndex: 1,
						lastRowIndex: 30,
						mountedRowCount: 2,
						unmountedRowCount: 1,
						profileSampleCount: 1,
						profileDurationMs: 4,
						profileMaxDurationMs: 4,
						profileSlowestPhase: "message-scroller.virtual-window",
					},
				],
				frameDeltasMs: [16, 20],
				frameEnvironment: null,
				memory: null,
			},
			profileSamples: [
				{
					phase: "scene-content.map-scroller-items",
					durationMs: 4,
					itemCount: 5_000,
					nodeCount: null,
					timestampMs: 12,
				},
			],
		});

		expect(dump.route).toBe("/test-agent-panel-stress");
		expect(dump.rendererMode).toBe("shell-only");
		expect(dump.summary.domRowCount).toBe(5_000);
		expect(dump.profileSummary.sampleCount).toBe(1);
		expect(JSON.parse(JSON.stringify(dump))).toEqual(dump);
	});

	it("summarizes profile samples by slowest total phase", () => {
		const summary = summarizeAgentPanelStressProfile([
			{
				phase: "fast",
				durationMs: 1,
				itemCount: 10,
				nodeCount: null,
				timestampMs: 1,
			},
			{
				phase: "slow",
				durationMs: 4,
				itemCount: 20,
				nodeCount: 5,
				timestampMs: 2,
			},
			{
				phase: "slow",
				durationMs: 6,
				itemCount: 30,
				nodeCount: 9,
				timestampMs: 3,
			},
		]);

		expect(summary.sampleCount).toBe(3);
		expect(summary.totalDurationMs).toBe(11);
		expect(summary.phases[0]).toEqual({
			phase: "slow",
			count: 2,
			totalDurationMs: 10,
			maxDurationMs: 6,
			averageDurationMs: 5,
			maxItemCount: 30,
			maxNodeCount: 9,
		});
	});
});
