import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "./file-explorer-results-list.svelte"), "utf8");

describe("file explorer grouped project results", () => {
	it("renders project letter badges for grouped project sections", () => {
		expect(source).toContain("ProjectLetterBadge");
		expect(source).toContain("projectInfoByPath");
		expect(source).toContain("group.projectInfo.name");
		expect(source).toContain("group.projectInfo.color");
	});

	it("renders project grouping headers in the results list", () => {
		expect(source).toContain("groupedRows");
		expect(source).toContain("projectPath");
	});
});
