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

	it("splits layout settings into a Standard versus Kanban choice", () => {
		expect(existsSync(topBarPath)).toBe(true);
		if (!existsSync(topBarPath)) return;

		const topBarSource = readFileSync(topBarPath, "utf8");

		expect(topBarSource).toContain("type LayoutFamily = \"standard\" | \"kanban\";");
		expect(topBarSource).toContain("const isKanbanView = $derived(panelStore.viewMode === \"kanban\")");
		expect(topBarSource).toContain("function switchLayoutFamily(nextFamily: LayoutFamily): void {");
		expect(topBarSource).toContain('{ value: "standard", label: "Standard" }');
		expect(topBarSource).toContain('{ value: "kanban", label: "Kanban" }');
		expect(topBarSource).toContain('<span class="flex-1">View</span>');
		expect(topBarSource).toContain("{#each layoutFamilies as family (family.value)}");
		expect(topBarSource).toContain('import { Kanban } from "phosphor-svelte"');
	});

	it("reveals single, project, and multi choices only inside Standard", () => {
		expect(existsSync(topBarPath)).toBe(true);
		if (!existsSync(topBarPath)) return;

		const topBarSource = readFileSync(topBarPath, "utf8");

		expect(topBarSource).toContain(
			'const standardViewModes: { value: Exclude<ViewMode, "kanban">; label: string; color: string }[] = ['
		);
		expect(topBarSource).toContain('{#if !isKanbanView}');
		expect(topBarSource).toContain('<span class="flex-1">Grouping</span>');
		expect(topBarSource).toContain('label: "Single"');
		expect(topBarSource).toContain('label: "Project"');
		expect(topBarSource).toContain('label: "Multi"');
	});

	it("renders a kanban-only New Agent action in the top bar", () => {
		expect(existsSync(topBarPath)).toBe(true);
		if (!existsSync(topBarPath)) return;

		const topBarSource = readFileSync(topBarPath, "utf8");
		const kanbanActionsSource = topBarSource
			.split('{#if panelStore.viewMode === "kanban"}')[1]
			?.split("{:else}")[0];
		const nonKanbanActionsSource = topBarSource
			.split("{:else}")[1]
			?.split("{/if}")[0];

		expect(topBarSource).toContain('panelStore.viewMode === "kanban"');
		expect(topBarSource).toContain('showRightSectionLeadingBorder={panelStore.viewMode !== "kanban"}');
		expect(topBarSource).toContain('{#if panelStore.viewMode === "kanban"}\n\t\t\t<div class="flex items-center">');
		expect(topBarSource).toContain('<div class="flex items-center pl-2 pr-2">');
		expect(topBarSource).toContain('<span>New Agent</span>');
		expect(topBarSource).toContain("viewState.handleNewThread()");
		expect(topBarSource).toContain('class="gap-2 border-transparent hover:border-transparent"');
		expect(kanbanActionsSource).toBeDefined();
		expect(kanbanActionsSource).toContain('<span>New Agent</span>');
		expect(nonKanbanActionsSource).toBeDefined();
		expect(nonKanbanActionsSource).not.toContain('<span>New Agent</span>');
		expect(topBarSource).toContain('aria-label="Layout Settings"');
		expect(kanbanActionsSource).toContain("{@render layoutControl()}");
		expect(kanbanActionsSource.indexOf('<span>New Agent</span>')).toBeLessThan(
			kanbanActionsSource.indexOf("{@render layoutControl()}")
		);
	});
});
