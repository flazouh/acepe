import { mock } from "bun:test";
import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionStateMock = vi.fn();
const closeSessionMock = vi.fn(() => okAsync(undefined));

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
		closeSession: closeSessionMock,
	},
}));

import type {
	InteractionSnapshot,
	SessionStateEnvelope,
	SessionStateGraph,
} from "$lib/services/acp-types.js";

import { InteractionStore } from "../interaction-store.svelte.js";
import { PermissionStore } from "../permission-store.svelte.js";
import { SessionStore } from "../session-store.svelte.js";

function createPermissionInteraction(state: InteractionSnapshot["state"] = "Pending"): InteractionSnapshot {
	return {
		id: "perm-1",
		session_id: "session-1",
		operation_id: "op-1",
		kind: "Permission",
		state,
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
				metadata: {
					rawInput: {
						filePath: "/tmp/example.txt",
					},
					parsedArguments: {
						kind: "read",
						filePath: "/tmp/example.txt",
					},
					options: [],
				},
				always: [],
				autoAccepted: false,
				tool: {
					messageId: "entry-1",
					callId: "tool-1",
				},
			},
		},
	};
}

function createGraph(
	overrides: Partial<SessionStateGraph> = {}
): SessionStateGraph {
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "codex",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: overrides.revision ?? {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
		transcriptSnapshot: overrides.transcriptSnapshot ?? {
			revision: 1,
			entries: [],
		},
		operations: overrides.operations ?? [
			{
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
				started_at_ms: 10,
				completed_at_ms: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		],
		interactions: overrides.interactions ?? [createPermissionInteraction()],
		turnState: overrides.turnState ?? "Running",
		messageCount: overrides.messageCount ?? 1,
		activeTurnFailure: overrides.activeTurnFailure ?? null,
		lastTerminalTurnId: overrides.lastTerminalTurnId ?? null,
		lifecycle: overrides.lifecycle ?? {
			status: "ready",
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

function createSnapshotEnvelope(graph: SessionStateGraph): SessionStateEnvelope {
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
	getSessionStateMock.mockReturnValue(okAsync(createSnapshotEnvelope(createGraph())));
	closeSessionMock.mockClear();
});

describe("canonical operation lifecycle equivalence", () => {
	it("preserves one blocked operation through disconnect, failed reconnect, and replacement snapshot", () => {
		const store = new SessionStore();
		const interactionStore = new InteractionStore();
		const permissionStore = new PermissionStore(interactionStore);

		store.setLiveSessionStateGraphConsumer({
			replaceSessionStateGraph(graph) {
				interactionStore.replaceSessionStateGraph(graph);
			},
		});

		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "codex",
			title: "Session",
			updatedAt: new Date("2026-04-20T00:00:00.000Z"),
			createdAt: new Date("2026-04-20T00:00:00.000Z"),
			sessionLifecycleState: "persisted",
			parentId: null,
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(createGraph()));

		const initialOperation = store.getOperationStore().getByToolCallId("session-1", "tool-1");
		expect(initialOperation).not.toBeNull();
		expect(store.getOperationStore().getSessionOperations("session-1")).toHaveLength(1);
		expect(initialOperation).toMatchObject({
			id: "op-1",
			lifecycle: "blocked",
			blockedReason: "permission",
			title: "Read /tmp/example.txt",
			command: "cat /tmp/example.txt",
		});
		expect(
			initialOperation
				? permissionStore.getForOperation(initialOperation, store.getOperationStore())?.id
				: null
		).toBe("perm-1");

		store.disconnectSession("session-1");

		const afterDisconnect = store.getOperationStore().getByToolCallId("session-1", "tool-1");
		expect(store.getOperationStore().getSessionOperations("session-1")).toHaveLength(1);
		expect(afterDisconnect).toMatchObject({
			id: "op-1",
			lifecycle: "blocked",
			blockedReason: "permission",
		});
		expect(
			afterDisconnect
				? permissionStore.getForOperation(afterDisconnect, store.getOperationStore())?.id
				: null
		).toBe("perm-1");

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 2,
			lastEventSeq: 2,
			payload: {
				kind: "lifecycle",
				lifecycle: {
					status: "error",
					errorMessage: "Reconnect failed",
					canReconnect: true,
				},
				revision: {
					graphRevision: 2,
					transcriptRevision: 1,
					lastEventSeq: 2,
				},
			},
		});

		const afterReconnectFailure = store.getOperationStore().getByToolCallId("session-1", "tool-1");
		expect(store.getHotState("session-1")).toMatchObject({
			status: "error",
			connectionError: "Reconnect failed",
		});
		expect(store.getOperationStore().getSessionOperations("session-1")).toHaveLength(1);
		expect(afterReconnectFailure).toMatchObject({
			id: "op-1",
			lifecycle: "blocked",
			blockedReason: "permission",
			title: "Read /tmp/example.txt",
		});

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createGraph({
					revision: {
						graphRevision: 3,
						transcriptRevision: 3,
						lastEventSeq: 3,
					},
					operations: [
						{
							id: "op-1",
							session_id: "session-1",
							tool_call_id: "tool-1",
							name: "Read",
							kind: "read",
							status: "completed",
							lifecycle: "completed",
							blocked_reason: null,
							title: "Read /tmp/example.txt",
							arguments: { kind: "read", file_path: "/tmp/example.txt", source_context: null },
							progressive_arguments: null,
							result: "contents",
							command: "cat /tmp/example.txt",
							locations: [{ path: "/tmp/example.txt" }],
							skill_meta: null,
							normalized_todos: null,
							started_at_ms: 10,
							completed_at_ms: 20,
							parent_tool_call_id: null,
							parent_operation_id: null,
							child_tool_call_ids: [],
							child_operation_ids: [],
						},
					],
					interactions: [],
					turnState: "Completed",
					lifecycle: {
						status: "idle",
						errorMessage: null,
						canReconnect: true,
					},
					lastTerminalTurnId: "turn-1",
				})
			)
		);

		const afterReplacementSnapshot = store.getOperationStore().getByToolCallId("session-1", "tool-1");
		expect(store.getOperationStore().getSessionOperations("session-1")).toHaveLength(1);
		expect(afterReplacementSnapshot).toMatchObject({
			id: "op-1",
			lifecycle: "completed",
			blockedReason: null,
			title: "Read /tmp/example.txt",
			command: "cat /tmp/example.txt",
			result: "contents",
			completedAtMs: 20,
		});
		expect(
			afterReplacementSnapshot
				? permissionStore.getForOperation(afterReplacementSnapshot, store.getOperationStore())
				: undefined
		).toBeUndefined();
	});
});
