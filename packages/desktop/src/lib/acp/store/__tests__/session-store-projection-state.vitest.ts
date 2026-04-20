import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionStateMock = vi.fn();

vi.mock("../api.js", () => ({
	api: {
		getSessionState: getSessionStateMock,
	},
}));

import type {
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
							title: "Run command",
							arguments: {
								kind: "execute",
								command: "pwd",
							},
							progressive_arguments: null,
							result: null,
							command: "pwd",
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
