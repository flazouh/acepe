import { describe, expect, it } from "vitest";

import type {
	InteractionSnapshot,
	OperationSnapshot,
	SessionGraphLifecycle,
	SessionOpenFound,
	SessionStateGraph,
} from "$lib/services/acp-types.js";
import { createSnapshotEnvelope } from "../../session-state/session-state-protocol.js";
import { SessionStore } from "../session-store.svelte.js";

function createReadyLifecycle(): SessionGraphLifecycle {
	return {
		status: "ready",
		detachedReason: null,
		failureReason: null,
		errorMessage: null,
		actionability: {
			canSend: false,
			canResume: false,
			canRetry: false,
			canArchive: true,
			canConfigure: true,
			recommendedAction: "wait",
			recoveryPhase: "none",
			compactStatus: "ready",
		},
	};
}

function createRunningOperation(): OperationSnapshot {
	return {
		id: "op-1",
		session_id: "session-1",
		tool_call_id: "tool-1",
		name: "bash",
		kind: "execute",
		provider_status: "in_progress",
		title: "Run tests",
		arguments: {
			kind: "execute",
			command: "bun test",
		},
		progressive_arguments: null,
		result: null,
		command: "bun test",
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_state: "blocked",
		awaiting_plan_approval: false,
		source_link: { kind: "transcript_linked", entry_id: "tool-1" },
	};
}

function createPendingInteraction(): InteractionSnapshot {
	return {
		id: "permission-1",
		session_id: "session-1",
		kind: "Permission",
		state: "Pending",
		json_rpc_request_id: 7,
		reply_handler: null,
		tool_reference: {
			messageId: "tool-1",
			callId: "tool-1",
		},
		responded_at_event_seq: null,
		response: null,
		canonical_operation_id: "op-1",
		payload: {
			Permission: {
				id: "permission-1",
				sessionId: "session-1",
				jsonRpcRequestId: 7,
				replyHandler: null,
				permission: "Write",
				patterns: ["/repo/src/app.ts"],
				metadata: {},
				always: [],
				autoAccepted: false,
				tool: {
					messageId: "tool-1",
					callId: "tool-1",
				},
			},
		},
	};
}

function createRepresentativeGraph(): SessionStateGraph {
	const lifecycle = createReadyLifecycle();
	const operation = createRunningOperation();
	const interaction = createPendingInteraction();
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "codex",
		projectPath: "/repo",
		worktreePath: "/repo",
		sourcePath: "/repo/.acepe/sessions/session-1.json",
		sequenceId: null,
		revision: {
			graphRevision: 42,
			transcriptRevision: 17,
			lastEventSeq: 99,
		},
		transcriptSnapshot: {
			revision: 17,
			entries: [
				{
					entryId: "user-1",
					role: "user",
					segments: [
						{
							kind: "text",
							segmentId: "user-1:block:0",
							text: "Please run the tests",
						},
					],
				},
				{
					entryId: "tool-1",
					role: "tool",
					segments: [
						{
							kind: "text",
							segmentId: "tool-1:block:0",
							text: "Run tests",
						},
					],
				},
			],
		},
		operations: [operation],
		interactions: [interaction],
		turnState: "Running",
		messageCount: 2,
		activeTurnFailure: null,
		lastTerminalTurnId: "turn-previous",
		activeStreamingTail: null,
		lifecycle,
		// Cold-open recomputes activity from operations/interactions; this fixture
		// must match that derived activity for the parity assertion to be meaningful.
		activity: {
			kind: "waiting_for_user",
			activeOperationCount: 1,
			activeSubagentCount: 0,
			dominantOperationId: "op-1",
			blockingInteractionId: "permission-1",
		},
		capabilities: {
			models: {
				currentModelId: "gpt-5",
				availableModels: [
					{
						modelId: "gpt-5",
						name: "GPT-5",
					},
				],
			},
			modes: {
				currentModeId: "build",
				availableModes: [
					{
						id: "build",
						name: "Build",
					},
				],
			},
			availableCommands: [
				{
					name: "run_tests",
					description: "Run the test suite",
				},
			],
			configOptions: [
				{
					id: "sandbox",
					name: "Sandbox",
					category: "runtime",
					type: "string",
					currentValue: "workspace-write",
				},
			],
			autonomousEnabled: true,
		},
	};
}

function createSessionOpenFoundFromGraph(graph: SessionStateGraph): SessionOpenFound {
	return {
		requestedSessionId: graph.requestedSessionId,
		canonicalSessionId: graph.canonicalSessionId,
		isAlias: graph.isAlias,
		openPath: "legacy_rebuild",
		lastEventSeq: graph.revision.lastEventSeq,
		graphRevision: graph.revision.graphRevision,
		openToken: "open-token",
		agentId: graph.agentId,
		projectPath: graph.projectPath,
		worktreePath: graph.worktreePath ?? null,
		sourcePath: graph.sourcePath ?? null,
		sequenceId: graph.sequenceId ?? null,
		transcriptSnapshot: graph.transcriptSnapshot,
		sessionTitle: "Opened session",
		operations: graph.operations,
		interactions: graph.interactions,
		turnState: graph.turnState,
		messageCount: graph.messageCount,
		activity: graph.activity,
		activeStreamingTail: graph.activeStreamingTail,
		lifecycle: graph.lifecycle,
		capabilities: graph.capabilities,
		activeTurnFailure: graph.activeTurnFailure,
		lastTerminalTurnId: graph.lastTerminalTurnId,
	};
}

function addSession(store: SessionStore): void {
	store.write.addSession({
		id: "session-1",
		projectPath: "/repo",
		agentId: "codex",
		title: "Session",
		updatedAt: new Date("2026-04-28T00:00:00.000Z"),
		createdAt: new Date("2026-04-28T00:00:00.000Z"),
		sourcePath: "/repo/.acepe/sessions/session-1.json",
		sessionLifecycleState: "persisted",
		parentId: null,
	});
}

// Normalize the two fields that are legitimately representation-dependent rather
// than canonical parity invariants:
//   - `kindStartedAtMs` is a CLIENT-stamped observation timestamp (Date.now): the
//     live path stamps "when I first observed this activity", while a cold-open
//     restore cannot know the original start time. They can never be bit-equal.
//   - `sequenceId` is optional (`number | null`); the cold path coalesces a missing
//     value to `null`, the live path leaves it `undefined`. Both are type-valid.
// Everything else must match exactly.
function normalizeForCanonicalParity(graph: SessionStateGraph | null): SessionStateGraph | null {
	if (graph === null) {
		return null;
	}
	return {
		...graph,
		sequenceId: graph.sequenceId ?? null,
		activity: { ...graph.activity, kindStartedAtMs: null },
	};
}

describe("canonical projection parity", () => {
	it("projects equivalent canonical state from cold-open snapshots and live snapshot envelopes", () => {
		const graph = createRepresentativeGraph();
		const coldStore = new SessionStore();
		const liveStore = new SessionStore();

		coldStore.write.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));
		addSession(liveStore);
		liveStore.applySessionStateEnvelope("session-1", createSnapshotEnvelope(graph));

		expect(coldStore.read.hasSessionCanonicalProjection("session-1")).toBe(true);
		expect(liveStore.read.hasSessionCanonicalProjection("session-1")).toBe(true);
		expect(normalizeForCanonicalParity(liveStore.getSessionStateGraphForTest("session-1"))).toEqual(
			normalizeForCanonicalParity(coldStore.getSessionStateGraphForTest("session-1"))
		);
		expect(liveStore.read.getSessionAvailableModels("session-1")).toEqual(
			coldStore.read.getSessionAvailableModels("session-1")
		);
		expect(liveStore.read.getSessionAvailableModes("session-1")).toEqual(
			coldStore.read.getSessionAvailableModes("session-1")
		);
		expect(liveStore.read.getSessionAvailableCommands("session-1")).toEqual(
			coldStore.read.getSessionAvailableCommands("session-1")
		);
		expect(liveStore.read.getSessionConfigOptions("session-1")).toEqual(
			coldStore.read.getSessionConfigOptions("session-1")
		);
		expect(liveStore.read.getSessionCapabilityRevision("session-1")).toEqual(
			coldStore.read.getSessionCapabilityRevision("session-1")
		);
		expect(liveStore.read.getSessionCapabilityPreviewState("session-1")).toBe(
			coldStore.read.getSessionCapabilityPreviewState("session-1")
		);
		expect(liveStore.read.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(liveStore.getSessionStateGraphForTest("session-1")?.turnState ?? null).toBe("Running");
		expect(liveStore.read.getSessionLastTerminalTurnId("session-1")).toBe("turn-previous");
		expect(liveStore.read.getSessionCurrentModeId("session-1")).toBe("build");
		expect(liveStore.read.getSessionCurrentModelId("session-1")).toBe("gpt-5");
		expect(liveStore.read.getSessionAutonomousEnabled("session-1")).toBe(true);
	});

	it("keeps turn failures live-only: neither cold-open nor live snapshot envelopes materialize transcript error rows", () => {
		const lifecycle = createReadyLifecycle();
		const transcriptSnapshot = {
			revision: 3,
			entries: [
				{
					entryId: "user-1",
					role: "user" as const,
					segments: [
						{
							kind: "text" as const,
							segmentId: "user-1:block:0",
							text: "what is this project?",
						},
					],
				},
			],
		};
		const liveFailureGraph: SessionStateGraph = {
			requestedSessionId: "session-1",
			canonicalSessionId: "session-1",
			isAlias: false,
			agentId: "claude-code",
			projectPath: "/repo",
			worktreePath: "/repo",
			sourcePath: "/repo/.acepe/sessions/session-1.json",
			sequenceId: null,
			revision: {
				graphRevision: 7,
				transcriptRevision: 3,
				lastEventSeq: 11,
			},
			transcriptSnapshot,
			operations: [],
			interactions: [],
			turnState: "Failed",
			messageCount: 1,
			activeTurnFailure: {
				turn_id: "turn-1",
				message: "rate_limit",
				code: "429",
				kind: "recoverable",
				source: "process",
			},
			lastTerminalTurnId: "turn-1",
			activeStreamingTail: null,
			lifecycle,
			activity: {
				kind: "error",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
			capabilities: createRepresentativeGraph().capabilities,
		};
		const restoredGraph: SessionStateGraph = {
			requestedSessionId: liveFailureGraph.requestedSessionId,
			canonicalSessionId: liveFailureGraph.canonicalSessionId,
			isAlias: liveFailureGraph.isAlias,
			agentId: liveFailureGraph.agentId,
			projectPath: liveFailureGraph.projectPath,
			worktreePath: liveFailureGraph.worktreePath,
			sourcePath: liveFailureGraph.sourcePath,
			sequenceId: liveFailureGraph.sequenceId,
			revision: {
				graphRevision: 4,
				transcriptRevision: 3,
				lastEventSeq: 3,
			},
			transcriptSnapshot,
			operations: [],
			interactions: [],
			turnState: "Completed",
			messageCount: 1,
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			activeStreamingTail: null,
			lifecycle,
			activity: {
				kind: "idle",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
			capabilities: liveFailureGraph.capabilities,
		};

		const liveStore = new SessionStore();
		const coldStore = new SessionStore();
		addSession(liveStore);
		addSession(coldStore);
		liveStore.applySessionStateEnvelope("session-1", createSnapshotEnvelope(liveFailureGraph));
		coldStore.write.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(restoredGraph));

		const hasTranscriptErrorRole = (
			entries: SessionStateGraph["transcriptSnapshot"]["entries"]
		): boolean => entries.some((entry) => (entry.role as string) === "error");

		expect(
			hasTranscriptErrorRole(
				liveStore.getSessionStateGraphForTest("session-1")!.transcriptSnapshot.entries
			)
		).toBe(false);
		expect(
			hasTranscriptErrorRole(
				coldStore.getSessionStateGraphForTest("session-1")!.transcriptSnapshot.entries
			)
		).toBe(false);
		expect(liveStore.getSessionStateGraphForTest("session-1")?.activeTurnFailure).not.toBeNull();
		expect(coldStore.getSessionStateGraphForTest("session-1")?.activeTurnFailure).toBeNull();
		expect(liveStore.getSessionStateGraphForTest("session-1")?.turnState).toBe("Failed");
		expect(coldStore.getSessionStateGraphForTest("session-1")?.turnState).toBe("Completed");
	});
});
