import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./attention-queue-entry.svelte"), "utf8");

describe("attention queue entry contract", () => {
	it("keeps latest task subagent tool optional for callers that do not render task cards", () => {
		expect(source).toContain("latestTaskSubagentTool?:");
		expect(source).toContain("latestTaskSubagentTool = null");
	});
});