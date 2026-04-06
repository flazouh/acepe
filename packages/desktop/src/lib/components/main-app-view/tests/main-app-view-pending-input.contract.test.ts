import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "../../main-app-view.svelte"), "utf8");

describe("main app view pending input lifecycle contract", () => {
	it("clears pending turn inputs when a turn errors", () => {
		expect(source).toContain("onTurnError: (sessionId: string) => {");
		expect(source).toContain("clearPendingTurnInputs(sessionId);");
	});
});
