import { describe, expect, it } from "bun:test";

import { resolveToolCallEditDiffs } from "../resolve-tool-call-edit-diffs.js";

describe("resolveToolCallEditDiffs", () => {
	it("returns every merged edit entry instead of only the first one", () => {
		const baseArguments = {
			kind: "edit" as const,
			edits: [
				{ type: "replaceText" as const, file_path: "src/one.ts", old_text: "one-old", new_text: "one-new" },
				{ type: "replaceText" as const, file_path: "src/two.ts", old_text: "two-old", new_text: "two-new" },
				{ type: "replaceText" as const, file_path: "src/three.ts", old_text: "three-old", new_text: "three-new" },
				{ type: "writeFile" as const, file_path: "src/four.ts", previous_content: "four-old", content: "four-new" },
				{ type: "writeFile" as const, file_path: "src/five.ts", previous_content: null, content: "five-new" },
			],
		};

		const result = resolveToolCallEditDiffs(baseArguments, undefined);

		expect(result).toHaveLength(5);
		expect(result.map((diff) => diff.filePath)).toEqual([
			"src/one.ts",
			"src/two.ts",
			"src/three.ts",
			"src/four.ts",
			"src/five.ts",
		]);
		expect(result.map((diff) => diff.newString)).toEqual([
			"one-new",
			"two-new",
			"three-new",
			"four-new",
			"five-new",
		]);
	});

	it("keeps base edit data when streaming updates only part of a later edit", () => {
		const baseArguments = {
			kind: "edit" as const,
			edits: [
				{ type: "replaceText" as const, file_path: "src/one.ts", old_text: "one-old", new_text: "one-new" },
				{ type: "replaceText" as const, file_path: "src/two.ts", old_text: "two-old", new_text: "two-new" },
			],
		};

		const streamingArguments = {
			kind: "edit" as const,
			edits: [
				{ type: "replaceText" as const, file_path: "src/one.ts", old_text: "one-old", new_text: "one-stream" },
			],
		};

		const result = resolveToolCallEditDiffs(baseArguments, streamingArguments);

		expect(result).toEqual([
			{ filePath: "src/one.ts", oldString: "one-old", newString: "one-stream" },
			{ filePath: "src/two.ts", oldString: "two-old", newString: "two-new" },
		]);
	});
});
