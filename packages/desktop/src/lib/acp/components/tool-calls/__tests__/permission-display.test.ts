import { describe, expect, it } from "bun:test";

import type { PermissionRequest } from "../../../types/permission.js";

import { extractPermissionCommand, extractPermissionFilePath } from "../permission-display.js";

function createPermission(metadata: Record<string, unknown>): PermissionRequest {
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
	it("extracts file path from rawInput.file_path", () => {
		const permission = createPermission({
			rawInput: {
				file_path: "/tmp/example.ts",
			},
		});

		expect(extractPermissionFilePath(permission)).toBe("/tmp/example.ts");
	});

	it("extracts file path from rawInput.path", () => {
		const permission = createPermission({
			rawInput: {
				path: "/tmp/example.ts",
			},
		});

		expect(extractPermissionFilePath(permission)).toBe("/tmp/example.ts");
	});

	it("extracts file path from rawInput.filePath", () => {
		const permission = createPermission({
			rawInput: {
				filePath: "/tmp/example.ts",
			},
		});

		expect(extractPermissionFilePath(permission)).toBe("/tmp/example.ts");
	});

	it("returns null when no path field exists", () => {
		const permission = createPermission({
			rawInput: {
				command: "ls",
			},
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("returns null for whitespace-only file_path", () => {
		const permission = createPermission({
			rawInput: {
				file_path: "   ",
			},
		});

		expect(extractPermissionFilePath(permission)).toBeNull();
	});

	it("extracts command from rawInput.command", () => {
		const permission = createPermission({
			rawInput: {
				command: "git status",
			},
		});

		expect(extractPermissionCommand(permission)).toBe("git status");
	});

	// parsedArguments (agent-agnostic) tests

	it("prefers parsedArguments over rawInput for file_path", () => {
		const permission = createPermission({
			parsedArguments: { kind: "read", file_path: "/parsed/path.ts" },
			rawInput: { file_path: "/raw/path.ts" },
		});

		expect(extractPermissionFilePath(permission)).toBe("/parsed/path.ts");
	});

	it("prefers parsedArguments over rawInput for command", () => {
		const permission = createPermission({
			parsedArguments: { kind: "execute", command: "parsed-cmd" },
			rawInput: { command: "raw-cmd" },
		});

		expect(extractPermissionCommand(permission)).toBe("parsed-cmd");
	});

	it("extracts file_path from parsedArguments edit kind", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "edit",
				file_path: "/src/main.rs",
				old_string: "foo",
				new_string: "bar",
			},
		});

		expect(extractPermissionFilePath(permission)).toBe("/src/main.rs");
	});

	it("falls back to rawInput when parsedArguments absent", () => {
		const permission = createPermission({
			rawInput: { file_path: "/fallback.ts" },
		});

		expect(extractPermissionFilePath(permission)).toBe("/fallback.ts");
	});

	it("falls back to rawInput when parsedArguments kind has no file_path", () => {
		const permission = createPermission({
			parsedArguments: { kind: "execute", command: "ls" },
			rawInput: { file_path: "/raw.ts" },
		});

		expect(extractPermissionFilePath(permission)).toBe("/raw.ts");
	});

	it("falls back to rawInput when parsed edit file_path is blank", () => {
		const permission = createPermission({
			parsedArguments: {
				kind: "edit",
				file_path: "   ",
				old_string: null,
				new_string: null,
				content: null,
			},
			rawInput: { file_path: "/raw.ts" },
		});

		expect(extractPermissionFilePath(permission)).toBe("/raw.ts");
	});

	it("falls back to permission label when rawInput path is missing", () => {
		const permission = createPermission({
			rawInput: {},
		});
		permission.permission = "Write /tmp/from-title.ts";

		expect(extractPermissionFilePath(permission)).toBe("/tmp/from-title.ts");
	});

	it("extracts relative file path from permission label", () => {
		const permission = createPermission({
			rawInput: {},
		});
		permission.permission = "Write articles.csv";

		expect(extractPermissionFilePath(permission)).toBe("articles.csv");
	});
});
