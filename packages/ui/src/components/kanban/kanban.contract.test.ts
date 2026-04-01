import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const kanbanDir = import.meta.dir;
const kanbanIndexPath = resolve(kanbanDir, "./index.ts");
const rootUiIndexPath = resolve(kanbanDir, "../../index.ts");
const kanbanCardPath = resolve(kanbanDir, "./kanban-card.svelte");
const kanbanBoardPath = resolve(kanbanDir, "./kanban-board.svelte");
const kanbanColumnPath = resolve(kanbanDir, "./kanban-column.svelte");
const permissionFooterPath = resolve(kanbanDir, "./kanban-permission-footer.svelte");
const questionFooterPath = resolve(kanbanDir, "./kanban-question-footer.svelte");
const kanbanTypesPath = resolve(kanbanDir, "./types.ts");

describe("kanban UI contract", () => {
	it("adds the shared kanban presentational files", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		expect(existsSync(kanbanBoardPath)).toBe(true);
		expect(existsSync(kanbanColumnPath)).toBe(true);
		expect(existsSync(permissionFooterPath)).toBe(true);
		expect(existsSync(questionFooterPath)).toBe(true);
		expect(existsSync(kanbanTypesPath)).toBe(true);
		expect(existsSync(kanbanIndexPath)).toBe(true);
	});

	it("exports the kanban components from the UI package", () => {
		expect(existsSync(kanbanIndexPath)).toBe(true);
		expect(existsSync(rootUiIndexPath)).toBe(true);
		if (!existsSync(kanbanIndexPath) || !existsSync(rootUiIndexPath)) return;

		const kanbanIndexSource = readFileSync(kanbanIndexPath, "utf8");
		const rootUiIndexSource = readFileSync(rootUiIndexPath, "utf8");

		expect(kanbanIndexSource).toContain("KanbanBoard");
		expect(kanbanIndexSource).toContain("KanbanCard");
		expect(kanbanIndexSource).toContain("KanbanColumn");
		expect(kanbanIndexSource).toContain("KanbanPermissionFooter");
		expect(kanbanIndexSource).toContain("KanbanQuestionFooter");
		expect(rootUiIndexSource).toContain("KanbanBoard");
		expect(rootUiIndexSource).toContain("KanbanCardData");
	});

	it("keeps the kanban card aligned with the shared queue visual language", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		if (!existsSync(kanbanCardPath)) return;

		const cardSource = readFileSync(kanbanCardPath, "utf8");

		expect(cardSource).toContain("ProjectLetterBadge");
		expect(cardSource).toContain("PlanIcon");
		expect(cardSource).toContain("BuildIcon");
		expect(cardSource).toContain("SegmentedProgress");
		expect(cardSource).toContain("DiffPill");
		expect(cardSource).toContain("AgentToolRow");
		expect(cardSource).toContain("ToolTally");
		expect(cardSource).toContain("TextShimmer");
		expect(cardSource).toContain('data-testid="kanban-card"');
		expect(cardSource).toContain('data-testid="kanban-card-accent"');
		expect(cardSource).toContain('data-testid="kanban-card-header"');
		expect(cardSource).toContain('data-testid="kanban-card-tally"');
	});

	it("makes the kanban board claim the available width in flex layouts", () => {
		expect(existsSync(kanbanBoardPath)).toBe(true);
		if (!existsSync(kanbanBoardPath)) return;

		const boardSource = readFileSync(kanbanBoardPath, "utf8");

		expect(boardSource).toContain('class="flex h-full w-full min-w-0 flex-1');
	});
});