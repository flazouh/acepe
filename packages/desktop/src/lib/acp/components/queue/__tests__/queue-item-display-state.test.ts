import { describe, expect, it } from "bun:test";
import type { PlanApprovalInteraction } from "$lib/acp/types/interaction.js";
import type { ToolCall } from "$lib/acp/types/tool-call.js";

import {
	getQueueItemStatusText,
	getQueueItemTodoProgress,
	getQueuePlanApprovalPrompt,
	getQueuePlanApprovalToolCall,
	shouldShowQueueItemShimmer,
} from "../queue-item-display-state.js";

function createTaskToolCall(id = "task-parent"): ToolCall {
	return {
		id,
		name: "Task",
		kind: "task",
		arguments: { kind: "think", description: "Parent task" },
		status: "in_progress",
		taskChildren: [],
		awaitingPlanApproval: false,
	};
}

function createReadToolCall(id: string): ToolCall {
	return {
		id,
		name: "Read",
		kind: "read",
		arguments: {
			kind: "read",
			file_path: `/repo/${id}.ts`,
		},
		status: "completed",
		awaitingPlanApproval: false,
	};
}

function createPlanApproval(toolCallId: string): PlanApprovalInteraction {
	return {
		id: "approval-1",
		kind: "plan_approval",
		source: "create_plan",
		sessionId: "session-1",
		tool: {
			messageID: null,
			callID: toolCallId,
		},
		replyHandler: {
			kind: "http",
			requestId: "approval-1",
		},
		status: "pending",
	};
}

describe("queue item display state", () => {
	it("hides status text for pending questions and plan approvals", () => {
		expect(
			getQueueItemStatusText({
				hasPendingQuestion: true,
				hasPendingPlanApproval: false,
				isThinking: true,
				pendingText: "Waiting",
				hasError: true,
				urgencyDetail: "Failed",
			})
		).toBeNull();
		expect(
			getQueueItemStatusText({
				hasPendingQuestion: false,
				hasPendingPlanApproval: true,
				isThinking: true,
				pendingText: "Waiting",
				hasError: true,
				urgencyDetail: "Failed",
			})
		).toBeNull();
	});

	it("uses thinking, pending text, error detail, then no status", () => {
		expect(
			getQueueItemStatusText({
				hasPendingQuestion: false,
				hasPendingPlanApproval: false,
				isThinking: true,
				pendingText: "Waiting",
				hasError: true,
				urgencyDetail: "Failed",
			})
		).toBe("Thinking");
		expect(
			getQueueItemStatusText({
				hasPendingQuestion: false,
				hasPendingPlanApproval: false,
				isThinking: false,
				pendingText: "Waiting",
				hasError: true,
				urgencyDetail: "Failed",
			})
		).toBe("Waiting");
		expect(
			getQueueItemStatusText({
				hasPendingQuestion: false,
				hasPendingPlanApproval: false,
				isThinking: false,
				pendingText: null,
				hasError: true,
				urgencyDetail: "Failed",
			})
		).toBe("Failed");
		expect(
			getQueueItemStatusText({
				hasPendingQuestion: false,
				hasPendingPlanApproval: false,
				isThinking: false,
				pendingText: null,
				hasError: true,
				urgencyDetail: null,
			})
		).toBeNull();
	});

	it("only shimmers while thinking without a blocking interaction", () => {
		expect(
			shouldShowQueueItemShimmer({
				isThinking: true,
				hasPendingQuestion: false,
				hasPendingPlanApproval: false,
			})
		).toBe(true);
		expect(
			shouldShowQueueItemShimmer({
				isThinking: true,
				hasPendingQuestion: true,
				hasPendingPlanApproval: false,
			})
		).toBe(false);
	});

	it("maps todo progress into the shared activity entry shape", () => {
		expect(
			getQueueItemTodoProgress({
				current: 1,
				total: 3,
				label: "Build UI",
			})
		).toEqual({
			current: 1,
			total: 3,
			label: "Build UI",
		});
		expect(getQueueItemTodoProgress(null)).toBeNull();
	});

	it("finds the approval tool from effective, streaming, then last tool calls", () => {
		const approval = createPlanApproval("plan-tool");
		const planTool = createTaskToolCall("plan-tool");
		const otherTool = createReadToolCall("other-tool");

		expect(
			getQueuePlanApprovalToolCall({
				pendingPlanApproval: approval,
				effectiveToolCall: planTool,
				currentStreamingToolCall: otherTool,
				lastToolCall: otherTool,
			})
		).toBe(planTool);
		expect(
			getQueuePlanApprovalToolCall({
				pendingPlanApproval: approval,
				effectiveToolCall: otherTool,
				currentStreamingToolCall: planTool,
				lastToolCall: otherTool,
			})
		).toBe(planTool);
		expect(
			getQueuePlanApprovalToolCall({
				pendingPlanApproval: approval,
				effectiveToolCall: otherTool,
				currentStreamingToolCall: otherTool,
				lastToolCall: planTool,
			})
		).toBe(planTool);
	});

	it("uses the approval question or a fallback prompt", () => {
		expect(
			getQueuePlanApprovalPrompt({
				...createTaskToolCall(),
				normalizedQuestions: [
					{
						question: "Review plan?",
						header: "Plan",
						options: [],
						multiSelect: false,
					},
				],
			})
		).toBe("Review plan?");
		expect(getQueuePlanApprovalPrompt(null)).toBe("Creating plan");
	});
});
