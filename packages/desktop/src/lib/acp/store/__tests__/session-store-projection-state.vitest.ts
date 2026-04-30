import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionStateMock = vi.fn();
const sendPromptMock = vi.fn();

vi.mock("../api.js", () => ({
	api: {
		getSessionState: (...args: Parameters<typeof getSessionStateMock>) =>
			getSessionStateMock(...args),
		sendPrompt: (...args: Parameters<typeof sendPromptMock>) => sendPromptMock(...args),
	},
}));

import type {
	InteractionSnapshot,
	OperationSnapshot,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionOpenFound,
	SessionStateEnvelope,
	SessionStateGraph,
	TurnFailureSnapshot,
} from "$lib/services/acp-types.js";
import { materializeAgentPanelSceneFromGraph } from "../../session-state/agent-panel-graph-materializer.js";
import { InteractionStore } from "../interaction-store.svelte.js";
import { SessionStore } from "../session-store.svelte.js";

type ProjectionFailureOverride = Partial<TurnFailureSnapshot> | null;

type GraphOverride = Partial<SessionStateGraph> & {
	activeTurnFailure?: ProjectionFailureOverride;
};

function createIdleActivity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function createOperationSnapshot(overrides: Partial<OperationSnapshot> = {}): OperationSnapshot {
	return {
		id: overrides.id ?? "op-1",
		session_id: overrides.session_id ?? "session-1",
		tool_call_id: overrides.tool_call_id ?? "tool-1",
		name: overrides.name ?? "bash",
		kind: overrides.kind ?? "execute",
		provider_status: overrides.provider_status ?? "in_progress",
		title: overrides.title ?? "Run command",
		arguments: overrides.arguments ?? {
			kind: "execute",
			command: "pwd",
		},
		progressive_arguments: overrides.progressive_arguments ?? null,
		result: overrides.result ?? null,
		command: overrides.command ?? "pwd",
		normalized_todos: overrides.normalized_todos ?? null,
		parent_tool_call_id: overrides.parent_tool_call_id ?? null,
		parent_operation_id: overrides.parent_operation_id ?? null,
		child_tool_call_ids: overrides.child_tool_call_ids ?? [],
		child_operation_ids: overrides.child_operation_ids ?? [],
		operation_state: overrides.operation_state ?? "running",
		source_link: overrides.source_link ?? {
			kind: "transcript_linked",
			entry_id: overrides.tool_call_id ?? "tool-1",
		},
	};
}

function createPermissionInteractionSnapshot(
	overrides: Partial<InteractionSnapshot> = {}
): InteractionSnapshot {
	return {
		id: overrides.id ?? "permission-1",
		session_id: overrides.session_id ?? "session-1",
		kind: overrides.kind ?? "Permission",
		state: overrides.state ?? "Pending",
		json_rpc_request_id: overrides.json_rpc_request_id ?? 7,
		reply_handler: overrides.reply_handler ?? null,
		tool_reference: overrides.tool_reference ?? {
			messageId: "tool-1",
			callId: "tool-1",
		},
		responded_at_event_seq: overrides.responded_at_event_seq ?? null,
		response: overrides.response ?? null,
		canonical_operation_id: overrides.canonical_operation_id ?? "op-1",
		payload: overrides.payload ?? {
			Permission: {
				id: "permission-1",
				sessionId: "session-1",
				jsonRpcRequestId: 7,
				replyHandler: null,
				permission: "Read",
				patterns: ["/repo/README.md"],
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

function createSessionStateGraph(overrides: GraphOverride = {}): SessionStateGraph {
	const activeTurnFailureOverride = overrides.activeTurnFailure;
	const activeTurnFailure: TurnFailureSnapshot | null =
		activeTurnFailureOverride === undefined
			? {
					turn_id: "turn-1",
					message: "Usage limit reached",
					code: "429",
					kind: "recoverable",
					source: "process",
				}
			: activeTurnFailureOverride === null
				? null
				: {
						turn_id: activeTurnFailureOverride.turn_id ?? "turn-1",
						message: activeTurnFailureOverride.message ?? "Usage limit reached",
						code: activeTurnFailureOverride.code ?? "429",
						kind: activeTurnFailureOverride.kind ?? "recoverable",
						source: activeTurnFailureOverride.source ?? "unknown",
					};

	return {
		requestedSessionId: overrides.requestedSessionId ?? "session-1",
		canonicalSessionId: overrides.canonicalSessionId ?? "session-1",
		isAlias: overrides.isAlias ?? false,
		agentId: overrides.agentId ?? "codex",
		projectPath: overrides.projectPath ?? "/repo",
		worktreePath: overrides.worktreePath ?? null,
		sourcePath: overrides.sourcePath ?? null,
		revision: overrides.revision ?? {
			graphRevision: 7,
			transcriptRevision: 7,
			lastEventSeq: 7,
		},
		transcriptSnapshot: overrides.transcriptSnapshot ?? {
			revision: 7,
			entries: [],
		},
		operations: overrides.operations ?? [],
		interactions: overrides.interactions ?? [],
		turnState: overrides.turnState ?? "Failed",
		messageCount: overrides.messageCount ?? 1,
		activeTurnFailure,
		lastTerminalTurnId: overrides.lastTerminalTurnId ?? "turn-1",
		lifecycle: overrides.lifecycle ?? createGraphLifecycle(),
		activity: overrides.activity ?? {
			kind: activeTurnFailure === null ? "idle" : "error",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		capabilities: overrides.capabilities ?? {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
		},
	};
}

function createSessionOpenFoundFromGraph(
	graph: SessionStateGraph = createSessionStateGraph()
): SessionOpenFound {
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
		activeTurnFailure: graph.activeTurnFailure ?? null,
		lastTerminalTurnId: graph.lastTerminalTurnId ?? null,
	};
}

function addColdSession(store: SessionStore, sessionId = "session-1", agentId = "codex"): void {
	store.addSession({
		id: sessionId,
		projectPath: "/repo",
		agentId,
		title: "Session",
		updatedAt: new Date("2026-04-19T00:00:00.000Z"),
		createdAt: new Date("2026-04-19T00:00:00.000Z"),
		sessionLifecycleState: "persisted",
		parentId: null,
	});
}

function createSnapshotEnvelope(
	graph: SessionStateGraph = createSessionStateGraph()
): SessionStateEnvelope {
	return {
		sessionId: graph.canonicalSessionId,
		graphRevision: graph.revision.graphRevision,
		lastEventSeq: graph.revision.lastEventSeq,
		payload: {
			kind: "snapshot",
			graph,
		},
	};
}

function materializeStoredScene(store: SessionStore, sessionId = "session-1") {
	const graph = store.getSessionStateGraph(sessionId);
	if (graph === null) {
		throw new Error(`Expected graph for ${sessionId}`);
	}

	return materializeAgentPanelSceneFromGraph({
		panelId: "panel-1",
		graph,
		header: {
			title: "Session",
		},
	});
}

beforeEach(() => {
	getSessionStateMock.mockReset();
	getSessionStateMock.mockReturnValue(okAsync(createSnapshotEnvelope()));
	sendPromptMock.mockReset();
	sendPromptMock.mockReturnValue(okAsync(undefined));
});

describe("SessionStore.applySessionStateGraph", () => {
	it("populates canonical projection from backend-authored open snapshots", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			lifecycle: createGraphLifecycle("reserved"),
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
				availableCommands: [
					{
						name: "edit",
						description: "Edit files",
					},
				],
				configOptions: [],
				autonomousEnabled: false,
			},
		});

		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));

		expect(store.getCanonicalSessionProjection("session-1")).toMatchObject({
			lifecycle: {
				status: "reserved",
				actionability: {
					canSend: false,
					recommendedAction: "wait",
				},
			},
			turnState: "Idle",
			activeTurnFailure: null,
			revision: graph.revision,
		});
	});

	it("keeps open snapshot transcript entries spine-only while operations hold rich tool data before connect", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			lifecycle: createGraphLifecycle("detached"),
			transcriptSnapshot: {
				revision: 12,
				entries: [
					{
						entryId: "tool-1",
						role: "tool",
						segments: [
							{
								kind: "text",
								segmentId: "tool-1:tool",
								text: "Run ls",
							},
						],
					},
				],
			},
			operations: [
				createOperationSnapshot({
					id: "session-1:tool-1",
					tool_call_id: "tool-1",
					name: "bash",
					kind: "execute",
					provider_status: "completed",
					title: "Run ls",
					arguments: {
						kind: "execute",
						command: "ls",
					},
					result: {
						content: "README.md",
						detailedContent: "README.md\npackage.json",
					},
					command: "ls",
					operation_state: "completed",
				}),
			],
		});

		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));

		const entries = store.getEntries("session-1");
		expect(entries).toHaveLength(1);
		const entry = entries[0];
		expect(entry?.type).toBe("tool_call");
		if (entry?.type !== "tool_call") {
			throw new Error("Expected hydrated entry to be a tool call");
		}
		expect(entry.message.kind).toBe("other");
		expect(entry.message.arguments).toEqual({
			kind: "other",
			raw: null,
		});
		expect(entry.message.result).toBeNull();
		const operation = store.getOperationStore().getByToolCallId("session-1", "tool-1");
		expect(operation).toMatchObject({
			toolCallId: "tool-1",
			kind: "execute",
			arguments: {
				kind: "execute",
				command: "ls",
			},
			result: {
				content: "README.md",
				detailedContent: "README.md\npackage.json",
			},
		});
		expect(operation?.arguments).toEqual({
			kind: "execute",
			command: "ls",
		});
		expect(operation?.result).toEqual({
			content: "README.md",
			detailedContent: "README.md\npackage.json",
		});
	});

	it("exposes a graph-materialized restored scene before connect replays history", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			lifecycle: createGraphLifecycle("detached"),
			transcriptSnapshot: {
				revision: 12,
				entries: [
					{
						entryId: "tool-1",
						role: "tool",
						segments: [
							{
								kind: "text",
								segmentId: "tool-1:tool",
								text: "Run ls",
							},
						],
					},
				],
			},
			operations: [
				createOperationSnapshot({
					id: "session-1:tool-1",
					tool_call_id: "tool-1",
					name: "bash",
					kind: "execute",
					provider_status: "completed",
					title: "Run ls",
					arguments: {
						kind: "execute",
						command: "ls",
					},
					result: {
						content: "README.md",
						detailedContent: "README.md\npackage.json",
					},
					command: "ls",
					operation_state: "completed",
				}),
			],
		});

		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));

		const restoredGraph = store.getSessionStateGraph("session-1");
		expect(restoredGraph).not.toBeNull();
		if (restoredGraph === null) {
			throw new Error("Expected restored graph to be available for scene materialization");
		}
		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph: restoredGraph,
			header: {
				title: "Opened session",
			},
		});
		const sceneEntry = scene.conversation.entries[0];
		expect(sceneEntry).toMatchObject({
			type: "tool_call",
			kind: "execute",
			title: "Run ls",
			status: "done",
			command: "ls",
			stdout: "README.md\npackage.json",
			presentationState: "resolved",
		});
	});

	it("preserves restored historical scene content across connect lifecycle envelopes", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Completed",
			activeTurnFailure: null,
			lastTerminalTurnId: "turn-7",
			lifecycle: createGraphLifecycle("detached"),
			activity: createIdleActivity(),
			revision: {
				graphRevision: 7,
				transcriptRevision: 7,
				lastEventSeq: 7,
			},
			transcriptSnapshot: {
				revision: 7,
				entries: [
					{
						entryId: "tool-1",
						role: "tool",
						segments: [
							{
								kind: "text",
								segmentId: "tool-1:tool",
								text: "Run ls",
							},
						],
					},
				],
			},
			operations: [
				createOperationSnapshot({
					id: "session-1:tool-1",
					tool_call_id: "tool-1",
					name: "bash",
					kind: "execute",
					provider_status: "completed",
					title: "Run ls",
					arguments: {
						kind: "execute",
						command: "ls",
					},
					result: {
						content: "README.md",
						detailedContent: "README.md\npackage.json",
					},
					command: "ls",
					operation_state: "completed",
				}),
			],
		});

		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));
		const openScene = materializeStoredScene(store);
		const openEntries = openScene.conversation.entries;
		expect(openEntries[0]).toMatchObject({
			type: "tool_call",
			kind: "execute",
			title: "Run ls",
			status: "done",
			command: "ls",
			stdout: "README.md\npackage.json",
			presentationState: "resolved",
		});

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("ready"),
				revision: {
					graphRevision: 8,
					transcriptRevision: 7,
					lastEventSeq: 8,
				},
			},
		});
		const connectedScene = materializeStoredScene(store);
		expect(connectedScene.conversation.entries).toEqual(openEntries);

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 9,
			lastEventSeq: 9,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("failed", "Reconnect failed"),
				revision: {
					graphRevision: 9,
					transcriptRevision: 7,
					lastEventSeq: 9,
				},
			},
		});
		const failedScene = materializeStoredScene(store);
		expect(failedScene.status).toBe("error");
		expect(failedScene.lifecycle).toMatchObject({
			status: "failed",
			errorMessage: "Reconnect failed",
			actionability: {
				canRetry: true,
				recommendedAction: "retry",
			},
		});
		expect(failedScene.conversation.entries).toEqual(openEntries);
	});

	it("updates only the affected restored operation when connect delivers a newer operation delta", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Running",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			lifecycle: createGraphLifecycle("ready"),
			activity: {
				kind: "running_operation",
				activeOperationCount: 1,
				activeSubagentCount: 0,
				dominantOperationId: "op-2",
				blockingInteractionId: null,
			},
			revision: {
				graphRevision: 7,
				transcriptRevision: 7,
				lastEventSeq: 7,
			},
			transcriptSnapshot: {
				revision: 7,
				entries: [
					{
						entryId: "tool-1",
						role: "tool",
						segments: [
							{
								kind: "text",
								segmentId: "tool-1:tool",
								text: "Run pwd",
							},
						],
					},
					{
						entryId: "tool-2",
						role: "tool",
						segments: [
							{
								kind: "text",
								segmentId: "tool-2:tool",
								text: "Run tests",
							},
						],
					},
				],
			},
			operations: [
				createOperationSnapshot({
					id: "op-1",
					tool_call_id: "tool-1",
					name: "bash",
					kind: "execute",
					provider_status: "completed",
					title: "Run pwd",
					arguments: {
						kind: "execute",
						command: "pwd",
					},
					result: "/repo",
					command: "pwd",
					operation_state: "completed",
				}),
				createOperationSnapshot({
					id: "op-2",
					tool_call_id: "tool-2",
					name: "bash",
					kind: "execute",
					provider_status: "in_progress",
					title: "Run tests",
					arguments: {
						kind: "execute",
						command: "bun test",
					},
					result: null,
					command: "bun test",
					operation_state: "running",
				}),
			],
		});

		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));
		const openScene = materializeStoredScene(store);
		const stableEntry = openScene.conversation.entries[0];
		expect(stableEntry).toMatchObject({
			type: "tool_call",
			kind: "execute",
			title: "Run pwd",
			status: "done",
			stdout: "/repo",
		});
		expect(openScene.conversation.entries[1]).toMatchObject({
			type: "tool_call",
			kind: "execute",
			title: "Run tests",
			status: "running",
		});

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 7,
						lastEventSeq: 8,
					},
					activity: createIdleActivity(),
					turnState: "Completed",
					activeTurnFailure: null,
					lastTerminalTurnId: "turn-8",
					transcriptOperations: [],
					operationPatches: [
						createOperationSnapshot({
							id: "op-2",
							tool_call_id: "tool-2",
							name: "bash",
							kind: "execute",
							provider_status: "completed",
							title: "Run tests",
							arguments: {
								kind: "execute",
								command: "bun test",
							},
							result: {
								content: "Tests passed",
								detailedContent: "20 pass",
							},
							command: "bun test",
							operation_state: "completed",
						}),
					],
					interactionPatches: [],
					changedFields: ["operations", "activity"],
				},
			},
		});

		const patchedScene = materializeStoredScene(store);
		expect(patchedScene.conversation.entries[0]).toEqual(stableEntry);
		expect(patchedScene.conversation.entries[1]).toMatchObject({
			type: "tool_call",
			kind: "execute",
			title: "Run tests",
			status: "done",
			command: "bun test",
			stdout: "20 pass",
			presentationState: "resolved",
		});
	});

	it("keeps operation and interaction arrays stable for graph-only terminal turn deltas", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Running",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
			lifecycle: createGraphLifecycle("ready"),
			activity: {
				kind: "running_operation",
				activeOperationCount: 1,
				activeSubagentCount: 0,
				dominantOperationId: "op-1",
				blockingInteractionId: null,
			},
			revision: {
				graphRevision: 7,
				transcriptRevision: 7,
				lastEventSeq: 7,
			},
			operations: [
				createOperationSnapshot({
					id: "op-1",
					tool_call_id: "tool-1",
					operation_state: "completed",
					provider_status: "completed",
				}),
			],
			interactions: [createPermissionInteractionSnapshot()],
		});
		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));
		const beforeGraph = store.getSessionStateGraph("session-1");
		if (beforeGraph === null) {
			throw new Error("Expected graph before terminal delta");
		}

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 7,
						lastEventSeq: 8,
					},
					activity: createIdleActivity(),
					turnState: "Completed",
					activeTurnFailure: null,
					lastTerminalTurnId: "turn-8",
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity", "turnState", "activeTurnFailure", "lastTerminalTurnId"],
				},
			},
		});
		const afterGraph = store.getSessionStateGraph("session-1");

		expect(afterGraph?.operations).toBe(beforeGraph.operations);
		expect(afterGraph?.interactions).toBe(beforeGraph.interactions);
		expect(afterGraph?.turnState).toBe("Completed");
		expect(afterGraph?.lastTerminalTurnId).toBe("turn-8");
	});

	it("hydrates canonical failed-turn state from the graph snapshot", () => {
		const store = new SessionStore();

		store.applySessionStateGraph(createSessionStateGraph());

		expect(store.getCanonicalSessionProjection("session-1")).toMatchObject({
			lifecycle: {
				status: "reserved",
			},
			activity: {
				kind: "error",
			},
			turnState: "Failed",
			activeTurnFailure: {
				turnId: "turn-1",
				message: "Usage limit reached",
			},
		});
		expect(store.getSessionTurnState("session-1")).toBe("Failed");
		expect(store.getSessionConnectionError("session-1")).toBeNull();
		expect(store.getSessionActiveTurnFailure("session-1")).toMatchObject({
			turnId: "turn-1",
			message: "Usage limit reached",
			code: "429",
			kind: "recoverable",
			source: "process",
		});
		expect(store.getSessionLastTerminalTurnId("session-1")).toBe("turn-1");
	});

	it("clears hydrated failed-turn state when the projection no longer has one", () => {
		const store = new SessionStore();

		store.applySessionStateGraph(createSessionStateGraph());
		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Completed",
				activeTurnFailure: null,
				lastTerminalTurnId: "turn-1",
			})
		);

		expect(store.getSessionTurnState("session-1")).toBe("Completed");
		expect(store.getSessionActiveTurnFailure("session-1")).toBeNull();
		expect(store.getSessionLastTerminalTurnId("session-1")).toBe("turn-1");
	});

	it("defaults missing projected failure source to unknown during hydration", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph();
		if (graph.activeTurnFailure) {
			Reflect.deleteProperty(graph.activeTurnFailure, "source");
		}

		store.applySessionStateGraph(graph);

		expect(store.getSessionActiveTurnFailure("session-1")).toMatchObject({
			source: "unknown",
		});
	});

	it("hydrates lifecycle and capabilities from the graph snapshot", () => {
		const store = new SessionStore();
		addColdSession(store);

		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Running",
				lifecycle: createGraphLifecycle("ready"),
				capabilities: {
					models: {
						availableModels: [
							{
								modelId: "gpt-5",
								name: "GPT-5",
							},
						],
						currentModelId: "gpt-5",
					},
					modes: {
						currentModeId: "plan",
						availableModes: [
							{
								id: "plan",
								name: "Plan",
							},
						],
					},
					availableCommands: [
						{
							name: "run",
							description: "Run a command",
						},
					],
					configOptions: [
						{
							id: "approval-policy",
							name: "approval-policy",
							category: "general",
							type: "string",
							currentValue: "always",
						},
					],
				},
			})
		);

		expect(store.getHotState("session-1")).toMatchObject({
			acpSessionId: "session-1",
		});
		expect(store.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(store.getSessionCanSend("session-1")).toBe(true);
		expect(store.getSessionTurnState("session-1")).toBe("Running");
		expect(store.getSessionCurrentModeId("session-1")).toBe("plan");
		expect(store.getSessionCurrentModelId("session-1")).toBe("gpt-5");
		expect(store.getSessionConfigOptions("session-1")).toEqual([
			{
				id: "approval-policy",
				name: "approval-policy",
				category: "general",
				type: "string",
				currentValue: "always",
				options: [],
			},
		]);
		expect(store.getSessionCapabilities("session-1")).toMatchObject({
			availableModes: [
				{
					id: "plan",
					name: "Plan",
				},
			],
			availableModels: [
				{
					id: "gpt-5",
					name: "GPT-5",
				},
			],
			availableCommands: [
				{
					name: "run",
					description: "Run a command",
				},
			],
		});
	});

	it("carries canonical capabilities across lifecycle-only envelopes", () => {
		const store = new SessionStore();
		addColdSession(store);

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					activeTurnFailure: null,
					turnState: "Running",
					lifecycle: createGraphLifecycle("ready"),
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
						modes: null,
						availableCommands: [
							{
								name: "run",
								description: "Run command",
							},
						],
						configOptions: [],
						autonomousEnabled: true,
					},
				})
			)
		);

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("reconnecting"),
				revision: {
					graphRevision: 8,
					transcriptRevision: 7,
					lastEventSeq: 8,
				},
			},
		});

		expect(store.getCanonicalSessionProjection("session-1")?.capabilities).toMatchObject({
			models: {
				currentModelId: "gpt-5",
			},
			autonomousEnabled: true,
		});
		expect(store.getSessionCapabilities("session-1").availableModels).toEqual([
			{
				id: "gpt-5",
				name: "GPT-5",
				description: undefined,
			},
		]);
	});

	it("replaces canonical capabilities while carrying lifecycle fields forward", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					activeTurnFailure: null,
					turnState: "Running",
					lifecycle: createGraphLifecycle("ready"),
					capabilities: {
						models: {
							currentModelId: "gpt-4.1",
							availableModels: [
								{
									modelId: "gpt-4.1",
									name: "GPT-4.1",
								},
							],
						},
						modes: null,
						availableCommands: [],
						configOptions: [],
						autonomousEnabled: false,
					},
				})
			)
		);

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "capabilities",
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
					modes: null,
					availableCommands: [],
					configOptions: [],
					autonomousEnabled: true,
				},
				revision: {
					graphRevision: 8,
					transcriptRevision: 7,
					lastEventSeq: 8,
				},
				pending_mutation_id: "mutation-1",
				preview_state: "pending",
			},
		});

		expect(store.getCanonicalSessionProjection("session-1")).toMatchObject({
			lifecycle: {
				status: "ready",
			},
			turnState: "Running",
			capabilities: {
				models: {
					currentModelId: "gpt-5",
				},
				autonomousEnabled: true,
			},
			revision: {
				graphRevision: 8,
				transcriptRevision: 7,
				lastEventSeq: 8,
			},
		});
		expect(store.getSessionCapabilities("session-1")).toMatchObject({
			availableModels: [
				{
					id: "gpt-5",
					name: "GPT-5",
				},
			],
			pendingMutationId: "mutation-1",
			previewState: "pending",
		});
	});

	it("redacts unsafe config option values before writing canonical capabilities", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			activeTurnFailure: null,
			turnState: "Idle",
			capabilities: {
				models: null,
				modes: null,
				availableCommands: [],
				configOptions: [
					{
						id: "api-key",
						name: "API key",
						category: "credentials",
						type: "string",
						currentValue: "sk-secret",
						options: [
							{
								name: "secret",
								value: "ghp_secret",
							},
						],
					},
					{
						id: "max-tokens",
						name: "Max tokens",
						category: "general",
						type: "string",
						currentValue: "4096",
					},
				],
				autonomousEnabled: false,
			},
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(graph));

		expect(
			store.getCanonicalSessionProjection("session-1")?.capabilities.configOptions?.[0]
		).toMatchObject({
			id: "api-key",
			currentValue: null,
			options: [
				{
					name: "secret",
					value: null,
				},
			],
		});
		expect(
			store.getCanonicalSessionProjection("session-1")?.capabilities.configOptions?.[1]
		).toMatchObject({
			id: "max-tokens",
			currentValue: "4096",
		});
	});

	it("preserves canonical model capabilities when a capabilities envelope omits models and modes", () => {
		const store = new SessionStore();
		addColdSession(store, "session-1", "cursor");

		store.applySessionStateGraph(
			createSessionStateGraph({
				activeTurnFailure: null,
				turnState: "Running",
				lifecycle: createGraphLifecycle("ready"),
				capabilities: {
					models: {
						currentModelId: "cursor-model",
						availableModels: [
							{
								modelId: "cursor-model",
								name: "Cursor Model",
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
					availableCommands: [],
					configOptions: [],
				},
			})
		);

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "capabilities",
				capabilities: {
					models: null,
					modes: null,
					availableCommands: [],
					configOptions: [],
					autonomousEnabled: false,
				},
				revision: {
					graphRevision: 8,
					transcriptRevision: 8,
					lastEventSeq: 8,
				},
				pending_mutation_id: null,
				preview_state: "partial",
			},
		});

		expect(store.getSessionCapabilities("session-1").availableModels).toEqual([
			{
				id: "cursor-model",
				name: "Cursor Model",
				description: undefined,
			},
		]);
		expect(store.getSessionCurrentModelId("session-1")).toBe("cursor-model");
	});

	it("reconciles the connection machine from canonical lifecycle and turn state", () => {
		const store = new SessionStore();

		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Running",
				lifecycle: createGraphLifecycle("ready"),
			})
		);

		expect(store.getSessionState("session-1")).toMatchObject({
			connection: "streaming",
		});

		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Completed",
				activeTurnFailure: null,
				lastTerminalTurnId: "turn-1",
				lifecycle: createGraphLifecycle("ready"),
			})
		);

		expect(store.getSessionState("session-1")).toMatchObject({
			connection: "ready",
		});
	});

	it("reconciles the connection machine when a terminal graph delta completes the turn", () => {
		const store = new SessionStore();
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					lifecycle: createGraphLifecycle("ready"),
					activity: {
						kind: "running_operation",
						activeOperationCount: 1,
						activeSubagentCount: 0,
						dominantOperationId: "op-1",
						blockingInteractionId: null,
					},
					revision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
				})
			)
		);

		expect(store.getSessionRuntimeState("session-1")).toMatchObject({
			showStop: true,
			canCancel: true,
		});

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 7,
						lastEventSeq: 8,
					},
					activity: createIdleActivity(),
					turnState: "Completed",
					activeTurnFailure: null,
					lastTerminalTurnId: "turn-8",
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity", "turnState", "activeTurnFailure", "lastTerminalTurnId"],
				},
			},
		});

		expect(store.getSessionState("session-1")).toMatchObject({
			connection: "ready",
		});
		expect(store.getSessionRuntimeState("session-1")).toMatchObject({
			showStop: false,
			canCancel: false,
			canSubmit: true,
		});
	});
});

describe("SessionStore.applySessionStateEnvelope", () => {
	it("hydrates snapshot envelopes into transcript, operations, and hot state", () => {
		const store = new SessionStore();
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "snapshot",
				graph: createSessionStateGraph({
					lifecycle: createGraphLifecycle("ready"),
					operations: [
						{
							id: "op-1",
							session_id: "session-1",
							tool_call_id: "tool-1",
							name: "bash",
							kind: "execute",
							provider_status: "completed",
							operation_state: "completed",
							source_link: { kind: "transcript_linked", entry_id: "tool-1" },
							title: "Run command",
							arguments: {
								kind: "execute",
								command: "pwd",
							},
							progressive_arguments: null,
							result: null,
							command: "pwd",
							normalized_todos: null,
							parent_tool_call_id: null,
							parent_operation_id: null,
							child_tool_call_ids: [],
							child_operation_ids: [],
						},
					],
				}),
			},
		};

		store.applySessionStateEnvelope("session-1", envelope);

		expect(store.getOperationStore().getSessionOperations("session-1")).toHaveLength(1);
		expect(store.getHotState("session-1")).toMatchObject({
			acpSessionId: "session-1",
		});
		expect(store.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(store.getSessionCanSend("session-1")).toBe(true);
	});

	it("does not let a non-advancing snapshot erase restored transcript history", () => {
		const store = new SessionStore();
		addColdSession(store);
		const restoredGraph = createSessionStateGraph({
			activeTurnFailure: null,
			turnState: "Completed",
			lastTerminalTurnId: "turn-7",
			lifecycle: createGraphLifecycle("ready"),
			revision: {
				graphRevision: 7,
				transcriptRevision: 7,
				lastEventSeq: 7,
			},
			transcriptSnapshot: {
				revision: 7,
				entries: [
					{
						entryId: "assistant-history-7",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-history-7:block:0",
								text: "restored history",
							},
						],
					},
				],
			},
		});
		const staleReadyGraph = createSessionStateGraph({
			activeTurnFailure: null,
			turnState: "Idle",
			lastTerminalTurnId: null,
			lifecycle: createGraphLifecycle("ready"),
			revision: {
				graphRevision: 8,
				transcriptRevision: 7,
				lastEventSeq: 8,
			},
			transcriptSnapshot: {
				revision: 7,
				entries: [],
			},
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(restoredGraph));
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(staleReadyGraph));

		expect(store.getEntries("session-1")).toHaveLength(1);
		expect(store.getEntries("session-1")[0]).toMatchObject({
			id: "assistant-history-7",
			type: "assistant",
			message: {
				chunks: [
					{
						block: {
							text: "restored history",
						},
					},
				],
			},
		});
		expect(store.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(store.getSessionCanSend("session-1")).toBe(true);
		expect(store.getSessionStateGraph("session-1")?.transcriptSnapshot.entries).toEqual([
			{
				entryId: "assistant-history-7",
				role: "assistant",
				segments: [
					{
						kind: "text",
						segmentId: "assistant-history-7:block:0",
						text: "restored history",
					},
				],
			},
		]);
	});

	it("applies canonical operation and interaction patches from delta envelopes", () => {
		const store = new SessionStore();
		const interactions = new InteractionStore();
		const patchActivity: SessionGraphActivity = {
			kind: "running_operation",
			activeOperationCount: 1,
			activeSubagentCount: 0,
			dominantOperationId: "op-1",
			blockingInteractionId: null,
		};
		store.setLiveSessionStateGraphConsumer(interactions);
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					activeTurnFailure: null,
					turnState: "Running",
					lifecycle: createGraphLifecycle("ready"),
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
						modes: null,
						availableCommands: [],
						configOptions: [],
						autonomousEnabled: false,
					},
				})
			)
		);

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 7,
						lastEventSeq: 8,
					},
					activity: patchActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptOperations: [],
					operationPatches: [createOperationSnapshot()],
					interactionPatches: [createPermissionInteractionSnapshot()],
					changedFields: ["operations", "interactions", "activity"],
				},
			},
		});

		expect(store.getOperationStore().getSessionOperations("session-1")).toHaveLength(1);
		expect(interactions.permissionsPending.get("permission-1")).toMatchObject({
			id: "permission-1",
			sessionId: "session-1",
			permission: "Read",
		});
		expect(store.getCanonicalSessionProjection("session-1")?.activity).toEqual(patchActivity);
		expect(store.getCanonicalSessionProjection("session-1")?.turnState).toBe("Running");
		expect(store.getCanonicalSessionProjection("session-1")?.revision).toEqual({
			graphRevision: 8,
			transcriptRevision: 7,
			lastEventSeq: 8,
		});
		expect(store.getSessionCapabilities("session-1").availableModels).toEqual([
			{
				id: "gpt-5",
				name: "GPT-5",
				description: undefined,
			},
		]);
		expect(store.getCanonicalSessionProjection("session-1")?.activity).toEqual(patchActivity);
		expect(store.getSessionTurnState("session-1")).toBe("Running");
	});

	it("applies canonical blocked to running patches to graph, operation store, and scene", () => {
		const store = new SessionStore();
		const interactions = new InteractionStore();
		store.setLiveSessionStateGraphConsumer(interactions);
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					activeTurnFailure: null,
					turnState: "Running",
					lifecycle: createGraphLifecycle("ready"),
					operations: [
						createOperationSnapshot({
							operation_state: "blocked",
							provider_status: "in_progress",
						}),
					],
					transcriptSnapshot: {
						revision: 7,
						entries: [
							{
								entryId: "tool-1",
								role: "tool",
								segments: [
									{
										kind: "text",
										segmentId: "tool-1:tool",
										text: "Run pwd",
									},
								],
							},
						],
					},
					interactions: [createPermissionInteractionSnapshot()],
					activity: {
						kind: "waiting_for_user",
						activeOperationCount: 1,
						activeSubagentCount: 0,
						dominantOperationId: "op-1",
						blockingInteractionId: "permission-1",
					},
				})
			)
		);

		const blockedGraph = store.getSessionStateGraph("session-1");
		expect(blockedGraph).not.toBeNull();
		if (blockedGraph === null) {
			throw new Error("Expected blocked graph");
		}
		expect(
			materializeAgentPanelSceneFromGraph({
				panelId: "panel-1",
				graph: blockedGraph,
				header: {
					title: "Session",
				},
			}).conversation.entries[0]
		).toMatchObject({
			type: "tool_call",
			kind: "execute",
			status: "blocked",
			presentationState: "resolved",
		});

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 7,
						lastEventSeq: 8,
					},
					activity: {
						kind: "running_operation",
						activeOperationCount: 1,
						activeSubagentCount: 0,
						dominantOperationId: "op-1",
						blockingInteractionId: null,
					},
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptOperations: [],
					operationPatches: [
						createOperationSnapshot({
							operation_state: "running",
							provider_status: "in_progress",
						}),
					],
					interactionPatches: [
						createPermissionInteractionSnapshot({
							state: "Approved",
							responded_at_event_seq: 8,
							response: {
								kind: "permission",
								accepted: true,
								option_id: null,
								reply: null,
							},
						}),
					],
					changedFields: [
						"operations",
						"interactions",
						"activity",
						"turnState",
						"activeTurnFailure",
						"lastTerminalTurnId",
					],
				},
			},
		});

		const graph = store.getSessionStateGraph("session-1");
		expect(graph).not.toBeNull();
		if (graph === null) {
			throw new Error("Expected running graph");
		}
		expect(graph?.operations[0]?.operation_state).toBe("running");
		expect(graph?.interactions[0]?.state).toBe("Approved");
		expect(store.getOperationStore().getByToolCallId("session-1", "tool-1")?.operationState).toBe(
			"running"
		);
		expect(
			materializeAgentPanelSceneFromGraph({
				panelId: "panel-1",
				graph: graph,
				header: {
					title: "Session",
				},
			}).conversation.entries[0]
		).toMatchObject({
			type: "tool_call",
			kind: "execute",
			status: "running",
			presentationState: "resolved",
		});

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 9,
			lastEventSeq: 9,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 8,
						transcriptRevision: 7,
						lastEventSeq: 8,
					},
					toRevision: {
						graphRevision: 9,
						transcriptRevision: 7,
						lastEventSeq: 9,
					},
					activity: createIdleActivity(),
					turnState: "Idle",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptOperations: [],
					operationPatches: [
						createOperationSnapshot({
							operation_state: "completed",
							provider_status: "completed",
						}),
					],
					interactionPatches: [],
					changedFields: [
						"operations",
						"activity",
						"turnState",
						"activeTurnFailure",
						"lastTerminalTurnId",
					],
				},
			},
		});

		const completedGraph = store.getSessionStateGraph("session-1");
		expect(completedGraph).not.toBeNull();
		if (completedGraph === null) {
			throw new Error("Expected completed graph");
		}
		expect(completedGraph.operations[0]?.operation_state).toBe("completed");
		expect(
			materializeAgentPanelSceneFromGraph({
				panelId: "panel-1",
				graph: completedGraph,
				header: {
					title: "Session",
				},
			}).conversation.entries[0]
		).toMatchObject({
			type: "tool_call",
			kind: "execute",
			status: "done",
			presentationState: "resolved",
		});
	});

	it("materializes live operation patches without replacing the transcript snapshot", () => {
		const store = new SessionStore();
		const runningActivity: SessionGraphActivity = {
			kind: "awaiting_model",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		};
		const patchActivity: SessionGraphActivity = {
			kind: "running_operation",
			activeOperationCount: 1,
			activeSubagentCount: 0,
			dominantOperationId: "op-1",
			blockingInteractionId: null,
		};

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					activeTurnFailure: null,
					turnState: "Running",
					lifecycle: createGraphLifecycle("ready"),
					activity: runningActivity,
					transcriptSnapshot: {
						revision: 7,
						entries: [
							{
								entryId: "tool-1",
								role: "tool",
								segments: [
									{
										kind: "text",
										segmentId: "tool-1:tool",
										text: "Run pwd",
									},
								],
							},
						],
					},
					operations: [],
					revision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
				})
			)
		);

		const pendingGraph = store.getSessionStateGraph("session-1");
		expect(pendingGraph).not.toBeNull();
		if (pendingGraph === null) {
			throw new Error("Expected initial graph");
		}
		expect(
			materializeAgentPanelSceneFromGraph({
				panelId: "panel-1",
				graph: pendingGraph,
				header: {
					title: "Session",
				},
			}).conversation.entries[0]
		).toMatchObject({
			type: "tool_call",
			status: "pending",
			presentationState: "pending_operation",
		});

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 7,
						lastEventSeq: 8,
					},
					activity: patchActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptOperations: [],
					operationPatches: [
						createOperationSnapshot({
							id: "op-1",
							tool_call_id: "tool-1",
							name: "bash",
							kind: "execute",
							provider_status: "completed",
							title: "Run pwd",
							arguments: {
								kind: "execute",
								command: "pwd",
							},
							result: "/repo",
							command: "pwd",
							operation_state: "completed",
						}),
					],
					interactionPatches: [],
					changedFields: ["operations", "activity"],
				},
			},
		});

		const patchedGraph = store.getSessionStateGraph("session-1");
		expect(patchedGraph?.transcriptSnapshot.revision).toBe(7);
		expect(
			materializeAgentPanelSceneFromGraph({
				panelId: "panel-1",
				graph: patchedGraph ?? pendingGraph,
				header: {
					title: "Session",
				},
			}).conversation.entries[0]
		).toMatchObject({
			type: "tool_call",
			kind: "execute",
			title: "Run pwd",
			status: "done",
			command: "pwd",
			stdout: "/repo",
			presentationState: "resolved",
		});
	});

	it("forwards snapshot graphs to the live graph consumer", () => {
		const store = new SessionStore();
		const replaceSessionStateGraph = vi.fn();
		const graph = createSessionStateGraph();

		store.setLiveSessionStateGraphConsumer({ replaceSessionStateGraph });
		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: graph.revision.graphRevision,
			lastEventSeq: graph.revision.lastEventSeq,
			payload: {
				kind: "snapshot",
				graph,
			},
		});

		expect(replaceSessionStateGraph).toHaveBeenCalledWith(graph);
	});

	it("hydrates lifecycle envelopes without needing a full graph refresh", () => {
		const store = new SessionStore();

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("failed", "Connection dropped"),
				revision: {
					graphRevision: 8,
					transcriptRevision: 7,
					lastEventSeq: 8,
				},
			},
		});

		expect(store.getSessionLifecycleStatus("session-1")).toBe("failed");
		expect(store.getSessionCanSend("session-1")).toBe(false);
		expect(store.getSessionConnectionError("session-1")).toBe("Connection dropped");
		expect(store.getSessionState("session-1")).toMatchObject({
			connection: "error",
		});
	});

	it("hydrates graph-backed activity from snapshot envelopes", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Running",
			lifecycle: createGraphLifecycle("ready"),
			activity: {
				kind: "running_operation",
				activeOperationCount: 2,
				activeSubagentCount: 1,
				dominantOperationId: "op-2",
				blockingInteractionId: null,
			},
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(graph));

		expect(store.getCanonicalSessionProjection("session-1")?.activity).toEqual({
			kind: "running_operation",
			activeOperationCount: 2,
			activeSubagentCount: 1,
			dominantOperationId: "op-2",
			blockingInteractionId: null,
		});
	});

	it("preserves graph-backed activity topology across lifecycle-only envelopes", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Running",
			lifecycle: createGraphLifecycle("ready"),
			activity: {
				kind: "running_operation",
				activeOperationCount: 2,
				activeSubagentCount: 1,
				dominantOperationId: "op-2",
				blockingInteractionId: null,
			},
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(graph));
		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("failed", "Connection dropped"),
				revision: {
					graphRevision: 8,
					transcriptRevision: 7,
					lastEventSeq: 8,
				},
			},
		});

		expect(store.getCanonicalSessionProjection("session-1")?.activity).toEqual({
			kind: "error",
			activeOperationCount: 2,
			activeSubagentCount: 1,
			dominantOperationId: "op-2",
			blockingInteractionId: null,
		});
	});

	it("carries canonical turnState from previous projection on lifecycle-only envelopes", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Running",
			activeTurnFailure: null,
			lifecycle: createGraphLifecycle("ready"),
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(graph));

		// Apply a lifecycle-only envelope — does NOT carry a full graph turnState
		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("reconnecting"),
				revision: {
					graphRevision: 8,
					transcriptRevision: 7,
					lastEventSeq: 8,
				},
			},
		});

		// Canonical projection should carry "Running" from the previous full-graph projection,
		// not "Idle" from an uninitialised hotState, proving no authority inversion.
		expect(store.getCanonicalSessionProjection("session-1")).toMatchObject({
			turnState: "Running",
		});
	});

	it("carries canonical activeTurnFailure from previous projection on lifecycle-only envelopes", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Failed",
			activeTurnFailure: {
				turn_id: "turn-2",
				message: "rate limit",
				code: "429",
				kind: "recoverable",
				source: "process",
			},
			lifecycle: createGraphLifecycle("ready"),
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(graph));

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 9,
			lastEventSeq: 9,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("reconnecting"),
				revision: {
					graphRevision: 9,
					transcriptRevision: 7,
					lastEventSeq: 9,
				},
			},
		});

		expect(store.getCanonicalSessionProjection("session-1")).toMatchObject({
			activeTurnFailure: {
				turnId: "turn-2",
				message: "rate limit",
			},
		});
	});

	it("hydrates capabilities envelopes into capability and hot-state selectors", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateGraph(
			createSessionStateGraph({
				activeTurnFailure: null,
				turnState: "Idle",
				lifecycle: createGraphLifecycle("ready"),
			})
		);

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 9,
			lastEventSeq: 9,
			payload: {
				kind: "capabilities",
				capabilities: {
					models: {
						availableModels: [
							{
								modelId: "claude-sonnet-4.6",
								name: "Claude Sonnet 4.6",
							},
						],
						currentModelId: "claude-sonnet-4.6",
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
							name: "edit",
							description: "Edit files",
						},
					],
					configOptions: [
						{
							id: "sandbox",
							name: "sandbox",
							category: "runtime",
							type: "string",
							currentValue: "workspace-write",
						},
					],
					autonomousEnabled: true,
				},
				pending_mutation_id: null,
				preview_state: "canonical",
				revision: {
					graphRevision: 9,
					transcriptRevision: 7,
					lastEventSeq: 9,
				},
			},
		});

		expect(store.getSessionCapabilities("session-1")).toMatchObject({
			availableModels: [
				{
					id: "claude-sonnet-4.6",
					name: "Claude Sonnet 4.6",
				},
			],
			availableModes: [
				{
					id: "build",
					name: "Build",
				},
			],
			availableCommands: [
				{
					name: "edit",
					description: "Edit files",
				},
			],
		});
		expect(store.getSessionCurrentModeId("session-1")).toBe("build");
		expect(store.getSessionCurrentModelId("session-1")).toBe("claude-sonnet-4.6");
		expect(store.getSessionAvailableCommands("session-1")).toEqual([
			{
				name: "edit",
				description: "Edit files",
			},
		]);
		expect(store.getSessionConfigOptions("session-1")).toEqual([
			{
				id: "sandbox",
				name: "sandbox",
				category: "runtime",
				type: "string",
				currentValue: "workspace-write",
				options: [],
			},
		]);
		expect(store.getSessionAutonomousEnabled("session-1")).toBe(true);
	});

	it("hydrates telemetry envelopes into usage telemetry state", () => {
		const store = new SessionStore();

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 10,
			lastEventSeq: 10,
			payload: {
				kind: "telemetry",
				telemetry: {
					sessionId: "session-1",
					eventId: "telemetry-1",
					scope: "turn",
					contextWindowSize: 200000,
					tokens: {
						total: 50000,
						input: 30000,
						output: 20000,
					},
					costUsd: 0.42,
				},
				revision: {
					graphRevision: 10,
					transcriptRevision: 7,
					lastEventSeq: 10,
				},
			},
		});

		expect(store.getHotState("session-1").usageTelemetry).toMatchObject({
			sessionSpendUsd: 0.42,
			latestStepCostUsd: 0.42,
			latestTokensTotal: 50000,
			latestTokensInput: 30000,
			latestTokensOutput: 20000,
			lastTelemetryEventId: "telemetry-1",
			contextBudget: {
				maxTokens: 200000,
				source: "provider-explicit",
				scope: "turn",
			},
		});
	});

	it("does not guess a context budget when telemetry envelopes omit context size", () => {
		const store = new SessionStore();

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 11,
			lastEventSeq: 11,
			payload: {
				kind: "telemetry",
				telemetry: {
					sessionId: "session-1",
					eventId: "telemetry-2",
					scope: "step",
					tokens: {
						total: 1200,
					},
				},
				revision: {
					graphRevision: 11,
					transcriptRevision: 7,
					lastEventSeq: 11,
				},
			},
		});

		expect(store.getHotState("session-1").usageTelemetry).toMatchObject({
			contextBudget: null,
			latestTokensTotal: 1200,
			lastTelemetryEventId: "telemetry-2",
		});
	});

	it("refreshes from the canonical provider-open snapshot when a delta frontier mismatches the loaded transcript", async () => {
		const store = new SessionStore();
		const initialGraph = createSessionStateGraph();
		const refreshedGraph = createSessionStateGraph({
			revision: {
				graphRevision: 9,
				transcriptRevision: 9,
				lastEventSeq: 9,
			},
			transcriptSnapshot: {
				revision: 9,
				entries: [
					{
						entryId: "assistant-9",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-9:block:0",
								text: "fresh snapshot",
							},
						],
					},
				],
			},
			lifecycle: createGraphLifecycle("ready"),
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(initialGraph));
		getSessionStateMock.mockReturnValueOnce(okAsync(createSnapshotEnvelope(refreshedGraph)));

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 6,
						transcriptRevision: 6,
						lastEventSeq: 6,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 8,
					},
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "assistant-stale-8",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-stale-8:block:0",
										text: "stale delta",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		});

		await Promise.resolve();
		await Promise.resolve();

		expect(getSessionStateMock).toHaveBeenCalledWith("session-1");
		expect(store.getEntries("session-1")).toHaveLength(1);
		expect(store.getEntries("session-1")[0]).toMatchObject({
			id: "assistant-9",
			type: "assistant",
		});

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 10,
			lastEventSeq: 10,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 9,
						transcriptRevision: 9,
						lastEventSeq: 9,
					},
					toRevision: {
						graphRevision: 10,
						transcriptRevision: 10,
						lastEventSeq: 10,
					},
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "assistant-10",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-10:block:0",
										text: "live canonical delta",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		});

		expect(store.getEntries("session-1").map((entry) => entry.id)).toEqual([
			"assistant-9",
			"assistant-10",
		]);
		expect(store.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(store.getSessionCanSend("session-1")).toBe(true);
	});

	it("preserves reopened transcript history across a new user turn and canonical assistant reply", async () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					revision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					transcriptSnapshot: {
						revision: 7,
						entries: [
							{
								entryId: "assistant-history-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-history-1:block:0",
										text: "existing answer",
									},
								],
							},
						],
					},
					lifecycle: createGraphLifecycle("ready"),
				})
			)
		);

		await store.aggregateUserChunk("session-1", {
			content: {
				type: "text",
				text: "follow-up question",
			},
		});
		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 8,
					},
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "assistant-live-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-live-1:block:0",
										text: "new live answer",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		});

		expect(store.getEntries("session-1").map((entry) => entry.type)).toEqual([
			"assistant",
			"user",
			"assistant",
		]);
		expect(store.getEntries("session-1")[0]).toMatchObject({
			id: "assistant-history-1",
			message: {
				chunks: [
					{
						block: {
							text: "existing answer",
						},
					},
				],
			},
		});
		expect(store.getEntries("session-1")[1]).toMatchObject({
			type: "user",
			message: {
				content: {
					text: "follow-up question",
				},
			},
		});
		expect(store.getEntries("session-1")[2]).toMatchObject({
			id: "assistant-live-1",
			message: {
				chunks: [
					{
						block: {
							text: "new live answer",
						},
					},
				],
			},
		});
	});

	it("sends the first prompt for a created reserved session without forcing resume first", async () => {
		const store = new SessionStore();
		const connectSession = vi.spyOn(store, "connectSession");
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "cursor",
			title: "New Thread",
			updatedAt: new Date("2026-04-19T00:00:00.000Z"),
			createdAt: new Date("2026-04-19T00:00:00.000Z"),
			sessionLifecycleState: "created",
			parentId: null,
		});
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					agentId: "cursor",
					lifecycle: createGraphLifecycle("reserved"),
					turnState: "Idle",
					messageCount: 0,
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptSnapshot: {
						revision: 0,
						entries: [],
					},
					revision: {
						graphRevision: 0,
						transcriptRevision: 0,
						lastEventSeq: 0,
					},
				})
			)
		);

		const result = await store.sendMessage("session-1", "cursor UI diagnostic ping - reply ok");

		expect(result.isOk()).toBe(true);
		expect(sendPromptMock).toHaveBeenCalledWith("session-1", [
			{ type: "text", text: "cursor UI diagnostic ping - reply ok" },
		]);
		expect(connectSession).not.toHaveBeenCalled();
	});

	it("clears local pending send intent when the canonical graph accepts the send", async () => {
		const store = new SessionStore();
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "cursor",
			title: "New Thread",
			updatedAt: new Date("2026-04-19T00:00:00.000Z"),
			createdAt: new Date("2026-04-19T00:00:00.000Z"),
			sessionLifecycleState: "created",
			parentId: null,
		});
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					agentId: "cursor",
					lifecycle: createGraphLifecycle("reserved"),
					turnState: "Idle",
					messageCount: 0,
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptSnapshot: {
						revision: 0,
						entries: [],
					},
					revision: {
						graphRevision: 0,
						transcriptRevision: 0,
						lastEventSeq: 0,
					},
				})
			)
		);

		const result = await store.sendMessage("session-1", "cursor UI diagnostic ping - reply ok");

		expect(result.isOk()).toBe(true);
		expect(store.getHotState("session-1").pendingSendIntent).toEqual({
			attemptId: expect.any(String),
			startedAt: expect.any(Number),
			promptLength: 36,
		});

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					agentId: "cursor",
					lifecycle: createGraphLifecycle("activating"),
					turnState: "Running",
					messageCount: 1,
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptSnapshot: {
						revision: 1,
						entries: [],
					},
					revision: {
						graphRevision: 1,
						transcriptRevision: 1,
						lastEventSeq: 1,
					},
				})
			)
		);

		expect(store.getHotState("session-1").pendingSendIntent).toBeNull();
	});

	it("fails closed for a just-created session before canonical lifecycle hydration arrives", async () => {
		const store = new SessionStore();
		const connectSession = vi.spyOn(store, "connectSession");
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "cursor",
			title: "New Thread",
			updatedAt: new Date("2026-04-19T00:00:00.000Z"),
			createdAt: new Date("2026-04-19T00:00:00.000Z"),
			sessionLifecycleState: "created",
			parentId: null,
		});

		const result = await store.sendMessage("session-1", "cursor UI diagnostic ping - reply ok");

		expect(result.isErr()).toBe(true);
		expect(sendPromptMock).not.toHaveBeenCalled();
		expect(connectSession).not.toHaveBeenCalled();
	});

	it("marks restored local created sessions as loaded so the composer can submit", () => {
		const store = new SessionStore();
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "cursor",
			title: "Restored Thread",
			updatedAt: new Date("2026-04-19T00:00:00.000Z"),
			createdAt: new Date("2026-04-19T00:00:00.000Z"),
			sessionLifecycleState: "created",
			parentId: null,
		});

		store.setLocalCreatedSessionLoaded("session-1");

		expect(store.getSessionRuntimeState("session-1")).toMatchObject({
			connectionPhase: "disconnected",
			contentPhase: "loaded",
			canSubmit: true,
		});
	});

	it("routes detached restored sessions through connect before sending", async () => {
		const store = new SessionStore();
		const restoredSession = {
			id: "session-1",
			projectPath: "/repo",
			agentId: "cursor",
			title: "Restored Thread",
			updatedAt: new Date("2026-04-19T00:00:00.000Z"),
			createdAt: new Date("2026-04-19T00:00:00.000Z"),
			sourcePath: "/repo/.cursor/history/session.jsonl",
			sessionLifecycleState: "persisted",
			parentId: null,
		} as const;
		const connectSession = vi.spyOn(store, "connectSession").mockImplementation(() => {
			store.applySessionStateEnvelope(
				"session-1",
				createSnapshotEnvelope(
					createSessionStateGraph({
						agentId: "cursor",
						sourcePath: "/repo/.cursor/history/session.jsonl",
						lifecycle: createGraphLifecycle("ready"),
						turnState: "Idle",
						messageCount: 1,
						activeTurnFailure: null,
						lastTerminalTurnId: null,
						transcriptSnapshot: {
							revision: 2,
							entries: [],
						},
						revision: {
							graphRevision: 2,
							transcriptRevision: 2,
							lastEventSeq: 2,
						},
					})
				)
			);
			return okAsync(restoredSession);
		});
		store.addSession(restoredSession);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					agentId: "cursor",
					sourcePath: "/repo/.cursor/history/session.jsonl",
					lifecycle: createGraphLifecycle("detached"),
					turnState: "Idle",
					messageCount: 1,
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					transcriptSnapshot: {
						revision: 1,
						entries: [],
					},
					revision: {
						graphRevision: 1,
						transcriptRevision: 1,
						lastEventSeq: 1,
					},
				})
			)
		);

		const result = await store.sendMessage("session-1", "cursor restored follow-up - reply ok");

		expect(result.isOk()).toBe(true);
		expect(connectSession).toHaveBeenCalledWith("session-1");
		expect(sendPromptMock).toHaveBeenCalledWith("session-1", [
			{ type: "text", text: "cursor restored follow-up - reply ok" },
		]);
	});

	it("fails closed for restored local created sessions without canonical lifecycle", async () => {
		const store = new SessionStore();
		const connectSession = vi.spyOn(store, "connectSession");
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "cursor",
			title: "Restored Thread",
			updatedAt: new Date("2026-04-19T00:00:00.000Z"),
			createdAt: new Date("2026-04-19T00:00:00.000Z"),
			sessionLifecycleState: "created",
			parentId: null,
		});
		await store.aggregateUserChunk("session-1", {
			content: {
				type: "text",
				text: "existing prompt",
			},
		});

		const result = await store.sendMessage("session-1", "cursor restored follow-up - reply ok");

		expect(result.isErr()).toBe(true);
		expect(sendPromptMock).not.toHaveBeenCalled();
		expect(connectSession).not.toHaveBeenCalled();
	});

	it("keeps transcript entries intact when lifecycle transitions to error", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					transcriptSnapshot: {
						revision: 7,
						entries: [
							{
								entryId: "assistant-history-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-history-1:block:0",
										text: "existing answer",
									},
								],
							},
						],
					},
					lifecycle: createGraphLifecycle("ready"),
				})
			)
		);

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("failed", "Provider disconnected"),
				revision: {
					graphRevision: 8,
					transcriptRevision: 7,
					lastEventSeq: 8,
				},
			},
		});

		expect(store.getEntries("session-1")).toHaveLength(1);
		expect(store.getEntries("session-1")[0]).toMatchObject({
			id: "assistant-history-1",
			message: {
				chunks: [
					{
						block: {
							text: "existing answer",
						},
					},
				],
			},
		});
		expect(store.getSessionLifecycleStatus("session-1")).toBe("failed");
		expect(store.getSessionCanSend("session-1")).toBe(false);
		expect(store.getSessionConnectionError("session-1")).toBe("Provider disconnected");
	});
});
