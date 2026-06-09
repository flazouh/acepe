import { describe, expect, it } from "bun:test";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type {
	OperationSnapshot,
	SessionGraphActionability,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateGraph,
	TranscriptEntry,
	TranscriptSnapshot,
} from "$lib/services/acp-types.js";
import { materializeAgentPanelSceneFromGraph } from "../../../../session-state/agent-panel-graph-materializer.js";
import {
	createGraphSceneEntryIndex,
	findGraphSceneEntryForDisplayEntry,
} from "../graph-scene-entry-match.js";
import { buildRevealScenePatchedEntries } from "./reveal-scene-patch-test-helper.js";
import {
	buildVirtualizedDisplayEntriesFromScene,
	getVirtualizedDisplayEntryKey,
	isMergedAssistantDisplayEntry,
} from "../virtualized-entry-display.js";

function createActionability(): SessionGraphActionability {
	return {
		canSend: true,
		canResume: false,
		canRetry: false,
		canArchive: true,
		canConfigure: true,
		recommendedAction: "send",
		recoveryPhase: "none",
		compactStatus: "ready",
	};
}

function createLifecycle(): SessionGraphLifecycle {
	return {
		status: "ready",
		detachedReason: null,
		failureReason: null,
		errorMessage: null,
		actionability: createActionability(),
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

function createCapabilities(): SessionGraphCapabilities {
	return {
		models: null,
		modes: null,
		availableCommands: [],
		configOptions: [],
		autonomousEnabled: false,
	};
}

function textTranscriptEntry(
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
				segmentId: `${entryId}:text:1`,
				text,
			},
		],
		attemptId: null,
		timestampMs: null,
	};
}

function assistantThoughtAndTextEntry(entryId: string): TranscriptEntry {
	return {
		entryId,
		role: "assistant",
		segments: [
			{
				kind: "thought",
				segmentId: `${entryId}:thought:1`,
				text: "checking the test target",
			},
			{
				kind: "text",
				segmentId: `${entryId}:text:1`,
				text: "I will run the focused checks.",
			},
		],
		attemptId: null,
		timestampMs: null,
	};
}

function createTranscriptSnapshot(entries: readonly TranscriptEntry[]): TranscriptSnapshot {
	return {
		revision: 31,
		entries: Array.from(entries),
	};
}

function createExecuteOperation(): OperationSnapshot {
	return {
		id: "op:session-1:tool-run",
		session_id: "session-1",
		tool_call_id: "tool-run",
		name: "bash",
		kind: "execute",
		provider_status: "completed",
		title: "Run focused checks",
		arguments: {
			kind: "execute",
			command: "bun test src/lib/acp/session-state",
		},
		progressive_arguments: null,
		result: {
			stdout: "1 pass",
			stderr: null,
			exitCode: 0,
		},
		command: "bun test src/lib/acp/session-state",
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_provenance_key: "tool-run",
		operation_state: "completed",
		locations: null,
		skill_meta: null,
		normalized_questions: null,
		question_answer: null,
		awaiting_plan_approval: false,
		plan_approval_request_id: null,
		started_at_ms: null,
		completed_at_ms: null,
		source_link: {
			kind: "transcript_linked",
			entry_id: "tool-run",
		},
		degradation_reason: null,
	};
}

function createGraph(): SessionStateGraph {
	const transcriptSnapshot = createTranscriptSnapshot([
		textTranscriptEntry("user-1", "user", "Please verify the panel flow."),
		assistantThoughtAndTextEntry("assistant-plan"),
		textTranscriptEntry("tool-run", "tool", "Run focused checks"),
		textTranscriptEntry("assistant-final", "assistant", "Focused checks passed."),
	]);

	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: 32,
			transcriptRevision: transcriptSnapshot.revision,
			lastEventSeq: 32,
		},
		transcriptSnapshot,
		operations: [createExecuteOperation()],
		interactions: [],
		turnState: "Completed",
		messageCount: transcriptSnapshot.entries.length,
		activeStreamingTail: null,
		activeTurnFailure: null,
		lastTerminalTurnId: "turn-1",
		lifecycle: createLifecycle(),
		activity: createIdleActivity(),
		capabilities: createCapabilities(),
	};
}

function expectToolEntry(
	entry: AgentPanelSceneEntryModel | undefined
): Extract<AgentPanelSceneEntryModel, { type: "tool_call" }> {
	expect(entry?.type).toBe("tool_call");
	if (entry?.type !== "tool_call") {
		throw new Error("Expected tool call scene entry");
	}
	return entry;
}

describe("canonical graph to agent panel display flow", () => {
	it("keeps canonical transcript order and resolved tool data through scene and virtualized display rows", () => {
		const graph = createGraph();
		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Canonical flow",
			},
		});
		const displayedSceneEntries = buildRevealScenePatchedEntries(
			scene.conversation.entries,
			new Map()
		);
		const virtualizedEntries = buildVirtualizedDisplayEntriesFromScene(displayedSceneEntries);

		expect(displayedSceneEntries.map((entry) => entry.id)).toEqual([
			"user-1",
			"assistant-plan",
			"tool-run",
			"assistant-final",
		]);
		expect(virtualizedEntries.map((entry) => getVirtualizedDisplayEntryKey(entry))).toEqual([
			"user-1",
			"assistant-plan",
			"tool-run",
			"assistant-final",
		]);

		const assistantPlan = virtualizedEntries[1];
		expect(isMergedAssistantDisplayEntry(assistantPlan)).toBe(true);
		if (!isMergedAssistantDisplayEntry(assistantPlan)) {
			throw new Error("Expected merged assistant display row");
		}
		expect(assistantPlan.markdown).toBe("I will run the focused checks.");
		expect(assistantPlan.message.chunks).toEqual([
			{
				type: "thought",
				block: {
					type: "text",
					text: "checking the test target",
				},
			},
			{
				type: "message",
				block: {
					type: "text",
					text: "I will run the focused checks.",
				},
			},
		]);

		const toolSceneEntry = expectToolEntry(displayedSceneEntries[2]);
		expect(toolSceneEntry).toMatchObject({
			id: "tool-run",
			toolCallId: "tool-run",
			operationId: "op:session-1:tool-run",
			kind: "execute",
			title: "Run focused checks",
			command: "bun test src/lib/acp/session-state",
			stdout: "1 pass",
			status: "done",
			presentationState: "resolved",
		});
		expect(
			findGraphSceneEntryForDisplayEntry(
				virtualizedEntries[2],
				createGraphSceneEntryIndex(displayedSceneEntries)
			)
		).toBe(toolSceneEntry);
	});
});
