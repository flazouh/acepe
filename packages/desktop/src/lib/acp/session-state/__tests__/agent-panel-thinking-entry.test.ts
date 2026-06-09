// The agent-panel "Planning next moves..." indicator is a `thinking` scene
// entry rendered by the shared AgentPanelConversationEntry. Canonical truth for
// "the agent is working but not yet producing output" is activity.kind ===
// "awaiting_model" (Rust selector: turn running, no active work). This projects
// that canonical state into a synthetic thinking display entry at the tail.
//
// GOD: pure canonical -> display projection. Synthetic Acepe-owned id, read-only
// activity, no canonical write, no reordering of real entries — the same
// transient-affordance pattern as the optimistic-user-entry append.

import { describe, expect, it } from "bun:test";

import type {
	SessionGraphActivity,
	SessionStateGraph,
	TranscriptEntry,
} from "$lib/services/acp-types.js";
import { materializeAgentPanelSceneFromGraph } from "../agent-panel-graph-materializer.js";

function activity(kind: SessionGraphActivity["kind"]): SessionGraphActivity {
	return {
		kind,
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function entry(id: string, role: TranscriptEntry["role"], text: string): TranscriptEntry {
	return { entryId: id, role, segments: [{ kind: "text", segmentId: `${id}-s1`, text }], attemptId: null };
}

function graph(input: {
	activityKind: SessionGraphActivity["kind"];
	turnState: SessionStateGraph["turnState"];
	streaming?: boolean;
}): SessionStateGraph {
	const entries: TranscriptEntry[] = [entry("user-1", "user", "Prompt")];
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: { graphRevision: 1, transcriptRevision: 1, lastEventSeq: 1 },
		transcriptSnapshot: { revision: 1, entries },
		operations: [],
		interactions: [],
		turnState: input.turnState,
		messageCount: entries.length,
		activeTurnFailure: null,
		lastTerminalTurnId: input.turnState === "Completed" ? "turn-1" : null,
		activeStreamingTail: input.streaming === true ? { rowId: "assistant-1", contentKind: "message" } : null,
		lifecycle: {
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
		},
		activity: activity(input.activityKind),
		capabilities: { models: null, modes: null, availableCommands: [], configOptions: [], autonomousEnabled: false },
	};
}

function scene(g: SessionStateGraph) {
	return materializeAgentPanelSceneFromGraph({ panelId: "panel-1", graph: g, header: { title: "Session" } });
}

describe("agent-panel thinking entry (awaiting-model projection)", () => {
	it("appends a thinking entry while the agent is awaiting the model", () => {
		const entries = scene(graph({ activityKind: "awaiting_model", turnState: "Running" })).conversation.entries;
		const last = entries[entries.length - 1];
		expect(last?.type).toBe("thinking");
	});

	it("does not append a thinking entry when idle / completed", () => {
		const entries = scene(graph({ activityKind: "idle", turnState: "Completed" })).conversation.entries;
		expect(entries.some((e) => e.type === "thinking")).toBe(false);
	});

	it("does not append a thinking entry while a tool operation is running", () => {
		const entries = scene(graph({ activityKind: "running_operation", turnState: "Running" })).conversation.entries;
		expect(entries.some((e) => e.type === "thinking")).toBe(false);
	});

	it("does not append a thinking entry once the assistant is streaming (active tail)", () => {
		// Even if activity is still awaiting_model, a live streaming tail means the
		// agent is producing output — the indicator must not show.
		const entries = scene(
			graph({ activityKind: "awaiting_model", turnState: "Running", streaming: true })
		).conversation.entries;
		expect(entries.some((e) => e.type === "thinking")).toBe(false);
	});

	it("gives the thinking entry a stable synthetic id (no remount across awaiting revisions)", () => {
		const a = scene(graph({ activityKind: "awaiting_model", turnState: "Running" })).conversation.entries;
		const b = scene(graph({ activityKind: "awaiting_model", turnState: "Running" })).conversation.entries;
		const idA = a.find((e) => e.type === "thinking")?.id;
		const idB = b.find((e) => e.type === "thinking")?.id;
		expect(idA).toBeDefined();
		expect(idA).toBe(idB);
	});
});
