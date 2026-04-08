import { describe, expect, it } from "bun:test";

import type { ToolCallData } from "../../../services/converted-session-types.js";
import { buildAcpPermissionId, type PermissionRequest } from "../../types/permission.js";
import type { PlanApprovalInteraction } from "../../types/interaction.js";
import type { QuestionRequest } from "../../types/question.js";
import { OperationStore } from "../operation-store.svelte.js";
import {
	findOperationForPermission,
	findOperationForPlanApproval,
	findOperationForQuestion,
} from "../operation-association.js";
import { SessionEntryStore } from "../session-entry-store.svelte.js";

function createExecuteToolCall(
	id: string,
	command: string,
	overrides?: Partial<ToolCallData>
): ToolCallData {
	return {
		id: overrides?.id ?? id,
		name: overrides?.name ?? "bash",
		arguments: overrides?.arguments ?? { kind: "execute", command },
		status: overrides?.status ?? "pending",
		result: overrides?.result ?? null,
		kind: overrides?.kind ?? "execute",
		title: overrides?.title ?? "Run command",
		locations: overrides?.locations ?? null,
		skillMeta: overrides?.skillMeta ?? null,
		awaitingPlanApproval: overrides?.awaitingPlanApproval ?? false,
		parentToolUseId: overrides?.parentToolUseId,
		taskChildren: overrides?.taskChildren,
		normalizedQuestions: overrides?.normalizedQuestions,
		normalizedTodos: overrides?.normalizedTodos,
		planApprovalRequestId: overrides?.planApprovalRequestId,
		questionAnswer: overrides?.questionAnswer,
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
		const entryStore = new SessionEntryStore(operationStore);
		entryStore.createToolCallEntry("session-1", createExecuteToolCall("tool-1", "git status"));

		const permission = createExecutePermission("session-1", "tool-1", "different command");
		const operation = findOperationForPermission(operationStore, permission);

		expect(operation?.toolCallId).toBe("tool-1");
	});

	it("resolves execute permissions by command when the transport anchor differs", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);
		entryStore.createToolCallEntry("session-1", createExecuteToolCall("tool-1", "mkdir demo"));

		const permission = createExecutePermission("session-1", "shell-permission", "mkdir demo");
		const operation = findOperationForPermission(operationStore, permission);

		expect(operation?.toolCallId).toBe("tool-1");
		expect(operation?.command).toBe("mkdir demo");
	});

	it("fails closed when no operation command matches a fallback permission", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);
		entryStore.createToolCallEntry("session-1", createExecuteToolCall("tool-1", "git status"));
		entryStore.createToolCallEntry("session-1", createExecuteToolCall("tool-2", "git diff"));

		const permission = createExecutePermission("session-1", "shell-permission", "npm test");
		expect(findOperationForPermission(operationStore, permission)).toBeNull();
	});

	it("resolves question and plan approval interactions by explicit tool reference", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);
		entryStore.createToolCallEntry("session-1", createExecuteToolCall("tool-1", "plan"));

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
});
