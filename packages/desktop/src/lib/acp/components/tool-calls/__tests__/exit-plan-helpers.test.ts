import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { PermissionRequest } from "../../../types/permission.js";
import type { ToolCall } from "../../../types/tool-call.js";
import {
	findExitPlanPermission,
	getExitPlanDisplayPlan,
	shouldHidePermissionBarForExitPlan,
} from "../exit-plan-helpers.js";

function createExitPlanToolCall(id: string, plan: string, planFilePath: string): ToolCall {
	return {
		id,
		name: "ExitPlanMode",
		arguments: {
			kind: "other",
			raw: {
				plan,
				planFilePath,
			},
		},
		status: "in_progress",
		kind: "exit_plan_mode",
		awaitingPlanApproval: false,
	};
}

function createExitPlanPermission(
	id: string,
	toolCallId: string,
	plan: string,
	planFilePath: string,
	jsonRpcRequestId: number
): PermissionRequest {
	return {
		id,
		sessionId: "session-1",
		jsonRpcRequestId,
		permission: "ExitPlanMode",
		patterns: [],
		metadata: {
			rawInput: {
				plan,
				planFilePath,
			},
			parsedArguments: {
				kind: "planMode",
				mode: "default",
			},
			options: [],
		},
		always: [],
		tool: {
			messageID: "",
			callID: toolCallId,
		},
	};
}

function createToolEntry(toolCall: ToolCall): SessionEntry {
	return {
		id: `entry-${toolCall.id}`,
		type: "tool_call",
		message: toolCall,
	};
}

describe("exit-plan-helpers", () => {
	it("builds a display plan from exit-plan tool raw input when session plan is missing", () => {
		const plan = "# Focused Plan\n\n- [ ] Fix exit-plan card";
		const toolCall = createExitPlanToolCall("toolu_exit_plan", plan, "/tmp/focused-plan.md");

		const displayPlan = getExitPlanDisplayPlan(toolCall, null, null);

		expect(displayPlan).not.toBeNull();
		expect(displayPlan?.content).toBe(plan);
		expect(displayPlan?.title).toBe("Focused Plan");
		expect(displayPlan?.filePath).toBe("/tmp/focused-plan.md");
	});

	it("falls back to the best matching exit-plan permission when tool-call ids differ", () => {
		const plan = "# Focused Plan\n\n- [ ] Fix exit-plan card";
		const toolCall = createExitPlanToolCall("toolu_real", plan, "/tmp/focused-plan.md");
		const olderPermission = createExitPlanPermission(
			"perm-older",
			"cc-sdk-1",
			plan,
			"/tmp/focused-plan.md",
			41
		);
		const newerPermission = createExitPlanPermission(
			"perm-newer",
			"cc-sdk-2",
			plan,
			"/tmp/focused-plan.md",
			42
		);

		const matched = findExitPlanPermission(toolCall, [olderPermission, newerPermission]);

		expect(matched?.id).toBe("perm-newer");
	});

	it("hides the generic permission bar when an exit-plan row exists in the session", () => {
		const plan = "# Focused Plan\n\n- [ ] Fix exit-plan card";
		const toolCall = createExitPlanToolCall("toolu_exit_plan", plan, "/tmp/focused-plan.md");
		const permission = createExitPlanPermission(
			"perm-1",
			"cc-sdk-1",
			plan,
			"/tmp/focused-plan.md",
			42
		);

		const shouldHide = shouldHidePermissionBarForExitPlan(permission, [createToolEntry(toolCall)]);

		expect(shouldHide).toBe(true);
	});
});
