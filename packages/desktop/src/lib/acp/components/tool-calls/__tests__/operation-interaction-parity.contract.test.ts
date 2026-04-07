import { describe, expect, it } from "bun:test";

import { buildAcpPermissionId, type PermissionRequest } from "../../../types/permission.js";
import { PermissionStore } from "../../../store/permission-store.svelte.js";
import { OperationStore } from "../../../store/operation-store.svelte.js";
import { SessionEntryStore } from "../../../store/session-entry-store.svelte.js";
import { isPermissionRepresentedByToolCall } from "../permission-visibility.js";

function createPermission(command: string): PermissionRequest {
	return {
		id: buildAcpPermissionId("session-1", "shell-permission", 101),
		sessionId: "session-1",
		jsonRpcRequestId: 101,
		permission: "Execute",
		patterns: [],
		metadata: {
			rawInput: { command },
			parsedArguments: { kind: "execute", command },
			options: [],
		},
		always: [],
		tool: {
			messageID: "",
			callID: "shell-permission",
		},
	};
}

describe("operation interaction parity", () => {
	it("keeps transcript and session permission bar on the same represented-vs-duplicate decision", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);
		const permissionStore = new PermissionStore();
		entryStore.createToolCallEntry("session-1", {
			id: "tool-1",
			name: "bash",
			arguments: { kind: "execute", command: "mkdir demo" },
			status: "pending",
			result: null,
			kind: "execute",
			title: "Run command",
			locations: null,
			skillMeta: null,
			awaitingPlanApproval: false,
		});

		const permission = createPermission("mkdir demo");
		permissionStore.add(permission);

		const operation = operationStore.getByToolCallId("session-1", "tool-1");
		const transcriptPermission = operation
			? permissionStore.getForOperation(operation, operationStore)
			: null;
		const representedInSessionBar = isPermissionRepresentedByToolCall(
			permission,
			"session-1",
			operationStore,
			entryStore.getEntries("session-1")
		);

		expect(transcriptPermission?.id).toBe(permission.id);
		expect(representedInSessionBar).toBe(true);
	});
});
