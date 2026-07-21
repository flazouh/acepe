import { describe, expect, it } from "bun:test";

import type { QueueItemQuestionUiState } from "$lib/acp/components/session-attention/question-ui-state.js";
import type { CompactPermissionDisplay } from "$lib/acp/components/tool-calls/permission-display.js";
import type { PlanApprovalInteraction } from "$lib/acp/types/interaction.js";
import type { PermissionRequest } from "$lib/acp/types/permission.js";
import type { QuestionRequest } from "$lib/acp/types/question.js";
import type { ToolCall } from "$lib/acp/types/tool-call.js";

import {
	buildKanbanPermissionFooter,
	buildKanbanPlanApprovalFooter,
	buildKanbanQuestionFooter,
	resolveKanbanPlanApprovalPrompt,
	resolveKanbanQuestionId,
	resolveKanbanQuestionIndex,
	toKanbanScenePermissionToolKind,
} from "../kanban-footer-model.js";

function makeQuestionRequest(overrides: Partial<QuestionRequest> = {}): QuestionRequest {
	return {
		id: "question-1",
		sessionId: "session-1",
		questions: [
			{
				question: "Pick one",
				header: "Choice",
				options: [{ label: "A", description: "Option A" }],
				multiSelect: false,
			},
			{
				question: "Pick another",
				header: "Second",
				options: [{ label: "B", description: "Option B" }],
				multiSelect: true,
			},
		],
		...overrides,
	};
}

function makePermissionRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
	return {
		id: "permission-1",
		sessionId: "session-1",
		permission: "Run command",
		patterns: [],
		metadata: {},
		always: [],
		...overrides,
	};
}

function makePlanApproval(
	overrides: Partial<PlanApprovalInteraction> = {}
): PlanApprovalInteraction {
	return {
		id: "approval-1",
		kind: "plan_approval",
		source: "create_plan",
		sessionId: "session-1",
		tool: {
			messageID: null,
			callID: "tool-1",
		},
		replyHandler: {
			kind: "unsupported",
		},
		status: "pending",
		...overrides,
	} as PlanApprovalInteraction;
}

function makeToolCall(id: string, question: string): ToolCall {
	return {
		id,
		normalizedQuestions: [{ question }],
	} as ToolCall;
}

function makeQuestionUiState(): QueueItemQuestionUiState {
	return {
		totalQuestions: 2,
		hasMultipleQuestions: true,
		currentQuestion: makeQuestionRequest().questions[1] ?? null,
		currentQuestionAnswered: true,
		questionProgress: [
			{ questionIndex: 0, answered: true },
			{ questionIndex: 1, answered: false },
		],
		currentQuestionOptions: [
			{
				label: "B",
				description: "Option B",
				selected: false,
				color: "#ff00aa",
			},
		],
		isSingleQuestionSingleSelect: false,
		showOtherInput: true,
		hasOtherActive: false,
		otherText: "",
		canSubmit: true,
		showSubmitButton: true,
	};
}

describe("kanban-footer-model", () => {
	it("resolves question identity from tool call when available", () => {
		expect(
			resolveKanbanQuestionId(
				makeQuestionRequest({
					tool: {
						messageID: null,
						callID: "tool-question",
					},
				})
			)
		).toBe("tool-question");
		expect(resolveKanbanQuestionId(makeQuestionRequest())).toBe("question-1");
	});

	it("keeps question index only when it belongs to the current question", () => {
		const pendingQuestion = makeQuestionRequest({
			tool: {
				messageID: null,
				callID: "tool-question",
			},
		});

		expect(
			resolveKanbanQuestionIndex({
				pendingQuestion,
				current: { questionId: "tool-question", currentQuestionIndex: 1 },
			})
		).toBe(1);
		expect(
			resolveKanbanQuestionIndex({
				pendingQuestion,
				current: { questionId: "old-question", currentQuestionIndex: 1 },
			})
		).toBe(0);
		expect(
			resolveKanbanQuestionIndex({
				pendingQuestion,
				current: { questionId: "tool-question", currentQuestionIndex: 8 },
			})
		).toBe(0);
	});

	it("uses current streaming plan prompt before last tool prompt", () => {
		const approval = makePlanApproval();

		expect(
			resolveKanbanPlanApprovalPrompt({
				approval,
				currentStreamingToolCall: makeToolCall("tool-1", "Current prompt"),
				lastToolCall: makeToolCall("tool-1", "Last prompt"),
			})
		).toBe("Current prompt");
		expect(
			resolveKanbanPlanApprovalPrompt({
				approval,
				currentStreamingToolCall: makeToolCall("other", "Other prompt"),
				lastToolCall: makeToolCall("tool-1", "Last prompt"),
			})
		).toBe("Last prompt");
		expect(
			resolveKanbanPlanApprovalPrompt({
				approval: null,
				currentStreamingToolCall: null,
				lastToolCall: null,
			})
		).toBe("Creating plan");
	});

	it("builds permission footer progress and labels", () => {
		const compactDisplay: CompactPermissionDisplay = {
			kind: "execute",
			label: "Run command",
			command: "bun test",
			filePath: null,
		};

		const footer = buildKanbanPermissionFooter({
			permission: makePermissionRequest({ always: ["allow-bun"] }),
			compactDisplay,
			sessionProgress: { total: 3, completed: 2 },
		});

		expect(footer.kind).toBe("permission");
		if (footer.kind !== "permission") {
			throw new Error("expected permission footer");
		}
		expect(footer.toolKind).toBe("execute");
		expect(footer.progress).toEqual({ current: 3, total: 3, label: "Permission 3" });
		expect(footer.allowAlwaysLabel).toBe("Always");
	});

	it("maps only supported permission kinds to scene tool kinds", () => {
		expect(toKanbanScenePermissionToolKind("read")).toBe("read");
		expect(toKanbanScenePermissionToolKind("move")).toBe("other");
		expect(toKanbanScenePermissionToolKind("unknown")).toBe(null);
	});

	it("builds plan and question footers", () => {
		expect(buildKanbanPlanApprovalFooter("Review plan")).toEqual({
			kind: "plan_approval",
			prompt: "Review plan",
			approveLabel: "Build",
			rejectLabel: "Cancel",
		});

		const questionFooter = buildKanbanQuestionFooter({
			questionUiState: makeQuestionUiState(),
			currentQuestionIndex: 1,
			questionId: "question-1",
		});

		expect(questionFooter?.kind).toBe("question");
		if (questionFooter?.kind !== "question") {
			throw new Error("expected question footer");
		}
		expect(questionFooter.currentQuestionIndex).toBe(1);
		expect(questionFooter.questionId).toBe("question-1");
		expect(questionFooter.submitLabel).toBe("Submit");
	});
});
