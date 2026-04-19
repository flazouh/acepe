import { describe, expect, it } from "vitest";

import type {
	CanonicalAgentId,
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
	projectionSnapshotFromMaterialization,
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
			graphRevision: 3,
			lastEventSeq: 11,
			payload: {
				kind: "snapshot",
				graph,
			},
		} satisfies SessionStateEnvelope);
	});

	it("derives projection materialization from the graph snapshot contract", () => {
		const projection = projectionSnapshotFromMaterialization(
			materializeSnapshotFromOpenFound({
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
			})
		);

		expect(projection).toEqual({
			session: {
				session_id: "canonical-1",
				agent_id: "cursor",
				last_event_seq: 11,
				turn_state: "Idle",
				message_count: 0,
				last_agent_message_id: null,
				active_tool_call_ids: [],
				completed_tool_call_ids: [],
				active_turn_failure: null,
				last_terminal_turn_id: null,
			},
			operations: [],
			interactions: [],
		} satisfies SessionProjectionSnapshot);
	});
});
