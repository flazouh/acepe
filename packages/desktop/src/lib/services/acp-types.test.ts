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
	SessionOpenFound,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionTurnState,
} from "./acp-types.js";

function createGraphLifecycle(
	status: SessionGraphLifecycle["status"] = "reserved",
	errorMessage: string | null = null
): SessionGraphLifecycle {
	return {
		status,
		detachedReason: status === "detached" ? "reconnectExhausted" : null,
		failureReason: status === "failed" ? "resumeFailed" : null,
		errorMessage,
		actionability: {
			canSend: status === "ready",
			canResume: status === "detached",
			canRetry: status === "failed",
			canArchive: status !== "archived",
			canConfigure: status === "ready",
			recommendedAction:
				status === "ready"
					? "send"
					: status === "detached"
						? "resume"
						: status === "failed"
							? "retry"
							: status === "archived"
								? "none"
								: "wait",
			recoveryPhase:
				status === "activating"
					? "activating"
					: status === "reconnecting"
						? "reconnecting"
						: status === "detached"
							? "detached"
							: status === "failed"
								? "failed"
								: status === "archived"
									? "archived"
									: "none",
			compactStatus: status,
		},
	};
}

describe("session-state protocol graph contract", () => {
	it("builds a graph-backed snapshot envelope from a canonical open result", () => {
		const lifecycle = createGraphLifecycle("ready");
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
			autonomousEnabled: false,
		};

		const graph = graphFromSessionOpenFound({
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
			lifecycle,
			capabilities,
		});

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
		const lifecycle = createGraphLifecycle();
		const capabilities: SessionGraphCapabilities = {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		};
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
			lifecycle,
			capabilities,
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
			lifecycle,
			activity: {
				kind: "idle",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
			capabilities,
		} satisfies SessionStateGraph);
	});

	it("preserves detached lifecycle and capability authority from open snapshots", () => {
		const lifecycle = createGraphLifecycle("detached");
		const capabilities: SessionGraphCapabilities = {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		};
		const found: SessionOpenFound = {
			requestedSessionId: "requested-1",
			canonicalSessionId: "canonical-1",
			isAlias: false,
			lastEventSeq: 11,
			graphRevision: 9,
			openToken: "open-token-1",
			agentId: "cursor" satisfies CanonicalAgentId,
			projectPath: "/repo",
			worktreePath: null,
			sourcePath: "/repo/.acepe/session.jsonl",
			transcriptSnapshot: {
				revision: 3,
				entries: [],
			},
			sessionTitle: "Session 1",
			operations: [],
			interactions: [],
			turnState: "Idle" satisfies SessionTurnState,
			messageCount: 0,
			lifecycle,
			capabilities,
		};

		const materialization = materializeSnapshotFromOpenFound(found);

		expect(materialization.graph.lifecycle).toBe(lifecycle);
		expect(materialization.graph.lifecycle.actionability.canResume).toBe(true);
		expect(materialization.graph.capabilities).toBe(capabilities);
		expect(materialization.graph.activity.kind).toBe("paused");
	});

	it("derives running activity with operation topology from open snapshots", () => {
		const graph = graphFromSessionOpenFound({
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
					provider_status: "in_progress",
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
					operation_state: "running",
				},
			],
			interactions: [],
			turnState: "Running" satisfies SessionTurnState,
			messageCount: 0,
			lifecycle: createGraphLifecycle("ready"),
			capabilities: {
				models: null,
				modes: null,
				availableCommands: [],
				configOptions: [],
				autonomousEnabled: false,
			},
		});

		expect(graph.activity).toEqual({
			kind: "running_operation",
			activeOperationCount: 1,
			activeSubagentCount: 1,
			dominantOperationId: "op-1",
			blockingInteractionId: null,
		});
	});
});
