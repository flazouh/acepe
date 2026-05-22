import type { PlanCardStatus } from "../plan-card/types.js";
import type {
	AgentPanelConversationEntry,
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentToolEditDiffEntry,
	AgentToolFileSelectEvent,
	AgentToolStatus,
} from "./types.js";

export type AgentToolEntry = Extract<AgentPanelConversationEntry, { type: "tool_call" }>;

export type AgentToolEditPresentation = {
	readonly diffs: readonly AgentToolEditDiffEntry[];
	readonly filePath: string | null;
	readonly isStreaming: boolean;
	readonly applied: boolean;
	readonly awaitingApproval: boolean;
};

export type AgentToolReadLintsPresentation = {
	readonly totalDiagnostics: number;
	readonly totalFiles: number;
	readonly summaryLabel: string;
};

export type QuestionOtherTextByEntry = Readonly<Record<string, Readonly<Record<number, string>>>>;

export type AgentConversationRenderKind =
	| "user"
	| "assistant"
	| "thinking"
	| "missing"
	| "tool-todo"
	| "tool-question"
	| "tool-read-lints"
	| "tool-read"
	| "tool-edit"
	| "tool-execute"
	| "tool-search"
	| "tool-fetch"
	| "tool-web-search"
	| "tool-other"
	| "tool-browser"
	| "tool-skill"
	| "tool-task"
	| "tool-plan"
	| "tool-error-result"
	| "tool-row";

export function isToolCallEntry(entry: AgentPanelConversationEntry): entry is AgentToolEntry {
	return entry.type === "tool_call";
}

export function resolveConversationRenderKind(
	entry: AgentPanelConversationEntry
): AgentConversationRenderKind {
	if (entry.type !== "tool_call") {
		return entry.type;
	}

	if (entry.todos !== undefined && entry.todos.length > 0) {
		return "tool-todo";
	}
	if (entry.question) {
		return "tool-question";
	}
	if (entry.kind === "read_lints" || entry.lintDiagnostics !== undefined) {
		return "tool-read-lints";
	}
	if (entry.kind === "read") {
		return "tool-read";
	}
	if (entry.kind === "edit") {
		return "tool-edit";
	}
	if (entry.kind === "execute") {
		return "tool-execute";
	}
	if (entry.kind === "search") {
		return "tool-search";
	}
	if (entry.kind === "fetch") {
		return "tool-fetch";
	}
	if (entry.kind === "web_search") {
		return "tool-web-search";
	}
	if (entry.kind === "other") {
		return "tool-other";
	}
	if (entry.kind === "browser") {
		return "tool-browser";
	}
	if (entry.kind === "skill") {
		return "tool-skill";
	}
	if (entry.kind === "task" || entry.kind === "task_output") {
		return "tool-task";
	}
	if (entry.kind === "exit_plan_mode" || entry.kind === "create_plan") {
		return "tool-plan";
	}
	if (entry.status === "error" && entry.resultText) {
		return "tool-error-result";
	}
	return "tool-row";
}

export function countLintFiles(
	diagnostics: AgentToolEntry["lintDiagnostics"] | undefined
): number {
	if (diagnostics === undefined || diagnostics.length === 0) {
		return 0;
	}

	return new Set(diagnostics.map((diagnostic) => diagnostic.filePath ?? "unknown")).size;
}

export function resolvePlanCardStatus(input: {
	readonly status: AgentToolStatus;
	readonly planStatus?: PlanCardStatus;
}): PlanCardStatus {
	if (input.planStatus !== undefined) {
		return input.planStatus;
	}
	if (input.status === "error" || input.status === "cancelled") {
		return "rejected";
	}
	if (input.status === "done") {
		return "approved";
	}
	return "streaming";
}

export function createPlanActionEvent(toolEntry: AgentToolEntry): AgentPanelPlanActionEvent {
	return {
		entryId: toolEntry.id,
		toolCallId: toolEntry.toolCallId,
		interactionId: toolEntry.interactionId,
	};
}

export function createPlanViewEvent(toolEntry: AgentToolEntry): AgentPanelPlanViewEvent {
	return {
		entryId: toolEntry.id,
		toolCallId: toolEntry.toolCallId,
		interactionId: toolEntry.interactionId,
		title: toolEntry.planTitle ?? toolEntry.title,
		content: toolEntry.planContent ?? "",
	};
}

export function resolvePlanActionsDisabled(input: {
	readonly toolEntry: AgentToolEntry;
	readonly isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
}): boolean {
	if (input.isPlanActionAvailable === undefined) {
		return false;
	}

	return !input.isPlanActionAvailable(createPlanActionEvent(input.toolEntry));
}

export function createToolFileSelectEvent(
	toolEntry: AgentToolEntry
): AgentToolFileSelectEvent | null {
	if (!toolEntry.filePath) {
		return null;
	}

	return {
		entryId: toolEntry.id,
		toolCallId: toolEntry.toolCallId,
		filePath: toolEntry.filePath,
	};
}

export function createEditToolPresentation(
	toolEntry: AgentToolEntry
): AgentToolEditPresentation {
	return {
		diffs: toolEntry.editDiffs ?? [],
		filePath: toolEntry.filePath ?? null,
		isStreaming: toolEntry.status === "pending" || toolEntry.status === "running",
		applied: toolEntry.status === "done",
		awaitingApproval: toolEntry.presentationState === "pending_operation",
	};
}

export function createReadLintsPresentation(
	toolEntry: AgentToolEntry
): AgentToolReadLintsPresentation {
	const totalDiagnostics = toolEntry.lintDiagnostics?.length ?? 0;
	const totalFiles = countLintFiles(toolEntry.lintDiagnostics);
	return {
		totalDiagnostics,
		totalFiles,
		summaryLabel: `${totalDiagnostics} issues in ${totalFiles} files`,
	};
}

export function getQuestionOtherText(
	state: QuestionOtherTextByEntry,
	entryId: string
): Readonly<Record<number, string>> {
	return state[entryId] ?? {};
}

export function updateQuestionOtherText(input: {
	readonly state: QuestionOtherTextByEntry;
	readonly entryId: string;
	readonly questionIndex: number;
	readonly text: string;
}): QuestionOtherTextByEntry {
	const previousEntryState = input.state[input.entryId] ?? {};
	return {
		...input.state,
		[input.entryId]: {
			...previousEntryState,
			[input.questionIndex]: input.text,
		},
	};
}

export function createQuestionOtherSubmitEvent(input: {
	readonly state: QuestionOtherTextByEntry;
	readonly toolEntry: AgentToolEntry;
	readonly questionIndex: number;
	readonly key: string;
	readonly multiSelect?: boolean;
}): AgentPanelQuestionSelectEvent | null {
	if (input.key !== "Enter") {
		return null;
	}

	const label = input.state[input.toolEntry.id]?.[input.questionIndex]?.trim() ?? "";
	if (label.length === 0) {
		return null;
	}

	return {
		entryId: input.toolEntry.id,
		interactionId: input.toolEntry.interactionId,
		questionIndex: input.questionIndex,
		label,
		multiSelect: input.multiSelect,
	};
}
