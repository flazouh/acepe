import { describe, expect, it } from "bun:test";

import type { PermissionRequest } from "../../../types/permission.js";
import type { ToolCall } from "../../../types/tool-call.js";

import {
	buildPermissionBarDisplayModel,
	extractCompactPermissionDisplay,
	extractPermissionCommand,
	extractPermissionFilePath,
	shouldShowPermissionBarSummary,
} from "../permission-display.js";

function createPermission(metadata: PermissionRequest["metadata"]): PermissionRequest {
	return {
		id: "permission-1",
		sessionId: "session-1",
		permission: "Read file",
		patterns: [],
		metadata,
		always: [],
	};
}

function createEditToolCall(filePath: string): ToolCall {
	return {
		id: "tool-edit",
		name: "Edit",
		arguments: {
			kind: "edit",
			edits: [
				{
					filePath,
					moveFrom: null,
					oldString: "before",
					newString: "after",
					content: null,
				},
			],
		},
		status: "in_progress",
		result: null,
		kind: "edit",
		title: filePath,
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		normalizedTodoUpdate: null,
		parentToolUseId: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
	};
}

function createAccessToolCall(): ToolCall {
	return {
		id: "tool-access",
		name: "Access",
		arguments: {
			kind: "other",
			raw: {},
			intent: null,
		},
		status: "pending",
		result: null,
		kind: "other",
		title: "Access",
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		normalizedTodoUpdate: null,
		parentToolUseId: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
	};
}

describe("permission-display", () => {
	it("does not extract file path from diagnosticRawInput.file_path", () => {
		const permission = createPermission({
			diagnosticRawInput: {
				file_path: "/tmp/example.ts",
			},
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("does not extract file path from diagnosticRawInput.path", () => {
		const permission = createPermission({
			diagnosticRawInput: {
				path: "/tmp/example.ts",
			},
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("does not extract file path from diagnosticRawInput.filePath", () => {
		const permission = createPermission({
			diagnosticRawInput: {
				filePath: "/tmp/example.ts",
			},
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("returns null when no path field exists", () => {
		const permission = createPermission({
			diagnosticRawInput: {
				command: "ls",
			},
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("returns null for whitespace-only file_path", () => {
		const permission = createPermission({
			diagnosticRawInput: {
				file_path: "   ",
			},
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("does not extract command from diagnosticRawInput.command", () => {
		const permission = createPermission({
			diagnosticRawInput: {
				command: "git status",
			},
		});

		expect(extractPermissionCommand(permission)).toBeNull();
	});

	// parsedArguments (agent-agnostic) tests

	it("prefers parsedArguments over diagnosticRawInput for file_path", () => {
		const permission = createPermission({
			parsedArguments: { kind: "read", file_path: "/parsed/path.ts" },
			diagnosticRawInput: { file_path: "/raw/path.ts" },
		});

		expect(extractPermissionFilePath(permission)).toBe("/parsed/path.ts");
	});

	it("prefers parsedArguments over diagnosticRawInput for command", () => {
		const permission = createPermission({
			parsedArguments: { kind: "execute", command: "parsed-cmd" },
			diagnosticRawInput: { command: "raw-cmd" },
		});

		expect(extractPermissionCommand(permission)).toBe("parsed-cmd");
	});

	it("extracts file_path from parsedArguments edit kind", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "edit",
				edits: [{ filePath: "/src/main.rs", oldString: "foo", newString: "bar" }],
			},
		});

		expect(extractPermissionFilePath(permission)).toBe("/src/main.rs");
	});

	it("does not fall back to diagnosticRawInput when parsedArguments are absent", () => {
		const permission = createPermission({
			diagnosticRawInput: { file_path: "/fallback.ts" },
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("does not fall back to diagnosticRawInput when parsedArguments kind has no file_path", () => {
		const permission = createPermission({
			parsedArguments: { kind: "execute", command: "ls" },
			diagnosticRawInput: { file_path: "/raw.ts" },
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("does not fall back to diagnosticRawInput when parsed edit file_path is blank", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "edit",
				edits: [{ filePath: "   ", oldString: null, newString: null, content: null }],
			},
			diagnosticRawInput: { file_path: "/raw.ts" },
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("falls back to permission label when diagnosticRawInput path is missing", () => {
		const permission = createPermission({
			diagnosticRawInput: {},
		});
		permission.permission = "Write /tmp/from-title.ts";

		expect(extractPermissionFilePath(permission)).toBe("/tmp/from-title.ts");
	});

	it("extracts relative file path from permission label", () => {
		const permission = createPermission({
			diagnosticRawInput: {},
		});
		permission.permission = "Write articles.csv";

		expect(extractPermissionFilePath(permission)).toBe("articles.csv");
	});

	it("builds compact permission display data using the toolbar extraction rules", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "edit",
				edits: [
					{
						filePath: "/repo/packages/ui/src/index.ts",
						oldString: null,
						newString: null,
						content: null,
					},
				],
			},
		});
		permission.permission = "Edit /repo/packages/ui/src/index.ts";

		expect(extractCompactPermissionDisplay(permission, "/repo")).toEqual({
			kind: "edit",
			label: "Edit",
			command: null,
			filePath: "packages/ui/src/index.ts",
		});
	});

	it("suppresses raw command text for file permissions when a file chip can be shown", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "edit",
				edits: [
					{
						filePath: "/repo/packages/ui/src/kanban-card.svelte",
						oldString: null,
						newString: null,
						content: null,
					},
				],
			},
			diagnosticRawInput: {
				command: "packages/ui/src/kanban-card.svelte",
			},
		});
		permission.permission = "Edit /repo/packages/ui/src/kanban-card.svelte";

		expect(extractCompactPermissionDisplay(permission, "/repo")).toEqual({
			kind: "edit",
			label: "Edit",
			command: null,
			filePath: "packages/ui/src/kanban-card.svelte",
		});
	});

	it("uses linked canonical tool call display when permission metadata is only path access", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "read",
				file_path: "/repo/packages/desktop/src/lib/components/ui/dialog-frame.svelte",
			},
		});
		permission.permission = "Access paths outside trusted directories";

		expect(
			extractCompactPermissionDisplay(
				permission,
				"/repo",
				createEditToolCall(
					"/repo/packages/desktop/src/lib/components/ui/dialog-frame.svelte"
				)
			)
		).toEqual({
			kind: "edit",
			label: "Edit",
			command: null,
			filePath: "packages/desktop/src/lib/components/ui/dialog-frame.svelte",
		});
	});

	it("labels neutral path access permissions as access instead of read", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "read",
				file_path: "/repo/packages/desktop/src/lib/components/ui/dialog-frame.svelte",
			},
		});
		permission.permission = "Access paths outside trusted directories";

		expect(extractCompactPermissionDisplay(permission, "/repo")).toEqual({
			kind: "other",
			label: "Access",
			command: null,
			filePath: "packages/desktop/src/lib/components/ui/dialog-frame.svelte",
		});
	});

	it("keeps permission summary visible when the represented tool row lacks approval context", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "read",
				file_path: "/repo/packages/desktop/src/lib/components/ui/dialog-frame.svelte",
			},
		});
		permission.permission = "Access paths outside trusted directories";
		const display = extractCompactPermissionDisplay(permission, "/repo", createAccessToolCall());

		expect(
			shouldShowPermissionBarSummary({
				isRepresentedByToolCall: true,
				display,
				toolCall: createAccessToolCall(),
			})
		).toBe(true);
	});

	it("can hide permission summary when the represented edit tool row already has file context", () => {
		const filePath = "/repo/packages/desktop/src/lib/components/ui/dialog-frame.svelte";
		const permission = createPermission({
			parsedArguments: {
				kind: "edit",
				edits: [{ filePath, oldString: null, newString: null, content: null }],
			},
		});
		permission.permission = "Edit /repo/packages/desktop/src/lib/components/ui/dialog-frame.svelte";
		const toolCall = createEditToolCall(filePath);
		const display = extractCompactPermissionDisplay(permission, "/repo", toolCall);

		expect(
			shouldShowPermissionBarSummary({
				isRepresentedByToolCall: true,
				display,
				toolCall,
			})
		).toBe(false);
	});

	it("builds permission bar display model for standalone file permissions", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "edit",
				edits: [
					{
						filePath: "/repo/packages/ui/src/index.ts",
						oldString: null,
						newString: null,
						content: null,
					},
				],
			},
		});
		permission.permission = "Edit /repo/packages/ui/src/index.ts";

		expect(
			buildPermissionBarDisplayModel({
				permission,
				projectPath: "/repo",
				toolCall: null,
				isRepresentedByToolCall: false,
				showCommandWhenRepresented: false,
			})
		).toEqual({
			kind: "edit",
			verb: "Edit",
			command: null,
			filePath: "packages/ui/src/index.ts",
			showSummary: true,
		});
	});

	it("hides represented command text unless explicitly requested", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "execute",
				command: "bun test",
			},
		});
		permission.permission = "Execute bun test";

		expect(
			buildPermissionBarDisplayModel({
				permission,
				projectPath: "/repo",
				toolCall: null,
				isRepresentedByToolCall: true,
				showCommandWhenRepresented: false,
			}).command
		).toBeNull();

		expect(
			buildPermissionBarDisplayModel({
				permission,
				projectPath: "/repo",
				toolCall: null,
				isRepresentedByToolCall: true,
				showCommandWhenRepresented: true,
			}).command
		).toBe("bun test");
	});
});
