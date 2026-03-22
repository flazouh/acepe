import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const statePath = resolve(__dirname, "../logic/main-app-view-state.svelte.ts");
const source = readFileSync(statePath, "utf8");

describe("MainAppViewState new-thread project flow", () => {
	it("spawns panel with agent but no eager session for new thread", () => {
		expect(source).toContain("this.panelStore.spawnPanel(");
		expect(source).toContain("this.panelStore.setPanelAgent(panel.id, agentId);");
		// Session creation is deferred to first message — no eager sessions
		expect(source).not.toContain("createEagerSession");
		expect(source).not.toContain("handleCreateEagerSessionForProject");
	});

	it("does not create a session when only changing the selected agent on an empty panel", () => {
		expect(source).toContain("handlePanelAgentChange(panelId: string, agentId: string): void {");
		expect(source).toContain("this.panelStore.setPanelAgent(panelId, agentId);");
		expect(source).not.toContain("this.sessionStore\n\t\t\t.createSession({");
	});
});
