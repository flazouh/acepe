import { describe, expect, it } from "bun:test";

import { parseFilePathReference } from "../todo-badge-html.js";

describe("parseFilePathReference", () => {
	it("parses plain file path without location", () => {
		const result = parseFilePathReference("/path/to/file.ts");
		expect(result.filePath).toBe("/path/to/file.ts");
		expect(result.locationSuffix).toBe("");
	});

	it("parses file path with line number", () => {
		const result = parseFilePathReference("/path/to/file.ts:42");
		expect(result.filePath).toBe("/path/to/file.ts");
		expect(result.locationSuffix).toBe(":42");
	});

	it("parses file path with line and column", () => {
		const result = parseFilePathReference("/path/to/file.ts:42:10");
		expect(result.filePath).toBe("/path/to/file.ts");
		expect(result.locationSuffix).toBe(":42:10");
	});
});
