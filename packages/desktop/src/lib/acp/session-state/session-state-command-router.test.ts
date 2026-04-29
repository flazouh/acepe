import { describe, expect, it } from "vitest";

import type { SessionGraphActivity, SessionStateEnvelope } from "../../services/acp-types.js";
import { routeSessionStateEnvelope } from "./session-state-command-router.js";

const runningOperationActivity: SessionGraphActivity = {
	kind: "running_operation",
	activeOperationCount: 1,
	activeSubagentCount: 0,
	dominantOperationId: "session-1:tool-1",
	blockingInteractionId: null,
};

describe("routeSessionStateEnvelope", () => {
	it("routes graph patch deltas with canonical activity", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 9,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 6,
						transcriptRevision: 4,
						lastEventSeq: 8,
					},
					toRevision: {
						graphRevision: 7,
						transcriptRevision: 4,
						lastEventSeq: 9,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity"],
				},
			},
		};

		expect(routeSessionStateEnvelope("session-1", 4, envelope)).toEqual([
			{
				kind: "applyGraphPatches",
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 9,
				},
				activity: runningOperationActivity,
				turnState: "Running",
				activeTurnFailure: null,
				lastTerminalTurnId: null,
				operationPatches: [],
				interactionPatches: [],
			},
		]);
	});

	it("does not apply graph patches from a transcript delta with a stale frontier", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 9,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 10,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
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
					changedFields: [
						"transcriptSnapshot",
						"activity",
						"turnState",
						"activeTurnFailure",
						"lastTerminalTurnId",
					],
				},
			},
		};

		expect(routeSessionStateEnvelope("session-1", 6, envelope)).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 7,
				toRevision: 8,
			},
		]);
	});
});
