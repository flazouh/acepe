import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const contentDir = import.meta.dir;
const panelsContainerPath = resolve(contentDir, "./panels-container.svelte");
const kanbanViewPath = resolve(contentDir, "./kanban-view.svelte");
const appSidebarPath = resolve(contentDir, "../sidebar/app-sidebar.svelte");
const topBarPath = resolve(contentDir, "../../../top-bar/top-bar.svelte");

describe("kanban layout wiring contract", () => {
	it("routes the app shell through a dedicated kanban view", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		expect(existsSync(panelsContainerPath)).toBe(true);
		if (!existsSync(kanbanViewPath) || !existsSync(panelsContainerPath)) return;

		const panelsContainerSource = readFileSync(panelsContainerPath, "utf8");

		expect(panelsContainerSource).toContain('import KanbanView from "./kanban-view.svelte"');
		expect(panelsContainerSource).toContain('viewModeState.layout === "kanban"');
		expect(panelsContainerSource).toContain("<KanbanView");
	});

	it("hides the sidebar queue when the board is active", () => {
		expect(existsSync(appSidebarPath)).toBe(true);
		if (!existsSync(appSidebarPath)) return;

		const appSidebarSource = readFileSync(appSidebarPath, "utf8");

		expect(appSidebarSource).toContain('panelStore.viewMode !== "kanban"');
		expect(appSidebarSource).toContain("<AppQueueRow");
	});

	it("adds kanban to the top-bar layout selector", () => {
		expect(existsSync(topBarPath)).toBe(true);
		if (!existsSync(topBarPath)) return;

		const topBarSource = readFileSync(topBarPath, "utf8");

		expect(topBarSource).toContain('value: "kanban"');
		expect(topBarSource).toContain('phosphor-svelte/lib/Kanban');
	});
});