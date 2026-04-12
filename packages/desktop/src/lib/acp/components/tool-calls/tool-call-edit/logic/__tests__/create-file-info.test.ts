import { describe, expect, it } from "bun:test";

import type { ToolCall } from "../../../../../types/tool-call.js";

import { createFileInfo } from "../create-file-info.js";

function replaceTextEdit(
	file_path?: string,
	old_text?: string | null,
	new_text?: string | null
) {
	return { type: "replaceText" as const, file_path, old_text, new_text };
}

function writeFileEdit(file_path?: string, content?: string | null, previous_content?: string | null) {
	return { type: "writeFile" as const, file_path, previous_content, content };
}

describe("createFileInfo", () => {
	it("should extract file path and name", () => {
		const toolCall: ToolCall = {
			id: "test-1",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit("src/lib/utils.ts", undefined, "export const x = 1;")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.filePath).toBe("src/lib/utils.ts");
		expect(fileInfo.fileName).toBe("utils.ts");
	});

	it("should handle null file path", () => {
		const toolCall: ToolCall = {
			id: "test-2",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit(undefined, undefined, "content")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.filePath).toBeNull();
		expect(fileInfo.fileName).toBe("");
	});

	it("should fall back to first location path when edit arguments are empty", () => {
		const toolCall: ToolCall = {
			id: "test-location-fallback",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit(undefined, undefined, "content")],
			},
			locations: [{ path: "/tmp/location-fallback.md" }],
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.filePath).toBe("/tmp/location-fallback.md");
		expect(fileInfo.fileName).toBe("location-fallback.md");
	});

	it("should prefer edit argument file_path over location path", () => {
		const toolCall: ToolCall = {
			id: "test-location-precedence",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit("/tmp/from-arguments.md", undefined, "content")],
			},
			locations: [{ path: "/tmp/from-location.md" }],
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.filePath).toBe("/tmp/from-arguments.md");
		expect(fileInfo.fileName).toBe("from-arguments.md");
	});

	it("should calculate diff stats from old_string and new_string", () => {
		const toolCall: ToolCall = {
			id: "test-3",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [
					replaceTextEdit(
						"test.ts",
						"line1\nline2\nline3",
						"line1\nline2\nline3\nline4\nline5"
					),
				],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.diffStats).not.toBeNull();
		if (fileInfo.diffStats) {
			// Calculates actual changes: line4 and line5 added, nothing removed
			expect(fileInfo.diffStats.added).toBe(2);
			expect(fileInfo.diffStats.removed).toBe(0);
		}
	});

	it("should calculate diff stats from content", () => {
		const toolCall: ToolCall = {
			id: "test-4",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [writeFileEdit("test.ts", "line1\nline2\nline3")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.diffStats).not.toBeNull();
		if (fileInfo.diffStats) {
			expect(fileInfo.diffStats.added).toBe(3);
			expect(fileInfo.diffStats.removed).toBe(0);
		}
	});

	it("should return null diff stats when no content available", () => {
		const toolCall: ToolCall = {
			id: "test-5",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit("test.ts")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.diffStats).toBeNull();
	});

	it("should detect markdown files", () => {
		const toolCall: ToolCall = {
			id: "test-6",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit("README.md", undefined, "# Title")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.isMarkdown).toBe(true);
	});

	it("should detect non-markdown files", () => {
		const toolCall: ToolCall = {
			id: "test-7",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit("script.ts", undefined, "export const x = 1;")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.isMarkdown).toBe(false);
	});

	it("should handle case-insensitive markdown detection", () => {
		const toolCall: ToolCall = {
			id: "test-8",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit("readme.MD", undefined, "# Title")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const fileInfo = createFileInfo(toolCall);

		expect(fileInfo.isMarkdown).toBe(true);
	});

	it("should handle filePath variations", () => {
		const toolCall1: ToolCall = {
			id: "test-9",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit("src/file.ts", undefined, "content")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const toolCall2: ToolCall = {
			id: "test-10",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit("src/file.ts", undefined, "content")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const toolCall3: ToolCall = {
			id: "test-11",
			name: "edit",
			arguments: {
				kind: "edit",
				edits: [replaceTextEdit("src/file.ts", undefined, "content")],
			},
			status: "completed",
			awaitingPlanApproval: false,
		};

		const info1 = createFileInfo(toolCall1);
		const info2 = createFileInfo(toolCall2);
		const info3 = createFileInfo(toolCall3);

		expect(info1.filePath).toBe("src/file.ts");
		expect(info2.filePath).toBe("src/file.ts");
		expect(info3.filePath).toBe("src/file.ts");
	});
});
