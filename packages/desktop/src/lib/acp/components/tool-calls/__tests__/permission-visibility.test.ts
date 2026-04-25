import { describe, expect, it } from "bun:test";
import { OperationStore } from "../../../store/operation-store.svelte.js";
import { SessionEntryStore } from "../../../store/session-entry-store.svelte.js";
import type { PermissionRequest } from "../../../types/permission.js";

import {
	isPermissionRepresentedByToolCall,
	visiblePermissionsForSessionBar,
} from "../permission-visibility.js";

function createPermission(toolCallId: string, command = "git status"): PermissionRequest {
	return {
		id: `permission-${toolCallId}`,
		sessionId: "session-1",
		permission: "Execute",
		patterns: [],
		metadata: {
			rawInput: { command },
			parsedArguments: { kind: "execute", command },
		},
		always: [],
		tool: {
			messageID: "",
			callID: toolCallId,
		},
	};
}

function createEntriesWithOperations(
	toolCallId: string,
	command = "git status"
): { operationStore: OperationStore } {
	const operationStore = new OperationStore();
	const entryStore = new SessionEntryStore(operationStore);
	entryStore.createToolCallEntry("session-1", {
		id: toolCallId,
		name: "Execute",
		arguments: {
			kind: "execute",
			command,
		},
		status: "in_progress",
		kind: "execute",
		title: null,
		locations: null,
		skillMeta: null,
		result: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		parentToolUseId: null,
		taskChildren: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
	});
	return {
		operationStore,
	};
}

describe("permission visibility", () => {
	it("treats a permission with a matching tool-call entry as represented", () => {
		const permission = createPermission("tool-1");
		const { operationStore } = createEntriesWithOperations("tool-1");

		expect(isPermissionRepresentedByToolCall(permission, "session-1", operationStore)).toBe(true);
	});

	it("keeps orphan permissions visible when no matching tool-call entry exists", () => {
		const permission = createPermission("tool-2", "git diff");
		const { operationStore } = createEntriesWithOperations("tool-1");

		expect(isPermissionRepresentedByToolCall(permission, "session-1", operationStore)).toBe(false);
		expect(visiblePermissionsForSessionBar([permission], operationStore)).toEqual([permission]);
	});

	it("keeps execute permissions visible when only the command matches and the canonical anchor differs", () => {
		const permission = createPermission("shell-permission");
		const { operationStore } = createEntriesWithOperations("tool-1");

		expect(isPermissionRepresentedByToolCall(permission, "session-1", operationStore)).toBe(false);
	});

	it("keeps anchored permissions visible in the session-level permission bar", () => {
		const anchoredPermission = createPermission("tool-1");
		const orphanPermission = createPermission("tool-2");
		const { operationStore } = createEntriesWithOperations("tool-1");

		expect(
			visiblePermissionsForSessionBar([anchoredPermission, orphanPermission], operationStore)
		).toEqual([anchoredPermission, orphanPermission]);
	});
});
