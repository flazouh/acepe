import { describe, expect, it } from "vitest";

import type { OperationSnapshot } from "../../../../services/acp-types.js";
import { OperationStore } from "../../../store/operation-store.svelte.js";
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

function createOperationStoreWithToolCall(toolCall: ToolCall): OperationStore {
	const operationStore = new OperationStore();
	const operation: OperationSnapshot = {
		id: `op-${toolCall.id}`,
		session_id: "session-1",
		tool_call_id: toolCall.id,
		operation_provenance_key: toolCall.id,
		name: toolCall.name,
		arguments: toolCall.arguments,
		provider_status: toolCall.status,
		operation_state: toolCall.status === "completed" ? "completed" : "running",
		source_link: { kind: "transcript_linked", entry_id: toolCall.id },
		kind: toolCall.kind ?? null,
		title: null,
		result: null,
		progressive_arguments: null,
		command: null,
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
	};
	operationStore.replaceSessionOperations("session-1", [operation]);
	return operationStore;
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

		const shouldHide = shouldHidePermissionBarForExitPlan(
			permission,
			createOperationStoreWithToolCall(toolCall)
		);

		expect(shouldHide).toBe(true);
	});
});
