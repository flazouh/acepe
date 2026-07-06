import { describe, expect, it } from "bun:test";

import { summarizeFirstSendProbe } from "../first-send-probe-summary";
import type { FirstSendTimelineProbeResult } from "../schemas";

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
	if (fields.distFromBottomPx !== undefined) result.distFromBottomPx = fields.distFromBottomPx;
	if (fields.bodyPreview !== undefined) result.bodyPreview = fields.bodyPreview;
	return result;
}

describe("summarizeFirstSendProbe", () => {
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
});
