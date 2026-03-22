import { describe, expect, it } from "bun:test";

import type { ToolArguments } from "../../../services/converted-session-types.js";
import type { PermissionRequest } from "../../types/permission.js";

import { mergePermissionArgs } from "../merge-permission-args.js";

function createPermission(metadata: Record<string, unknown>): PermissionRequest {
	return {
		id: "permission-1",
		sessionId: "session-1",
		permission: "Write",
		patterns: [],
		metadata,
		always: [],
		tool: { messageID: "msg-1", callID: "tool-1" },
	};
}

describe("mergePermissionArgs", () => {
	it("ignores whitespace-only file_path values in parsedArguments", () => {
		const base: ToolArguments = {
			kind: "edit",
			file_path: null,
			old_string: null,
			new_string: null,
			content: null,
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					file_path: null,
					old_string: null,
					new_string: null,
					content: "new content",
				},
			})
		);

		expect(merged.kind).toBe("edit");
		if (merged.kind !== "edit") return;
		expect(merged.file_path).toBeNull();
		expect(merged.content).toBe("new content");
	});

	it("uses trimmed file_path values from parsedArguments", () => {
		const base: ToolArguments = {
			kind: "edit",
			file_path: null,
			old_string: null,
			new_string: null,
			content: null,
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					file_path: "/tmp/example.ts",
					old_string: null,
					new_string: null,
					content: null,
				},
			})
		);

		expect(merged.kind).toBe("edit");
		if (merged.kind !== "edit") return;
		expect(merged.file_path).toBe("/tmp/example.ts");
	});

	it("preserves content whitespace exactly from parsedArguments", () => {
		const base: ToolArguments = {
			kind: "edit",
			file_path: null,
			old_string: null,
			new_string: null,
			content: null,
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					file_path: "/tmp/example.ts",
					old_string: null,
					new_string: null,
					content: "  keep leading and trailing spaces  \n",
				},
			})
		);

		expect(merged.kind).toBe("edit");
		if (merged.kind !== "edit") return;
		expect(merged.content).toBe("  keep leading and trailing spaces  \n");
	});

	it("prefers parsedArguments for edit preview content", () => {
		const base: ToolArguments = {
			kind: "edit",
			file_path: null,
			old_string: null,
			new_string: null,
			content: null,
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					file_path: "/tmp/README.md",
					old_string: null,
					new_string: "# Hello",
					content: "# Hello",
				},
				rawInput: {
					file_path: "/tmp/ignored.md",
					content: "ignored",
				},
			})
		);

		expect(merged.kind).toBe("edit");
		if (merged.kind !== "edit") return;
		expect(merged.file_path).toBe("/tmp/README.md");
		expect(merged.content).toBe("# Hello");
		expect(merged.new_string).toBe("# Hello");
	});

	it("enriches codex edit permissions from rawInput.changes payload", () => {
		const base: ToolArguments = {
			kind: "edit",
			file_path: null,
			old_string: null,
			new_string: null,
			content: null,
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					file_path: "/Users/alex/Downloads/hello-world-go/blockchain/block.go",
					old_string: null,
					new_string: null,
					content: null,
				},
				rawInput: {
					changes: {
						"/Users/alex/Downloads/hello-world-go/blockchain/block.go": {
							old_content: "old block content",
							new_content: "new block content",
						},
					},
				},
			})
		);

		expect(merged.kind).toBe("edit");
		if (merged.kind !== "edit") return;
		expect(merged.file_path).toBe("/Users/alex/Downloads/hello-world-go/blockchain/block.go");
		expect(merged.old_string).toBe("old block content");
		expect(merged.new_string).toBe("new block content");
		expect(merged.content).toBe("new block content");
	});
});
