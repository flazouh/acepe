import { describe, expect, it } from "vitest";
import { createInitialTranscriptViewportState } from "../transcript-viewport-controller.js";
import type { TranscriptViewportEvent } from "../transcript-viewport-events.js";
import { replayTranscriptViewportEvents } from "../transcript-viewport-replay.js";

describe("TranscriptViewportReplay", () => {
	it("replays a send sequence into the same final follow state and effects", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
		});
		const events: TranscriptViewportEvent[] = [
			{
				type: "SendStarted",
				sessionId: "session-1",
				generation: 0,
			},
			{
				type: "RowsChanged",
				sessionId: "session-1",
				generation: 0,
				rows: {
					version: 1,
					count: 1,
					firstKey: "user-1",
					lastKey: "user-1",
					latestUserKey: "user-1",
					anchorEligibleKeys: ["user-1"],
				},
			},
		];

		const result = replayTranscriptViewportEvents(initial, events);

		expect(result.state.follow).toBe("following");
		expect(result.effects.map((effect) => effect.type)).toContain("RevealRow");
	});
});
