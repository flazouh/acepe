import { describe, expect, it } from "bun:test";

import { resolveToolCallEditDiffs } from "../resolve-tool-call-edit-diffs.js";

describe("resolveToolCallEditDiffs", () => {
	it("returns every merged edit entry instead of only the first one", () => {
		const baseArguments = {
			kind: "edit" as const,
			edits: [
				{ filePath: "src/one.ts", oldString: "one-old", newString: "one-new" },
				{ filePath: "src/two.ts", oldString: "two-old", newString: "two-new" },
				{ filePath: "src/three.ts", oldString: "three-old", newString: "three-new" },
				{ filePath: "src/four.ts", oldString: "four-old", newString: "four-new" },
				{ filePath: "src/five.ts", oldString: "five-old", newString: "five-new" },
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
				{ filePath: "src/one.ts", oldString: "one-old", newString: "one-new" },
				{ filePath: "src/two.ts", oldString: "two-old", newString: "two-new" },
			],
		};

		const streamingArguments = {
			kind: "edit" as const,
			edits: [{ filePath: "src/one.ts", oldString: "one-old", newString: "one-stream" }],
		};

		const result = resolveToolCallEditDiffs(baseArguments, streamingArguments);

		expect(result).toEqual([
			{ filePath: "src/one.ts", oldString: "one-old", newString: "one-stream" },
			{ filePath: "src/two.ts", oldString: "two-old", newString: "two-new" },
		]);
	});
});
