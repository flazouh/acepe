import { describe, expect, it } from "bun:test";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { SessionGraphActivity, SessionStateGraph } from "$lib/services/acp-types.js";
import type { AgentPanelCanonicalSource } from "../../../../session-state/agent-panel-canonical-source.js";
import { deriveAgentPanelWaiting } from "../agent-panel-waiting.js";

function activity(kind: SessionGraphActivity["kind"]): SessionGraphActivity {
	return {
		kind,
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

// A SessionStateGraph is assignable to AgentPanelCanonicalSource (a Pick of it);
// only `.activity` is read by deriveAgentPanelWaiting, but the full shape keeps
// the test honest against the real type.
function graph(activityKind: SessionGraphActivity["kind"]): AgentPanelCanonicalSource {
	const full: SessionStateGraph = {
		requestedSessionId: "s1",
		canonicalSessionId: "s1",
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: { graphRevision: 1, transcriptRevision: 1, lastEventSeq: 1 },
		transcriptSnapshot: { revision: 1, entries: [] },
		operations: [],
		interactions: [],
		turnState: "Running",
		messageCount: 0,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		activeStreamingTail: null,
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
		activity: activity(activityKind),
		capabilities: {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
	};
	return full;
}

const assistant = (id: string, streaming: boolean): AgentPanelSceneEntryModel => ({
	id,
	type: "assistant",
	markdown: "answer",
	isStreaming: streaming,
});

describe("deriveAgentPanelWaiting", () => {
	it("shows the preparing label pre-session when an optimistic entry exists", () => {
		const waiting = deriveAgentPanelWaiting({
			graph: null,
			sceneEntries: [{ id: "u1", type: "user", text: "Prompt", isOptimistic: true }],
			pendingSendIntent: false,
			agentName: "Claude Opus 4.7",
		});
		expect(waiting.show).toBe(true);
		expect(waiting.label).toBe("Connecting to Claude Opus 4.7...");
	});

	it("hides waiting pre-session when there is nothing pending", () => {
		const waiting = deriveAgentPanelWaiting({
			graph: null,
			sceneEntries: [],
			pendingSendIntent: false,
			agentName: null,
		});
		expect(waiting).toEqual({ show: false, label: null });
	});

	it("shows the planning placeholder while awaiting the model with no live tail", () => {
		const waiting = deriveAgentPanelWaiting({
			graph: graph("awaiting_model"),
			sceneEntries: [{ id: "u1", type: "user", text: "Prompt" }],
			pendingSendIntent: false,
			agentName: null,
		});
		expect(waiting).toEqual({ show: true, label: "Planning next moves..." });
	});

	it("hides the placeholder once an assistant tail is streaming", () => {
		const waiting = deriveAgentPanelWaiting({
			graph: graph("awaiting_model"),
			sceneEntries: [assistant("a1", true)],
			pendingSendIntent: false,
			agentName: null,
		});
		expect(waiting).toEqual({ show: false, label: null });
	});

	it("hides waiting when the turn is idle/complete", () => {
		const waiting = deriveAgentPanelWaiting({
			graph: graph("idle"),
			sceneEntries: [assistant("a1", false)],
			pendingSendIntent: false,
			agentName: null,
		});
		expect(waiting).toEqual({ show: false, label: null });
	});

	it("shows waiting whenever a send is in flight, regardless of activity", () => {
		const waiting = deriveAgentPanelWaiting({
			graph: graph("idle"),
			sceneEntries: [assistant("a1", false)],
			pendingSendIntent: true,
			agentName: null,
		});
		expect(waiting.show).toBe(true);
		expect(waiting.label).toBe("Planning next moves...");
	});
});
