import { describe, expect, it } from "bun:test";
import type { PermissionRequest } from "../../../types/permission.js";
import type { ToolCall } from "../../../types/tool-call.js";
import { resolveToolOperation } from "../resolve-tool-operation.js";

function createToolCall(overrides?: Partial<ToolCall>): ToolCall {
	const base: ToolCall = {
		id: "tool-1",
		name: "Bash",
		arguments: { kind: "execute", command: null },
		status: "pending",
		result: null,
		kind: "execute",
		title: "Bash",
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		parentToolUseId: null,
		taskChildren: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
		startedAtMs: 1,
		completedAtMs: undefined,
	};

	if (!overrides) {
		return base;
	}

	return Object.assign({}, base, overrides);
}

function createPermission(overrides?: Partial<PermissionRequest>): PermissionRequest {
	const base: PermissionRequest = {
		id: "perm-1",
		sessionId: "session-1",
		permission: "execute",
		patterns: [],
		metadata: {
			rawInput: { command: "git status" },
			parsedArguments: { kind: "execute", command: "git status" },
			options: [],
		},
		always: [],
		tool: {
			messageID: "message-1",
			callID: "tool-1",
		},
	};

	if (!overrides) {
		return base;
	}

	return Object.assign({}, base, overrides);
}

describe("resolveToolOperation", () => {
	it("keeps canonical tool arguments and shows inline approval", () => {
		const resolved = resolveToolOperation(createToolCall(), createPermission());

		expect(resolved.toolCall.arguments).toEqual({ kind: "execute", command: null });
		expect(resolved.routeKey).toBe("execute");
		expect(resolved.shouldShowInlinePermissionActionBar).toBe(true);
	});

	it("routes canonical read_lints tool calls to the read-lints component key", () => {
		const resolved = resolveToolOperation(
			createToolCall({
				name: "read_lints",
				kind: "read_lints",
				arguments: { kind: "readLints", raw: {} },
				title: "Read Lints",
			}),
			null
		);

		expect(resolved.routeKey).toBe("read_lints");
		expect(resolved.resolvedKind).toBe("read_lints");
	});

	it("does not route raw read_lints names without canonical kind", () => {
		const resolved = resolveToolOperation(
			createToolCall({
				name: "read_lints",
				kind: "read",
				arguments: { kind: "read", file_path: "/tmp/lints.txt" },
				title: "Read Lints",
			}),
			null
		);

		expect(resolved.routeKey).toBe("read");
		expect(resolved.resolvedKind).toBe("read");
	});

	it("keeps exit-plan approvals out of the generic inline action bar", () => {
		const resolved = resolveToolOperation(
			createToolCall({
				name: "ExitPlanMode",
				arguments: { kind: "planMode", mode: "build" },
				kind: "exit_plan_mode",
			}),
			createPermission({
				permission: "exit_plan_mode",
				metadata: {
					rawInput: { mode: "build" },
					parsedArguments: { kind: "planMode", mode: "build" },
					options: [],
				},
			})
		);

		expect(resolved.routeKey).toBe("exit_plan_mode");
		expect(resolved.shouldShowInlinePermissionActionBar).toBe(false);
	});

	it("keeps transcript tool rows instead of rebuilding ToolCall fallback data", () => {
		const toolCall = createToolCall({
			name: "apply_patch",
			kind: "other",
			title: "apply_patch",
			arguments: { kind: "other", raw: "raw transcript tool row" },
		});
		const resolved = resolveToolOperation(toolCall, null);

		expect(resolved.toolCall).toBe(toolCall);
		expect(resolved.toolCall.name).toBe("apply_patch");
		expect(resolved.toolCall.arguments).toEqual({ kind: "other", raw: "raw transcript tool row" });
	});
});
