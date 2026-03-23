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
			edits: [{ filePath: null, oldString: null, newString: null, content: null }],
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: "new content" }],
				},
			})
		);

		expect(merged.kind).toBe("edit");
		if (merged.kind !== "edit") return;
		expect(merged.edits[0]?.filePath).toBeNull();
		expect(merged.edits[0]?.content).toBe("new content");
	});

	it("uses trimmed file_path values from parsedArguments", () => {
		const base: ToolArguments = {
			kind: "edit",
			edits: [{ filePath: null, oldString: null, newString: null, content: null }],
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					edits: [{ filePath: "/tmp/example.ts", oldString: null, newString: null, content: null }],
				},
			})
		);

		expect(merged.kind).toBe("edit");
		if (merged.kind !== "edit") return;
		expect(merged.edits[0]?.filePath).toBe("/tmp/example.ts");
	});

	it("preserves content whitespace exactly from parsedArguments", () => {
		const base: ToolArguments = {
			kind: "edit",
			edits: [{ filePath: null, oldString: null, newString: null, content: null }],
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/tmp/example.ts",
							oldString: null,
							newString: null,
							content: "  keep leading and trailing spaces  \n",
						},
					],
				},
			})
		);

		expect(merged.kind).toBe("edit");
		if (merged.kind !== "edit") return;
		expect(merged.edits[0]?.content).toBe("  keep leading and trailing spaces  \n");
	});

	it("prefers parsedArguments for edit preview content", () => {
		const base: ToolArguments = {
			kind: "edit",
			edits: [{ filePath: null, oldString: null, newString: null, content: null }],
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/tmp/README.md",
							oldString: null,
							newString: "# Hello",
							content: "# Hello",
						},
					],
				},
				rawInput: {
					file_path: "/tmp/ignored.md",
					content: "ignored",
				},
			})
		);

		expect(merged.kind).toBe("edit");
		if (merged.kind !== "edit") return;
		expect(merged.edits[0]?.filePath).toBe("/tmp/README.md");
		expect(merged.edits[0]?.content).toBe("# Hello");
		expect(merged.edits[0]?.newString).toBe("# Hello");
	});

	it("enriches codex edit permissions from rawInput.changes payload", () => {
		const base: ToolArguments = {
			kind: "edit",
			edits: [{ filePath: null, oldString: null, newString: null, content: null }],
		};

		const merged = mergePermissionArgs(
			base,
			createPermission({
				parsedArguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/Users/alex/Downloads/hello-world-go/blockchain/block.go",
							oldString: null,
							newString: null,
							content: null,
						},
					],
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
		expect(merged.edits[0]?.filePath).toBe(
			"/Users/alex/Downloads/hello-world-go/blockchain/block.go"
		);
		expect(merged.edits[0]?.oldString).toBe("old block content");
		expect(merged.edits[0]?.newString).toBe("new block content");
		expect(merged.edits[0]?.content).toBe("new block content");
	});
});
