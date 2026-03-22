import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../acp/application/dto/session-entry.js";
import type { QuestionRequest } from "../../acp/types/question.js";
import type { ToolCallData } from "../../acp/types/tool-call.js";

import { getQuestionToolCallBackfill } from "./question-tool-sync.js";

function createQuestionRequest(toolCallId: string): QuestionRequest {
	return {
		id: `${toolCallId}-question`,
		sessionId: "session-1",
		jsonRpcRequestId: 42,
		questions: [
			{
				question: "Approve this plan before continuing?",
				header: "Plan Approval",
				options: [
					{
						label: "Approve",
						description: "Continue with this plan",
					},
					{
						label: "Reject",
						description: "Stop and ask for a revised plan",
					},
				],
				multiSelect: false,
			},
		],
		tool: {
			messageID: "",
			callID: toolCallId,
		},
	};
}

function createToolCallEntry(message: ToolCallData): SessionEntry {
	return {
		id: message.id,
		type: "tool_call",
		message,
		timestamp: new Date("2026-03-12T00:00:00.000Z"),
		isStreaming: true,
	};
}

describe("getQuestionToolCallBackfill", () => {
	it("creates a pending question tool call when no matching entry exists", () => {
		const entries: SessionEntry[] = [];
		const question: QuestionRequest = {
			...createQuestionRequest("tool-question-1"),
			questions: [
				{
					question: "Which option should I use?",
					header: "Choose one",
					options: [
						{
							label: "A",
							description: "First option",
						},
					],
					multiSelect: false,
				},
			],
		};

		expect(getQuestionToolCallBackfill(question, entries)).toEqual({
			id: "tool-question-1",
			name: "AskUserQuestion",
			arguments: {
				kind: "other",
				raw: {
					questions: question.questions,
				},
			},
			status: "pending",
			kind: "question",
			title: "Choose one",
			normalizedQuestions: question.questions,
			awaitingPlanApproval: false,
		});
	});

	it("does not backfill over an existing create_plan tool call", () => {
		const question = createQuestionRequest("tool-create-plan-1");
		const entries: SessionEntry[] = [
			createToolCallEntry({
				id: "tool-create-plan-1",
				name: "CreatePlan",
				arguments: { kind: "planMode" },
				status: "pending",
				kind: "create_plan",
				title: "Create Plan",
				awaitingPlanApproval: false,
			}),
		];

		expect(getQuestionToolCallBackfill(question, entries)).toBeNull();
	});

	it("does not backfill over an existing exit_plan_mode tool call", () => {
		const question = createQuestionRequest("tool-exit-plan-1");
		const entries: SessionEntry[] = [
			createToolCallEntry({
				id: "tool-exit-plan-1",
				name: "ExitPlanMode",
				arguments: { kind: "planMode", mode: "default" },
				status: "pending",
				kind: "exit_plan_mode",
				title: "Plan",
				awaitingPlanApproval: false,
			}),
		];

		expect(getQuestionToolCallBackfill(question, entries)).toBeNull();
	});
});
