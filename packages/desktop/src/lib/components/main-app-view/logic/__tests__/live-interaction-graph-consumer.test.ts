import { describe, expect, it, vi } from "vitest";
import { InteractionStore } from "$lib/acp/store/interaction-store.svelte.js";
import type {
	InteractionSnapshot,
	SessionGraphActionability,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateGraph,
} from "$lib/services/acp-types.js";
import {
	createLiveInteractionGraphConsumer,
	createSessionOpenInteractionGraphConsumer,
} from "../live-interaction-graph-consumer.js";

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
		detachedReason: null,
		failureReason: null,
		errorMessage: null,
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

function graph(interactions: InteractionSnapshot[]): SessionStateGraph {
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "codex",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
		transcriptSnapshot: {
			revision: 1,
			entries: [],
		},
		operations: [],
		interactions,
		turnState: "Completed",
		messageCount: 0,
		activeStreamingTail: null,
		activeTurnFailure: null,
		lastTerminalTurnId: "turn-1",
		lifecycle: lifecycle(),
		activity: activity(),
		capabilities: capabilities(),
	};
}

function questionInteraction(id: string): InteractionSnapshot {
	return {
		id,
		session_id: "session-1",
		kind: "Question",
		state: "Pending",
		json_rpc_request_id: 22,
		reply_handler: null,
		tool_reference: null,
		responded_at_event_seq: null,
		response: null,
		payload: {
			Question: {
				id,
				sessionId: "session-1",
				jsonRpcRequestId: 22,
				replyHandler: null,
				questions: [
					{
						question: "Continue?",
						header: "Decision",
						options: [
							{
								label: "Yes",
								description: "Continue.",
							},
						],
						multiSelect: false,
					},
				],
				tool: null,
			},
		},
		canonical_operation_id: null,
	};
}

function permissionInteraction(id: string): InteractionSnapshot {
	return {
		id,
		session_id: "session-1",
		kind: "Permission",
		state: "Pending",
		json_rpc_request_id: 33,
		reply_handler: null,
		tool_reference: null,
		responded_at_event_seq: null,
		response: null,
		payload: {
			Permission: {
				id,
				sessionId: "session-1",
				jsonRpcRequestId: 33,
				replyHandler: null,
				permission: "Run command",
				patterns: ["bun test"],
				metadata: null,
				always: [],
				autoAccepted: false,
				tool: null,
			},
		},
		canonical_operation_id: null,
	};
}

describe("createLiveInteractionGraphConsumer", () => {
	it("notifies only newly pending interactions after graph replacement", () => {
		const interactionStore = new InteractionStore();
		const existingQuestion = questionInteraction("question-1");
		const newQuestion = questionInteraction("question-2");
		interactionStore.replaceSessionStateGraph(graph([existingQuestion]));
		const showQuestionNotification = vi.fn();
		const consumer = createLiveInteractionGraphConsumer({
			interactionStore,
			showPermissionNotification: vi.fn(),
			showQuestionNotification,
			showPlanApprovalNotification: vi.fn(),
		});

		consumer.replaceSessionStateGraph(graph([existingQuestion, newQuestion]));

		expect(showQuestionNotification).toHaveBeenCalledTimes(1);
		expect(showQuestionNotification).toHaveBeenCalledWith(
			interactionStore.questionsPending.get("question-2")
		);
	});

	it("notifies newly pending interactions from patches", () => {
		const interactionStore = new InteractionStore();
		const permission = permissionInteraction("permission-1");
		const showPermissionNotification = vi.fn();
		const consumer = createLiveInteractionGraphConsumer({
			interactionStore,
			showPermissionNotification,
			showQuestionNotification: vi.fn(),
			showPlanApprovalNotification: vi.fn(),
		});

		consumer.applySessionInteractionPatches([permission]);

		expect(showPermissionNotification).toHaveBeenCalledTimes(1);
		expect(showPermissionNotification).toHaveBeenCalledWith(
			interactionStore.permissionsPending.get("permission-1")
		);
	});

	it("updates interaction state for session-open hydration without notifications", () => {
		const interactionStore = new InteractionStore();
		const question = questionInteraction("question-1");
		const consumer = createSessionOpenInteractionGraphConsumer({ interactionStore });

		consumer.replaceSessionStateGraph(graph([question]));

		expect(interactionStore.questionsPending.has("question-1")).toBe(true);
	});
});
