import { describe, expect, it } from "vitest";
import {
	createInitialTranscriptViewportState,
	reduceTranscriptViewportBatch,
	reduceTranscriptViewportEvent,
} from "../transcript-viewport-controller.js";
import { orderTranscriptViewportEvents } from "../transcript-viewport-events.js";
import type { TranscriptViewportRowSummary } from "../transcript-viewport-row-summary.js";

const baseRows: TranscriptViewportRowSummary = {
	version: 1,
	count: 3,
	firstKey: "user-1",
	lastKey: "assistant-1",
	latestUserKey: "user-1",
	anchorEligibleKeys: ["user-1", "assistant-1"],
};

describe("TranscriptViewportController", () => {
	it("keeps waiting row changes on the primary renderer", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});

		const result = reduceTranscriptViewportEvent(initial, {
			type: "RowsChanged",
			sessionId: "session-1",
			generation: initial.generation,
			rows: {
				version: 2,
				count: 4,
				firstKey: "user-1",
				lastKey: "thinking",
				latestUserKey: "user-1",
				anchorEligibleKeys: ["user-1", "assistant-1"],
				reason: "waiting-row-appended",
			},
		});

		expect(result.state.renderer).toEqual({ type: "primary" });
		expect(result.effects.map((effect) => effect.type)).not.toContain("SwitchRenderer");
	});

	it("preserves a row anchor when detached rows change", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});
		const detached = reduceTranscriptViewportEvent(initial, {
			type: "UserScroll",
			sessionId: "session-1",
			generation: initial.generation,
			measurement: {
				scrollOffset: 240,
				scrollSize: 1200,
				viewportSize: 300,
			},
			anchorKey: "assistant-1",
		}).state;

		const result = reduceTranscriptViewportEvent(detached, {
			type: "RowsChanged",
			sessionId: "session-1",
			generation: detached.generation,
			rows: {
				version: 2,
				count: 4,
				firstKey: "user-0",
				lastKey: "assistant-1",
				latestUserKey: "user-1",
				anchorEligibleKeys: ["user-0", "user-1", "assistant-1"],
			},
		});

		expect(result.state.follow).toBe("detached");
		expect(result.effects).toContainEqual({
			type: "PreserveAnchor",
			sessionId: "session-1",
			generation: detached.generation,
			anchorKey: "assistant-1",
			offsetPx: 240,
		});
		expect(result.effects.map((effect) => effect.type)).not.toContain("RevealTail");
	});

	it("skips detached anchor preservation when the changed range is entirely below the anchor", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: {
				...baseRows,
				rowIndexByKey: new Map([
					["user-1", 0],
					["assistant-1", 1],
					["tool-1", 2],
				]),
			},
		});
		const detached = reduceTranscriptViewportEvent(initial, {
			type: "UserScroll",
			sessionId: "session-1",
			generation: initial.generation,
			measurement: {
				scrollOffset: 240,
				scrollSize: 1200,
				viewportSize: 300,
			},
			anchorKey: "assistant-1",
			anchorOffsetPx: 18,
		}).state;

		const result = reduceTranscriptViewportEvent(detached, {
			type: "RowsChanged",
			sessionId: "session-1",
			generation: detached.generation,
			rows: {
				version: 2,
				count: 4,
				firstKey: "user-1",
				lastKey: "tool-2",
				latestUserKey: "user-1",
				rowIndexByKey: new Map([
					["user-1", 0],
					["assistant-1", 1],
					["tool-2", 2],
				]),
				anchorEligibleKeys: ["user-1", "assistant-1", "tool-2"],
				changedRange: {
					startIndex: 2,
					endIndex: 3,
				},
			},
		});

		expect(result.state.follow).toBe("detached");
		expect(result.effects).toEqual([]);
	});

	it("stores the captured visible anchor offset instead of raw scroll offset", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});

		const detached = reduceTranscriptViewportEvent(initial, {
			type: "UserScroll",
			sessionId: "session-1",
			generation: initial.generation,
			measurement: {
				scrollOffset: 240,
				scrollSize: 1200,
				viewportSize: 300,
			},
			anchorKey: "assistant-1",
			anchorOffsetPx: 12,
		});

		expect(detached.state.anchor).toEqual({
			type: "row",
			rowKey: "assistant-1",
			edge: "start",
			offsetPx: 12,
		});
	});

	it("uses send as an explicit follow override while detached", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});
		const detached = reduceTranscriptViewportEvent(initial, {
			type: "UserScroll",
			sessionId: "session-1",
			generation: initial.generation,
			measurement: {
				scrollOffset: 120,
				scrollSize: 1000,
				viewportSize: 300,
			},
			anchorKey: "user-1",
		}).state;

		const result = reduceTranscriptViewportEvent(detached, {
			type: "SendStarted",
			sessionId: "session-1",
			generation: detached.generation,
			targetKey: "user-2",
		});

		expect(result.state.follow).toBe("following");
		expect(result.state.anchor).toEqual({ type: "tail" });
		expect(result.effects).toContainEqual({
			type: "RevealRow",
			sessionId: "session-1",
			generation: detached.generation,
			targetKey: "user-2",
			align: "end",
			reason: "send-started",
		});
	});

	it("routes public scroll commands through typed effects", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});

		const top = reduceTranscriptViewportEvent(initial, {
			type: "PublicScrollCommand",
			sessionId: "session-1",
			generation: initial.generation,
			command: "top",
		});
		const bottom = reduceTranscriptViewportEvent(initial, {
			type: "PublicScrollCommand",
			sessionId: "session-1",
			generation: initial.generation,
			command: "bottom",
		});

		expect(top.effects).toContainEqual({
			type: "RevealRow",
			sessionId: "session-1",
			generation: initial.generation,
			targetKey: "user-1",
			align: "start",
			reason: "public-scroll-top",
		});
		expect(bottom.effects).toContainEqual({
			type: "RevealTail",
			sessionId: "session-1",
			generation: initial.generation,
			force: true,
			reason: "public-scroll-bottom",
		});
	});

	it("does not detach from intermediate programmatic scroll events after scrolling to bottom", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});
		const bottom = reduceTranscriptViewportEvent(initial, {
			type: "PublicScrollCommand",
			sessionId: "session-1",
			generation: initial.generation,
			command: "bottom",
		}).state;

		const intermediateScroll = reduceTranscriptViewportEvent(bottom, {
			type: "UserScroll",
			sessionId: "session-1",
			generation: bottom.generation,
			measurement: {
				scrollOffset: 120,
				scrollSize: 1200,
				viewportSize: 300,
			},
			anchorKey: "assistant-1",
		});

		expect(intermediateScroll.state.follow).toBe("following");
		expect(intermediateScroll.state.anchor).toEqual({ type: "tail" });
		expect(intermediateScroll.state.lastMeasurement).toEqual({
			scrollOffset: 120,
			scrollSize: 1200,
			viewportSize: 300,
		});
		expect(intermediateScroll.effects).toEqual([]);
	});

	it("detaches when a programmatic bottom scroll settles away from the tail", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});
		const bottom = reduceTranscriptViewportEvent(initial, {
			type: "PublicScrollCommand",
			sessionId: "session-1",
			generation: initial.generation,
			command: "bottom",
		}).state;
		const stalledMeasurement = {
			scrollOffset: 120,
			scrollSize: 1200,
			viewportSize: 300,
		};
		const firstSettlingFrame = reduceTranscriptViewportEvent(bottom, {
			type: "UserScroll",
			sessionId: "session-1",
			generation: bottom.generation,
			measurement: stalledMeasurement,
			anchorKey: "assistant-1",
			anchorOffsetPx: 16,
		}).state;

		const secondSettlingFrame = reduceTranscriptViewportEvent(firstSettlingFrame, {
			type: "UserScroll",
			sessionId: "session-1",
			generation: firstSettlingFrame.generation,
			measurement: stalledMeasurement,
			anchorKey: "assistant-1",
			anchorOffsetPx: 16,
		});

		expect(secondSettlingFrame.state.follow).toBe("detached");
		expect(secondSettlingFrame.state.programmaticScrollInFlight).toBe(false);
		expect(secondSettlingFrame.state.anchor).toEqual({
			type: "row",
			rowKey: "assistant-1",
			edge: "start",
			offsetPx: 16,
		});

		const streamedRows = reduceTranscriptViewportEvent(secondSettlingFrame.state, {
			type: "RowsChanged",
			sessionId: "session-1",
			generation: secondSettlingFrame.state.generation,
			rows: {
				version: 2,
				count: 4,
				firstKey: "user-1",
				lastKey: "assistant-2",
				latestUserKey: "user-1",
				anchorEligibleKeys: ["user-1", "assistant-1", "assistant-2"],
			},
		});

		expect(streamedRows.effects).toContainEqual({
			type: "PreserveAnchor",
			sessionId: "session-1",
			generation: secondSettlingFrame.state.generation,
			anchorKey: "assistant-1",
			offsetPx: 16,
		});
		expect(streamedRows.effects.map((effect) => effect.type)).not.toContain("RevealTail");
	});

	it("still lets explicit wheel scroll detach during a programmatic bottom scroll", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});
		const bottom = reduceTranscriptViewportEvent(initial, {
			type: "PublicScrollCommand",
			sessionId: "session-1",
			generation: initial.generation,
			command: "bottom",
		}).state;

		const wheelScroll = reduceTranscriptViewportEvent(bottom, {
			type: "UserWheel",
			sessionId: "session-1",
			generation: bottom.generation,
			measurement: {
				scrollOffset: 120,
				scrollSize: 1200,
				viewportSize: 300,
			},
			anchorKey: "assistant-1",
		});

		expect(wheelScroll.state.follow).toBe("detached");
		expect(wheelScroll.state.anchor).toEqual({
			type: "row",
			rowKey: "assistant-1",
			edge: "start",
			offsetPx: 120,
		});
		expect(wheelScroll.state.programmaticScrollInFlight).toBe(false);
		expect(wheelScroll.effects).toEqual([]);
	});

	it("reveals the waiting tail row after send instead of parking on the user row", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});
		const sendStarted = reduceTranscriptViewportEvent(initial, {
			type: "SendStarted",
			sessionId: "session-1",
			generation: initial.generation,
		}).state;

		const waitingRow = reduceTranscriptViewportEvent(sendStarted, {
			type: "RowsChanged",
			sessionId: "session-1",
			generation: sendStarted.generation,
			rows: {
				version: 2,
				count: 5,
				firstKey: "user-1",
				lastKey: "thinking",
				latestUserKey: "user-2",
				anchorEligibleKeys: ["user-1", "assistant-1", "user-2"],
				reason: "waiting-row-appended",
			},
		});

		expect(waitingRow.state.follow).toBe("following");
		expect(waitingRow.effects).toContainEqual({
			type: "RevealTail",
			sessionId: "session-1",
			generation: sendStarted.generation,
			force: true,
			reason: "send-started",
		});
		expect(waitingRow.effects).not.toContainEqual({
			type: "RevealRow",
			sessionId: "session-1",
			generation: sendStarted.generation,
			targetKey: "user-2",
			align: "end",
			reason: "send-started",
		});
	});

	it("keeps the waiting tail visible when the sent user row resizes after send", () => {
		const waitingState = reduceTranscriptViewportEvent(
			createInitialTranscriptViewportState({
				sessionId: "session-1",
				rows: baseRows,
			}),
			{
				type: "RowsChanged",
				sessionId: "session-1",
				generation: 0,
				rows: {
					version: 2,
					count: 5,
					firstKey: "user-1",
					lastKey: "thinking-indicator",
					latestUserKey: "user-2",
					anchorEligibleKeys: ["user-1", "assistant-1", "user-2"],
					reason: "waiting-row-appended",
				},
			}
		).state;

		const resizeReveal = reduceTranscriptViewportEvent(waitingState, {
			type: "ExplicitRevealRequested",
			sessionId: "session-1",
			generation: waitingState.generation,
			targetKey: "user-2",
		});

		expect(resizeReveal.state.follow).toBe("following");
		expect(resizeReveal.effects).toContainEqual({
			type: "RevealTail",
			sessionId: "session-1",
			generation: waitingState.generation,
			force: false,
			reason: "rows-changed-following",
		});
		expect(resizeReveal.effects).not.toContainEqual({
			type: "RevealRow",
			sessionId: "session-1",
			generation: waitingState.generation,
			targetKey: "user-2",
			align: "end",
			reason: "explicit-reveal",
		});
	});

	it("keeps following the tail when a row resizes while attached", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});

		const result = reduceTranscriptViewportEvent(initial, {
			type: "RowResized",
			sessionId: "session-1",
			generation: initial.generation,
			rowKey: "assistant-1",
		});

		expect(result.state.follow).toBe("following");
		expect(result.effects).toContainEqual({
			type: "RevealTail",
			sessionId: "session-1",
			generation: initial.generation,
			force: false,
			reason: "rows-changed-following",
		});
	});

	it("preserves the captured row anchor when a row resizes while detached", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: {
				...baseRows,
				rowIndexByKey: new Map([
					["user-1", 0],
					["assistant-1", 1],
				]),
			},
		});
		const detached = reduceTranscriptViewportEvent(initial, {
			type: "UserScroll",
			sessionId: "session-1",
			generation: initial.generation,
			measurement: {
				scrollOffset: 240,
				scrollSize: 1200,
				viewportSize: 300,
			},
			anchorKey: "assistant-1",
			anchorOffsetPx: 18,
		}).state;

		const result = reduceTranscriptViewportEvent(detached, {
			type: "RowResized",
			sessionId: "session-1",
			generation: detached.generation,
			rowKey: "assistant-1",
		});

		expect(result.state.follow).toBe("detached");
		expect(result.effects).toContainEqual({
			type: "PreserveAnchor",
			sessionId: "session-1",
			generation: detached.generation,
			anchorKey: "assistant-1",
			offsetPx: 18,
		});
	});

	it("skips detached anchor preservation when a resized row is below the anchor", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: {
				...baseRows,
				count: 4,
				lastKey: "tool-1",
				rowIndexByKey: new Map([
					["user-1", 0],
					["assistant-1", 1],
					["tool-1", 2],
				]),
				anchorEligibleKeys: ["user-1", "assistant-1", "tool-1"],
			},
		});
		const detached = reduceTranscriptViewportEvent(initial, {
			type: "UserScroll",
			sessionId: "session-1",
			generation: initial.generation,
			measurement: {
				scrollOffset: 240,
				scrollSize: 1200,
				viewportSize: 300,
			},
			anchorKey: "assistant-1",
			anchorOffsetPx: 18,
		}).state;

		const result = reduceTranscriptViewportEvent(detached, {
			type: "RowResized",
			sessionId: "session-1",
			generation: detached.generation,
			rowKey: "tool-1",
		});

		expect(result.state.follow).toBe("detached");
		expect(result.effects).toEqual([]);
	});

	it("ignores stale generation events and reports a diagnostic", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});
		const changed = reduceTranscriptViewportEvent(initial, {
			type: "SessionChanged",
			sessionId: "session-2",
			previousSessionId: "session-1",
		}).state;

		const result = reduceTranscriptViewportEvent(changed, {
			type: "ScrollMeasured",
			sessionId: "session-1",
			generation: initial.generation,
			measurement: {
				scrollOffset: 0,
				scrollSize: 900,
				viewportSize: 300,
			},
		});

		expect(result.state).toBe(changed);
		expect(result.effects).toContainEqual({
			type: "ReportDiagnostic",
			sessionId: "session-2",
			generation: changed.generation,
			code: "stale-event-dropped",
			message: "Dropped ScrollMeasured for an old session or generation",
		});
	});

	it("orders same-frame events deterministically", () => {
		const ordered = orderTranscriptViewportEvents([
			{
				type: "RowsChanged",
				sessionId: "session-1",
				generation: 0,
				rows: baseRows,
			},
			{
				type: "SendStarted",
				sessionId: "session-1",
				generation: 0,
				targetKey: "user-2",
			},
			{
				type: "RendererFailed",
				sessionId: "session-1",
				generation: 0,
				reason: "no_rendered_entries",
			},
		]);

		expect(ordered.map((event) => event.type)).toEqual([
			"RendererFailed",
			"SendStarted",
			"RowsChanged",
		]);
	});

	it("reduces ordered batches with user intent before row changes", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});

		const result = reduceTranscriptViewportBatch(initial, [
			{
				type: "RowsChanged",
				sessionId: "session-1",
				generation: initial.generation,
				rows: {
					version: 2,
					count: 4,
					firstKey: "user-1",
					lastKey: "thinking",
					latestUserKey: "user-2",
					anchorEligibleKeys: ["user-1", "assistant-1", "user-2"],
				},
			},
			{
				type: "SendStarted",
				sessionId: "session-1",
				generation: initial.generation,
			},
		]);

		expect(result.state.follow).toBe("following");
		expect(result.effects.at(0)).toMatchObject({
			type: "RevealTail",
			reason: "send-started",
		});
	});

	it("does not reveal the tail when a user wheel and rows changed arrive in the same frame", () => {
		const initial = createInitialTranscriptViewportState({
			sessionId: "session-1",
			rows: baseRows,
		});

		const result = reduceTranscriptViewportBatch(initial, [
			{
				type: "RowsChanged",
				sessionId: "session-1",
				generation: initial.generation,
				rows: {
					version: 2,
					count: 4,
					firstKey: "user-1",
					lastKey: "assistant-2",
					latestUserKey: "user-1",
					anchorEligibleKeys: ["user-1", "assistant-1", "assistant-2"],
				},
			},
			{
				type: "UserWheel",
				sessionId: "session-1",
				generation: initial.generation,
				measurement: {
					scrollOffset: 120,
					scrollSize: 1200,
					viewportSize: 300,
				},
				anchorKey: "assistant-1",
				anchorOffsetPx: 18,
			},
		]);

		expect(result.state.follow).toBe("detached");
		expect(result.effects).toContainEqual({
			type: "PreserveAnchor",
			sessionId: "session-1",
			generation: initial.generation,
			anchorKey: "assistant-1",
			offsetPx: 18,
		});
		expect(result.effects.map((effect) => effect.type)).not.toContain("RevealTail");
	});
});
