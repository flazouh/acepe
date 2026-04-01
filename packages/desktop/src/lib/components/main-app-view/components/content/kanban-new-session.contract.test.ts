import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const contentDir = import.meta.dir;
const kanbanViewPath = resolve(contentDir, "./kanban-view.svelte");
const dialogPath = resolve(contentDir, "./kanban-new-session-dialog.svelte");

describe("kanban new-session dialog contract", () => {
	it("renders a top-right new-session entry point in the kanban view", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain('import KanbanNewSessionDialog from "./kanban-new-session-dialog.svelte"');
		expect(source).toContain("projectManager: ProjectManager");
		expect(source).toContain("<KanbanNewSessionDialog {projectManager} />");
	});

	it("builds the dialog around the shared agent composer flow", () => {
		expect(existsSync(dialogPath)).toBe(true);
		if (!existsSync(dialogPath)) return;

		const source = readFileSync(dialogPath, "utf8");

		expect(source).toContain("AgentInput");
		expect(source).toContain("Dialog.Root");
		expect(source).toContain("SelectTrigger");
		expect(source).toContain("onSessionCreated");
		expect(source).toContain('panelStore.setViewMode("single")');
		expect(source).toContain("projectManager.projects");
	});
});