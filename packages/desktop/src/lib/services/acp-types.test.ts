import { describe, expect, it } from "vitest";
import {
	createSnapshotEnvelope,
	graphFromSessionOpenFound,
	materializeSnapshotFromOpenFound,
} from "../acp/session-state/session-state-protocol.js";
import type {
	CanonicalAgentId,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionProjectionSnapshot,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionTurnState,
} from "./acp-types.js";

describe("session-state protocol graph contract", () => {
	it("builds a graph-backed snapshot envelope from a canonical open result", () => {
		const lifecycle: SessionGraphLifecycle = {
			status: "ready",
			errorMessage: null,
			canReconnect: true,
		};
		const capabilities: SessionGraphCapabilities = {
			models: {
				currentModelId: "model-a",
				availableModels: [{ modelId: "model-a", name: "Model A", description: null }],
			},
			modes: {
				currentModeId: "build",
				availableModes: [{ id: "build", name: "Build", description: null }],
			},
			availableCommands: [{ name: "compact", description: "Compact session" }],
			configOptions: [],
		};

		const graph = graphFromSessionOpenFound(
			{
				requestedSessionId: "requested-1",
				canonicalSessionId: "canonical-1",
				isAlias: false,
				lastEventSeq: 11,
				graphRevision: 9,
				openToken: "open-token-1",
				agentId: "cursor" satisfies CanonicalAgentId,
				projectPath: "/repo",
				worktreePath: null,
				sourcePath: null,
				transcriptSnapshot: {
					revision: 3,
					entries: [],
				},
				sessionTitle: "Session 1",
				operations: [],
				interactions: [],
				turnState: "Idle" satisfies SessionTurnState,
				messageCount: 0,
			},
			lifecycle,
			capabilities
		);

		const envelope = createSnapshotEnvelope(graph);

		expect(envelope).toEqual({
			sessionId: "canonical-1",
			graphRevision: 9,
			lastEventSeq: 11,
			payload: {
				kind: "snapshot",
				graph,
			},
		} satisfies SessionStateEnvelope);
	});

	it("materializes graph snapshots without constructing legacy projection snapshots", () => {
		const materialization = materializeSnapshotFromOpenFound({
			requestedSessionId: "requested-1",
			canonicalSessionId: "canonical-1",
			isAlias: false,
			lastEventSeq: 11,
			graphRevision: 9,
			openToken: "open-token-1",
			agentId: "cursor" satisfies CanonicalAgentId,
			projectPath: "/repo",
			worktreePath: null,
			sourcePath: null,
			transcriptSnapshot: {
				revision: 3,
				entries: [],
			},
			sessionTitle: "Session 1",
			operations: [],
			interactions: [],
			turnState: "Idle" satisfies SessionTurnState,
			messageCount: 0,
		});

		expect(materialization.graph).toEqual({
			requestedSessionId: "requested-1",
			canonicalSessionId: "canonical-1",
			isAlias: false,
			agentId: "cursor",
			projectPath: "/repo",
			worktreePath: null,
			sourcePath: null,
			revision: {
				graphRevision: 9,
				transcriptRevision: 3,
				lastEventSeq: 11,
			},
			transcriptSnapshot: {
				revision: 3,
				entries: [],
			},
			operations: [],
			interactions: [],
			turnState: "Idle",
			messageCount: 0,
			activeTurnFailure: undefined,
			lastTerminalTurnId: undefined,
			lifecycle: {
				status: "idle",
				errorMessage: null,
				canReconnect: true,
			},
			activity: {
				kind: "idle",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
			capabilities: {
				models: null,
				modes: null,
				availableCommands: [],
				configOptions: [],
				autonomousEnabled: false,
			},
		} satisfies SessionStateGraph);
	});

	it("derives running activity with operation topology from open snapshots", () => {
		const graph = graphFromSessionOpenFound(
			{
				requestedSessionId: "requested-1",
				canonicalSessionId: "canonical-1",
				isAlias: false,
				lastEventSeq: 11,
				graphRevision: 9,
				openToken: "open-token-1",
				agentId: "cursor" satisfies CanonicalAgentId,
				projectPath: "/repo",
				worktreePath: null,
				sourcePath: null,
				transcriptSnapshot: {
					revision: 3,
					entries: [],
				},
				sessionTitle: "Session 1",
				operations: [
					{
						id: "op-1",
						session_id: "canonical-1",
						tool_call_id: "tool-1",
						name: "task",
						kind: "task",
						status: "in_progress",
						title: null,
						arguments: { kind: "other", raw: {} },
						progressive_arguments: null,
						result: null,
						command: null,
						normalized_todos: null,
						parent_tool_call_id: null,
						parent_operation_id: null,
						child_tool_call_ids: [],
						child_operation_ids: [],
					},
				],
				interactions: [],
				turnState: "Running" satisfies SessionTurnState,
				messageCount: 0,
			},
			{
				status: "ready",
				errorMessage: null,
				canReconnect: true,
			},
			{
				models: null,
				modes: null,
				availableCommands: [],
				configOptions: [],
				autonomousEnabled: false,
			}
		);

		expect(graph.activity).toEqual({
			kind: "running_operation",
			activeOperationCount: 1,
			activeSubagentCount: 1,
			dominantOperationId: "op-1",
			blockingInteractionId: null,
		});
	});
});
