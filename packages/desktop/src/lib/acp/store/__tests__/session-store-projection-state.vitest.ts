import { mock } from "bun:test";
import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionStateMock = vi.fn();

mock.module("$lib/analytics.js", () => ({
	captureException: vi.fn(),
	captureContractViolation: vi.fn(),
	initAnalytics: vi.fn(),
	setAnalyticsEnabled: vi.fn(),
}));
mock.module("../../../analytics.js", () => ({
	captureException: vi.fn(),
	captureContractViolation: vi.fn(),
	initAnalytics: vi.fn(),
	setAnalyticsEnabled: vi.fn(),
}));
mock.module("@sentry/browser", () => ({
	captureException: vi.fn(),
	init: vi.fn(),
}));
mock.module("posthog-js", () => ({
	default: {
		init: vi.fn(),
		capture: vi.fn(),
		identify: vi.fn(),
		reset: vi.fn(),
	},
}));

vi.mock("../api.js", () => ({
	api: {
		getSessionState: getSessionStateMock,
	},
}));

import type {
	SessionDomainEvent,
	SessionStateEnvelope,
	SessionStateGraph,
	TurnFailureSnapshot,
} from "$lib/services/acp-types.js";

import { SessionStore } from "../session-store.svelte.js";

type ProjectionFailureOverride =
	| Partial<TurnFailureSnapshot>
	| null;

type GraphOverride = Partial<SessionStateGraph> & {
	activeTurnFailure?: ProjectionFailureOverride;
};

function createSessionStateGraph(
	overrides: GraphOverride = {}
): SessionStateGraph {
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
		lifecycle: overrides.lifecycle ?? {
			status: "idle",
			errorMessage: null,
			canReconnect: true,
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
});

describe("SessionStore.applySessionStateGraph", () => {
	it("hydrates canonical failed-turn state from the graph snapshot", () => {
		const store = new SessionStore();

		store.applySessionStateGraph(createSessionStateGraph());

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
				lifecycle: {
					status: "ready",
					errorMessage: null,
					canReconnect: true,
				},
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
					lifecycle: {
						status: "ready",
						errorMessage: null,
						canReconnect: true,
					},
					operations: [
						{
							id: "op-1",
							session_id: "session-1",
							tool_call_id: "tool-1",
							name: "bash",
							kind: "execute",
							status: "completed",
							lifecycle: "completed",
							blocked_reason: null,
							title: "Run command",
							arguments: {
								kind: "execute",
								command: "pwd",
							},
							progressive_arguments: null,
							result: null,
							command: "pwd",
							locations: null,
							skill_meta: null,
							normalized_todos: null,
							started_at_ms: null,
							completed_at_ms: null,
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

	it("preserves richer canonical operation evidence across snapshot replacement", () => {
		const store = new SessionStore();
		const initialGraph = createSessionStateGraph({
			operations: [
				{
					id: "session-1:tool-1",
					session_id: "session-1",
					tool_call_id: "tool-1",
					name: "Read",
					kind: "read",
					status: "pending",
					lifecycle: "blocked",
					blocked_reason: "permission",
					title: "Read /tmp/example.txt",
					arguments: { kind: "read", file_path: "/tmp/example.txt", source_context: null },
					progressive_arguments: null,
					result: null,
					command: null,
					locations: [{ path: "/tmp/example.txt" }],
					skill_meta: null,
					normalized_todos: null,
					started_at_ms: 10,
					completed_at_ms: null,
					parent_tool_call_id: null,
					parent_operation_id: null,
					child_tool_call_ids: [],
					child_operation_ids: [],
				},
			],
		});
		const thinnerGraph = createSessionStateGraph({
			revision: {
				graphRevision: 8,
				transcriptRevision: 8,
				lastEventSeq: 8,
			},
			operations: [
				{
					id: "session-1:tool-1",
					session_id: "session-1",
					tool_call_id: "tool-1",
					name: "Read",
					kind: "read",
					status: "pending",
					lifecycle: "blocked",
					blocked_reason: "permission",
					title: "Read",
					arguments: { kind: "read", file_path: null, source_context: null },
					progressive_arguments: null,
					result: null,
					command: null,
					locations: null,
					skill_meta: null,
					normalized_todos: null,
					started_at_ms: null,
					completed_at_ms: null,
					parent_tool_call_id: null,
					parent_operation_id: null,
					child_tool_call_ids: [],
					child_operation_ids: [],
				},
			],
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(initialGraph));
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(thinnerGraph));

		expect(store.getOperationStore().getByToolCallId("session-1", "tool-1")).toMatchObject({
			title: "Read /tmp/example.txt",
			arguments: { kind: "read", file_path: "/tmp/example.txt", source_context: null },
			locations: [{ path: "/tmp/example.txt" }],
			startedAtMs: 10,
		});
	});

	it("applies live canonical operation events without transcript repair", () => {
		const store = new SessionStore();
		addColdSession(store);

		const event: SessionDomainEvent = {
			event_id: "event-1",
			seq: 11,
			session_id: "session-1",
			provider_session_id: null,
			occurred_at_ms: 11,
			causation_id: null,
			kind: "operation_upserted",
			payload: {
				kind: "operation_upserted",
				operation_id: "op-1",
				tool_call_id: "tool-1",
				tool_name: "Read",
				tool_kind: "read",
				status: "pending",
				parent_operation_id: null,
				operation: {
					id: "op-1",
					session_id: "session-1",
					tool_call_id: "tool-1",
					name: "Read",
					kind: "read",
					status: "pending",
					lifecycle: "blocked",
					blocked_reason: "permission",
					title: "Read /tmp/example.txt",
					arguments: { kind: "read", file_path: "/tmp/example.txt", source_context: null },
					progressive_arguments: null,
					result: null,
					command: "cat /tmp/example.txt",
					locations: [{ path: "/tmp/example.txt" }],
					skill_meta: null,
					normalized_todos: null,
					started_at_ms: null,
					completed_at_ms: null,
					parent_tool_call_id: null,
					parent_operation_id: null,
					child_tool_call_ids: [],
					child_operation_ids: [],
				},
			},
		};

		store.applySessionDomainEvent(event);
		store.createToolCallEntry("session-1", {
			id: "tool-1",
			name: "Read",
			arguments: { kind: "read", file_path: null, source_context: null },
			status: "pending",
			kind: "read",
			title: "Read",
			locations: null,
			skillMeta: null,
			result: null,
			awaitingPlanApproval: false,
		});

		expect(store.getOperationStore().getByToolCallId("session-1", "tool-1")).toMatchObject({
			id: "op-1",
			title: "Read /tmp/example.txt",
			command: "cat /tmp/example.txt",
			lifecycle: "blocked",
			blockedReason: "permission",
		});
	});

	it("updates canonical operation blocking from live interaction events", () => {
		const store = new SessionStore();
		addColdSession(store);

		store.applySessionDomainEvent({
			event_id: "event-1",
			seq: 11,
			session_id: "session-1",
			provider_session_id: null,
			occurred_at_ms: 11,
			causation_id: null,
			kind: "operation_upserted",
			payload: {
				kind: "operation_upserted",
				operation_id: "op-1",
				tool_call_id: "tool-1",
				tool_name: "Read",
				tool_kind: "read",
				status: "pending",
				parent_operation_id: null,
				operation: {
					id: "op-1",
					session_id: "session-1",
					tool_call_id: "tool-1",
					name: "Read",
					kind: "read",
					status: "pending",
					lifecycle: "pending",
					blocked_reason: null,
					title: "Read",
					arguments: { kind: "read", file_path: null, source_context: null },
					progressive_arguments: null,
					result: null,
					command: null,
					locations: null,
					skill_meta: null,
					normalized_todos: null,
					started_at_ms: null,
					completed_at_ms: null,
					parent_tool_call_id: null,
					parent_operation_id: null,
					child_tool_call_ids: [],
					child_operation_ids: [],
				},
			},
		});

		store.applySessionDomainEvent({
			event_id: "event-2",
			seq: 12,
			session_id: "session-1",
			provider_session_id: null,
			occurred_at_ms: 12,
			causation_id: null,
			kind: "interaction_upserted",
			payload: {
				kind: "interaction_upserted",
				interaction_id: "perm-1",
				interaction_kind: "Permission",
				operation_id: "op-1",
				interaction: {
					id: "perm-1",
					session_id: "session-1",
					operation_id: "op-1",
					kind: "Permission",
					state: "Pending",
					json_rpc_request_id: 41,
					reply_handler: null,
					tool_reference: {
						messageId: "entry-1",
						callId: "tool-1",
					},
					responded_at_event_seq: null,
					response: null,
					payload: {
						Permission: {
							id: "perm-1",
							sessionId: "session-1",
							jsonRpcRequestId: 41,
							replyHandler: null,
							permission: "Read",
							patterns: [],
							metadata: {},
							always: [],
							autoAccepted: false,
							tool: {
								messageId: "entry-1",
								callId: "tool-1",
							},
						},
					},
				},
			},
		});

		expect(store.getOperationStore().getById("op-1")).toMatchObject({
			lifecycle: "blocked",
			blockedReason: "permission",
		});

		store.applySessionDomainEvent({
			event_id: "event-3",
			seq: 13,
			session_id: "session-1",
			provider_session_id: null,
			occurred_at_ms: 13,
			causation_id: null,
			kind: "interaction_resolved",
			payload: {
				kind: "interaction_resolved",
				interaction_id: "perm-1",
				operation_id: "op-1",
				interaction: {
					id: "perm-1",
					session_id: "session-1",
					operation_id: "op-1",
					kind: "Permission",
					state: "Approved",
					json_rpc_request_id: 41,
					reply_handler: null,
					tool_reference: {
						messageId: "entry-1",
						callId: "tool-1",
					},
					responded_at_event_seq: 13,
					response: null,
					payload: {
						Permission: {
							id: "perm-1",
							sessionId: "session-1",
							jsonRpcRequestId: 41,
							replyHandler: null,
							permission: "Read",
							patterns: [],
							metadata: {},
							always: [],
							autoAccepted: false,
							tool: {
								messageId: "entry-1",
								callId: "tool-1",
							},
						},
					},
				},
			},
		});

		expect(store.getOperationStore().getById("op-1")).toMatchObject({
			lifecycle: "pending",
			blockedReason: null,
		});
	});

	it("creates a skeletal canonical operation when a live upsert arrives without an enriched snapshot", () => {
		const store = new SessionStore();
		addColdSession(store);

		store.applySessionDomainEvent({
			event_id: "event-skeletal",
			seq: 21,
			session_id: "session-1",
			provider_session_id: null,
			occurred_at_ms: 21,
			causation_id: null,
			kind: "operation_upserted",
			payload: {
				kind: "operation_upserted",
				operation_id: "op-skeletal",
				tool_call_id: "tool-skeletal",
				tool_name: "Bash",
				tool_kind: "execute",
				status: "pending",
				parent_operation_id: null,
				operation: null,
			},
		});

		expect(store.getOperationStore().getById("op-skeletal")).toMatchObject({
			id: "op-skeletal",
			toolCallId: "tool-skeletal",
			name: "Bash",
			kind: "execute",
			lifecycle: "pending",
			arguments: { kind: "execute", command: null },
			startedAtMs: 21,
		});
	});

	it("backfills deferred interaction blocking when the operation arrives after the interaction", () => {
		const store = new SessionStore();
		addColdSession(store);

		store.applySessionDomainEvent({
			event_id: "event-early-interaction",
			seq: 31,
			session_id: "session-1",
			provider_session_id: null,
			occurred_at_ms: 31,
			causation_id: null,
			kind: "interaction_upserted",
			payload: {
				kind: "interaction_upserted",
				interaction_id: "perm-early",
				interaction_kind: "Permission",
				operation_id: "op-early",
				interaction: {
					id: "perm-early",
					session_id: "session-1",
					operation_id: null,
					kind: "Permission",
					state: "Pending",
					json_rpc_request_id: 77,
					reply_handler: null,
					tool_reference: {
						messageId: "entry-early",
						callId: "tool-early",
					},
					responded_at_event_seq: null,
					response: null,
					payload: {
						Permission: {
							id: "perm-early",
							sessionId: "session-1",
							jsonRpcRequestId: 77,
							replyHandler: null,
							permission: "Bash",
							patterns: [],
							metadata: {},
							always: [],
							autoAccepted: false,
							tool: {
								messageId: "entry-early",
								callId: "tool-early",
							},
						},
					},
				},
			},
		});

		store.applySessionDomainEvent({
			event_id: "event-late-operation",
			seq: 32,
			session_id: "session-1",
			provider_session_id: null,
			occurred_at_ms: 32,
			causation_id: null,
			kind: "operation_upserted",
			payload: {
				kind: "operation_upserted",
				operation_id: "op-early",
				tool_call_id: "tool-early",
				tool_name: "Bash",
				tool_kind: "execute",
				status: "pending",
				parent_operation_id: null,
				operation: null,
			},
		});

		expect(store.getOperationStore().getById("op-early")).toMatchObject({
			lifecycle: "blocked",
			blockedReason: "permission",
		});

		store.applySessionDomainEvent({
			event_id: "event-cancelled-interaction",
			seq: 33,
			session_id: "session-1",
			provider_session_id: null,
			occurred_at_ms: 33,
			causation_id: null,
			kind: "interaction_cancelled",
			payload: {
				kind: "interaction_cancelled",
				interaction_id: "perm-early",
				operation_id: null,
				interaction: {
					id: "perm-early",
					session_id: "session-1",
					operation_id: null,
					kind: "Permission",
					state: "Rejected",
					json_rpc_request_id: 77,
					reply_handler: null,
					tool_reference: {
						messageId: "entry-early",
						callId: "tool-early",
					},
					responded_at_event_seq: 33,
					response: null,
					payload: {
						Permission: {
							id: "perm-early",
							sessionId: "session-1",
							jsonRpcRequestId: 77,
							replyHandler: null,
							permission: "Bash",
							patterns: [],
							metadata: {},
							always: [],
							autoAccepted: false,
							tool: {
								messageId: "entry-early",
								callId: "tool-early",
							},
						},
					},
				},
			},
		});

		expect(store.getOperationStore().getById("op-early")).toMatchObject({
			lifecycle: "pending",
			blockedReason: null,
		});
	});

	it("hydrates lifecycle envelopes without needing a full graph refresh", () => {
		const store = new SessionStore();

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "lifecycle",
				lifecycle: {
					status: "error",
					errorMessage: "Connection dropped",
					canReconnect: true,
				},
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
				},
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
		});
	});

	it("refreshes from a canonical snapshot when a delta frontier mismatches the loaded transcript", async () => {
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
			lifecycle: {
				status: "ready",
				errorMessage: null,
				canReconnect: true,
			},
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
					transcriptOperations: [],
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
		expect(store.getHotState("session-1")).toMatchObject({
			status: "ready",
			isConnected: true,
		});
	});
});
