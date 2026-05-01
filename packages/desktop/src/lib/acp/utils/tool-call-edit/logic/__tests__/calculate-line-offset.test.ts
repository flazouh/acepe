import { describe, expect, it } from "bun:test";

import { findLineNumber } from "../calculate-line-offset.js";

describe("findLineNumber", () => {
	it("should find line number when search string is at the beginning", () => {
		const fileContent = "first line\nsecond line\nthird line";
		const searchString = "first line";

		const result = findLineNumber(fileContent, searchString);

		expect(result).toBe(1);
	});

	it("should find line number when search string is on the second line", () => {
		const fileContent = "first line\nsecond line\nthird line";
		const searchString = "second line";

		const result = findLineNumber(fileContent, searchString);

		expect(result).toBe(2);
	});

	it("should find line number when search string is on the third line", () => {
		const fileContent = "first line\nsecond line\nthird line";
		const searchString = "third line";

		const result = findLineNumber(fileContent, searchString);

		expect(result).toBe(3);
	});

	it("should return null when search string is not found", () => {
		const fileContent = "first line\nsecond line\nthird line";
		const searchString = "nonexistent";

		const result = findLineNumber(fileContent, searchString);

		expect(result).toBeNull();
	});

	it("should handle search string that spans multiple lines", () => {
		const fileContent = "first line\nsecond line\nthird line";
		const searchString = "second line\nthird line";

		const result = findLineNumber(fileContent, searchString);

		expect(result).toBe(2);
	});

	it("should handle empty file content", () => {
		const fileContent = "";
		const searchString = "anything";

		const result = findLineNumber(fileContent, searchString);

		expect(result).toBeNull();
	});

	it("should handle empty search string", () => {
		const fileContent = "first line\nsecond line";
		const searchString = "";

		const result = findLineNumber(fileContent, searchString);

		// Empty string is found at position 0, which is line 1
		expect(result).toBe(1);
	});

	it("should find correct line for partial match within a line", () => {
		const fileContent = "function hello() {\n  return 'world';\n}";
		const searchString = "return 'world'";

		const result = findLineNumber(fileContent, searchString);

		expect(result).toBe(2);
	});

	it("should handle Windows-style line endings", () => {
		const fileContent = "first line\r\nsecond line\r\nthird line";
		const searchString = "second line";

		const result = findLineNumber(fileContent, searchString);

		// When using \r\n, the \r is part of the line content
		// indexOf will find "second line" starting at position 12
		// Substring "first line\r\n" = 12 chars, split by \n = ["first line\r", ""] = 2 elements
		expect(result).toBe(2);
	});

	it("should find the first occurrence when search string appears multiple times", () => {
		const fileContent = "line one\nline two\nline one again";
		const searchString = "line one";

		const result = findLineNumber(fileContent, searchString);

		expect(result).toBe(1);
	});

	it("should handle realistic code snippet", () => {
		const fileContent = `import { Result } from 'neverthrow';

export function processData(input: string): Result<string, Error> {
	const trimmed = input.trim();
	return Ok(trimmed);
}`;
		const searchString = "const trimmed = input.trim();";

		const result = findLineNumber(fileContent, searchString);

		expect(result).toBe(4);
	});
});
