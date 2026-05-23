import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionStateMock = vi.fn();
const sendPromptMock = vi.fn();

vi.mock("../api.js", () => ({
	api: {
		fetchCanonicalSessionStateEnvelope: (...args: Parameters<typeof getSessionStateMock>) =>
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
import type { SessionUpdate } from "$lib/services/converted-session-types.js";
import { materializeAgentPanelSceneFromGraph } from "../../session-state/agent-panel-graph-materializer.js";
import { InteractionStore } from "../interaction-store.svelte.js";
import type { SessionEntryStore } from "../session-entry-store.svelte.js";
import { SessionStore } from "../session-store.svelte.js";
import type { CanonicalSessionProjection } from "../canonical-session-projection.js";
import { readStoredEntries } from "./entry-store-test-access.js";
import { deliverDiagnosticSessionUpdate } from "./session-store-test-access.js";

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
	awaiting_plan_approval: false,
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
		activeStreamingTail: overrides.activeStreamingTail ?? null,
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
		activity: graph.activity,
		activeStreamingTail: graph.activeStreamingTail,
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
	const graph = store.getSessionStateGraphForTest(sessionId);
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

function getEntryStore(store: SessionStore): SessionEntryStore {
	return (store as never as { entryStore: SessionEntryStore }).entryStore;
}

function getSessionEntries(store: SessionStore, sessionId: string) {
	return readStoredEntries(getEntryStore(store), sessionId);
}

function getCanonicalProjection(
	store: SessionStore,
	sessionId = "session-1"
): CanonicalSessionProjection | null {
	return (
		store as unknown as {
			canonicalProjections: Map<string, CanonicalSessionProjection>;
		}
	).canonicalProjections.get(sessionId) ?? null;
}

beforeEach(() => {
	getSessionStateMock.mockReset();
	getSessionStateMock.mockReturnValue(okAsync(createSnapshotEnvelope()));
	sendPromptMock.mockReset();
	sendPromptMock.mockReturnValue(okAsync(undefined));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("SessionStore.applySessionStateGraph", () => {
	it("treats raw assistant chunks as diagnostic and leaves transcript entries unchanged", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					transcriptSnapshot: {
						revision: 1,
						entries: [],
					},
					revision: {
						graphRevision: 1,
						transcriptRevision: 1,
						lastEventSeq: 1,
					},
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					lifecycle: createGraphLifecycle("ready"),
					activity: {
						kind: "awaiting_model",
						activeOperationCount: 0,
						activeSubagentCount: 0,
						dominantOperationId: null,
						blockingInteractionId: null,
					},
				})
			)
		);

		const rawAssistantChunk: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-1",
			message_id: "provider-msg-1",
			part_id: "provider-part-1",
			chunk: {
				content: {
					type: "text",
					text: "raw lane text",
				},
			},
		};

		deliverDiagnosticSessionUpdate(store, rawAssistantChunk);

		expect(getSessionEntries(store, "session-1")).toEqual([]);
		expect(store.getSessionStateGraphForTest("session-1")?.transcriptSnapshot).toEqual({
			revision: 1,
			entries: [],
		});
	});

	it("applies transcript deltas against the current graph frontier, not the entry projection cache", () => {
		const store = new SessionStore();
		addColdSession(store);
		const initialGraph = createSessionStateGraph({
			revision: {
				graphRevision: 1,
				transcriptRevision: 1,
				lastEventSeq: 1,
			},
			transcriptSnapshot: {
				revision: 1,
				entries: [
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:block:0",
								text: "old answer",
							},
						],
					},
				],
			},
			turnState: "Running",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
					activeStreamingTail: null,
			lifecycle: createGraphLifecycle("ready"),
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
		});
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(initialGraph));

		getEntryStore(store).replaceTranscriptSnapshot(
			"session-1",
			{
				revision: 2,
				entries: initialGraph.transcriptSnapshot.entries,
			},
			new Date("2026-05-06T10:00:00.000Z")
		);
		getSessionStateMock.mockClear();

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 2,
			lastEventSeq: 2,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 1,
						transcriptRevision: 1,
						lastEventSeq: 1,
					},
					toRevision: {
						graphRevision: 2,
						transcriptRevision: 2,
						lastEventSeq: 2,
					},
					activity: {
						kind: "awaiting_model",
						activeOperationCount: 0,
						activeSubagentCount: 0,
						dominantOperationId: null,
						blockingInteractionId: null,
					},
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendSegment",
							entryId: "assistant-1",
							role: "assistant",
							segment: {
								kind: "text",
								segmentId: "assistant-1:block:1",
								text: " plus new text",
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		});

		expect(getSessionStateMock).not.toHaveBeenCalled();
		expect(store.getSessionStateGraphForTest("session-1")?.transcriptSnapshot).toEqual({
			revision: 2,
			entries: [
				{
					entryId: "assistant-1",
					role: "assistant",
					segments: [
						{
							kind: "text",
							segmentId: "assistant-1:block:0",
							text: "old answer",
						},
						{
							kind: "text",
							segmentId: "assistant-1:block:1",
							text: " plus new text",
						},
					],
				},
			],
		});
	});

	it("replaces stale graph snapshots even when the entry projection cache transcript revision is ahead", () => {
		const store = new SessionStore();
		addColdSession(store);
		const initialGraph = createSessionStateGraph({
			revision: {
				graphRevision: 4,
				transcriptRevision: 1,
				lastEventSeq: 4,
			},
			transcriptSnapshot: {
				revision: 1,
				entries: [
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:block:0",
								text: "stale graph text",
							},
						],
					},
				],
			},
			turnState: "Running",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
					activeStreamingTail: null,
			lifecycle: createGraphLifecycle("ready"),
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
		});
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(initialGraph));

		getEntryStore(store).replaceTranscriptSnapshot(
			"session-1",
			{
				revision: 2,
				entries: initialGraph.transcriptSnapshot.entries,
			},
			new Date("2026-05-06T10:00:01.000Z")
		);

		const recoveredGraph = createSessionStateGraph({
			revision: {
				graphRevision: 5,
				transcriptRevision: 2,
				lastEventSeq: 5,
			},
			transcriptSnapshot: {
				revision: 2,
				entries: [
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:block:0",
								text: "canonical recovered answer",
							},
						],
					},
				],
			},
			turnState: "Completed",
			activeTurnFailure: null,
			lastTerminalTurnId: "turn-1",
					activeStreamingTail: null,
			lifecycle: createGraphLifecycle("ready"),
			activity: createIdleActivity(),
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(recoveredGraph));

		expect(store.getSessionStateGraphForTest("session-1")?.transcriptSnapshot).toEqual(
			recoveredGraph.transcriptSnapshot
		);
		expect(materializeStoredScene(store).conversation.entries).toMatchObject([
			{
				id: "assistant-1",
				type: "assistant",
				markdown: "canonical recovered answer",
				isStreaming: false,
			},
		]);
	});

	it("populates canonical projection from backend-authored open snapshots", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
					activeStreamingTail: null,
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

		expect(store.getSessionLifecycleStatus("session-1")).toBe("reserved");
		expect(store.getSessionCanSend("session-1")).toBe(false);
		expect(store.getSessionTurnState("session-1")).toBe("Idle");
		expect(store.getSessionActiveTurnFailure("session-1")).toBeNull();
		expect(store.getSessionGraphRevision("session-1")).toEqual(graph.revision);
	});

	it("keeps open snapshot transcript entries spine-only while operations hold rich tool data before connect", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
					activeStreamingTail: null,
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
	awaiting_plan_approval: false,
				}),
			],
		});

		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));

		const entries = getSessionEntries(store, "session-1");
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
		const operation = store.getToolCallById("session-1", "tool-1");
		expect(operation).toMatchObject({
			id: "tool-1",
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
					activeStreamingTail: null,
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
	awaiting_plan_approval: false,
				}),
			],
		});

		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));

		const restoredGraph = store.getSessionStateGraphForTest("session-1");
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

	it("does not preserve previous operations when a reconnect snapshot omits them", () => {
		const store = new SessionStore();
		const transcriptSnapshot = {
			revision: 12,
			entries: [
				{
					entryId: "tool-1",
					role: "tool" as const,
					segments: [
						{
							kind: "text" as const,
							segmentId: "tool-1:tool",
							text: "Run ls",
						},
					],
				},
			],
		};
		const restoredOperation = createOperationSnapshot({
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
	awaiting_plan_approval: false,
		});
		const restoredGraph = createSessionStateGraph({
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
					activeStreamingTail: null,
			lifecycle: createGraphLifecycle("detached"),
			transcriptSnapshot,
			operations: [restoredOperation],
		});
		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(restoredGraph));

		const reconnectGraph = createSessionStateGraph({
			turnState: "Idle",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
					activeStreamingTail: null,
			lifecycle: createGraphLifecycle("ready"),
			revision: {
				graphRevision: 13,
				transcriptRevision: 12,
				lastEventSeq: 13,
			},
			transcriptSnapshot,
			operations: [],
		});
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(reconnectGraph));

		const scene = materializeStoredScene(store);
		expect(scene.conversation.entries[0]).toMatchObject({
			type: "tool_call",
			kind: "other",
			title: "Unresolved tool",
			status: "degraded",
			presentationState: "degraded_operation",
		});
		expect(store.getToolCallById("session-1", "tool-1")).toBeNull();
	});

	it("preserves restored historical scene content across connect lifecycle envelopes", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Completed",
			activeTurnFailure: null,
			lastTerminalTurnId: "turn-7",
					activeStreamingTail: null,
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
	awaiting_plan_approval: false,
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
					activeStreamingTail: null,
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
	awaiting_plan_approval: false,
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
	awaiting_plan_approval: false,
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
					activeStreamingTail: null,
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
	awaiting_plan_approval: false,
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
					activeStreamingTail: null,
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
	awaiting_plan_approval: false,
					provider_status: "completed",
				}),
			],
			interactions: [createPermissionInteractionSnapshot()],
		});
		store.replaceSessionOpenSnapshot(createSessionOpenFoundFromGraph(graph));
		const beforeGraph = store.getSessionStateGraphForTest("session-1");
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
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity", "turnState", "activeTurnFailure", "lastTerminalTurnId"],
				},
			},
		});
		const afterGraph = store.getSessionStateGraphForTest("session-1");

		expect(afterGraph?.operations).toBe(beforeGraph.operations);
		expect(afterGraph?.interactions).toBe(beforeGraph.interactions);
		expect(afterGraph?.turnState).toBe("Completed");
		expect(afterGraph?.lastTerminalTurnId).toBe("turn-8");
	});

	it("applies canonical turn-only graph deltas without requiring activity changes", () => {
		const store = new SessionStore();
		store.replaceSessionOpenSnapshot(
			createSessionOpenFoundFromGraph(
				createSessionStateGraph({
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
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
					turnState: "Completed",
					activeTurnFailure: null,
					lastTerminalTurnId: "turn-8",
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["turnState", "lastTerminalTurnId"],
				},
			},
		});

		const graph = store.getSessionStateGraphForTest("session-1");
		expect(graph?.turnState).toBe("Completed");
		expect(graph?.lastTerminalTurnId).toBe("turn-8");
		expect(store.getSessionTurnState("session-1")).toBe("Completed");
	});

	it("hydrates canonical failed-turn state from the graph snapshot", () => {
		const store = new SessionStore();

		store.applySessionStateGraph(createSessionStateGraph());

		expect(store.getSessionLifecycleStatus("session-1")).toBe("reserved");
		expect(store.getSessionActivity("session-1")?.kind).toBe("error");
		expect(store.getSessionTurnState("session-1")).toBe("Failed");
		expect(store.getSessionActiveTurnFailure("session-1")).toMatchObject({
			turnId: "turn-1",
			message: "Usage limit reached",
		});
		expect(store.getSessionStateGraphForTest("session-1")?.turnState ?? null).toBe("Failed");
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
					activeStreamingTail: null,
			})
		);

		expect(store.getSessionStateGraphForTest("session-1")?.turnState ?? null).toBe("Completed");
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

		expect(store.getSessionAcpSessionId("session-1")).toBe("session-1");
		expect(store.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(store.getSessionCanSend("session-1")).toBe(true);
		expect(store.getSessionStateGraphForTest("session-1")?.turnState ?? null).toBe("Running");
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
		expect(store.getSessionAvailableModes("session-1")).toEqual([
			{
				id: "plan",
				name: "Plan",
				description: undefined,
			},
		]);
		expect(store.getSessionAvailableModels("session-1")).toEqual([
			{
				id: "gpt-5",
				name: "GPT-5",
				description: undefined,
			},
		]);
		expect(store.getSessionAvailableCommands("session-1")).toEqual([
			{
				name: "run",
				description: "Run a command",
			},
		]);
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

		expect(store.getSessionCurrentModelId("session-1")).toBe("gpt-5");
		expect(store.getSessionAutonomousEnabled("session-1")).toBe(true);
		expect(store.getSessionAvailableModels("session-1")).toEqual([
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

		expect(store.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(store.getSessionTurnState("session-1")).toBe("Running");
		expect(store.getSessionCurrentModelId("session-1")).toBe("gpt-5");
		expect(store.getSessionAutonomousEnabled("session-1")).toBe(true);
		expect(store.getSessionGraphRevision("session-1")).toEqual({
			graphRevision: 8,
			transcriptRevision: 7,
			lastEventSeq: 8,
		});
		expect(store.getSessionAvailableModels("session-1")).toEqual([
			{
				id: "gpt-5",
				name: "GPT-5",
				description: undefined,
			},
		]);
		expect(store.getSessionCapabilityPendingMutationId("session-1")).toBe("mutation-1");
		expect(store.getSessionCapabilityPreviewState("session-1")).toBe("pending");
	});

	it("redacts unsafe config option values before writing canonical capabilities", () => {
		const store = new SessionStore();
		addColdSession(store);
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

		expect(store.getSessionConfigOptions("session-1")?.[0]).toMatchObject({
			id: "api-key",
			currentValue: null,
			options: [
				{
					name: "secret",
					value: null,
				},
			],
		});
		expect(store.getSessionConfigOptions("session-1")?.[1]).toMatchObject({
			id: "max-tokens",
			currentValue: "4096",
		});
	});

	it("preserves omitted models and modes in a capability envelope as unknown state", () => {
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

		expect(store.getSessionAvailableModels("session-1")).toBeNull();
		expect(store.getSessionAvailableModels("session-1")).toBeNull();
		expect(store.getSessionAvailableModes("session-1")).toBeNull();
		expect(store.getSessionCurrentModelId("session-1")).toBeNull();
	});

	it("reconciles the connection machine from canonical lifecycle and turn state", () => {
		const store = new SessionStore();

		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Running",
				activeTurnFailure: null,
				activity: {
					kind: "running_operation",
					activeOperationCount: 1,
					activeSubagentCount: 0,
					dominantOperationId: "op-1",
					blockingInteractionId: null,
				},
				lifecycle: createGraphLifecycle("ready"),
			})
		);

		expect(store.getSessionLifecyclePresentation("session-1")).toMatchObject({
			connectionPhase: "connected",
			activityPhase: "running",
			canCancel: true,
			showStop: true,
		});

		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Completed",
				activeTurnFailure: null,
				lastTerminalTurnId: "turn-1",
					activeStreamingTail: null,
				lifecycle: createGraphLifecycle("ready"),
			})
		);

		expect(store.getSessionLifecyclePresentation("session-1")).toMatchObject({
			connectionPhase: "connected",
			activityPhase: "idle",
			canCancel: false,
			canSubmit: true,
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
					activeStreamingTail: null,
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

		expect(store.getSessionLifecyclePresentation("session-1")).toMatchObject({
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
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity", "turnState", "activeTurnFailure", "lastTerminalTurnId"],
				},
			},
		});

		expect(store.getSessionLifecyclePresentation("session-1")).toMatchObject({
			connectionPhase: "connected",
			activityPhase: "idle",
			canCancel: false,
			canSubmit: true,
		});
		expect(store.getSessionLifecyclePresentation("session-1")).toMatchObject({
			showStop: false,
			canCancel: false,
			canSubmit: true,
		});
	});

	it("clears local composer dispatching when canonical turn completion arrives", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
				})
			)
		);
		store.bindComposerSession("session-1");
		store.composerBeginDispatch("session-1");

		expect(store.getStoreComposerState("session-1")).toMatchObject({
			isDispatching: true,
			selectorsDisabled: true,
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
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity", "turnState", "activeTurnFailure", "lastTerminalTurnId"],
				},
			},
		});

		expect(store.getStoreComposerState("session-1")).toMatchObject({
			isDispatching: false,
			selectorsDisabled: false,
			canSubmit: true,
		});
	});

	it("does not notify turn completion when the first graph is restored already completed", () => {
		const store = new SessionStore();
		const onTurnComplete = vi.fn();
		store.setCallbacks({ onTurnComplete });

		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Completed",
				activeTurnFailure: null,
				lastTerminalTurnId: "turn-restored",
					activeStreamingTail: null,
				lifecycle: createGraphLifecycle("ready"),
				activity: createIdleActivity(),
			})
		);

		expect(onTurnComplete).not.toHaveBeenCalled();
	});

	it("notifies turn completion when a known running graph completes", () => {
		const store = new SessionStore();
		const onTurnComplete = vi.fn();
		store.setCallbacks({ onTurnComplete });
		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Running",
				activeTurnFailure: null,
				lastTerminalTurnId: null,
					activeStreamingTail: null,
				lifecycle: createGraphLifecycle("ready"),
			})
		);
		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "assistantTextDelta",
				delta: {
					turnId: "turn-live",
					rowId: "assistant-1",
					charOffset: 0,
					deltaText: " it with code.",
					producedAtMonotonicMs: 1,
					revision: 1,
				},
			},
		});
		expect(getCanonicalProjection(store)?.tokenStream.size).toBe(1);

		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Completed",
				activeTurnFailure: null,
				lastTerminalTurnId: "turn-live",
					activeStreamingTail: null,
				lifecycle: createGraphLifecycle("ready"),
				activity: createIdleActivity(),
			})
		);

		expect(onTurnComplete).toHaveBeenCalledWith("session-1");
		expect(onTurnComplete).toHaveBeenCalledTimes(1);
	});

	it("refreshes the canonical snapshot when a known running graph completes", async () => {
		const store = new SessionStore();
		const refreshedGraph = createSessionStateGraph({
			turnState: "Completed",
			activeTurnFailure: null,
			lastTerminalTurnId: "turn-live",
					activeStreamingTail: null,
			lifecycle: createGraphLifecycle("ready"),
			activity: createIdleActivity(),
			revision: {
				graphRevision: 9,
				transcriptRevision: 9,
				lastEventSeq: 9,
			},
			transcriptSnapshot: {
				revision: 9,
				entries: [
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:segment:1",
								text: "I’m turning the handoff hypothesis into a focused failing viewport regression so we can confirm",
							},
							{
								kind: "text",
								segmentId: "assistant-1:segment:2",
								text: " it with code.",
							},
						],
					},
				],
			},
		});
		getSessionStateMock.mockReturnValue(okAsync(createSnapshotEnvelope(refreshedGraph)));
		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Running",
				activeTurnFailure: null,
				lastTerminalTurnId: null,
					activeStreamingTail: null,
				lifecycle: createGraphLifecycle("ready"),
			})
		);

		store.applySessionStateGraph(
			createSessionStateGraph({
				turnState: "Completed",
				activeTurnFailure: null,
				lastTerminalTurnId: "turn-live",
					activeStreamingTail: null,
				lifecycle: createGraphLifecycle("ready"),
				activity: createIdleActivity(),
			})
		);
		await Promise.resolve();

		expect(getSessionStateMock).toHaveBeenCalledWith("session-1");
		const materialized = materializeStoredScene(store);
		const assistant = materialized.conversation.entries.find((entry) => entry.type === "assistant");
		expect(assistant).toMatchObject({
			type: "assistant",
			markdown:
				"I’m turning the handoff hypothesis into a focused failing viewport regression so we can confirm it with code.",
		});
	});
});

describe("SessionStore.applySessionStateEnvelope", () => {
	it("ignores same-revision transcript replacement instead of repairing in TypeScript", () => {
		const store = new SessionStore();
		const partialGraph = createSessionStateGraph({
			activeTurnFailure: null,
			turnState: "Completed",
			lifecycle: createGraphLifecycle("ready"),
			activity: createIdleActivity(),
			revision: {
				graphRevision: 10,
				transcriptRevision: 10,
				lastEventSeq: 10,
			},
			transcriptSnapshot: {
				revision: 10,
				entries: [
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:block:0",
								text: "full unwrapped* width of all controls",
							},
						],
					},
				],
			},
		});
		const fullGraph = createSessionStateGraph({
			activeTurnFailure: null,
			turnState: "Completed",
			lifecycle: createGraphLifecycle("ready"),
			activity: createIdleActivity(),
			revision: {
				graphRevision: 11,
				transcriptRevision: 10,
				lastEventSeq: 10,
			},
			transcriptSnapshot: {
				revision: 10,
				entries: [
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:block:0",
								text: "Tests pass. Changed `min-w-min` -> `min-w-max` on the header row. Now the header refuses to be narrower than the *full unwrapped* width of all controls",
							},
						],
					},
				],
			},
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(partialGraph));
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(fullGraph));

		const scene = materializeStoredScene(store);
		const assistantEntry = scene.conversation.entries[0];

		expect(assistantEntry?.type).toBe("assistant");
		if (assistantEntry?.type !== "assistant") {
			throw new Error("Expected assistant scene entry");
		}
		expect(assistantEntry.markdown).not.toContain("Tests pass.");
		expect(assistantEntry.markdown).toContain("full unwrapped* width");
	});

	it("hydrates snapshot envelopes into transcript, operations, and canonical projection", () => {
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
	awaiting_plan_approval: false,
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

		expect(store.getSessionStateGraphForTest("session-1")?.operations).toHaveLength(1);
		expect(store.getSessionAcpSessionId("session-1")).toBe("session-1");
		expect(store.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(store.getSessionCanSend("session-1")).toBe(true);
	});

	it("preserves the live assistant message id across graph patch deltas", () => {
		const store = new SessionStore();
		const initialGraph = createSessionStateGraph({
			activeTurnFailure: null,
			turnState: "Running",
			lastTerminalTurnId: null,
					activeStreamingTail: null,
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
			transcriptSnapshot: {
				revision: 7,
				entries: [
					{
						entryId: "user-1",
						role: "user",
						segments: [
							{
								kind: "text",
								segmentId: "user-1:block:0",
								text: "Use a tool, then continue.",
							},
						],
					},
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:block:0",
								text: "I'll check that.",
							},
						],
					},
					{
						entryId: "tool-1",
						role: "tool",
						segments: [
							{
								kind: "text",
								segmentId: "tool-1:block:0",
								text: "Tool completed",
							},
						],
					},
				],
			},
		});

		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(initialGraph));
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
						kind: "awaiting_model",
						activeOperationCount: 0,
						activeSubagentCount: 0,
						dominantOperationId: null,
						blockingInteractionId: null,
					},
						turnState: "Running",
						activeTurnFailure: null,
						lastTerminalTurnId: null,
						activeStreamingTail: { rowId: "assistant-1", contentKind: "message" },
						transcriptOperations: [],
						operationPatches: [],
						interactionPatches: [],
						changedFields: ["activity", "activeStreamingTail"],
					},
				},
		});
		const scene = materializeStoredScene(store);
		const assistantRow = scene.conversation.entries.find(
			(entry) => entry.type === "assistant" && entry.id === "assistant-1"
		);
		expect(assistantRow).toMatchObject({
			isStreaming: true,
		});
	});

	it("does not let a non-advancing snapshot erase restored transcript history", () => {
		const store = new SessionStore();
		addColdSession(store);
		const restoredGraph = createSessionStateGraph({
			activeTurnFailure: null,
			turnState: "Completed",
			lastTerminalTurnId: "turn-7",
					activeStreamingTail: null,
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
					activeStreamingTail: null,
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

		expect(getSessionEntries(store, "session-1")).toHaveLength(1);
		expect(getSessionEntries(store, "session-1")[0]).toMatchObject({
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
		expect(store.getSessionStateGraphForTest("session-1")?.transcriptSnapshot.entries).toEqual([
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
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [createOperationSnapshot()],
					interactionPatches: [createPermissionInteractionSnapshot()],
					changedFields: ["operations", "interactions", "activity"],
				},
			},
		});

		expect(store.getSessionStateGraphForTest("session-1")?.operations).toHaveLength(1);
		expect(interactions.permissionsPending.get("permission-1")).toMatchObject({
			id: "permission-1",
			sessionId: "session-1",
			permission: "Read",
		});
		expect(store.getSessionActivity("session-1")).toEqual(patchActivity);
		expect(store.getSessionTurnState("session-1")).toBe("Running");
		expect(store.getSessionGraphRevision("session-1")).toEqual({
			graphRevision: 8,
			transcriptRevision: 7,
			lastEventSeq: 8,
		});
		expect(store.getSessionAvailableModels("session-1")).toEqual([
			{
				id: "gpt-5",
				name: "GPT-5",
				description: undefined,
			},
		]);
		expect(store.getSessionActivity("session-1")).toEqual(patchActivity);
		expect(store.getSessionStateGraphForTest("session-1")?.turnState ?? null).toBe("Running");
	});

	it("ignores stale graph patch revisions instead of rolling canonical state backward", () => {
		const store = new SessionStore();
		const initialActivity: SessionGraphActivity = {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		};
		const staleActivity: SessionGraphActivity = {
			kind: "running_operation",
			activeOperationCount: 1,
			activeSubagentCount: 0,
			dominantOperationId: "op-stale",
			blockingInteractionId: null,
		};
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					activeTurnFailure: null,
					turnState: "Idle",
					lifecycle: createGraphLifecycle("ready"),
					activity: initialActivity,
					revision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
				})
			)
		);

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 6,
			lastEventSeq: 6,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 5,
						transcriptRevision: 7,
						lastEventSeq: 5,
					},
					toRevision: {
						graphRevision: 6,
						transcriptRevision: 7,
						lastEventSeq: 6,
					},
					activity: staleActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity", "turnState"],
				},
			},
		});

		expect(store.getSessionGraphRevision("session-1")).toEqual({
			graphRevision: 7,
			transcriptRevision: 7,
			lastEventSeq: 7,
		});
		expect(store.getSessionActivity("session-1")).toEqual(initialActivity);
		expect(store.getSessionTurnState("session-1")).toBe("Idle");
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
	awaiting_plan_approval: false,
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

		const blockedGraph = store.getSessionStateGraphForTest("session-1");
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
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [
						createOperationSnapshot({
							operation_state: "running",
	awaiting_plan_approval: false,
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

		const graph = store.getSessionStateGraphForTest("session-1");
		expect(graph).not.toBeNull();
		if (graph === null) {
			throw new Error("Expected running graph");
		}
		expect(graph?.operations[0]?.operation_state).toBe("running");
		expect(graph?.interactions[0]?.state).toBe("Approved");
		expect(graph.operations[0]?.operation_state).toBe("running");
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
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [
						createOperationSnapshot({
							operation_state: "completed",
	awaiting_plan_approval: false,
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

		const completedGraph = store.getSessionStateGraphForTest("session-1");
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

		const pendingGraph = store.getSessionStateGraphForTest("session-1");
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
					activeStreamingTail: null,
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
	awaiting_plan_approval: false,
						}),
					],
					interactionPatches: [],
					changedFields: ["operations", "activity"],
				},
			},
		});

		const patchedGraph = store.getSessionStateGraphForTest("session-1");
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
		expect(store.getSessionCapabilityRevision("session-1")).toBeNull();
		expect(store.getSessionAvailableModels("session-1")).toBeNull();
		expect(store.getSessionStateGraphForTest("session-1")?.lifecycle.status).toBe("failed");
		expect(store.getSessionStateGraphForTest("session-1")?.lifecycle.errorMessage).toBe(
			"Connection dropped"
		);
		expect(store.getSessionLifecyclePresentation("session-1")).toMatchObject({
			connectionPhase: "failed",
			canSubmit: false,
			showStop: false,
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

		expect(store.getSessionActivity("session-1")).toEqual({
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

		expect(store.getSessionActivity("session-1")).toEqual({
			kind: "error",
			activeOperationCount: 2,
			activeSubagentCount: 1,
			dominantOperationId: "op-2",
			blockingInteractionId: null,
		});
	});

	it("ignores stale lifecycle envelopes instead of rolling canonical lifecycle backward", () => {
		const store = new SessionStore();
		const graph = createSessionStateGraph({
			turnState: "Running",
			lifecycle: createGraphLifecycle("ready"),
			activeTurnFailure: null,
			revision: {
				graphRevision: 9,
				transcriptRevision: 7,
				lastEventSeq: 9,
			},
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
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
				lifecycle: createGraphLifecycle("failed", "Old failure"),
				revision: {
					graphRevision: 8,
					transcriptRevision: 7,
					lastEventSeq: 8,
				},
			},
		});

		expect(store.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(store.getSessionTurnState("session-1")).toBe("Running");
		expect(store.getSessionGraphRevision("session-1")).toEqual({
			graphRevision: 9,
			transcriptRevision: 7,
			lastEventSeq: 9,
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
		// not "Idle" from uninitialised local state, proving no authority inversion.
		expect(store.getSessionTurnState("session-1")).toBe("Running");
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

		expect(store.getSessionActiveTurnFailure("session-1")).toMatchObject({
			turnId: "turn-2",
			message: "rate limit",
		});
	});

	it("hydrates capabilities envelopes into canonical capability selectors", () => {
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

		expect(store.getSessionAvailableModels("session-1")).toEqual([
			{
				id: "claude-sonnet-4.6",
				name: "Claude Sonnet 4.6",
				description: undefined,
			},
		]);
		expect(store.getSessionAvailableModes("session-1")).toEqual([
			{
				id: "build",
				name: "Build",
				description: undefined,
			},
		]);
		expect(store.getSessionAvailableCommands("session-1")).toEqual([
			{
				name: "edit",
				description: "Edit files",
			},
		]);
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

		expect(store.getSessionUsageTelemetry("session-1")).toMatchObject({
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

		expect(store.getSessionUsageTelemetry("session-1")).toMatchObject({
			contextBudget: null,
			latestTokensTotal: 1200,
			lastTelemetryEventId: "telemetry-2",
		});
	});

	it("ignores stale telemetry envelopes instead of overwriting newer usage selectors", () => {
		const store = new SessionStore();
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					revision: {
						graphRevision: 10,
						transcriptRevision: 7,
						lastEventSeq: 10,
					},
				})
			)
		);

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 11,
			lastEventSeq: 11,
			payload: {
				kind: "telemetry",
				telemetry: {
					sessionId: "session-1",
					eventId: "telemetry-new",
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

		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 9,
			lastEventSeq: 9,
			payload: {
				kind: "telemetry",
				telemetry: {
					sessionId: "session-1",
					eventId: "telemetry-stale",
					scope: "turn",
					tokens: {
						total: 9999,
					},
					costUsd: 99,
				},
				revision: {
					graphRevision: 9,
					transcriptRevision: 7,
					lastEventSeq: 9,
				},
			},
		});

		expect(store.getSessionUsageTelemetry("session-1")).toMatchObject({
			latestTokensTotal: 1200,
			lastTelemetryEventId: "telemetry-new",
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
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "user-live-1",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-live-1:block:0",
										text: "follow-up question",
									},
								],
							},
						},
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
		expect(getSessionEntries(store, "session-1")).toHaveLength(1);
		expect(getSessionEntries(store, "session-1")[0]).toMatchObject({
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
					activeStreamingTail: null,
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

		expect(getSessionEntries(store, "session-1").map((entry) => entry.id)).toEqual([
			"assistant-9",
			"assistant-10",
		]);
		expect(store.getSessionLifecycleStatus("session-1")).toBe("ready");
		expect(store.getSessionCanSend("session-1")).toBe(true);
	});

	it("accepts canonical empty snapshots instead of preserving transcript in TypeScript", () => {
		const store = new SessionStore();
		const trustedGraph = createSessionStateGraph({
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
								text: "trusted transcript",
							},
						],
					},
				],
			},
			lifecycle: createGraphLifecycle("ready"),
		});
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope(trustedGraph));

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					revision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 8,
					},
					transcriptSnapshot: {
						revision: 8,
						entries: [],
					},
					lifecycle: createGraphLifecycle("ready"),
				})
			)
		);

		expect(getSessionEntries(store, "session-1").map((entry) => entry.id)).toEqual([]);
		expect(store.getSessionStateGraphForTest("session-1")?.revision).toEqual({
			graphRevision: 8,
			transcriptRevision: 8,
			lastEventSeq: 8,
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
						transcriptRevision: 8,
						lastEventSeq: 8,
					},
					toRevision: {
						graphRevision: 9,
						transcriptRevision: 9,
						lastEventSeq: 9,
					},
					activity: createIdleActivity(),
					turnState: "Completed",
					activeTurnFailure: null,
					lastTerminalTurnId: "turn-1",
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "assistant-live-2",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-live-2:block:0",
										text: "next valid delta",
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

		expect(getSessionEntries(store, "session-1").map((entry) => entry.id)).toEqual(["assistant-live-2"]);
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
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "user-live-1",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-live-1:block:0",
										text: "follow-up question",
									},
								],
							},
						},
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

		expect(getSessionEntries(store, "session-1").map((entry) => entry.type)).toEqual([
			"assistant",
			"user",
			"assistant",
		]);
		expect(getSessionEntries(store, "session-1")[0]).toMatchObject({
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
		expect(getSessionEntries(store, "session-1")[1]).toMatchObject({
			type: "user",
			message: {
				content: {
					text: "follow-up question",
				},
			},
		});
		expect(getSessionEntries(store, "session-1")[2]).toMatchObject({
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

	it("applies canonical assistant turn ids exactly as Rust sends them", async () => {
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
								entryId: "provider-message",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "provider-message:block:0",
										text: "first answer",
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
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "user-2",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-2:block:0",
										text: "follow-up question",
									},
								],
							},
						},
						{
							kind: "appendSegment",
							entryId: "assistant-event-8",
							role: "assistant",
							segment: {
								kind: "text",
								segmentId: "assistant-event-8:block:1",
								text: "second answer",
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		});

		expect(
			store
				.getSessionStateGraphForTest("session-1")
				?.transcriptSnapshot.entries.map((entry) => entry.entryId)
		).toEqual(["provider-message", "user-2", "assistant-event-8"]);
		expect(getSessionEntries(store, "session-1").map((entry) => entry.type)).toEqual([
			"assistant",
			"user",
			"assistant",
		]);
		expect(getSessionEntries(store, "session-1")[2]).toMatchObject({
			id: "assistant-event-8",
			message: {
				chunks: [
					{
						block: {
							text: "second answer",
						},
					},
				],
			},
		});
	});

	it("ignores malformed assistant transcript deltas that omit entryId instead of creating undefined:turn rows", () => {
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
								entryId: "assistant-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-1:block:0",
										text: "first answer",
									},
								],
							},
							{
								entryId: "user-2",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-2:block:0",
										text: "follow-up question",
									},
								],
							},
						],
					},
					lifecycle: createGraphLifecycle("ready"),
					turnState: "Running",
					activity: createIdleActivity(),
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					activeTurnFailure: null,
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
						transcriptRevision: 8,
						lastEventSeq: 8,
					},
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendSegment",
							entryId: undefined as never,
							role: "assistant",
							segment: {
								kind: "text",
								segmentId: "missing-id:block:0",
								text: "broken answer",
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		});

		expect(
			getSessionEntries(store, "session-1")
				.filter((entry) => entry.type === "assistant")
				.map((entry) => entry.id)
		).toEqual(["assistant-1"]);
		expect(
			store
				.getSessionStateGraphForTest("session-1")
				?.transcriptSnapshot.entries.map((entry) => entry.entryId)
		).toEqual(["assistant-1", "user-2"]);
	});

	it("renders a completed second turn after awaiting-model state from live journal deltas", () => {
		const store = new SessionStore();
		addColdSession(store, "019df8c6-6615-7c73-abc3-b7d64fce3191");
		store.applySessionStateEnvelope(
			"019df8c6-6615-7c73-abc3-b7d64fce3191",
			createSnapshotEnvelope(
				createSessionStateGraph({
					requestedSessionId: "019df8c6-6615-7c73-abc3-b7d64fce3191",
					canonicalSessionId: "019df8c6-6615-7c73-abc3-b7d64fce3191",
					lifecycle: createGraphLifecycle("ready"),
					turnState: "Completed",
					activity: createIdleActivity(),
					activeTurnFailure: null,
					lastTerminalTurnId: "019df8ca-8d77-7fe2-bf77-bc9f542769b4",
					activeStreamingTail: null,
					messageCount: 2,
					revision: {
						graphRevision: 15,
						transcriptRevision: 12,
						lastEventSeq: 15,
					},
					transcriptSnapshot: {
						revision: 12,
						entries: [
							{
								entryId: "user-event-3",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-event-3:block:0",
										text: "STREAMQA-CODEX-FIX1 reply with one short sentence about umbrellas.",
									},
								],
							},
							{
								entryId: "msg_first",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "msg_first:block:0",
										text: "Umbrellas keep you dry when it rains.",
									},
								],
							},
						],
					},
				})
			)
		);

		const sessionId = "019df8c6-6615-7c73-abc3-b7d64fce3191";
		store.applySessionStateEnvelope(sessionId, {
			sessionId,
			graphRevision: 16,
			lastEventSeq: 16,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 15,
						transcriptRevision: 12,
						lastEventSeq: 15,
					},
					toRevision: {
						graphRevision: 16,
						transcriptRevision: 16,
						lastEventSeq: 16,
					},
					activity: {
						kind: "awaiting_model",
						activeOperationCount: 0,
						activeSubagentCount: 0,
						dominantOperationId: null,
						blockingInteractionId: null,
					},
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: "019df8ca-8d77-7fe2-bf77-bc9f542769b4",
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "user-event-16",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-event-16:block:0",
										text: "STREAMQA-CODEX-FIX2 reply with exactly: Apples stay crisp.",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot", "activity", "turnState", "lastTerminalTurnId"],
				},
			},
		});

		const assistantChunks = ["Ap", "ples", " stay", " crisp", "."];
		for (let index = 0; index < assistantChunks.length; index += 1) {
			const eventSeq = 17 + index;
			store.applySessionStateEnvelope(sessionId, {
				sessionId,
				graphRevision: eventSeq,
				lastEventSeq: eventSeq,
				payload: {
					kind: "delta",
					delta: {
						fromRevision: {
							graphRevision: eventSeq - 1,
							transcriptRevision: eventSeq - 1,
							lastEventSeq: eventSeq - 1,
						},
						toRevision: {
							graphRevision: eventSeq,
							transcriptRevision: eventSeq,
							lastEventSeq: eventSeq,
						},
						activity: {
							kind: "awaiting_model",
							activeOperationCount: 0,
							activeSubagentCount: 0,
							dominantOperationId: null,
							blockingInteractionId: null,
						},
						turnState: "Running",
						activeTurnFailure: null,
						lastTerminalTurnId: "019df8ca-8d77-7fe2-bf77-bc9f542769b4",
					activeStreamingTail: null,
						transcriptOperations: [
							{
								kind: "appendSegment",
								entryId: "msg_016a506b7daddbd30169fa1090eae08191beb8cad59a47f5e4",
								role: "assistant",
								segment: {
									kind: "text",
									segmentId: `msg_016a506b7daddbd30169fa1090eae08191beb8cad59a47f5e4:block:${index}`,
									text: assistantChunks[index] ?? "",
								},
							},
						],
						operationPatches: [],
						interactionPatches: [],
						changedFields: ["transcriptSnapshot", "activity", "turnState", "lastTerminalTurnId"],
					},
				},
			});
		}

		store.applySessionStateEnvelope(sessionId, {
			sessionId,
			graphRevision: 22,
			lastEventSeq: 22,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 21,
						transcriptRevision: 21,
						lastEventSeq: 21,
					},
					toRevision: {
						graphRevision: 22,
						transcriptRevision: 21,
						lastEventSeq: 22,
					},
					activity: createIdleActivity(),
					turnState: "Completed",
					activeTurnFailure: null,
					lastTerminalTurnId: "019df8d0-b087-7721-a9e6-55ac2b04ce58",
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity", "turnState", "lastTerminalTurnId"],
				},
			},
		});

		const scene = materializeStoredScene(store, sessionId);

		expect(scene.status).toBe("done");
		expect(scene.conversation.isStreaming).toBe(false);
		expect(
			scene.conversation.entries
				.filter((entry) => entry.type === "assistant")
				.map((entry) => (entry.type === "assistant" ? entry.markdown : ""))
		).toEqual(["Umbrellas keep you dry when it rains.", "Apples stay crisp."]);
	});

	it("refreshes a stale awaiting-model session so a missed completion event cannot leave the panel stuck", async () => {
		vi.useFakeTimers();
		const store = new SessionStore();
		const sessionId = "session-stale-awaiting";
		addColdSession(store, sessionId);
		const initialGraph = createSessionStateGraph({
			requestedSessionId: sessionId,
			canonicalSessionId: sessionId,
			lifecycle: createGraphLifecycle("ready"),
			turnState: "Completed",
			activity: createIdleActivity(),
			activeTurnFailure: null,
			lastTerminalTurnId: "turn-1",
					activeStreamingTail: null,
			messageCount: 2,
			revision: {
				graphRevision: 12,
				transcriptRevision: 12,
				lastEventSeq: 12,
			},
			transcriptSnapshot: {
				revision: 12,
				entries: [
					{
						entryId: "user-1",
						role: "user",
						segments: [
							{
								kind: "text",
								segmentId: "user-1:block:0",
								text: "first prompt",
							},
						],
					},
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:block:0",
								text: "first answer",
							},
						],
					},
				],
			},
		});
		const recoveredGraph = createSessionStateGraph({
			requestedSessionId: sessionId,
			canonicalSessionId: sessionId,
			lifecycle: createGraphLifecycle("ready"),
			turnState: "Completed",
			activity: createIdleActivity(),
			activeTurnFailure: null,
			lastTerminalTurnId: "turn-2",
					activeStreamingTail: null,
			messageCount: 4,
			revision: {
				graphRevision: 18,
				transcriptRevision: 17,
				lastEventSeq: 18,
			},
			transcriptSnapshot: {
				revision: 17,
				entries: [
					{
						entryId: "user-1",
						role: "user",
						segments: [
							{
								kind: "text",
								segmentId: "user-1:block:0",
								text: "first prompt",
							},
						],
					},
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:block:0",
								text: "first answer",
							},
						],
					},
					{
						entryId: "user-2",
						role: "user",
						segments: [
							{
								kind: "text",
								segmentId: "user-2:block:0",
								text: "second prompt",
							},
						],
					},
					{
						entryId: "assistant-2",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-2:block:0",
								text: "second answer",
							},
						],
					},
				],
			},
		});
		getSessionStateMock.mockReturnValue(okAsync(createSnapshotEnvelope(recoveredGraph)));
		store.applySessionStateEnvelope(sessionId, createSnapshotEnvelope(initialGraph));

		store.applySessionStateEnvelope(sessionId, {
			sessionId,
			graphRevision: 13,
			lastEventSeq: 13,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 12,
						transcriptRevision: 12,
						lastEventSeq: 12,
					},
					toRevision: {
						graphRevision: 13,
						transcriptRevision: 13,
						lastEventSeq: 13,
					},
					activity: {
						kind: "awaiting_model",
						activeOperationCount: 0,
						activeSubagentCount: 0,
						dominantOperationId: null,
						blockingInteractionId: null,
					},
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: "turn-1",
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "user-2",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-2:block:0",
										text: "second prompt",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot", "activity", "turnState", "lastTerminalTurnId"],
				},
			},
		});

		vi.advanceTimersByTime(5_000);
		await Promise.resolve();
		await Promise.resolve();

		expect(getSessionStateMock).toHaveBeenCalledWith(sessionId);
		const scene = materializeStoredScene(store, sessionId);
		expect(scene.conversation.isStreaming).toBe(false);
		expect(
			scene.conversation.entries
				.filter((entry) => entry.type === "assistant")
				.map((entry) => (entry.type === "assistant" ? entry.markdown : ""))
		).toEqual(["first answer", "second answer"]);
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
					activeStreamingTail: null,
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
		expect(sendPromptMock).toHaveBeenCalledWith(
			"session-1",
			[{ type: "text", text: "cursor UI diagnostic ping - reply ok" }],
			expect.any(String)
		);
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
					activeStreamingTail: null,
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
		expect(store.getSessionPendingSendIntent("session-1")).toEqual({
			attemptId: expect.any(String),
			startedAt: expect.any(Number),
			baselineTranscriptRevision: 0,
			promptLength: 36,
			optimisticEntry: {
				id: expect.any(String),
				type: "user",
				message: {
					content: { type: "text", text: "cursor UI diagnostic ping - reply ok" },
					chunks: [{ type: "text", text: "cursor UI diagnostic ping - reply ok" }],
					sentAt: expect.any(Date),
				},
				timestamp: expect.any(Date),
			},
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
					activeStreamingTail: null,
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

		expect(store.getSessionPendingSendIntent("session-1")).toMatchObject({
			attemptId: expect.any(String),
		});
	});

	it("clears pending send intent only when canonical user attemptId matches", async () => {
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
					activeStreamingTail: null,
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

		const result = await store.sendMessage("session-1", "cursor canonical handoff test");
		expect(result.isOk()).toBe(true);

		const pending = store.getSessionPendingSendIntent("session-1");
		expect(pending).not.toBeNull();
		expect(pending).not.toBeUndefined();
		const attemptId = pending?.attemptId;
		expect(typeof attemptId).toBe("string");

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					agentId: "cursor",
					lifecycle: createGraphLifecycle("ready"),
					turnState: "Running",
					messageCount: 1,
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptSnapshot: {
						revision: 1,
						entries: [
							{
								entryId: "user-event-mismatch",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-event-mismatch:block:0",
										text: "different send",
									},
								],
								attemptId: "different-attempt",
							},
						],
					},
					revision: {
						graphRevision: 1,
						transcriptRevision: 1,
						lastEventSeq: 1,
					},
				})
			)
		);

		expect(store.getSessionPendingSendIntent("session-1")).toMatchObject({
			attemptId,
		});

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					agentId: "cursor",
					lifecycle: createGraphLifecycle("ready"),
					turnState: "Running",
					messageCount: 1,
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptSnapshot: {
						revision: 2,
						entries: [
							{
								entryId: "user-event-match",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-event-match:block:0",
										text: "cursor canonical handoff test",
									},
								],
								attemptId,
							},
						],
					},
					revision: {
						graphRevision: 2,
						transcriptRevision: 2,
						lastEventSeq: 2,
					},
				})
			)
		);

		expect(store.getSessionPendingSendIntent("session-1")).toBeNull();
	});

	it("clears pending send intent when the canonical turn completes without a user attempt id", async () => {
		const store = new SessionStore();
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "codex",
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
					agentId: "codex",
					lifecycle: createGraphLifecycle("ready"),
					turnState: "Idle",
					messageCount: 0,
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
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

		const result = await store.sendMessage("session-1", "codex terminal cleanup test");
		expect(result.isOk()).toBe(true);
		expect(store.getSessionPendingSendIntent("session-1")).not.toBeNull();

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					agentId: "codex",
					lifecycle: createGraphLifecycle("ready"),
					turnState: "Completed",
					messageCount: 2,
					activeTurnFailure: null,
					lastTerminalTurnId: "turn-complete-1",
					activeStreamingTail: null,
					transcriptSnapshot: {
						revision: 2,
						entries: [
							{
								entryId: "user-1",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-1:block:0",
										text: "codex terminal cleanup test",
									},
								],
							},
							{
								entryId: "assistant-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-1:block:0",
										text: "Done.",
									},
								],
							},
						],
					},
					revision: {
						graphRevision: 2,
						transcriptRevision: 2,
						lastEventSeq: 2,
					},
				})
			)
		);

		expect(store.getSessionPendingSendIntent("session-1")).toBeNull();
	});

	it("clears stale pending send intent from a completed canonical snapshot that already acknowledged the prompt text", async () => {
		const store = new SessionStore();
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "copilot",
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
					agentId: "copilot",
					lifecycle: createGraphLifecycle("ready"),
					turnState: "Completed",
					messageCount: 2,
					activeTurnFailure: null,
					lastTerminalTurnId: "turn-complete-1",
					activeStreamingTail: null,
					transcriptSnapshot: {
						revision: 10,
						entries: [
							{
								entryId: "user-previous",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-previous:block:0",
										text: "previous prompt",
									},
								],
							},
							{
								entryId: "assistant-previous",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-previous:block:0",
										text: "Previous answer.",
									},
								],
							},
						],
					},
					revision: {
						graphRevision: 10,
						transcriptRevision: 10,
						lastEventSeq: 10,
					},
				})
			)
		);

		const result = await store.sendMessage("session-1", "copilot acknowledged prompt");
		expect(result.isOk()).toBe(true);
		expect(store.getSessionPendingSendIntent("session-1")).not.toBeNull();

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					agentId: "copilot",
					lifecycle: createGraphLifecycle("ready"),
					turnState: "Completed",
					messageCount: 4,
					activeTurnFailure: null,
					lastTerminalTurnId: "turn-complete-1",
					activeStreamingTail: null,
					transcriptSnapshot: {
						revision: 20,
						entries: [
							{
								entryId: "user-previous",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-previous:block:0",
										text: "previous prompt",
									},
								],
							},
							{
								entryId: "assistant-previous",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-previous:block:0",
										text: "Previous answer.",
									},
								],
							},
							{
								entryId: "user-current",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-current:block:0",
										text: "copilot acknowledged prompt",
									},
								],
							},
							{
								entryId: "assistant-current",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-current:block:0",
										text: "Done.",
									},
								],
							},
						],
					},
					revision: {
						graphRevision: 20,
						transcriptRevision: 20,
						lastEventSeq: 20,
					},
				})
			)
		);

		expect(store.getSessionPendingSendIntent("session-1")).toBeNull();
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

	it("keeps restored local created sessions without canonical sendability", () => {
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

		expect(store.getSessionCanSend("session-1")).toBe(null);
	});

	it("selects lifecycle presentation from canonical graph instead of runtime state", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					lifecycle: createGraphLifecycle("ready"),
					turnState: "Idle",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptSnapshot: {
						revision: 7,
						entries: [],
					},
					activity: createIdleActivity(),
				})
			)
		);

		expect(store.getSessionLifecyclePresentation("session-1")).toEqual({
			connectionPhase: "connected",
			contentPhase: "empty",
			activityPhase: "idle",
			canSubmit: true,
			canCancel: false,
			showStop: false,
			showThinking: false,
			showConnectingOverlay: false,
			showConversation: false,
			showReadyPlaceholder: true,
		});
	});

	it("exposes pending send and telemetry as narrow local selectors", async () => {
		const store = new SessionStore();
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "cursor",
			title: "Session",
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
					activeStreamingTail: null,
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

		expect(store.getSessionPendingSendIntent("session-1")).toBeNull();
		expect(store.getSessionHasLocalPendingSendIntent("session-1")).toBe(false);
		expect(store.getSessionUsageTelemetry("session-1")).toBeNull();

		const result = await store.sendMessage("session-1", "cursor UI diagnostic ping - reply ok");

		expect(result.isOk()).toBe(true);
		expect(store.getSessionPendingSendIntent("session-1")).toMatchObject({
			attemptId: expect.any(String),
		});
		expect(store.getSessionHasLocalPendingSendIntent("session-1")).toBe(true);
		expect(store.getSessionLifecyclePresentation("session-1").canSubmit).toBe(false);
	});

	it("fails closed for detached restored sessions until canonical lifecycle is sendable", async () => {
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
					activeStreamingTail: null,
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
					activeStreamingTail: null,
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

		expect(result.isErr()).toBe(true);
		expect(connectSession).not.toHaveBeenCalled();
		expect(sendPromptMock).not.toHaveBeenCalled();
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

		expect(getSessionEntries(store, "session-1")).toHaveLength(1);
		expect(getSessionEntries(store, "session-1")[0]).toMatchObject({
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
