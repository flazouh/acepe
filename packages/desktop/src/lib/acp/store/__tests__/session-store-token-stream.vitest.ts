import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	AssistantTextDeltaPayload,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionStateEnvelope,
	SessionStateGraph,
} from "$lib/services/acp-types.js";
import { SessionStore } from "../session-store.svelte.js";

function createReadyLifecycle(): SessionGraphLifecycle {
	return {
		status: "ready",
		detachedReason: null,
		failureReason: null,
		errorMessage: null,
		actionability: {
			canSend: true,
			canResume: false,
			canRetry: false,
			canArchive: true,
			canConfigure: true,
			recommendedAction: "send",
			recoveryPhase: "none",
			compactStatus: "ready",
		},
	};
}

function createIdleActivity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function createSessionStateGraph(overrides: Partial<SessionStateGraph> = {}): SessionStateGraph {
	return {
		requestedSessionId: overrides.requestedSessionId ?? "session-1",
		canonicalSessionId: overrides.canonicalSessionId ?? "session-1",
		isAlias: overrides.isAlias ?? false,
		agentId: overrides.agentId ?? "codex",
		projectPath: overrides.projectPath ?? "/repo",
		worktreePath: overrides.worktreePath ?? null,
		sourcePath: overrides.sourcePath ?? null,
		revision: overrides.revision ?? {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
		transcriptSnapshot: overrides.transcriptSnapshot ?? {
			revision: 1,
			entries: [],
		},
		operations: overrides.operations ?? [],
		interactions: overrides.interactions ?? [],
		turnState: overrides.turnState ?? "Running",
		messageCount: overrides.messageCount ?? 1,
		lastAgentMessageId: overrides.lastAgentMessageId ?? "assistant-1",
		activeTurnFailure: overrides.activeTurnFailure ?? null,
		lastTerminalTurnId: overrides.lastTerminalTurnId ?? null,
		activeStreamingTail: overrides.activeStreamingTail ?? null,
		lifecycle: overrides.lifecycle ?? createReadyLifecycle(),
		activity: overrides.activity ?? createIdleActivity(),
		capabilities: overrides.capabilities ?? {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
	};
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

function createAssistantTextDeltaEnvelope(
	sessionId: string,
	delta: AssistantTextDeltaPayload
): SessionStateEnvelope {
	return {
		sessionId,
		graphRevision: delta.revision,
		lastEventSeq: delta.revision,
		payload: {
			kind: "assistantTextDelta",
			delta,
		},
	};
}

function addColdSession(store: SessionStore): void {
	store.addSession({
		id: "session-1",
		projectPath: "/repo",
		agentId: "codex",
		title: "Session",
		updatedAt: new Date("2026-05-09T00:00:00.000Z"),
		createdAt: new Date("2026-05-09T00:00:00.000Z"),
		sessionLifecycleState: "persisted",
		parentId: null,
	});
}

function applyAssistantTextDeltaLog(
	store: SessionStore,
	deltas: readonly AssistantTextDeltaPayload[]
): void {
	for (const delta of deltas) {
		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", delta)
		);
	}
}

describe("SessionStore assistantTextDelta canonical projection", () => {
	beforeEach(() => {
		getSessionStateMock.mockReset();
		getSessionStateMock.mockReturnValue(okAsync(createSnapshotEnvelope()));
		sendPromptMock.mockReset();
		sendPromptMock.mockReturnValue(okAsync(undefined));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("builds canonical row token streams and preserves them across graph replacement", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope());
		vi.spyOn(performance, "now").mockReturnValue(500);

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: 0,
				deltaText: "**hello world** after",
				producedAtMonotonicMs: 1_000,
				revision: 2,
			})
		);

		const firstRow = store.getRowTokenStream("session-1", "turn-1", "assistant-1");
		expect(firstRow).not.toBeNull();
		expect(firstRow?.accumulatedText).toBe("**hello world** after");
		expect(firstRow?.wordCount).toBe(2);
		expect(firstRow?.latestWordCount).toBe(2);
		expect(store.getClockAnchor("session-1")).toEqual({
			rustMonotonicMs: 1_000,
			browserAnchorMs: 500,
		});

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: firstRow?.accumulatedText.length ?? 0,
				deltaText: " `pwd`",
				producedAtMonotonicMs: 1_012,
				revision: 3,
			})
		);

		const secondRow = store.getRowTokenStream("session-1", "turn-1", "assistant-1");
		expect(secondRow).not.toBeNull();
		expect(secondRow?.accumulatedText).toBe("**hello world** after `pwd`");
		expect(secondRow?.wordCount).toBe(3);
		expect(secondRow?.latestWordCount).toBe(1);
		expect(secondRow?.firstDeltaProducedAtMonotonicMs).toBe(1_000);
		expect(secondRow?.lastDeltaProducedAtMonotonicMs).toBe(1_012);

		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					revision: {
						graphRevision: 4,
						transcriptRevision: 4,
						lastEventSeq: 4,
					},
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

		expect(store.getRowTokenStream("session-1", "turn-1", "assistant-1")).toEqual(secondRow);
		expect(store.getClockAnchor("session-1")).toEqual({
			rustMonotonicMs: 1_000,
			browserAnchorMs: 500,
		});
	});

	it("treats replayed revisions as idempotent and rejects non-append offsets", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope());
		vi.spyOn(performance, "now").mockReturnValue(700);

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: 0,
				deltaText: "hello",
				producedAtMonotonicMs: 2_000,
				revision: 2,
			})
		);

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: 0,
				deltaText: "hello",
				producedAtMonotonicMs: 2_000,
				revision: 2,
			})
		);

		expect(store.getRowTokenStream("session-1", "turn-1", "assistant-1")).toMatchObject({
			accumulatedText: "hello",
			wordCount: 1,
			latestWordCount: 1,
			revision: 2,
		});

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: 1,
				deltaText: "!",
				producedAtMonotonicMs: 2_100,
				revision: 3,
			})
		);

		expect(store.getRowTokenStream("session-1", "turn-1", "assistant-1")).toMatchObject({
			accumulatedText: "hello",
			wordCount: 1,
			latestWordCount: 1,
			revision: 2,
			lastDeltaProducedAtMonotonicMs: 2_000,
		});
	});

	it("produces identical canonical token streams when the same delta log is replayed", () => {
		const liveStore = new SessionStore();
		const replayStore = new SessionStore();
		const deltas: readonly AssistantTextDeltaPayload[] = [
			{
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: 0,
				deltaText: "one two",
				producedAtMonotonicMs: 3_000,
				revision: 2,
			},
			{
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: "one two".length,
				deltaText: " three `pwd`",
				producedAtMonotonicMs: 3_032,
				revision: 3,
			},
		];

		addColdSession(liveStore);
		addColdSession(replayStore);
		liveStore.applySessionStateEnvelope("session-1", createSnapshotEnvelope());
		replayStore.applySessionStateEnvelope("session-1", createSnapshotEnvelope());
		vi.spyOn(performance, "now").mockReturnValue(900);

		applyAssistantTextDeltaLog(liveStore, deltas);
		applyAssistantTextDeltaLog(replayStore, deltas);

		expect(replayStore.getRowTokenStream("session-1", "turn-1", "assistant-1")).toEqual(
			liveStore.getRowTokenStream("session-1", "turn-1", "assistant-1")
		);
		expect(replayStore.getClockAnchor("session-1")).toEqual(liveStore.getClockAnchor("session-1"));
	});
});
