import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const virtualizedSessionListPath = resolve(__dirname, "../virtualized-session-list.svelte");
const source = readFileSync(virtualizedSessionListPath, "utf8");

describe("virtualized session list PR badge state forwarding", () => {
	it("forwards prState to SessionItem so merged and closed badges render correctly", () => {
		expect(source).toContain("prNumber: row.item.prNumber");
		expect(source).toContain("prState: row.item.prState");
	});
});
