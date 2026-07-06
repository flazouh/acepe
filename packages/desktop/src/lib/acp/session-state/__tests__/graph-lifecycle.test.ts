import { describe, expect, it } from "bun:test";
import type {
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionStateGraph,
} from "../../../services/acp-types.js";
import { mapGraphStatus } from "../graph-lifecycle.js";

function readyLifecycle(): SessionGraphLifecycle {
	return {
		status: "ready",
		actionability: {
			canSend: true,
			canResume: false,
			canRetry: false,
			canArchive: true,
			canConfigure: true,
			recommendedAction: "send",
			recoveryPhase: "none",
			compactStatus: "ready",
		},
	};
}

function idleActivity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function graphWithCompactTranscript(messageCount: number): SessionStateGraph {
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "codex",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: 7,
			transcriptRevision: 7,
			lastEventSeq: 7,
		},
		transcriptSnapshot: {
			revision: 7,
			entries: [],
		},
		operations: [],
		interactions: [],
		turnState: "Idle",
		messageCount,
		activeStreamingTail: null,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		lifecycle: readyLifecycle(),
		activity: idleActivity(),
		capabilities: {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
	};
}

describe("mapGraphStatus", () => {
	it("treats compact snapshots with messages as existing idle sessions", () => {
		expect(mapGraphStatus(graphWithCompactTranscript(12))).toBe("idle");
	});

	it("keeps brand-new compact snapshots connected when no messages exist", () => {
		expect(mapGraphStatus(graphWithCompactTranscript(0))).toBe("connected");
	});
});
