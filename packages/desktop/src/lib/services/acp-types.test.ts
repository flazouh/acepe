import { describe, expect, it } from "vitest";

import type {
	CanonicalAgentId,
	InteractionSnapshot,
	OperationSnapshot,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionProjectionSnapshot,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionTurnState,
} from "./acp-types.js";
import {
	createSnapshotEnvelope,
	graphFromSessionOpenFound,
	materializeSnapshotFromOpenFound,
} from "../acp/session-state/session-state-protocol.js";

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
			graphRevision: 11,
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
				graphRevision: 11,
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
			capabilities: {
				models: null,
				modes: null,
				availableCommands: [],
				configOptions: [],
			},
		} satisfies SessionStateGraph);
	});

	it("preserves canonical operation lifecycle and interaction association in generated graph types", () => {
		const projection = {
			session: null,
			operations: [
				{
					id: "session-1:tool-1",
					session_id: "session-1",
					tool_call_id: "tool-1",
					name: "bash",
					kind: "execute",
					status: "pending",
					lifecycle: "blocked",
					blocked_reason: "permission",
					title: "Run command",
					arguments: { kind: "execute", command: null },
					progressive_arguments: null,
					result: null,
					command: "bun test",
					locations: [{ path: "/repo/package.json" }],
					skill_meta: { description: "Execute command", filePath: null },
					normalized_todos: [
						{
							content: "Run tests",
							activeForm: "Run tests",
							status: "pending",
							startedAt: null,
							completedAt: null,
							duration: null,
						},
					],
					started_at_ms: null,
					completed_at_ms: null,
					parent_tool_call_id: null,
					parent_operation_id: null,
					child_tool_call_ids: [],
					child_operation_ids: [],
				} satisfies OperationSnapshot,
			],
			interactions: [
				{
					id: "permission-1",
					session_id: "session-1",
					operation_id: "session-1:tool-1",
					kind: "Permission",
					state: "Pending",
					json_rpc_request_id: 7,
					reply_handler: { kind: "json_rpc", requestId: "7" },
					tool_reference: { messageId: "", callId: "tool-1" },
					responded_at_event_seq: null,
					response: null,
					payload: {
						Permission: {
							id: "permission-1",
							sessionId: "session-1",
							jsonRpcRequestId: 7,
							replyHandler: { kind: "json_rpc", requestId: "7" },
							permission: "Execute",
							patterns: [],
							metadata: { command: "bun test" },
							always: [],
							autoAccepted: false,
							tool: { messageId: "", callId: "tool-1" },
						},
					},
				} satisfies InteractionSnapshot,
			],
		} satisfies SessionProjectionSnapshot;

		expect(projection.operations[0]?.lifecycle).toBe("blocked");
		expect(projection.operations[0]?.blocked_reason).toBe("permission");
		expect(projection.interactions[0]?.operation_id).toBe("session-1:tool-1");
	});
});
