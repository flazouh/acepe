import { describe, expect, it } from "vitest";

import type { SessionStateDelta } from "../../services/acp-types.js";
import { resolveSessionStateDelta } from "./session-state-query-service.js";

const idleActivity = {
	kind: "idle",
	activeOperationCount: 0,
	activeSubagentCount: 0,
	dominantOperationId: null,
	blockingInteractionId: null,
} as const;

describe("resolveSessionStateDelta", () => {
	it("does not refresh when only the graph frontier advances", () => {
		const delta: SessionStateDelta = {
			fromRevision: {
				graphRevision: 6,
				transcriptRevision: 4,
				lastEventSeq: 6,
			},
			toRevision: {
				graphRevision: 7,
				transcriptRevision: 4,
				lastEventSeq: 7,
			},
			activity: idleActivity,
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			activeStreamingTail: null,
			transcriptOperations: [],
			operationPatches: [],
			interactionPatches: [],
			changedFields: ["capabilities"],
		};

		expect(resolveSessionStateDelta("session-1", 4, delta)).toEqual({
			kind: "noop",
		});
	});

	it("refreshes graph-only deltas when transcript revisions diverge", () => {
		const delta: SessionStateDelta = {
			fromRevision: {
				graphRevision: 6,
				transcriptRevision: 5,
				lastEventSeq: 6,
			},
			toRevision: {
				graphRevision: 8,
				transcriptRevision: 7,
				lastEventSeq: 8,
			},
			activity: idleActivity,
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			activeStreamingTail: null,
			transcriptOperations: [],
			operationPatches: [],
			interactionPatches: [],
			changedFields: ["activity"],
		};

		expect(resolveSessionStateDelta("session-1", 4, delta)).toEqual({
			kind: "refreshSnapshot",
			fromRevision: 5,
			toRevision: 7,
		});
	});

	it("refreshes when transcriptSnapshot is marked changed without transcript operations", () => {
		const delta: SessionStateDelta = {
			fromRevision: {
				graphRevision: 6,
				transcriptRevision: 4,
				lastEventSeq: 6,
			},
			toRevision: {
				graphRevision: 7,
				transcriptRevision: 5,
				lastEventSeq: 7,
			},
			activity: idleActivity,
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			activeStreamingTail: null,
			transcriptOperations: [],
			operationPatches: [],
			interactionPatches: [],
			changedFields: ["transcriptSnapshot"],
		};

		expect(resolveSessionStateDelta("session-1", 4, delta)).toEqual({
			kind: "refreshSnapshot",
			fromRevision: 4,
			toRevision: 5,
		});
	});

	it("refreshes when a transcript-bearing delta frontier diverges", () => {
		const delta: SessionStateDelta = {
			fromRevision: {
				graphRevision: 6,
				transcriptRevision: 5,
				lastEventSeq: 6,
			},
			toRevision: {
				graphRevision: 8,
				transcriptRevision: 7,
				lastEventSeq: 8,
			},
			activity: idleActivity,
			turnState: "Running",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			activeStreamingTail: { rowId: "assistant-1", contentKind: "message" },
			transcriptOperations: [
				{
					kind: "appendEntry",
					entry: {
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:block:0",
								text: "hello",
							},
						],
					},
				},
			],
			operationPatches: [],
			interactionPatches: [],
			changedFields: ["transcriptSnapshot"],
		};

		expect(resolveSessionStateDelta("session-1", 4, delta)).toEqual({
			kind: "refreshSnapshot",
			fromRevision: 5,
			toRevision: 7,
		});
	});

	it("refreshes instead of applying replacement snapshots from delta envelopes", () => {
		const delta: SessionStateDelta = {
			fromRevision: {
				graphRevision: 6,
				transcriptRevision: 4,
				lastEventSeq: 6,
			},
			toRevision: {
				graphRevision: 7,
				transcriptRevision: 5,
				lastEventSeq: 7,
			},
			activity: idleActivity,
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			activeStreamingTail: null,
			transcriptOperations: [
				{
					kind: "replaceSnapshot",
					snapshot: {
						revision: 5,
						entries: [
							{
								entryId: "assistant-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-1:block:0",
										text: "full replacement",
									},
								],
							},
						],
					},
				},
			],
			operationPatches: [],
			interactionPatches: [],
			changedFields: ["transcriptSnapshot"],
		};

		expect(resolveSessionStateDelta("session-1", 4, delta)).toEqual({
			kind: "refreshSnapshot",
			fromRevision: 4,
			toRevision: 5,
		});
	});
});
