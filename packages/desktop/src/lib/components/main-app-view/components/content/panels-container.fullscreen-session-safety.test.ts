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

	it("does not render source control as a workspace panel", () => {
		expect(source).not.toContain("import { GitPanel }");
		expect(source).not.toContain('{:else if fullscreenTopLevelPanel.kind === "git"}');
		expect(source).not.toContain("{#each group.gitPanels as gitPanel (gitPanel.id)}");
	});

	it("shows the embedded project badge for agent panels when only one project group exists", () => {
		expect(source).toContain("const hideEmbeddedProjectBadge = $derived(allGroups.length > 1);");
		expect(source.match(/hideProjectBadge=\{hideEmbeddedProjectBadge\}/g)?.length).toBe(2);
	});
});
