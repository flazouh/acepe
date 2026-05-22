import type { AgentToolKind, KanbanSceneFooterData } from "@acepe/ui";

import type { QueueItemQuestionUiState } from "$lib/acp/components/queue/queue-item-question-ui-state.js";
import type { CompactPermissionDisplay } from "$lib/acp/components/tool-calls/permission-display.js";
import type { PlanApprovalInteraction } from "$lib/acp/types/interaction.js";
import type { PermissionRequest } from "$lib/acp/types/permission.js";
import type { QuestionRequest } from "$lib/acp/types/question.js";
import type { ToolCall } from "$lib/acp/types/tool-call.js";

export interface KanbanQuestionIndexState {
	readonly questionId: string;
	readonly currentQuestionIndex: number;
}

export function resolveKanbanQuestionId(question: QuestionRequest): string {
	const callId = question.tool?.callID;
	return callId ? callId : question.id ? question.id : "";
}

export function resolveKanbanQuestionIndex(input: {
	readonly pendingQuestion: QuestionRequest | null;
	readonly current: KanbanQuestionIndexState | null | undefined;
}): number {
	const pendingQuestion = input.pendingQuestion;
	if (pendingQuestion === null) {
		return 0;
	}

	const questionId = resolveKanbanQuestionId(pendingQuestion);
	const current = input.current;
	if (!current || current.questionId !== questionId) {
		return 0;
	}

	const maxQuestionIndex = pendingQuestion.questions.length - 1;
	if (current.currentQuestionIndex < 0 || current.currentQuestionIndex > maxQuestionIndex) {
		return 0;
	}

	return current.currentQuestionIndex;
}

export function resolveKanbanPlanApprovalPrompt(input: {
	readonly approval: PlanApprovalInteraction | null;
	readonly currentStreamingToolCall: ToolCall | null;
	readonly lastToolCall: ToolCall | null;
}): string {
	const approval = input.approval;
	if (!approval) {
		return "Creating plan";
	}

	const currentTool =
		input.currentStreamingToolCall?.id === approval.tool.callID
			? input.currentStreamingToolCall
			: null;
	if (currentTool?.normalizedQuestions?.[0]?.question) {
		return currentTool.normalizedQuestions[0].question;
	}

	const lastTool = input.lastToolCall?.id === approval.tool.callID ? input.lastToolCall : null;
	return lastTool?.normalizedQuestions?.[0]?.question ?? "Creating plan";
}

export function toKanbanScenePermissionToolKind(kind: string): AgentToolKind | null {
	switch (kind) {
		case "read":
		case "edit":
		case "delete":
		case "execute":
		case "search":
		case "fetch":
		case "web_search":
			return kind;
		case "move":
		case "other":
			return "other";
		default:
			return null;
	}
}

export function buildKanbanPermissionFooter(input: {
	readonly permission: PermissionRequest;
	readonly compactDisplay: CompactPermissionDisplay;
	readonly sessionProgress: { total: number; completed: number } | null;
}): KanbanSceneFooterData {
	const sessionProgress = input.sessionProgress;
	const progress = sessionProgress
		? {
				current:
					sessionProgress.completed + 1 <= sessionProgress.total
						? sessionProgress.completed + 1
						: sessionProgress.total,
				total: sessionProgress.total,
				label: `Permission ${sessionProgress.total}`,
			}
		: null;

	return {
		kind: "permission",
		label: input.compactDisplay.label,
		command: input.compactDisplay.command,
		filePath: input.compactDisplay.filePath,
		toolKind: toKanbanScenePermissionToolKind(input.compactDisplay.kind),
		progress,
		allowAlwaysLabel:
			input.permission.always && input.permission.always.length > 0 ? "Always" : undefined,
		approveLabel: "Allow",
		rejectLabel: "Deny",
	};
}

export function buildKanbanPlanApprovalFooter(prompt: string): KanbanSceneFooterData {
	return {
		kind: "plan_approval",
		prompt,
		approveLabel: "Build",
		rejectLabel: "Cancel",
	};
}

export function buildKanbanQuestionFooter(input: {
	readonly questionUiState: QueueItemQuestionUiState | null;
	readonly currentQuestionIndex: number;
	readonly questionId: string;
}): KanbanSceneFooterData | null {
	const questionUiState = input.questionUiState;
	if (!questionUiState?.currentQuestion) {
		return null;
	}

	return {
		kind: "question",
		currentQuestion: questionUiState.currentQuestion,
		totalQuestions: questionUiState.totalQuestions,
		hasMultipleQuestions: questionUiState.hasMultipleQuestions,
		currentQuestionIndex: input.currentQuestionIndex,
		questionId: input.questionId,
		questionProgress: questionUiState.questionProgress,
		currentQuestionAnswered: questionUiState.currentQuestionAnswered,
		currentQuestionOptions: questionUiState.currentQuestionOptions,
		otherText: questionUiState.otherText,
		otherPlaceholder: "Type your answer...",
		showOtherInput: questionUiState.showOtherInput,
		showSubmitButton: questionUiState.showSubmitButton,
		canSubmit: questionUiState.canSubmit,
		submitLabel: "Submit",
	};
}
