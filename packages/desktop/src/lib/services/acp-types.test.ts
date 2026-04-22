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
			capabilities: {
				models: null,
				modes: null,
				availableCommands: [],
				configOptions: [],
				autonomousEnabled: false,
			},
		} satisfies SessionStateGraph);
	});
});
