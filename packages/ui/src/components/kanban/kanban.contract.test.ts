import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const kanbanDir = import.meta.dir;
const kanbanIndexPath = resolve(kanbanDir, "./index.ts");
const rootUiIndexPath = resolve(kanbanDir, "../../index.ts");
const kanbanCardPath = resolve(kanbanDir, "./kanban-card.svelte");
const kanbanBoardPath = resolve(kanbanDir, "./kanban-board.svelte");
const kanbanColumnPath = resolve(kanbanDir, "./kanban-column.svelte");
const questionFooterPath = resolve(kanbanDir, "./kanban-question-footer.svelte");
const kanbanTypesPath = resolve(kanbanDir, "./types.ts");

describe("kanban UI contract", () => {
	it("adds the shared kanban presentational files", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		expect(existsSync(kanbanBoardPath)).toBe(true);
		expect(existsSync(kanbanColumnPath)).toBe(true);
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
		expect(kanbanIndexSource).toContain("KanbanQuestionFooter");
		expect(rootUiIndexSource).toContain("KanbanBoard");
		expect(rootUiIndexSource).toContain("KanbanCardData");
	});

	it("keeps the kanban card aligned with the shared queue visual language", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		if (!existsSync(kanbanCardPath)) return;

		const cardSource = readFileSync(kanbanCardPath, "utf8");

		expect(cardSource).toContain("ProjectLetterBadge");
		expect(cardSource).toContain("MarkdownDisplay");
		expect(cardSource).toContain("SegmentedProgress");
		expect(cardSource).toContain("DiffPill");
		expect(cardSource).toContain("AgentToolRow");
		expect(cardSource).toContain("ToolTally");
		expect(cardSource).toContain("TextShimmer");
		expect(cardSource).toContain("cursor-pointer");
		expect(cardSource).toContain("hover:border-border");
		expect(cardSource).toContain("hover:bg-accent/45");
		expect(cardSource).toContain("hover:translate-x-px");
		expect(cardSource).not.toContain("hover:-translate-y-px");
		expect(cardSource).toContain("kanban-markdown-preview");
		expect(cardSource).toContain(
			'<MarkdownDisplay content={card.previewMarkdown} scrollable={true} class="kanban-markdown-preview text-[10px]" />'
		);
		expect(cardSource).toContain('class="flex flex-col gap-1 border-t border-border/40 px-1 py-1.5"');
		expect(cardSource).not.toContain('class="flex flex-col gap-1 border-t border-border/40 py-1.5"');
		expect(cardSource).not.toContain(
			'kanban-markdown-preview overflow-hidden rounded-sm border border-border/40 bg-background/40'
		);
		expect(cardSource).toContain("padding: 0 0.5rem;");
		expect(cardSource).toContain("max-height: 4.5rem;");
		expect(cardSource).not.toContain("overflow: hidden;");
		expect(cardSource).toContain('data-testid="kanban-card"');
		expect(cardSource).toContain('data-testid="kanban-card-header"');
		expect(cardSource).toContain('data-testid="kanban-card-tally"');
		expect(cardSource).toContain("QueueSubagentCard");
		expect(cardSource).toContain("summary={card.taskCard.summary}");
		expect(cardSource).toContain("isStreaming={card.taskCard.isStreaming}");
		expect(cardSource).toContain("latestTool={card.taskCard.latestTool}");
		expect(cardSource).toContain("toolCalls={[...card.taskCard.toolCalls]}");
		expect(cardSource).toContain("{card.todoProgress.label}");
		expect(cardSource).not.toContain("AgentToolTask");
	});

	it("only renders footer sections when there is actual footer content", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		if (!existsSync(kanbanCardPath)) return;

		const cardSource = readFileSync(kanbanCardPath, "utf8");

		expect(cardSource).toContain("showFooter?: boolean;");
		expect(cardSource).toContain("showFooter = false");
		expect(cardSource).toContain("const hasFooterContent = $derived(");
		expect(cardSource).toContain("hasDiff || card.todoProgress !== null || card.toolCalls.length > 0");
		expect(cardSource).toContain("{#if showFooter && footer}");
		expect(cardSource).toContain("{#if hasFooterContent}");
	});

	it("makes the kanban board claim the available width in flex layouts", () => {
		expect(existsSync(kanbanBoardPath)).toBe(true);
		if (!existsSync(kanbanBoardPath)) return;

		const boardSource = readFileSync(kanbanBoardPath, "utf8");

		expect(boardSource).toContain('class="flex h-full w-full min-w-0 flex-1');
	});
});