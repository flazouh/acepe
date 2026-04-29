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
		lastEventSeq: graph.revision.lastEventSeq,
		graphRevision: graph.revision.graphRevision,
		openToken: "open-token",
		agentId: graph.agentId,
		projectPath: graph.projectPath,
		worktreePath: graph.worktreePath ?? null,
		sourcePath: graph.sourcePath ?? null,
		transcriptSnapshot: graph.transcriptSnapshot,
		sessionTitle: "Opened session",
		operations: graph.operations,
		interactions: graph.interactions,
		turnState: graph.turnState,
		messageCount: graph.messageCount,
		lifecycle: graph.lifecycle,
		capabilities: graph.capabilities,
		activeTurnFailure: graph.activeTurnFailure,
		lastTerminalTurnId: graph.lastTerminalTurnId,
	};
}

function addSession(store: SessionStore): void {
	store.addSession({
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

describe("canonical projection parity", () => {
	it("projects equivalent canonical state from cold-open snapshots and live snapshot envelopes", () => {
		const graph = createRepresentativeGraph();
		const coldStore = new SessionStore();
		const liveStore = new SessionStore();

		coldStore.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));
		addSession(liveStore);
		liveStore.applySessionStateEnvelope("session-1", createSnapshotEnvelope(graph));

		const coldProjection = coldStore.getCanonicalSessionProjection("session-1");
		const liveProjection = liveStore.getCanonicalSessionProjection("session-1");
		expect(coldProjection).not.toBeNull();
		expect(liveProjection).not.toBeNull();
		if (coldProjection === null || liveProjection === null) {
			throw new Error("Expected both stores to have canonical projections");
		}

		expect(liveProjection).toEqual(coldProjection);
		expect(liveStore.getSessionCapabilities("session-1")).toEqual(
			coldStore.getSessionCapabilities("session-1")
		);
		expect(liveStore.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(liveStore.getSessionTurnState("session-1")).toBe("Running");
		expect(liveStore.getSessionLastTerminalTurnId("session-1")).toBe("turn-previous");
		expect(liveStore.getSessionCurrentModeId("session-1")).toBe("build");
		expect(liveStore.getSessionCurrentModelId("session-1")).toBe("gpt-5");
		expect(liveStore.getSessionAutonomousEnabled("session-1")).toBe(true);
	});
});
