import { describe, expect, it } from "bun:test";

import type { OperationSnapshot } from "../../../services/acp-types.js";
import type { PlanApprovalInteraction } from "../../types/interaction.js";
import { buildAcpPermissionId, type PermissionRequest } from "../../types/permission.js";
import type { QuestionRequest } from "../../types/question.js";
import {
	findOperationForPermission,
	findOperationForPlanApproval,
	findOperationForQuestion,
} from "../operation-association.js";
import { OperationStore } from "../operation-store.svelte.js";

function createExecuteOperation(
	id: string,
	command: string,
	overrides?: Partial<OperationSnapshot>
): OperationSnapshot {
	return {
		id: overrides?.id ?? `op-${id}`,
		session_id: overrides?.session_id ?? "session-1",
		tool_call_id: overrides?.tool_call_id ?? id,
		operation_provenance_key: overrides?.operation_provenance_key ?? id,
		name: overrides?.name ?? "bash",
		arguments: overrides?.arguments ?? { kind: "execute", command },
		provider_status: overrides?.provider_status ?? "pending",
		operation_state: overrides?.operation_state ?? "pending",
		source_link: overrides?.source_link ?? { kind: "transcript_linked", entry_id: id },
		result: overrides?.result ?? null,
		kind: overrides?.kind ?? "execute",
		title: overrides?.title ?? "Run command",
		progressive_arguments: overrides?.progressive_arguments ?? null,
		command: overrides?.command ?? command,
		normalized_todos: overrides?.normalized_todos ?? null,
		parent_tool_call_id: overrides?.parent_tool_call_id ?? null,
		parent_operation_id: overrides?.parent_operation_id ?? null,
		child_tool_call_ids: overrides?.child_tool_call_ids ?? [],
		child_operation_ids: overrides?.child_operation_ids ?? [],
	};
}

function createExecutePermission(
	sessionId: string,
	toolCallId: string,
	command: string
): PermissionRequest {
	return {
		id: buildAcpPermissionId(sessionId, toolCallId, 101),
		sessionId,
		jsonRpcRequestId: 101,
		permission: "Execute",
		patterns: [],
		metadata: {
			rawInput: { command },
			parsedArguments: { kind: "execute", command },
			options: [],
		},
		always: [],
		tool: { messageID: "", callID: toolCallId },
	};
}

describe("operation association", () => {
	it("prefers explicit tool references over semantic fallback", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "git status"),
		]);

		const permission = createExecutePermission("session-1", "tool-1", "different command");
		const operation = findOperationForPermission(operationStore, permission);

		expect(operation?.toolCallId).toBe("tool-1");
	});

	it("does not guess execute permissions by command when the transport anchor differs", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "mkdir demo"),
		]);

		const permission = createExecutePermission("session-1", "shell-permission", "mkdir demo");
		const operation = findOperationForPermission(operationStore, permission);

		expect(operation).toBeNull();
	});

	it("fails closed when no operation command matches a fallback permission", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "git status"),
			createExecuteOperation("tool-2", "git diff"),
		]);

		const permission = createExecutePermission("session-1", "shell-permission", "npm test");
		expect(findOperationForPermission(operationStore, permission)).toBeNull();
	});

	it("resolves question and plan approval interactions by explicit tool reference", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "plan"),
		]);

		const question: QuestionRequest = {
			id: "question-1",
			sessionId: "session-1",
			questions: [],
			tool: { messageID: "", callID: "tool-1" },
		};
		const approval: PlanApprovalInteraction = {
			id: "approval-1",
			kind: "plan_approval",
			source: "create_plan",
			sessionId: "session-1",
			tool: { messageID: "", callID: "tool-1" },
			jsonRpcRequestId: 10,
			replyHandler: { kind: "json-rpc", requestId: 10 },
			status: "pending",
		};

		expect(findOperationForQuestion(operationStore, question)?.toolCallId).toBe("tool-1");
		expect(findOperationForPlanApproval(operationStore, approval)?.toolCallId).toBe("tool-1");
	});

	it("resolves interactions by operation provenance key when tool-call storage id differs", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "stored-tool-1",
				operation_provenance_key: "provider-tool-1",
				name: "bash",
				kind: "execute",
				provider_status: "pending",
				operation_state: "pending",
				source_link: { kind: "transcript_linked", entry_id: "stored-tool-1" },
				title: "Run command",
				arguments: { kind: "execute", command: "mkdir demo" },
				progressive_arguments: null,
				result: null,
				command: "mkdir demo",
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

		const permission = createExecutePermission("session-1", "provider-tool-1", "different command");
		expect(findOperationForPermission(operationStore, permission)?.toolCallId).toBe(
			"stored-tool-1"
		);
	});

	it("returns null for permission with no matching operation", () => {
		const operationStore = new OperationStore();
		const permission = createExecutePermission("session-1", "tool-nonexistent", "some command");
		const result = findOperationForPermission(operationStore, permission);
		expect(result).toBeNull();
	});
});
