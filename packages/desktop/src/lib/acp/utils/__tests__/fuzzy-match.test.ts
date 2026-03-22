import { describe, expect, it } from "vitest";

import type { IndexedFile } from "../../../services/converted-session-types.js";

import { fuzzyMatchFiles } from "../fuzzy-match.js";

const createFile = (path: string, lineCount = 100): IndexedFile => ({
	path,
	extension: path.split(".").pop() ?? "",
	lineCount,
	gitStatus: null,
});

describe("fuzzyMatchFiles", () => {
	const testFiles: IndexedFile[] = [
		createFile("src/lib/utils/fuzzy-match.ts", 50),
		createFile("src/lib/components/button.svelte", 30),
		createFile("src/lib/components/modal.svelte", 80),
		createFile("src/routes/+page.svelte", 120),
		createFile("package.json", 25),
		createFile("README.md", 10),
		createFile("src/lib/acp/components/agent-input/agent-input-ui.svelte", 200),
	];

	it("returns all files sorted by path length when query is empty", () => {
		const results = fuzzyMatchFiles("", testFiles);

		expect(results.length).toBe(testFiles.length);
		// Shorter paths should come first
		expect(results[0].item.path).toBe("README.md");
		expect(results[1].item.path).toBe("package.json");
	});

	it("matches exact filename substring with highest priority", () => {
		const results = fuzzyMatchFiles("button", testFiles);

		expect(results.length).toBe(1);
		expect(results[0].item.path).toBe("src/lib/components/button.svelte");
		expect(results[0].score).toBeGreaterThan(1000); // Exact filename match score
	});

	it("matches partial filename", () => {
		const results = fuzzyMatchFiles("modal", testFiles);

		expect(results.length).toBe(1);
		expect(results[0].item.path).toBe("src/lib/components/modal.svelte");
	});

	it("matches path substring", () => {
		const results = fuzzyMatchFiles("components", testFiles);

		expect(results.length).toBe(3);
		// All component files should match
		const paths = results.map((r) => r.item.path);
		expect(paths).toContain("src/lib/components/button.svelte");
		expect(paths).toContain("src/lib/components/modal.svelte");
		expect(paths).toContain("src/lib/acp/components/agent-input/agent-input-ui.svelte");
	});

	it("performs fuzzy matching on filename", () => {
		const results = fuzzyMatchFiles("btn", testFiles);

		// "btn" matches "button" (b-t-n) and possibly "agent-input" (a-g-e-n-t)
		expect(results.length).toBeGreaterThanOrEqual(1);
		// button.svelte should rank highest due to better consecutive match
		expect(results[0].item.path).toBe("src/lib/components/button.svelte");
	});

	it("performs fuzzy matching on path when filename doesn't match", () => {
		const results = fuzzyMatchFiles("acp", testFiles);

		expect(results.length).toBe(1);
		expect(results[0].item.path).toBe("src/lib/acp/components/agent-input/agent-input-ui.svelte");
	});

	it("returns empty array when no matches", () => {
		const results = fuzzyMatchFiles("xyz123", testFiles);

		expect(results.length).toBe(0);
	});

	it("respects maxResults limit", () => {
		const results = fuzzyMatchFiles("", testFiles, 3);

		expect(results.length).toBe(3);
	});

	it("prioritizes earlier matches in filename", () => {
		const files: IndexedFile[] = [
			createFile("src/modal-button.ts"),
			createFile("src/button-modal.ts"),
		];

		const results = fuzzyMatchFiles("button", files);

		expect(results.length).toBe(2);
		// button-modal should rank higher (button appears earlier)
		expect(results[0].item.path).toBe("src/button-modal.ts");
	});

	it("ranks shorter paths higher for same score", () => {
		const files: IndexedFile[] = [
			createFile("src/deep/nested/path/button.ts"),
			createFile("src/button.ts"),
		];

		const results = fuzzyMatchFiles("button", files);

		expect(results.length).toBe(2);
		// Shorter path should rank higher
		expect(results[0].item.path).toBe("src/button.ts");
	});

	it("handles case-insensitive matching", () => {
		const results = fuzzyMatchFiles("README", testFiles);

		expect(results.length).toBe(1);
		expect(results[0].item.path).toBe("README.md");
	});

	it("handles extension matching", () => {
		const results = fuzzyMatchFiles(".svelte", testFiles);

		expect(results.length).toBe(4);
		for (const result of results) {
			expect(result.item.path.endsWith(".svelte")).toBe(true);
		}
	});
});
