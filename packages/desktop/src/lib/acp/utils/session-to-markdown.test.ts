import { describe, expect, it } from "bun:test";
import type {
	OperationSnapshot,
	SessionGraphActionability,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateGraph,
	TranscriptEntry,
} from "../../services/acp-types.js";
import { sessionGraphToMarkdown } from "./session-to-markdown.js";

function actionability(): SessionGraphActionability {
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

function lifecycle(): SessionGraphLifecycle {
	return {
		status: "ready",
		actionability: actionability(),
	};
}

function activity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function capabilities(): SessionGraphCapabilities {
	return {
		models: null,
		modes: null,
		availableCommands: [],
		configOptions: [],
		autonomousEnabled: false,
	};
}

function textEntry(entryId: string, role: TranscriptEntry["role"], text: string): TranscriptEntry {
	return {
		entryId,
		role,
		segments: [
			{
				kind: "text",
				segmentId: `${entryId}:segment:1`,
				text,
			},
		],
		attemptId: null,
		timestampMs: null,
	};
}

function readOperation(): OperationSnapshot {
	return {
		id: "operation-1",
		session_id: "session-1",
		tool_call_id: "tool-call-1",
		name: "Read",
		kind: "read",
		provider_status: "completed",
		title: "Read file",
		arguments: {
			kind: "read",
			file_path: "/repo/src/app.ts",
			source_context: null,
		},
		progressive_arguments: null,
		result: null,
		command: null,
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_provenance_key: null,
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
			entry_id: "tool-entry-1",
		},
		degradation_reason: null,
	};
}

function graph(): SessionStateGraph {
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: 4,
			transcriptRevision: 4,
			lastEventSeq: 4,
		},
		transcriptSnapshot: {
			revision: 4,
			entries: [
				textEntry("user-1", "user", "Please inspect the app."),
				textEntry("assistant-1", "assistant", "I will read the entry point."),
				textEntry("tool-entry-1", "tool", "Read"),
				textEntry("assistant-2", "assistant", "The entry point is small."),
			],
		},
		operations: [readOperation()],
		interactions: [],
		turnState: "Completed",
		messageCount: 4,
		lastAgentMessageId: "assistant-2",
		activeTurnFailure: null,
		lastTerminalTurnId: "turn-1",
		lifecycle: lifecycle(),
		activity: activity(),
		capabilities: capabilities(),
	};
}

describe("sessionGraphToMarkdown", () => {
	it("exports canonical transcript order with operation-backed tool details", () => {
		expect(sessionGraphToMarkdown(graph())).toBe(
			[
				"## User\n",
				"Please inspect the app.",
				"\n",
				"## Assistant\n",
				"I will read the entry point.",
				"\n",
				"## Tool: Read file\n",
				"/repo/src/app.ts",
				"\n",
				"## Assistant\n",
				"The entry point is small.",
			].join("")
		);
	});
});
