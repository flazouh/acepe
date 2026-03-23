import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const panelsContainerPath = resolve(__dirname, "./panels-container.svelte");
const source = readFileSync(panelsContainerPath, "utf8");

describe("PanelsContainer fullscreen AgentPanel bindings", () => {
	it("uses a null-safe snapshot for fullscreen AgentPanel props", () => {
		expect(source).toContain("const fullscreenPanelSnapshot = $derived.by(() => {");
		expect(source).toContain("panelId={fullscreenPanelSnapshot.panelId}");
		expect(source).toContain("sessionId={fullscreenPanelSnapshot.sessionId}");
		expect(source).toContain("width={fullscreenPanelSnapshot.width}");
		expect(source).toContain(
			"panelStore.updatePanelSession(fullscreenPanelSnapshot.panelId, sessionId)"
		);
	});

	it("uses a null-safe snapshot for source control GitPanel props", () => {
		expect(source).toContain("const sourceControlPanelSnapshot = $derived.by(() => {");
		expect(source).toContain("panelId={sourceControlPanelSnapshot.id}");
		expect(source).toContain("projectPath={sourceControlPanelSnapshot.projectPath}");
		expect(source).toContain("width={sourceControlPanelSnapshot.width}");
		expect(source).toContain(
			"onClose={() => panelStore.closeGitPanel(sourceControlPanelSnapshot.id)}"
		);
	});
});
