import { describe, expect, it } from "vitest";

import { highlightMatches, parseGrepContent, parseSearchResult } from "../parse-grep-output.js";

describe("parseGrepContent", () => {
	it("parses match lines with colon separator", () => {
		const content = "/path/to/file.rs:42:fn main() {";
		const matches = parseGrepContent(content);

		expect(matches).toHaveLength(1);
		expect(matches[0]).toEqual({
			filePath: "/path/to/file.rs",
			fileName: "file.rs",
			lineNumber: 42,
			content: "fn main() {",
			isMatch: true,
		});
	});

	it("parses context lines with hyphen separator", () => {
		const content = "/path/to/file.rs-40-// Context line";
		const matches = parseGrepContent(content);

		expect(matches).toHaveLength(1);
		expect(matches[0]).toEqual({
			filePath: "/path/to/file.rs",
			fileName: "file.rs",
			lineNumber: 40,
			content: "// Context line",
			isMatch: false,
		});
	});

	it("parses multiple lines", () => {
		const content = `/path/file.rs-10-context before
/path/file.rs:11:matching line
/path/file.rs-12-context after`;

		const matches = parseGrepContent(content);

		expect(matches).toHaveLength(3);
		expect(matches[0].isMatch).toBe(false);
		expect(matches[1].isMatch).toBe(true);
		expect(matches[2].isMatch).toBe(false);
	});

	it("handles empty lines", () => {
		const content = `/path/file.rs:10:first

/path/file.rs:20:second`;

		const matches = parseGrepContent(content);
		expect(matches).toHaveLength(2);
	});
});

describe("parseSearchResult", () => {
	it("parses content mode with toolResponseMeta", () => {
		const result = {};
		const meta = {
			mode: "content",
			numFiles: 1,
			content: "/path/file.rs:10:matching line",
		};

		const parsed = parseSearchResult(result, meta);

		expect(parsed.mode).toBe("content");
		expect(parsed.numFiles).toBe(1);
		expect(parsed.matches).toHaveLength(1);
		expect(parsed.numMatches).toBe(1);
	});

	it("parses files_with_matches mode", () => {
		const result = {};
		const meta = {
			mode: "files_with_matches",
			numFiles: 3,
			filenames: ["/path/a.rs", "/path/b.rs", "/path/c.rs"],
		};

		const parsed = parseSearchResult(result, meta);

		expect(parsed.mode).toBe("files");
		expect(parsed.files).toHaveLength(3);
	});

	it("parses array result as files", () => {
		const result = ["/path/a.rs", "/path/b.rs"];

		const parsed = parseSearchResult(result, undefined);

		expect(parsed.mode).toBe("files");
		expect(parsed.files).toEqual(["/path/a.rs", "/path/b.rs"]);
	});

	it("returns empty result for null", () => {
		const parsed = parseSearchResult(null, undefined);

		expect(parsed.mode).toBe("files");
		expect(parsed.files).toHaveLength(0);
		expect(parsed.matches).toHaveLength(0);
	});

	it("parses grep stdout lines as content with a single-file searchPath", () => {
		const parsed = parseSearchResult(
			{
				stdout: '6:\t"scripts": {\n23:\t\t"translate:update": "inlang machine translate --force"',
			},
			undefined,
			"packages/desktop/package.json"
		);

		expect(parsed.mode).toBe("content");
		expect(parsed.numFiles).toBe(1);
		expect(parsed.numMatches).toBe(2);
		expect(parsed.matches).toHaveLength(2);
		expect(parsed.matches[0]).toEqual(
			expect.objectContaining({
				filePath: "packages/desktop/package.json",
				fileName: "package.json",
				lineNumber: 6,
				isMatch: true,
			})
		);
	});

	it("parses plain stdout match lines without file metadata", () => {
		const parsed = parseSearchResult({ stdout: "beta\n" });

		expect(parsed.mode).toBe("content");
		expect(parsed.numFiles).toBe(1);
		expect(parsed.numMatches).toBe(1);
		expect(parsed.matches).toHaveLength(1);
		expect(parsed.matches[0]).toEqual(
			expect.objectContaining({
				filePath: "stdout",
				fileName: "stdout",
				lineNumber: 1,
				content: "beta",
				isMatch: true,
			})
		);
	});
});

describe("highlightMatches", () => {
	it("highlights pattern matches", () => {
		const content = "function test() { return true; }";
		const pattern = "test";

		const segments = highlightMatches(content, pattern);

		expect(segments).toHaveLength(3);
		expect(segments[0]).toEqual({ text: "function ", isMatch: false });
		expect(segments[1]).toEqual({ text: "test", isMatch: true });
		expect(segments[2]).toEqual({ text: "() { return true; }", isMatch: false });
	});

	it("returns unhighlighted content when no pattern", () => {
		const content = "some text";
		const segments = highlightMatches(content, null);

		expect(segments).toHaveLength(1);
		expect(segments[0]).toEqual({ text: "some text", isMatch: false });
	});

	it("handles case-insensitive matching", () => {
		const content = "Test TEST test";
		const pattern = "test";

		const segments = highlightMatches(content, pattern);

		// Should match all 3 occurrences
		const matchedSegments = segments.filter((s) => s.isMatch);
		expect(matchedSegments).toHaveLength(3);
	});

	it("escapes regex special characters", () => {
		const content = "file.*.ts matches";
		const pattern = "file.*";

		const segments = highlightMatches(content, pattern);

		const matchedSegments = segments.filter((s) => s.isMatch);
		expect(matchedSegments).toHaveLength(1);
		expect(matchedSegments[0].text).toBe("file.*");
	});
});
