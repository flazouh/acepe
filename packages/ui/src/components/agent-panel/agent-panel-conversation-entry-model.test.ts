import { describe, expect, it } from "bun:test";

import {
	countLintFiles,
	createEditToolPresentation,
	createPlanActionEvent,
	createPlanViewEvent,
	createQuestionOtherSubmitEvent,
	createReadLintsPresentation,
	createToolFileSelectEvent,
	getQuestionOtherText,
	resolveConversationRenderKind,
	resolvePlanActionsDisabled,
	resolvePlanCardStatus,
	updateQuestionOtherText,
	type AgentToolEntry,
} from "./agent-panel-conversation-entry-model.js";

function toolEntry(overrides: Partial<AgentToolEntry> = {}): AgentToolEntry {
	return {
		id: "entry-1",
		type: "tool_call",
		kind: "other",
		title: "Tool",
		status: "running",
		...overrides,
	};
}

describe("agent panel conversation entry model", () => {
	it("selects render kinds for top-level entry types", () => {
		expect(resolveConversationRenderKind({ id: "user-1", type: "user", text: "Hi" })).toBe(
			"user"
		);
		expect(
			resolveConversationRenderKind({
				id: "assistant-1",
				type: "assistant",
				markdown: "Done",
			})
		).toBe("assistant");
		expect(resolveConversationRenderKind({ id: "thinking-1", type: "thinking" })).toBe(
			"thinking"
		);
		expect(resolveConversationRenderKind({ id: "missing-1", type: "missing" })).toBe(
			"missing"
		);
	});

	it("selects specialized tool render kinds in priority order", () => {
		expect(
			resolveConversationRenderKind(
				toolEntry({
					kind: "read",
					todos: [{ content: "Todo", status: "pending" }],
				})
			)
		).toBe("tool-todo");
		expect(resolveConversationRenderKind(toolEntry({ question: {} as never }))).toBe(
			"tool-question"
		);
		expect(
			resolveConversationRenderKind(
				toolEntry({
					kind: "read",
					lintDiagnostics: [],
				})
			)
		).toBe("tool-read-lints");
		expect(resolveConversationRenderKind(toolEntry({ kind: "read" }))).toBe("tool-read");
		expect(resolveConversationRenderKind(toolEntry({ kind: "edit" }))).toBe("tool-edit");
		expect(resolveConversationRenderKind(toolEntry({ kind: "execute" }))).toBe(
			"tool-execute"
		);
		expect(resolveConversationRenderKind(toolEntry({ kind: "search" }))).toBe("tool-search");
		expect(resolveConversationRenderKind(toolEntry({ kind: "fetch" }))).toBe("tool-fetch");
		expect(resolveConversationRenderKind(toolEntry({ kind: "web_search" }))).toBe(
			"tool-web-search"
		);
		expect(resolveConversationRenderKind(toolEntry({ kind: "browser" }))).toBe("tool-browser");
		expect(resolveConversationRenderKind(toolEntry({ kind: "skill" }))).toBe("tool-skill");
		expect(resolveConversationRenderKind(toolEntry({ kind: "task_output" }))).toBe(
			"tool-task"
		);
		expect(resolveConversationRenderKind(toolEntry({ kind: "create_plan" }))).toBe(
			"tool-plan"
		);
	});

	it("falls back to error result before the generic tool row", () => {
		expect(
			resolveConversationRenderKind(
				toolEntry({
					kind: "other",
					status: "error",
					resultText: "Please run /login · API Error: 401 Invalid authentication credentials",
				})
			)
		).toBe("tool-error-result");
		expect(
			resolveConversationRenderKind(
				toolEntry({
					kind: "unclassified",
					status: "error",
					resultText: "Command failed",
				})
			)
		).toBe("tool-error-result");
		expect(resolveConversationRenderKind(toolEntry({ kind: "unclassified" }))).toBe(
			"tool-row"
		);
	});

	it("counts unique lint files, including unknown diagnostics", () => {
		expect(
			countLintFiles([
				{ filePath: "src/app.ts", message: "A", severity: "error" },
				{ filePath: "src/app.ts", message: "B", severity: "warning" },
				{ filePath: null, message: "C", severity: "error" },
			])
		).toBe(2);
	});

	it("builds read-lints presentation labels from diagnostics", () => {
		expect(
			createReadLintsPresentation(
				toolEntry({
					lintDiagnostics: [
						{ filePath: "src/app.ts", message: "A", severity: "error" },
						{ filePath: "src/app.ts", message: "B", severity: "warning" },
						{ filePath: "src/lib.ts", message: "C", severity: "error" },
					],
				})
			)
		).toEqual({
			totalDiagnostics: 3,
			totalFiles: 2,
			summaryLabel: "3 issues in 2 files",
		});
	});

	it("maps plan status from explicit plan state or tool state", () => {
		expect(resolvePlanCardStatus({ status: "running", planStatus: "interactive" })).toBe(
			"interactive"
		);
		expect(resolvePlanCardStatus({ status: "done" })).toBe("approved");
		expect(resolvePlanCardStatus({ status: "cancelled" })).toBe("rejected");
		expect(resolvePlanCardStatus({ status: "running" })).toBe("streaming");
	});

	it("builds plan action and full-view events", () => {
		const entry = toolEntry({
			toolCallId: "tool-1",
			interactionId: "interaction-1",
			planTitle: "Local plan",
			planContent: "# Plan",
		});

		expect(createPlanActionEvent(entry)).toEqual({
			entryId: "entry-1",
			toolCallId: "tool-1",
			interactionId: "interaction-1",
		});
		expect(createPlanViewEvent(entry)).toEqual({
			entryId: "entry-1",
			toolCallId: "tool-1",
			interactionId: "interaction-1",
			title: "Local plan",
			content: "# Plan",
		});
	});

	it("disables plan actions only when the callback says the action is unavailable", () => {
		const entry = toolEntry({ toolCallId: "tool-1" });

		expect(resolvePlanActionsDisabled({ toolEntry: entry })).toBe(false);
		expect(
			resolvePlanActionsDisabled({
				toolEntry: entry,
				isPlanActionAvailable: () => false,
			})
		).toBe(true);
	});

	it("builds file select events only when a file path exists", () => {
		expect(createToolFileSelectEvent(toolEntry())).toBeNull();
		expect(createToolFileSelectEvent(toolEntry({ filePath: "src/app.ts" }))).toEqual({
			entryId: "entry-1",
			toolCallId: undefined,
			filePath: "src/app.ts",
		});
	});

	it("builds edit tool presentation props without copying diff arrays", () => {
		const diffs = [{ filePath: "src/app.ts", additions: 1, deletions: 0 }];
		const presentation = createEditToolPresentation(
			toolEntry({
				kind: "edit",
				status: "done",
				filePath: "src/app.ts",
				editDiffs: diffs,
				presentationState: "pending_operation",
			})
		);

		expect(presentation.diffs).toBe(diffs);
		expect(presentation).toEqual({
			diffs,
			filePath: "src/app.ts",
			isStreaming: false,
			applied: true,
			awaitingApproval: true,
		});
	});

	it("stores question Other text without mutating the old state", () => {
		const initialState = {
			"entry-1": {
				0: "First answer",
			},
		};

		const nextState = updateQuestionOtherText({
			state: initialState,
			entryId: "entry-1",
			questionIndex: 1,
			text: "Second answer",
		});

		expect(nextState).toEqual({
			"entry-1": {
				0: "First answer",
				1: "Second answer",
			},
		});
		expect(initialState).toEqual({
			"entry-1": {
				0: "First answer",
			},
		});
		expect(getQuestionOtherText(nextState, "missing-entry")).toEqual({});
	});

	it("creates a question submit event only for non-empty Enter submissions", () => {
		const state = updateQuestionOtherText({
			state: {},
			entryId: "entry-1",
			questionIndex: 0,
			text: "  Custom answer  ",
		});
		const entry = toolEntry({ interactionId: "interaction-1" });

		expect(
			createQuestionOtherSubmitEvent({
				state,
				toolEntry: entry,
				questionIndex: 0,
				key: "Tab",
			})
		).toBeNull();
		expect(
			createQuestionOtherSubmitEvent({
				state: updateQuestionOtherText({
					state: {},
					entryId: "entry-1",
					questionIndex: 0,
					text: "   ",
				}),
				toolEntry: entry,
				questionIndex: 0,
				key: "Enter",
			})
		).toBeNull();
		expect(
			createQuestionOtherSubmitEvent({
				state,
				toolEntry: entry,
				questionIndex: 0,
				key: "Enter",
				multiSelect: true,
			})
		).toEqual({
			entryId: "entry-1",
			interactionId: "interaction-1",
			questionIndex: 0,
			label: "Custom answer",
			multiSelect: true,
		});
	});
});
