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
const kanbanSceneBoardPath = resolve(kanbanDir, "./kanban-scene-board.svelte");
const kanbanSceneTypesPath = resolve(kanbanDir, "./kanban-scene-types.ts");
const kanbanTypesPath = resolve(kanbanDir, "./types.ts");

describe("kanban UI contract", () => {
	it("adds the shared kanban presentational files", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		expect(existsSync(kanbanBoardPath)).toBe(true);
		expect(existsSync(kanbanColumnPath)).toBe(true);
		expect(existsSync(questionFooterPath)).toBe(true);
		expect(existsSync(kanbanSceneBoardPath)).toBe(true);
		expect(existsSync(kanbanSceneTypesPath)).toBe(true);
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
		expect(kanbanIndexSource).toContain("KanbanSceneBoard");
		expect(kanbanIndexSource).toContain("KanbanSceneCardData");
		expect(rootUiIndexSource).toContain("KanbanBoard");
		expect(rootUiIndexSource).toContain("KanbanCardData");
		expect(rootUiIndexSource).toContain("KanbanSceneBoard");
		expect(rootUiIndexSource).toContain("KanbanSceneCardData");
	});

	it("defines a shared scene model for mockable kanban compositions", () => {
		expect(existsSync(kanbanSceneTypesPath)).toBe(true);
		if (!existsSync(kanbanSceneTypesPath)) return;

		const sceneTypesSource = readFileSync(kanbanSceneTypesPath, "utf8");

		expect(sceneTypesSource).toContain("export interface KanbanSceneMenuAction");
		expect(sceneTypesSource).toContain("export interface KanbanSceneQuestionFooterData");
		expect(sceneTypesSource).toContain("export interface KanbanScenePermissionFooterData");
		expect(sceneTypesSource).toContain("export interface KanbanScenePlanApprovalFooterData");
		expect(sceneTypesSource).toContain("export type KanbanSceneFooterData =");
		expect(sceneTypesSource).toContain("export interface KanbanSceneCardData extends KanbanCardData");
		expect(sceneTypesSource).toContain("footer: KanbanSceneFooterData | null");
		expect(sceneTypesSource).toContain("menuActions: readonly KanbanSceneMenuAction[]");
		expect(sceneTypesSource).toContain("export interface KanbanSceneColumnGroup");
	});

	it("adds a shared scene board that owns card chrome and footer variants", () => {
		expect(existsSync(kanbanSceneBoardPath)).toBe(true);
		if (!existsSync(kanbanSceneBoardPath)) return;

		const sceneBoardSource = readFileSync(kanbanSceneBoardPath, "utf8");

		expect(sceneBoardSource).toContain("import { AttentionQueueQuestionCard }");
		expect(sceneBoardSource).toContain("import KanbanBoard from \"./kanban-board.svelte\"");
		expect(sceneBoardSource).toContain("import KanbanCard from \"./kanban-card.svelte\"");
		expect(sceneBoardSource).toContain("{#if questionFooterData}");
		expect(sceneBoardSource).toContain("{:else if permissionFooterData}");
		expect(sceneBoardSource).toContain("{:else if planApprovalFooterData}");
		expect(sceneBoardSource).toContain("menuActions={sceneCard.menuActions}");
		expect(sceneBoardSource).toContain("onMenuAction={(actionId: string) => onMenuAction(sceneCard.id, actionId)}");
		expect(sceneBoardSource).toContain("onCardClick(sceneCard.id)");
		expect(sceneBoardSource).toContain("onCardClose(sceneCard.id)");
	});

	it("removes conversation preview content from the shared kanban card contract", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		expect(existsSync(kanbanTypesPath)).toBe(true);
		if (!existsSync(kanbanCardPath) || !existsSync(kanbanTypesPath)) return;

		const cardSource = readFileSync(kanbanCardPath, "utf8");
		const typesSource = readFileSync(kanbanTypesPath, "utf8");

		expect(typesSource).not.toContain("previewMarkdown");
		expect(cardSource).not.toContain("MarkdownDisplay");
		expect(cardSource).not.toContain("card.previewMarkdown");
		expect(cardSource).not.toContain("kanban-markdown-preview");
	});

	it("keeps the kanban card aligned with the shared queue visual language", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		if (!existsSync(kanbanCardPath)) return;

		const cardSource = readFileSync(kanbanCardPath, "utf8");

		expect(cardSource).toContain("ProjectLetterBadge");
		expect(cardSource).toContain("EmbeddedPanelHeader");
		expect(cardSource).toContain("HeaderCell");
		expect(cardSource).toContain("HeaderTitleCell");
		expect(cardSource).toContain("SegmentedProgress");
		expect(cardSource).toContain("DiffPill");
		expect(cardSource).toContain("AgentToolRow");
		expect(cardSource).toContain("TextShimmer");
		expect(cardSource).toContain("cursor-pointer");
		expect(cardSource).toContain("hover:border-border");
		expect(cardSource).toContain("hover:bg-accent/45");
		expect(cardSource).not.toContain("hover:translate-x-px");
		expect(cardSource).not.toContain("hover:-translate-y-px");
		expect(cardSource).toContain("card.taskCard ||");
		expect(cardSource).toContain("card.latestTool ||");
		expect(cardSource).toContain("card.activityText ||");
		expect(cardSource).toContain("capitalizeLeadingCharacter");
		expect(cardSource).toContain('const title = $derived(card.title ? capitalizeLeadingCharacter(card.title) : "Untitled session");');
		expect(cardSource).not.toContain("card.previewMarkdown");
		expect(cardSource).toContain('<EmbeddedPanelHeader class="bg-card/50">');
		expect(cardSource).toContain('<HeaderCell withDivider={false}>');
		expect(cardSource).toContain('<HeaderTitleCell compactPadding>');
		expect(cardSource).toContain('data-testid="kanban-card-title"');
		expect(cardSource).toContain('class="border-b border-border/40 px-1.5 py-1"');
		expect(cardSource).toContain('class="block text-xs font-medium leading-tight text-foreground"');
		expect(cardSource).not.toContain('truncate text-[11px] font-medium text-foreground');
		expect(cardSource).not.toContain('class="flex items-center gap-1.5 px-2 py-1.5"');
		expect(cardSource).toContain('class="flex flex-col gap-1 px-1 pt-1 pb-1"');
		expect(cardSource).not.toContain('class="flex flex-col gap-1 border-t border-border/40 px-1"');
		expect(cardSource).not.toContain('class="flex flex-col gap-1 border-t border-border/40 px-1 py-1.5"');
		expect(cardSource).not.toContain('class="flex flex-col gap-1 border-t border-border/40 py-1.5"');
		expect(cardSource).toContain('data-testid="kanban-card"');
		expect(cardSource).toContain('data-testid="kanban-card-header"');
		expect(cardSource).toContain('data-testid="kanban-card-tally"');
		expect(cardSource).toContain("AgentToolTask");
		expect(cardSource).toContain("description={card.taskCard.summary}");
		expect(cardSource).toContain("status={card.taskCard.isStreaming ? \"running\" : \"done\"}");
		expect(cardSource).toContain("children={card.taskCard.toolCalls}");
		expect(cardSource).toContain('iconBasePath="/svgs/icons"');
		expect(cardSource).toContain("{card.todoProgress.label}");
		expect(cardSource).not.toContain("ToolTally toolCalls={[...card.toolCalls]}");
	});

	it("places the diff pill in the header before the overflow menu instead of the footer tally", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		if (!existsSync(kanbanCardPath)) return;

		const cardSource = readFileSync(kanbanCardPath, "utf8");

		expect(cardSource).toContain("const headerDiffDivider = $derived(hasMenu ? true : hasClose);");
		expect(cardSource).toContain('{#if hasDiff}\n\t\t\t\t<HeaderActionCell withDivider={headerDiffDivider} class="px-1">');
		expect(cardSource).toContain('<div class="flex h-7 items-center justify-center">');
		expect(cardSource).toContain('<DiffPill insertions={card.diffInsertions} deletions={card.diffDeletions} variant="plain" class="text-[10px]" />');
		expect(cardSource).not.toContain('{#if hasDiff}\n\t\t\t\t\t<DiffPill insertions={card.diffInsertions} deletions={card.diffDeletions} variant="plain" class="text-[10px]" />');
	});

	it("only renders footer sections when there is actual footer content", () => {
		expect(existsSync(kanbanCardPath)).toBe(true);
		if (!existsSync(kanbanCardPath)) return;

		const cardSource = readFileSync(kanbanCardPath, "utf8");
		expect(cardSource).toContain("showFooter?: boolean;");
		expect(cardSource).toContain("showFooter = false");
		expect(cardSource).toContain("tally?: Snippet;");
		expect(cardSource).toContain("showTally?: boolean;");
		expect(cardSource).toContain("showTally = false");
		expect(cardSource).toContain("const hasFooterContent = $derived(");
		expect(cardSource).toContain("card.todoProgress !== null && !hasTodoSection ? true : showTally");
		expect(cardSource).not.toContain("card.toolCalls.length");
		expect(cardSource).toContain("{#if showFooter && footer}");
		expect(cardSource).toContain("{#if hasFooterContent}");
		expect(cardSource).toContain("{#if tally}");
		expect(cardSource).toContain("{@render tally()}");
		expect(cardSource).toContain("{#if flushFooter}");
		expect(cardSource).not.toContain("card.toolCalls");
	});

	it("makes the kanban board claim the available width in flex layouts", () => {
		expect(existsSync(kanbanBoardPath)).toBe(true);
		if (!existsSync(kanbanBoardPath)) return;

		const boardSource = readFileSync(kanbanBoardPath, "utf8");

		expect(boardSource).toContain('class="flex h-full w-full min-w-0 flex-1');
		expect(boardSource).toContain("gap-0.5");
		expect(boardSource).toContain("p-0.5");
	});
});
