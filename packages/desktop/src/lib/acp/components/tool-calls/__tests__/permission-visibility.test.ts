import { describe, expect, it } from "bun:test";
import type { OperationSnapshot } from "../../../../services/acp-types.js";
import { OperationStore } from "../../../store/operation-store.svelte.js";
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
	const operation: OperationSnapshot = {
		id: `op-${toolCallId}`,
		session_id: "session-1",
		tool_call_id: toolCallId,
		operation_provenance_key: toolCallId,
		name: "Execute",
		arguments: {
			kind: "execute",
			command,
		},
		provider_status: "in_progress",
		operation_state: "running",
		source_link: { kind: "transcript_linked", entry_id: toolCallId },
		kind: "execute",
		title: null,
		result: null,
		progressive_arguments: null,
		command,
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
	};
	operationStore.replaceSessionOperations("session-1", [operation]);
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
