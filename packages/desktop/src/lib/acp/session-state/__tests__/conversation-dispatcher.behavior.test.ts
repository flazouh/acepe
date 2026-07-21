import { describe, expect, it } from "bun:test";
import type {
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionStateGraph,
	TranscriptEntry,
	TranscriptSnapshot,
} from "../../../services/acp-types.js";
import type {
	CachedConversationInput,
	CachedConversationState,
} from "../conversation-cache-types.js";
import { materializeCachedConversation } from "../conversation-dispatcher.js";

function createActionability() {
	return {
		canSend: true,
		canResume: false,
		canRetry: false,
		canArchive: true,
		canConfigure: true,
		recommendedAction: "send" as const,
		recoveryPhase: "none" as const,
		compactStatus: "ready" as const,
	};
}

function createLifecycle(overrides: Partial<SessionGraphLifecycle> = {}): SessionGraphLifecycle {
	return {
		status: "ready",
		actionability: createActionability(),
		...overrides,
	};
}

function createActivity(overrides: Partial<SessionGraphActivity> = {}): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
		...overrides,
	};
}

function createTranscriptEntry(
	entryId: string,
	role: TranscriptEntry["role"],
	text: string
): TranscriptEntry {
	return {
		entryId,
		role,
		segments: [
			{
				kind: "text",
				segmentId: `${entryId}:segment-1`,
				text,
			},
		],
	};
}

function createTranscriptSnapshot(entries: TranscriptEntry[]): TranscriptSnapshot {
	return {
		revision: 7,
		entries,
	};
}

function createGraph(input: {
	transcriptSnapshot: TranscriptSnapshot;
	lifecycle?: SessionGraphLifecycle;
	activity?: SessionGraphActivity;
}): SessionStateGraph {
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: 9,
			transcriptRevision: input.transcriptSnapshot.revision,
			lastEventSeq: 42,
		},
		transcriptSnapshot: input.transcriptSnapshot,
		operations: [],
		interactions: [],
		turnState: "Completed",
		messageCount: input.transcriptSnapshot.entries.length,
		activeStreamingTail: null,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		lifecycle: input.lifecycle ?? createLifecycle(),
		activity: input.activity ?? createActivity(),
		capabilities: {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
	};
}

function cachedInput(graph: SessionStateGraph): CachedConversationInput {
	return { graph };
}

describe("conversation dispatcher behavior", () => {
	it("reuses the cached conversation when canonical slices are unchanged", () => {
		const transcriptSnapshot = createTranscriptSnapshot([
			createTranscriptEntry("user-1", "user", "hello"),
			createTranscriptEntry("assistant-1", "assistant", "hi"),
		]);
		const graph = createGraph({ transcriptSnapshot });
		const previous = materializeCachedConversation(null, cachedInput(graph));

		const nextGraph = {
			...graph,
			revision: {
				graphRevision: 10,
				transcriptRevision: graph.revision.transcriptRevision,
				lastEventSeq: 43,
			},
			lifecycle: createLifecycle({ status: "reconnecting" }),
		};
		const next = materializeCachedConversation(previous, cachedInput(nextGraph));

		expect(next).toBe(previous);
	});

	it("updates activity without rebuilding conversation entries", () => {
		const transcriptSnapshot = createTranscriptSnapshot([
			createTranscriptEntry("user-1", "user", "hello"),
			createTranscriptEntry("assistant-1", "assistant", "working"),
		]);
		const graph = createGraph({ transcriptSnapshot });
		const previous = materializeCachedConversation(null, cachedInput(graph));

		const nextGraph = {
			...graph,
			activity: createActivity({ kind: "running_operation" }),
		};
		const next = materializeCachedConversation(previous, cachedInput(nextGraph));

		expect(next).not.toBe(previous);
		expect(next.activity).toEqual(nextGraph.activity);
		expect((next as CachedConversationState).conversation.entries).toBe(
			(previous as CachedConversationState).conversation.entries
		);
	});

	it("full rebuilds when transcript entries change", () => {
		const transcriptSnapshot = createTranscriptSnapshot([
			createTranscriptEntry("user-1", "user", "hello"),
		]);
		const graph = createGraph({ transcriptSnapshot });
		const previous = materializeCachedConversation(null, cachedInput(graph));

		const nextTranscriptSnapshot = createTranscriptSnapshot([
			createTranscriptEntry("user-1", "user", "hello"),
			createTranscriptEntry("assistant-1", "assistant", "hi"),
		]);
		const nextGraph = {
			...graph,
			transcriptSnapshot: nextTranscriptSnapshot,
			messageCount: nextTranscriptSnapshot.entries.length,
		};
		const next = materializeCachedConversation(previous, cachedInput(nextGraph));

		expect(next.conversation.entries).not.toBe(previous.conversation.entries);
		expect(next.transcriptEntries).toBe(nextGraph.transcriptSnapshot.entries);
	});
});
