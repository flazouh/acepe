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
	AssistantTextDeltaPayload,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionStateEnvelope,
	SessionStateGraph,
} from "$lib/services/acp-types.js";
import { SessionStore } from "../session-store.svelte.js";
import { countAppendedMarkdownWords } from "../transcript-delta.js";

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

function createTranscriptAppendDeltaEnvelope(input: {
	readonly graphRevision: number;
	readonly fromTranscriptRevision: number;
	readonly toTranscriptRevision: number;
	readonly lastEventSeq: number;
	readonly entryId: string;
	readonly role: "user" | "assistant";
	readonly text: string;
	readonly turnState?: SessionStateGraph["turnState"];
	readonly activity?: SessionGraphActivity;
	readonly activeStreamingTail?: SessionStateGraph["activeStreamingTail"];
}): SessionStateEnvelope {
	return {
		sessionId: "session-1",
		graphRevision: input.graphRevision,
		lastEventSeq: input.lastEventSeq,
		payload: {
			kind: "delta",
			delta: {
				fromRevision: {
					graphRevision: input.graphRevision - 1,
					transcriptRevision: input.fromTranscriptRevision,
					lastEventSeq: input.lastEventSeq - 1,
				},
				toRevision: {
					graphRevision: input.graphRevision,
					transcriptRevision: input.toTranscriptRevision,
					lastEventSeq: input.lastEventSeq,
				},
				activity: input.activity ?? createIdleActivity(),
				turnState: input.turnState ?? "Running",
				activeTurnFailure: null,
				lastTerminalTurnId: null,
				activeStreamingTail: input.activeStreamingTail ?? null,
				transcriptOperations: [
					{
						kind: "appendEntry",
						entry: {
							entryId: input.entryId,
							role: input.role,
							segments: [
								{
									kind: "text",
									segmentId: `${input.entryId}:block:0`,
									text: input.text,
								},
							],
						},
					},
				],
				operationPatches: [],
				interactionPatches: [],
				changedFields: ["transcriptSnapshot", "activity", "turnState", "activeStreamingTail"],
			},
		},
	};
}

function addColdSession(store: SessionStore): void {
	store.write.addSession({
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

function applyEnvelopeJournal(
	store: SessionStore,
	envelopes: readonly SessionStateEnvelope[]
): void {
	for (const envelope of envelopes) {
		store.applySessionStateEnvelope("session-1", envelope);
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

	it("counts appended markdown words from the changed tail only", () => {
		expect(
			countAppendedMarkdownWords({
				previousText: "The quick brown",
				previousWordCount: 3,
				deltaText: " fox",
			})
		).toEqual({
			wordCount: 4,
			latestWordCount: 1,
		});
		expect(
			countAppendedMarkdownWords({
				previousText: "The quick hel",
				previousWordCount: 3,
				deltaText: "lo world",
			})
		).toEqual({
			wordCount: 4,
			latestWordCount: 2,
		});
		expect(
			countAppendedMarkdownWords({
				previousText: "**hello world** after",
				previousWordCount: 2,
				deltaText: " `pwd`",
			})
		).toEqual({
			wordCount: 3,
			latestWordCount: 1,
		});
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

		const firstRow = store.read.getRowTokenStream("session-1", "turn-1", "assistant-1");
		expect(firstRow).not.toBeNull();
		expect(store.read.getRowTokenStreamByRowId("session-1", "assistant-1")).toEqual(firstRow);
		expect(firstRow?.accumulatedText).toBe("**hello world** after");
		expect(firstRow?.wordCount).toBe(2);
		expect(firstRow?.latestWordCount).toBe(2);
		expect(store.read.getClockAnchor("session-1")).toEqual({
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

		const secondRow = store.read.getRowTokenStream("session-1", "turn-1", "assistant-1");
		expect(secondRow).not.toBeNull();
		expect(store.read.getRowTokenStreamByRowId("session-1", "assistant-1")).toEqual(secondRow);
		expect(store.read.getRowTokenStreamByRowId("session-1", "missing-row")).toBeNull();
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

		expect(store.read.getRowTokenStream("session-1", "turn-1", "assistant-1")).toEqual(secondRow);
		expect(store.read.getClockAnchor("session-1")).toEqual({
			rustMonotonicMs: 1_000,
			browserAnchorMs: 500,
		});
	});

	it("reads canonical active streaming tail through a narrow selector", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					activeStreamingTail: {
						rowId: "assistant-1",
						contentKind: "message",
					},
				})
			)
		);

		expect(store.read.getActiveStreamingTailRowId("session-1")).toBe("assistant-1");
		expect(store.read.getActiveStreamingTailRowId("missing-session")).toBeNull();
	});

	it("accepts split assistant text deltas that share the same source revision", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope());

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: 0,
				deltaText: "first ",
				producedAtMonotonicMs: 1_000,
				revision: 2,
			})
		);
		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: "first ".length,
				deltaText: "second",
				producedAtMonotonicMs: 1_000,
				revision: 2,
			})
		);

		expect(store.read.getRowTokenStream("session-1", "turn-1", "assistant-1")).toMatchObject({
			accumulatedText: "first second",
			revision: 2,
		});
	});

	it("selects token streams by row id without depending on stream insertion order", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope());

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-old",
				charOffset: 0,
				deltaText: "old row",
				producedAtMonotonicMs: 1_000,
				revision: 2,
			})
		);
		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-2",
				rowId: "assistant-active",
				charOffset: 0,
				deltaText: "active row",
				producedAtMonotonicMs: 1_016,
				revision: 3,
			})
		);

		expect(store.read.getRowTokenStreamByRowId("session-1", "assistant-active")).toMatchObject({
			turnId: "turn-2",
			rowId: "assistant-active",
			accumulatedText: "active row",
		});
		expect(store.read.getRowTokenStreamByRowId("session-1", "assistant-old")).toMatchObject({
			turnId: "turn-1",
			rowId: "assistant-old",
			accumulatedText: "old row",
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

		expect(store.read.getRowTokenStream("session-1", "turn-1", "assistant-1")).toMatchObject({
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

		expect(store.read.getRowTokenStream("session-1", "turn-1", "assistant-1")).toMatchObject({
			accumulatedText: "hello",
			wordCount: 1,
			latestWordCount: 1,
			revision: 2,
			lastDeltaProducedAtMonotonicMs: 2_000,
		});
	});

	it("rejects assistant text deltas that are older than the canonical graph frontier", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					revision: {
						graphRevision: 10,
						transcriptRevision: 10,
						lastEventSeq: 10,
					},
					transcriptSnapshot: {
						revision: 10,
						entries: [
							{
								entryId: "assistant-current",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-current:block:0",
										text: "current",
									},
								],
							},
						],
					},
				})
			)
		);

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-stale",
				rowId: "assistant-stale",
				charOffset: 0,
				deltaText: "stale",
				producedAtMonotonicMs: 1_000,
				revision: 9,
			})
		);

		expect(store.read.getRowTokenStream("session-1", "turn-stale", "assistant-stale")).toBeNull();
		expect(store.read.getSessionGraphRevision("session-1")).toEqual({
			graphRevision: 10,
			transcriptRevision: 10,
			lastEventSeq: 10,
		});
	});

	it("rejects late assistant text deltas for an existing row after the graph frontier advances", () => {
		const store = new SessionStore();
		addColdSession(store);
		store.applySessionStateEnvelope("session-1", createSnapshotEnvelope());

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: 0,
				deltaText: "hello",
				producedAtMonotonicMs: 1_000,
				revision: 2,
			})
		);
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					revision: {
						graphRevision: 10,
						transcriptRevision: 10,
						lastEventSeq: 10,
					},
					transcriptSnapshot: {
						revision: 10,
						entries: [],
					},
				})
			)
		);

		store.applySessionStateEnvelope(
			"session-1",
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: "hello".length,
				deltaText: " stale",
				producedAtMonotonicMs: 1_100,
				revision: 3,
			})
		);

		expect(store.read.getRowTokenStream("session-1", "turn-1", "assistant-1")).toMatchObject({
			accumulatedText: "hello",
			revision: 2,
		});
		expect(store.read.getSessionGraphRevision("session-1")).toEqual({
			graphRevision: 10,
			transcriptRevision: 10,
			lastEventSeq: 10,
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

		expect(replayStore.read.getRowTokenStream("session-1", "turn-1", "assistant-1")).toEqual(
			liveStore.read.getRowTokenStream("session-1", "turn-1", "assistant-1")
		);
		expect(replayStore.read.getClockAnchor("session-1")).toEqual(liveStore.read.getClockAnchor("session-1"));
	});

	it("replays the same small envelope journal into the same graph and token projection", () => {
		const liveStore = new SessionStore();
		const replayStore = new SessionStore();
		const snapshot = createSnapshotEnvelope(
			createSessionStateGraph({
				revision: {
					graphRevision: 1,
					transcriptRevision: 1,
					lastEventSeq: 1,
				},
				transcriptSnapshot: {
					revision: 1,
					entries: [
						{
							entryId: "user-1",
							role: "user",
							segments: [
								{
									kind: "text",
									segmentId: "user-1:block:0",
									text: "Prompt",
								},
							],
						},
					],
				},
				activeStreamingTail: null,
				turnState: "Running",
			})
		);
		const assistantEntryDelta = createTranscriptAppendDeltaEnvelope({
			graphRevision: 2,
			fromTranscriptRevision: 1,
			toTranscriptRevision: 2,
			lastEventSeq: 2,
			entryId: "assistant-1",
			role: "assistant",
			text: "",
			activeStreamingTail: { rowId: "assistant-1", contentKind: "message" },
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
		});
		const tokenDeltas = [
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: 0,
				deltaText: "hello",
				producedAtMonotonicMs: 4_000,
				revision: 3,
			}),
			createAssistantTextDeltaEnvelope("session-1", {
				turnId: "turn-1",
				rowId: "assistant-1",
				charOffset: "hello".length,
				deltaText: " world",
				producedAtMonotonicMs: 4_016,
				revision: 4,
			}),
		];
		const journal = [snapshot, assistantEntryDelta, ...tokenDeltas];

		addColdSession(liveStore);
		addColdSession(replayStore);
		vi.spyOn(performance, "now").mockReturnValue(1_200);
		// Pin Date.now so activity timing (kindStartedAtMs) is deterministic across
		// the two replays — otherwise the two journal applications land microseconds
		// apart and diverge on wall-clock-seeded activity timestamps.
		vi.spyOn(Date, "now").mockReturnValue(1_782_000_000_000);

		applyEnvelopeJournal(liveStore, journal);
		applyEnvelopeJournal(replayStore, journal);

		expect(replayStore.getSessionStateGraphForTest("session-1")).toEqual(
			liveStore.getSessionStateGraphForTest("session-1")
		);
		expect(replayStore.read.getActiveStreamingTailRowId("session-1")).toBe("assistant-1");
		expect(replayStore.read.getRowTokenStream("session-1", "turn-1", "assistant-1")).toEqual(
			liveStore.read.getRowTokenStream("session-1", "turn-1", "assistant-1")
		);
		expect(replayStore.read.getClockAnchor("session-1")).toEqual(liveStore.read.getClockAnchor("session-1"));
	});
});

// Bug repro: assistant-text-delta application drops valid deltas whenever the
// three revision counters diverge — which is the NORMAL case (graph_revision and
// last_event_seq advance on lifecycle/activity/turn events, transcript_revision
// only on message changes). The existing helper masks this by forcing all three
// equal. With realistic divergence the canonical token stream + clock anchor never
// populate, so buildTokenRevealCss returns undefined and token-reveal is dormant
// for the whole turn (the live "block-by-block" symptom).
describe("SessionStore assistantTextDelta revision gate (bug #1 repro)", () => {
	beforeEach(() => {
		getSessionStateMock.mockReset();
		getSessionStateMock.mockReturnValue(okAsync(createSnapshotEnvelope()));
		sendPromptMock.mockReset();
		sendPromptMock.mockReturnValue(okAsync(undefined));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("populates the token stream for a valid streaming delta even when graph/transcript/event revisions diverge", () => {
		const store = new SessionStore();
		addColdSession(store);
		// Realistic canonical frontier: graph_revision (5) and last_event_seq (8) are
		// ahead of transcript_revision (2) after ready/activity/turn events.
		store.applySessionStateEnvelope(
			"session-1",
			createSnapshotEnvelope(
				createSessionStateGraph({
					revision: { graphRevision: 5, transcriptRevision: 2, lastEventSeq: 8 },
					transcriptSnapshot: { revision: 2, entries: [] },
					turnState: "Running",
				})
			)
		);
		vi.spyOn(performance, "now").mockReturnValue(500);

		// Rust shape: envelope.graphRevision = graph_revision, envelope.lastEventSeq =
		// last_event_seq, delta.revision = transcript_revision (a contiguous +1 append).
		store.applySessionStateEnvelope("session-1", {
			sessionId: "session-1",
			graphRevision: 6,
			lastEventSeq: 9,
			payload: {
				kind: "assistantTextDelta",
				delta: {
					turnId: "turn-1",
					rowId: "assistant-1",
					charOffset: 0,
					deltaText: "Hello world",
					producedAtMonotonicMs: 1_000,
					revision: 3,
				},
			},
		});

		// Desired: a valid contiguous streaming delta activates token-reveal.
		expect(store.read.getRowTokenStream("session-1", "turn-1", "assistant-1")).not.toBeNull();
		expect(store.read.getClockAnchor("session-1")).not.toBeNull();
	});
});
