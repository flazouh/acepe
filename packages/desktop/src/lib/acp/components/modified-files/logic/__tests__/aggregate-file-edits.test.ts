import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../../application/dto/session.js";

import { aggregateFileEdits } from "../aggregate-file-edits.js";

function createEditEntry(
	id: string,
	filePath: string,
	oldString: string | null,
	newString: string | null
): SessionEntry {
	return {
		id,
		type: "tool_call",
		message: {
			id: `tc-${id}`,
			name: "Edit",
			kind: "edit",
			status: "completed",
			arguments: {
				kind: "edit",
				file_path: filePath,
				old_string: oldString,
				new_string: newString,
			},
		},
	} as SessionEntry;
}

function createWriteEntry(id: string, filePath: string, content: string): SessionEntry {
	return {
		id,
		type: "tool_call",
		message: {
			id: `tc-${id}`,
			name: "Write",
			kind: "edit",
			status: "completed",
			arguments: {
				kind: "edit",
				file_path: filePath,
				content,
			},
		},
	} as SessionEntry;
}

function createReadEntry(id: string, filePath: string): SessionEntry {
	return {
		id,
		type: "tool_call",
		message: {
			id: `tc-${id}`,
			name: "Read",
			kind: "read",
			status: "completed",
			arguments: {
				kind: "read",
				file_path: filePath,
			},
		},
	} as SessionEntry;
}

function createUserEntry(id: string, content: string): SessionEntry {
	return {
		id,
		type: "user",
		message: { content, chunks: [] },
	} as unknown as SessionEntry;
}

describe("aggregateFileEdits", () => {
	describe("empty and edge cases", () => {
		it("should return empty state for empty entries", () => {
			const result = aggregateFileEdits([]);
			expect(result.fileCount).toBe(0);
			expect(result.totalEditCount).toBe(0);
			expect(result.files).toEqual([]);
		});

		it("should ignore non-edit tool calls", () => {
			const entries = [createReadEntry("1", "/src/app.ts")];
			const result = aggregateFileEdits(entries);
			expect(result.fileCount).toBe(0);
			expect(result.totalEditCount).toBe(0);
		});

		it("should ignore user entries", () => {
			const entries = [createUserEntry("1", "Hello")];
			const result = aggregateFileEdits(entries);
			expect(result.fileCount).toBe(0);
			expect(result.totalEditCount).toBe(0);
		});

		it("should ignore edit entries without file path", () => {
			const entry: SessionEntry = {
				id: "1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Edit",
					kind: "edit",
					status: "completed",
					arguments: {
						kind: "edit",
						old_string: "a",
						new_string: "b",
					},
				},
			} as SessionEntry;
			const result = aggregateFileEdits([entry]);
			expect(result.fileCount).toBe(0);
		});
	});

	describe("single file edits", () => {
		it("should aggregate single edit", () => {
			const entries = [createEditEntry("1", "/src/app.ts", "line1", "line1\nline2")];
			const result = aggregateFileEdits(entries);

			expect(result.fileCount).toBe(1);
			expect(result.totalEditCount).toBe(1);
			expect(result.files[0].filePath).toBe("/src/app.ts");
			expect(result.files[0].fileName).toBe("app.ts");
			expect(result.files[0].editCount).toBe(1);
			// Calculates actual changes: "line2" is added, nothing removed
			expect(result.files[0].totalAdded).toBe(1);
			expect(result.files[0].totalRemoved).toBe(0);
		});

		it("should handle write operation (new file)", () => {
			const entries = [createWriteEntry("1", "/src/new-file.ts", "line1\nline2\nline3")];
			const result = aggregateFileEdits(entries);

			expect(result.fileCount).toBe(1);
			expect(result.files[0].totalAdded).toBe(3);
			expect(result.files[0].totalRemoved).toBe(0);
			expect(result.files[0].finalContent).toBe("line1\nline2\nline3");
		});

		it("should capture original and final content", () => {
			const entries = [createEditEntry("1", "/src/app.ts", "old", "new")];
			const result = aggregateFileEdits(entries);

			expect(result.files[0].editCount).toBe(1);
			expect(result.files[0].originalContent).toBe("old");
			expect(result.files[0].finalContent).toBe("new");
		});
	});

	describe("multiple edits to same file", () => {
		it("should aggregate multiple edits to same file", () => {
			const entries = [
				createEditEntry("1", "/src/app.ts", "a", "a\nb"),
				createEditEntry("2", "/src/app.ts", "a\nb", "a\nb\nc"),
			];
			const result = aggregateFileEdits(entries);

			expect(result.fileCount).toBe(1);
			expect(result.totalEditCount).toBe(2);
			expect(result.files[0].editCount).toBe(2);
			// Calculates actual changes: edit1 adds "b", edit2 adds "c"
			expect(result.files[0].totalAdded).toBe(2); // 1 + 1
			expect(result.files[0].totalRemoved).toBe(0); // 0 + 0
		});

		it("should track original content from first edit and final content from last edit", () => {
			const entries = [
				createEditEntry("1", "/src/app.ts", "first-old", "first-new"),
				createEditEntry("2", "/src/app.ts", "second-old", "second-new"),
			];
			const result = aggregateFileEdits(entries);

			expect(result.files[0].editCount).toBe(2);
			expect(result.files[0].originalContent).toBe("first-old");
			expect(result.files[0].finalContent).toBe("second-new");
		});

		it("should accumulate line stats across edits", () => {
			const entries = [
				createEditEntry("1", "/src/app.ts", "a", "a\nb"),
				createEditEntry("2", "/src/app.ts", "a\nb", "a\nb\nc\nd"),
			];
			const result = aggregateFileEdits(entries);

			// edit1: "a" -> "a\nb" adds 1 line
			// edit2: "a\nb" -> "a\nb\nc\nd" adds 2 lines
			expect(result.files[0].totalAdded).toBe(3);
			expect(result.files[0].totalRemoved).toBe(0);
		});
	});

	describe("multiple different files", () => {
		it("should handle multiple different files", () => {
			const entries = [
				createEditEntry("1", "/src/app.ts", "a", "b"),
				createWriteEntry("2", "/src/utils.ts", "new file"),
				createEditEntry("3", "/src/index.ts", "x", "y\nz"),
			];
			const result = aggregateFileEdits(entries);

			expect(result.fileCount).toBe(3);
			expect(result.totalEditCount).toBe(3);
		});

		it("should correctly aggregate mixed edits to multiple files", () => {
			const entries = [
				createEditEntry("1", "/src/a.ts", "1", "1\n2"),
				createEditEntry("2", "/src/b.ts", "x", "x\ny"),
				createEditEntry("3", "/src/a.ts", "1\n2", "1\n2\n3"),
				createEditEntry("4", "/src/b.ts", "x\ny", "x\ny\nz"),
			];
			const result = aggregateFileEdits(entries);

			expect(result.fileCount).toBe(2);
			expect(result.totalEditCount).toBe(4);

			const fileA = result.files.find((f) => f.filePath === "/src/a.ts");
			const fileB = result.files.find((f) => f.filePath === "/src/b.ts");

			expect(fileA?.editCount).toBe(2);
			expect(fileB?.editCount).toBe(2);
		});
	});

	describe("file path extraction", () => {
		it("should handle file_path argument", () => {
			const entries = [createEditEntry("1", "/src/app.ts", "a", "b")];
			const result = aggregateFileEdits(entries);
			expect(result.files[0].filePath).toBe("/src/app.ts");
		});

		it("should handle missing file_path gracefully", () => {
			const entry: SessionEntry = {
				id: "1",
				type: "tool_call",
				message: {
					id: "tc-1",
					name: "Edit",
					kind: "edit",
					status: "completed",
					arguments: {
						kind: "edit",
						old_string: "a",
						new_string: "b",
					},
				},
			} as SessionEntry;
			const result = aggregateFileEdits([entry]);
			expect(result.fileCount).toBe(0);
		});
	});

	describe("mixed entry types", () => {
		it("should only count edit tool calls", () => {
			const entries = [
				createUserEntry("1", "Hello"),
				createEditEntry("2", "/src/app.ts", "a", "b"),
				createReadEntry("3", "/src/app.ts"),
				createWriteEntry("4", "/src/new.ts", "content"),
			];
			const result = aggregateFileEdits(entries);

			expect(result.fileCount).toBe(2);
			expect(result.totalEditCount).toBe(2);
		});
	});

	describe("nested task children", () => {
		it("includes edit children nested under task tool calls", () => {
			const parentTaskEntry: SessionEntry = {
				id: "task-entry-1",
				type: "tool_call",
				message: {
					id: "task-1",
					name: "Task",
					kind: "task",
					status: "completed",
					arguments: {
						kind: "think",
						description: "run subtools",
					},
					taskChildren: [
						{
							id: "child-edit-1",
							name: "Edit",
							kind: "edit",
							status: "completed",
							arguments: {
								kind: "edit",
								file_path: "/src/agent-input-ui.svelte",
								old_string: "old",
								new_string: "new",
							},
							taskChildren: null,
						},
						{
							id: "child-task-2",
							name: "Task",
							kind: "task",
							status: "completed",
							arguments: {
								kind: "think",
								description: "nested task",
							},
							taskChildren: [
								{
									id: "grandchild-edit-1",
									name: "Edit",
									kind: "edit",
									status: "completed",
									arguments: {
										kind: "edit",
										file_path: "/src/review-panel.svelte",
										old_string: "before",
										new_string: "after",
									},
									taskChildren: null,
								},
							],
						},
					],
				},
			} as SessionEntry;

			const result = aggregateFileEdits([parentTaskEntry]);

			expect(result.fileCount).toBe(2);
			expect(result.totalEditCount).toBe(2);
			expect(result.byPath.has("/src/agent-input-ui.svelte")).toBe(true);
			expect(result.byPath.has("/src/review-panel.svelte")).toBe(true);
		});
	});
});
