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
	SessionGraphLifecycle,
	SessionStateEnvelope,
	SessionStateGraph,
	TurnFailureSnapshot,
} from "$lib/services/acp-types.js";
import { InteractionStore } from "../interaction-store.svelte.js";
import { SessionStore } from "../session-store.svelte.js";

type ProjectionFailureOverride = Partial<TurnFailureSnapshot> | null;

type GraphOverride = Partial<SessionStateGraph> & {
	activeTurnFailure?: ProjectionFailureOverride;
};

function createOperationSnapshot(overrides: Partial<OperationSnapshot> = {}): OperationSnapshot {
	return {
		id: overrides.id ?? "op-1",
		session_id: overrides.session_id ?? "session-1",
		tool_call_id: overrides.tool_call_id ?? "tool-1",
		name: overrides.name ?? "bash",
		kind: overrides.kind ?? "execute",
		status: overrides.status ?? "in_progress",
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

beforeEach(() => {
	getSessionStateMock.mockReset();
	getSessionStateMock.mockReturnValue(okAsync(createSnapshotEnvelope()));
	sendPromptMock.mockReset();
	sendPromptMock.mockReturnValue(okAsync(undefined));
});

describe("SessionStore.applySessionStateGraph", () => {
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
		expect(store.getHotState("session-1")).toMatchObject({
			turnState: "error",
			connectionError: null,
			activeTurnFailure: {
				turnId: "turn-1",
				message: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "process",
			},
			lastTerminalTurnId: "turn-1",
		});
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

		expect(store.getHotState("session-1")).toMatchObject({
			turnState: "completed",
			activeTurnFailure: null,
			lastTerminalTurnId: "turn-1",
		});
	});

	it("defaults missing projected failure source to unknown during hydration", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph();
		if (graph.activeTurnFailure) {
			Reflect.deleteProperty(graph.activeTurnFailure, "source");
		}

		store.applySessionStateGraph(graph);

		expect(store.getHotState("session-1")).toMatchObject({
			activeTurnFailure: {
				source: "unknown",
			},
		});
	});

	it("hydrates lifecycle and capabilities from the graph snapshot", () => {
		const store = new SessionStore();

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
			status: "ready",
			isConnected: true,
			acpSessionId: "session-1",
			turnState: "streaming",
			currentMode: {
				id: "plan",
				name: "Plan",
			},
			currentModel: {
				id: "gpt-5",
				name: "GPT-5",
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
		});
		expect(store.getCapabilities("session-1")).toMatchObject({
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

	it("preserves seeded model capabilities when a lifecycle-only graph omits capabilities", () => {
		const store = new SessionStore();

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

		store.applySessionStateGraph(
			createSessionStateGraph({
				activeTurnFailure: null,
				turnState: "Running",
				lifecycle: createGraphLifecycle("ready"),
				revision: {
					graphRevision: 8,
					transcriptRevision: 8,
					lastEventSeq: 8,
				},
				capabilities: {
					models: null,
					modes: null,
					availableCommands: [],
					configOptions: [],
				},
			})
		);

		expect(store.getCapabilities("session-1").availableModels).toEqual([
			{
				id: "cursor-model",
				name: "Cursor Model",
				description: undefined,
			},
		]);
		expect(store.getHotState("session-1").currentModel).toEqual({
			id: "cursor-model",
			name: "Cursor Model",
			description: undefined,
		});
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
							status: "completed",
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
			status: "ready",
			isConnected: true,
			acpSessionId: "session-1",
		});
	});

	it("applies canonical operation and interaction patches from delta envelopes", () => {
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
					transcriptOperations: [],
					operationPatches: [createOperationSnapshot()],
					interactionPatches: [createPermissionInteractionSnapshot()],
					changedFields: ["operations", "interactions"],
				},
			},
		});

		expect(store.getOperationStore().getSessionOperations("session-1")).toHaveLength(1);
		expect(interactions.permissionsPending.get("permission-1")).toMatchObject({
			id: "permission-1",
			sessionId: "session-1",
			permission: "Read",
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

		expect(store.getHotState("session-1")).toMatchObject({
			status: "error",
			isConnected: false,
			connectionError: "Connection dropped",
		});
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

		expect(store.getHotState("session-1")).toMatchObject({
			activity: {
				kind: "running_operation",
				activeOperationCount: 2,
				activeSubagentCount: 1,
				dominantOperationId: "op-2",
				blockingInteractionId: null,
			},
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

		expect(store.getHotState("session-1")).toMatchObject({
			activity: {
				kind: "error",
				activeOperationCount: 2,
				activeSubagentCount: 1,
				dominantOperationId: "op-2",
				blockingInteractionId: null,
			},
		});
	});

	it("hydrates capabilities envelopes into capability and hot-state selectors", () => {
		const store = new SessionStore();
		addColdSession(store);

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

		expect(store.getCapabilities("session-1")).toMatchObject({
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
		expect(store.getHotState("session-1")).toMatchObject({
			currentMode: {
				id: "build",
				name: "Build",
			},
			currentModel: {
				id: "claude-sonnet-4.6",
				name: "Claude Sonnet 4.6",
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
		});
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
		expect(store.getHotState("session-1")).toMatchObject({
			status: "ready",
			isConnected: true,
		});
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
	});

	it("sends the first prompt for a just-created session before canonical lifecycle hydration arrives", async () => {
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

		const result = await store.sendMessage("session-1", "cursor UI diagnostic ping - reply ok");

		expect(result.isOk()).toBe(true);
		expect(sendPromptMock).toHaveBeenCalledWith("session-1", [
			{ type: "text", text: "cursor UI diagnostic ping - reply ok" },
		]);
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

	it("sends follow-up prompts for restored local created sessions without forcing resume first", async () => {
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
		await store.aggregateUserChunk("session-1", {
			content: {
				type: "text",
				text: "existing prompt",
			},
		});

		const result = await store.sendMessage("session-1", "cursor restored follow-up - reply ok");

		expect(result.isOk()).toBe(true);
		expect(sendPromptMock).toHaveBeenCalledWith("session-1", [
			{ type: "text", text: "cursor restored follow-up - reply ok" },
		]);
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
		expect(store.getHotState("session-1")).toMatchObject({
			status: "error",
			connectionError: "Provider disconnected",
			isConnected: false,
		});
	});
});
