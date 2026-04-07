import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const virtualizedSessionListPath = resolve(__dirname, "../virtualized-session-list.svelte");
const source = readFileSync(virtualizedSessionListPath, "utf8");

describe("virtualized session list project color forwarding", () => {
	it("forwards projectColor to SessionItem so sequence badges keep the project color", () => {
		expect(source).toContain("projectColor: row.item.projectColor");
	});
});
