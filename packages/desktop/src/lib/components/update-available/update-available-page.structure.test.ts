import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./update-available-page.svelte"), "utf8");

describe("update available page structure", () => {
	it("uses a denser full-width segmented progress bar", () => {
		expect(source).toContain("const UPDATE_PROGRESS_SEGMENT_COUNT = 96;");
		expect(source).not.toContain("const UPDATE_PROGRESS_SEGMENT_COUNT = 72;");
		expect(source).toContain("fillWidth={true}");
	});
});