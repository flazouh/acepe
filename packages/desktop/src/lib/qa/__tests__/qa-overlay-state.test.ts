import { describe, expect, it } from "bun:test";
import { streamingReply, toolAndApproval } from "@acepe/qa-scenario";
import {
	lastEmittedType,
	QA_OVERLAY_RATE_OPTIONS,
	qaOverlayProps,
	qaOverlayScenarioOptions,
	scenarioSwitchUrl,
} from "../qa-overlay-state.ts";

const playback = (cursor: number, mode: "playing" | "paused", rate: number) => ({
	mode,
	cursor,
	total: streamingReply.steps.length,
	rate,
	lastSequence: cursor,
});

describe("lastEmittedType", () => {
	it("shows nothing before the first event goes out", () => {
		expect(lastEmittedType(streamingReply, 0)).toBeNull();
	});

	it("names the event the cursor has just passed, not the next one", () => {
		expect(lastEmittedType(streamingReply, 1)).toBe(streamingReply.steps[0]?.event.type);
		expect(lastEmittedType(streamingReply, 2)).toBe(streamingReply.steps[1]?.event.type);
	});

	it("stays readable at the end of the scenario", () => {
		const last = streamingReply.steps.length;
		expect(lastEmittedType(streamingReply, last)).toBe(streamingReply.steps[last - 1]?.event.type);
		expect(lastEmittedType(streamingReply, last + 5)).toBeNull();
	});
});

describe("qaOverlayScenarioOptions", () => {
	it("marks exactly the running scenario active", () => {
		const options = qaOverlayScenarioOptions(
			[streamingReply, toolAndApproval],
			toolAndApproval.meta.name
		);
		expect(options.map((option) => option.active)).toEqual([false, true]);
	});

	it("marks nothing active when the name is unknown", () => {
		const options = qaOverlayScenarioOptions([streamingReply], "no-such-scenario");
		expect(options.every((option) => option.active === false)).toBe(true);
	});
});

describe("qaOverlayProps", () => {
	it("passes the playback facts through unchanged", () => {
		const props = qaOverlayProps({
			scenario: streamingReply,
			playback: playback(3, "playing", 2),
			known: [streamingReply, toolAndApproval],
			missingCalls: ["gitCall {}"],
		});
		expect(props.scenarioName).toBe("streaming-reply");
		expect(props.playback).toBe("playing");
		expect(props.cursor).toBe(3);
		expect(props.total).toBe(streamingReply.steps.length);
		expect(props.rate).toBe(2);
		expect(props.rateOptions).toEqual(QA_OVERLAY_RATE_OPTIONS);
		expect(props.missingCalls).toEqual(["gitCall {}"]);
		expect(props.scenarios.length).toBe(2);
	});
});

describe("scenarioSwitchUrl", () => {
	it("swaps the scenario and keeps the other flags", () => {
		expect(scenarioSwitchUrl("?qa=streaming-reply&rate=0", "tool-and-approval")).toBe(
			"?qa=tool-and-approval&rate=0"
		);
	});

	it("adds the flag when the url had none", () => {
		expect(scenarioSwitchUrl("", "streaming-reply")).toBe("?qa=streaming-reply");
	});
});
