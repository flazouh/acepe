import { describe, expect, it } from "bun:test";

import type { PermissionRequest } from "../../../types/permission.js";

import {
	extractCompactPermissionDisplay,
	extractPermissionCommand,
	extractPermissionFilePath,
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
});
