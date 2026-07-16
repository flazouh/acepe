import { describe, expect, it } from "bun:test";

import { summarizeFirstSendProbe } from "../first-send-probe-summary";
import { type FirstSendTimelineProbeResult, firstSendTimelineProbeResultSchema } from "../schemas";

function probeWithSamples(
	samples: FirstSendTimelineProbeResult["samples"]
): FirstSendTimelineProbeResult {
	return {
		composerFound: true,
		selectedComposerIndex: 0,
		selectedComposerName: "Message input",
		sendFound: true,
		sendReadyBeforeClick: true,
		sent: true,
		prompt: "QA ping",
		samples,
		preScroll: {
			requestedOffsetPx: null,
			attempted: false,
			passed: true,
			tolerancePx: 24,
			scrollTopPx: null,
			maxScrollTopPx: null,
			distFromBottomPx: null,
		},
		scrollProvenance: {
			installed: true,
			restored: true,
			writes: [],
			events: [],
		},
	};
}

function sample(
	fields: Partial<FirstSendTimelineProbeResult["samples"][number]>
): FirstSendTimelineProbeResult["samples"][number] {
	const result: FirstSendTimelineProbeResult["samples"][number] = {
		label: "sample",
		elapsedMs: 0,
		composerText: "",
		composerContainsPrompt: false,
		messageVisible: true,
		messageVisibleInTranscript: true,
		sentRowVisibleInViewport: true,
		planningVisible: false,
		readyVisible: false,
		matchingTextLeafCount: 1,
		matchingTranscriptViewportCount: 1,
		transcriptViewportCount: 1,
		maxOnscreenRowHeightPx: 48,
		placeholderHeightPx: null,
		panelId: "panel-opencode",
		sessionId: "session-opencode",
		scrollTopPx: 1_000,
		maxScrollTopPx: 1_000,
		scrollAttached: true,
		scrollReleased: false,
		distFromBottomPx: 0,
		bodyPreview: "",
	};
	if (fields.label !== undefined) result.label = fields.label;
	if (fields.elapsedMs !== undefined) result.elapsedMs = fields.elapsedMs;
	if (fields.composerText !== undefined) result.composerText = fields.composerText;
	if (fields.composerContainsPrompt !== undefined) {
		result.composerContainsPrompt = fields.composerContainsPrompt;
	}
	if (fields.messageVisible !== undefined) result.messageVisible = fields.messageVisible;
	if (fields.messageVisibleInTranscript !== undefined) {
		result.messageVisibleInTranscript = fields.messageVisibleInTranscript;
	}
	if (fields.sentRowVisibleInViewport !== undefined) {
		result.sentRowVisibleInViewport = fields.sentRowVisibleInViewport;
	}
	if (fields.planningVisible !== undefined) result.planningVisible = fields.planningVisible;
	if (fields.readyVisible !== undefined) result.readyVisible = fields.readyVisible;
	if (fields.matchingTextLeafCount !== undefined) {
		result.matchingTextLeafCount = fields.matchingTextLeafCount;
	}
	if (fields.matchingTranscriptViewportCount !== undefined) {
		result.matchingTranscriptViewportCount = fields.matchingTranscriptViewportCount;
	}
	if (fields.transcriptViewportCount !== undefined) {
		result.transcriptViewportCount = fields.transcriptViewportCount;
	}
	if (fields.maxOnscreenRowHeightPx !== undefined) {
		result.maxOnscreenRowHeightPx = fields.maxOnscreenRowHeightPx;
	}
	if (fields.placeholderHeightPx !== undefined) {
		result.placeholderHeightPx = fields.placeholderHeightPx;
	}
	if (fields.panelId !== undefined) result.panelId = fields.panelId;
	if (fields.sessionId !== undefined) result.sessionId = fields.sessionId;
	if (fields.scrollTopPx !== undefined) result.scrollTopPx = fields.scrollTopPx;
	if (fields.maxScrollTopPx !== undefined) result.maxScrollTopPx = fields.maxScrollTopPx;
	if (fields.scrollAttached !== undefined) result.scrollAttached = fields.scrollAttached;
	if (fields.scrollReleased !== undefined) result.scrollReleased = fields.scrollReleased;
	if (fields.distFromBottomPx !== undefined) result.distFromBottomPx = fields.distFromBottomPx;
	if (fields.bodyPreview !== undefined) result.bodyPreview = fields.bodyPreview;
	return result;
}

function scrollEvent(
	provenance: FirstSendTimelineProbeResult["scrollProvenance"]["events"][number]["provenance"],
	isTrusted: boolean
): FirstSendTimelineProbeResult["scrollProvenance"]["events"][number] {
	return {
		elapsedMs: 14,
		isTrusted,
		scrollTopPx: 900,
		previousScrollTopPx: 700,
		deltaScrollTopPx: 200,
		scrollHeightPx: 1_600,
		clientHeightPx: 600,
		maxScrollTopPx: 1_000,
		distFromBottomPx: 100,
		nearestSetterAtMs: 12,
		nearestSetterDeltaMs: 2,
		nearestSetterMovedScrollTop: true,
		nearestSetterResultMatchesEvent: true,
		nearestInputIntentKind: null,
		nearestInputIntentAtMs: null,
		nearestInputIntentDeltaMs: null,
		provenance,
	};
}

describe("summarizeFirstSendProbe", () => {
	it("retains scroll writer and native scroll provenance in the artifact schema", () => {
		const parsed = firstSendTimelineProbeResultSchema.parse({
			composerFound: true,
			selectedComposerIndex: 0,
			selectedComposerName: "Message input",
			sendFound: true,
			sendReadyBeforeClick: true,
			sent: true,
			prompt: "QA ping",
			samples: [sample({})],
			preScroll: {
				requestedOffsetPx: 2_000,
				attempted: true,
				passed: true,
				tolerancePx: 24,
				scrollTopPx: 8_000,
				maxScrollTopPx: 10_000,
				distFromBottomPx: 2_000,
			},
			scrollProvenance: {
				installed: true,
				restored: true,
				writes: [
					{
						elapsedMs: 12,
						requestedScrollTopPx: 900,
						beforeScrollTopPx: 700,
						afterScrollTopPx: 900,
						scrollHeightPx: 1_600,
						clientHeightPx: 600,
						maxScrollTopPx: 1_000,
						distFromBottomPx: 100,
						stack: "at attachToBottom (stick-to-bottom.ts:42)",
					},
				],
				events: [
					{
						elapsedMs: 14,
						isTrusted: true,
						scrollTopPx: 900,
						previousScrollTopPx: 700,
						deltaScrollTopPx: 200,
						scrollHeightPx: 1_600,
						clientHeightPx: 600,
						maxScrollTopPx: 1_000,
						distFromBottomPx: 100,
						nearestSetterAtMs: 12,
						nearestSetterDeltaMs: 2,
						nearestSetterMovedScrollTop: true,
						nearestSetterResultMatchesEvent: true,
						nearestInputIntentKind: null,
						nearestInputIntentAtMs: null,
						nearestInputIntentDeltaMs: null,
						provenance: "setter",
					},
				],
			},
		});

		expect(Object.hasOwn(parsed, "scrollProvenance")).toBe(true);
		expect(Object.hasOwn(parsed, "preScroll")).toBe(true);
	});

	it("fails safely when the requested pre-scroll is not released", () => {
		const probe = probeWithSamples([sample({ messageVisibleInTranscript: false })]);
		probe.sent = false;
		probe.preScroll.requestedOffsetPx = 2_000;
		probe.preScroll.attempted = true;
		probe.preScroll.passed = false;
		probe.preScroll.scrollTopPx = 9_900;
		probe.preScroll.maxScrollTopPx = 10_000;
		probe.preScroll.distFromBottomPx = 100;

		const summary = summarizeFirstSendProbe(probe);

		expect(summary.status).toBe("fail");
		expect(summary.lines).toContain(
			"pre-scroll: failed requested=2000px dfb=100px tolerance=24px"
		);
	});

	it("summarizes setter, input, native layout, and synthetic scroll events", () => {
		const probe = probeWithSamples([sample({})]);
		probe.scrollProvenance.writes.push({
			elapsedMs: 12,
			requestedScrollTopPx: 900,
			beforeScrollTopPx: 700,
			afterScrollTopPx: 900,
			scrollHeightPx: 1_600,
			clientHeightPx: 600,
			maxScrollTopPx: 1_000,
			distFromBottomPx: 100,
			stack: "at attachToBottom (stick-to-bottom.ts:42)",
		});
		probe.scrollProvenance.events.push(
			scrollEvent("setter", true),
			scrollEvent("input-intent", true),
			scrollEvent("native-layout-or-anchoring", true),
			scrollEvent("synthetic-or-unknown", false)
		);

		const summary = summarizeFirstSendProbe(probe);

		expect(summary.lines).toContain("scrollTop writes: 1");
		expect(summary.lines).toContain("scroll events: 4 (trusted 3)");
		expect(summary.lines).toContain(
			"scroll provenance: setter=1 input=1 layout/anchor=1 synthetic/unknown=1"
		);
		expect(summary.lines).toContain("scroll instrumentation: installed/restored");
	});

	it("fails when the planning placeholder balloons", () => {
		const summary = summarizeFirstSendProbe(
			probeWithSamples([sample({ placeholderHeightPx: 1300, maxOnscreenRowHeightPx: 1300 })])
		);

		expect(summary.status).toBe("fail");
		expect(summary.lines).toContain("placeholder max height: 1300px");
	});

	it("warns when the sent row is hidden for more than 500ms before streaming", () => {
		const summary = summarizeFirstSendProbe(
			probeWithSamples([
				sample({ elapsedMs: 0, sentRowVisibleInViewport: false, planningVisible: true }),
				sample({ elapsedMs: 600, sentRowVisibleInViewport: false, planningVisible: true }),
				sample({ elapsedMs: 700, sentRowVisibleInViewport: true }),
			])
		);

		expect(summary.status).toBe("warn");
		expect(summary.lines).toContain("sent row hidden before stream: 600ms");
	});

	it("ignores pre-send scroll distance when calculating send-window dfb", () => {
		const summary = summarizeFirstSendProbe(
			probeWithSamples([
				sample({
					label: "before-input",
					messageVisible: false,
					messageVisibleInTranscript: false,
					sentRowVisibleInViewport: false,
					distFromBottomPx: 1400,
				}),
				sample({
					label: "after-click-microtask",
					messageVisible: true,
					messageVisibleInTranscript: true,
					sentRowVisibleInViewport: true,
					placeholderHeightPx: 48,
					distFromBottomPx: 0,
				}),
			])
		);

		expect(summary.status).toBe("ok");
		expect(summary.lines).toContain("max dfb: 0px");
	});

	it("fails when any send-window sample becomes detached", () => {
		const summary = summarizeFirstSendProbe(
			probeWithSamples([
				sample({
					label: "after-click",
					scrollTopPx: 1_000,
					maxScrollTopPx: 1_100,
					scrollAttached: false,
					scrollReleased: true,
					distFromBottomPx: 100,
				}),
			])
		);

		expect(summary.status).toBe("fail");
		expect(summary.lines).toContain("detached samples: 1");
	});
});
