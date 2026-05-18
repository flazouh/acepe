import { describe, expect, it } from "bun:test";

import type { PermissionRequest } from "../../../types/permission.js";
import type { ToolCall } from "../../../types/tool-call.js";
import { buildQueueExitPlanCard } from "../queue-exit-plan-card.js";

function makeToolCall(plan: string): ToolCall {
	return {
		id: "toolu_exit_plan",
		name: "ExitPlanMode",
		arguments: {
			kind: "planMode",
			plan,
			plan_file_path: "/Users/alex/.claude/plans/focused-plan.md",
		},
		rawInput: null,
		status: "in_progress",
		kind: "exit_plan_mode",
		awaitingPlanApproval: false,
	};
}

function makePermission(plan: string): PermissionRequest {
	return {
		id: "permission-exit-plan",
		sessionId: "session-1",
		jsonRpcRequestId: 1,
		permission: "ExitPlanMode",
		patterns: [],
		metadata: {
			diagnosticRawInput: {
				plan: "# Raw Plan\n\nThis should not be used.",
				planFilePath: "/Users/alex/.claude/plans/focused-plan.md",
			},
			parsedArguments: {
				kind: "planMode",
				mode: "default",
				plan,
				plan_file_path: "/Users/alex/.claude/plans/focused-plan.md",
			},
			options: [],
		},
		always: [],
		tool: {
			messageID: "message-1",
			callID: "toolu_exit_plan",
		},
	};
}

describe("buildQueueExitPlanCard", () => {
	it("keeps the plan content available for the queue ExitPlanMode card", () => {
		const plan = "# Focused Plan\n\nRender the actual plan body in the queue card.";

		const card = buildQueueExitPlanCard(makeToolCall(plan), makePermission(plan));

		expect(card).toEqual({
			title: "Focused Plan",
			content: plan,
		});
	});

	it("can build the card from permission metadata before the tool call is available", () => {
		const plan = "# Permission Plan\n\nUse the permission payload as the fallback.";

		const card = buildQueueExitPlanCard(null, makePermission(plan));

		expect(card?.title).toBe("Permission Plan");
		expect(card?.content).toBe(plan);
	});

	it("can build the card from canonical plan-mode arguments when rawInput is absent", () => {
		const plan = "# Restored Operation Plan\n\nUse canonical plan fields from the graph operation.";
		const toolCall = makeToolCall(plan);
		toolCall.rawInput = null;
		toolCall.arguments = {
			kind: "planMode",
			plan,
			plan_file_path: "/Users/alex/.claude/plans/restored-operation-plan.md",
		};

		const card = buildQueueExitPlanCard(toolCall, null);

		expect(card).toEqual({
			title: "Restored Operation Plan",
			content: plan,
		});
	});
});
