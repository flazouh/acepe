import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const agentPanelPath = resolve(__dirname, "../agent-panel.svelte");
const source = readFileSync(agentPanelPath, "utf8");

describe("agent panel PR details fetching", () => {
	it("reacts to session PR changes instead of only reading the initial sessionId", () => {
		expect(source).toContain("const prFetchTarget = $derived.by(() => {");
		expect(source).toContain("fetchPrDetails(prFetchTarget);");
		expect(source).not.toContain("const session = sessionId ? sessionStore.getSessionCold(sessionId) : null;");
	});
});
