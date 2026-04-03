import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const kanbanThreadDialogPath = resolve(__dirname, "./kanban-thread-dialog.svelte");
const source = readFileSync(kanbanThreadDialogPath, "utf8");

describe("kanban thread dialog contract", () => {
	it("uses a null-safe snapshot for AgentPanel bindings", () => {
		expect(source).toContain("const panelSnapshot = $derived.by(() => {");
			expect(source).toContain('panelId: panel ? panel.id : "",');
		expect(source).toContain(
			'const isPanelOpen = $derived(panelId !== null && panelSnapshot.panelId !== "");'
		);
		expect(source).toContain("<Dialog.Root open={isPanelOpen} onOpenChange={handleOpenChange}>");
		expect(source).toContain("panelId={panelSnapshot.panelId}");
		expect(source).toContain("sessionId={panelSnapshot.sessionId}");
		expect(source).toContain(
			"panelStore.updatePanelSession(panelSnapshot.panelId, sessionId)"
		);
		expect(source).not.toContain("<Dialog.Root open={panelSnapshot !== null} onOpenChange={handleOpenChange}>");
	});

	it("centers the agent panel and lets the panel define the visible dialog shell", () => {
		expect(source).toContain('class="flex h-[90vh] w-fit max-w-[96vw] items-center justify-center overflow-visible border-0 bg-transparent p-0 shadow-none"');
		expect(source).not.toContain('<div class="flex h-full min-h-0 flex-col overflow-hidden rounded-md">');
	});

	it("dismisses the kanban dialog from the panel close button without closing the live panel session", () => {
		expect(source).toContain("onClose={() => {");
		expect(source).toContain("onClose();");
		expect(source).not.toContain("state.handleClosePanel(panelSnapshot.panelId);");
	});
});