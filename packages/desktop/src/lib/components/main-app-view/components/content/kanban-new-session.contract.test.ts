import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const contentDir = import.meta.dir;
const kanbanViewPath = resolve(contentDir, "./kanban-view.svelte");
const dialogPath = resolve(contentDir, "./kanban-new-session-dialog.svelte");

describe("kanban new-session dialog contract", () => {
	it("delegates the new-session entry point to the shared top bar", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");
		const violetRobotIconMarkup =
			'<Robot weight="fill" class="h-3.5 w-3.5" style="color: {Colors.purple}" />';
		const violetRobotIconMatches = source.match(
			/<Robot weight="fill" class="h-3\.5 w-3\.5" style="color: \{Colors\.purple\}" \/>/g
		);

		expect(source).toContain("projectManager: ProjectManager");
		expect(source).toContain('from "@acepe/ui"');
		expect(source).toContain('class="flex h-full min-h-0 min-w-0 flex-1 flex-col"');
		expect(source).not.toContain('class="flex shrink-0 items-center justify-end px-2 pt-2"');
		expect(source).not.toContain('class="flex shrink-0 items-center justify-end px-2 pb-2"');
		expect(source).toContain("<Dialog bind:open={newSessionOpen}");
		expect(source).toContain('showCloseButton={false}');
		expect(source).toContain('overflow-hidden max-w-[34rem]');
		expect(source).toContain('!backdrop-blur-none');
		expect(source).toContain('px-3 pt-4 pb-2');
		expect(source).not.toContain('px-4 py-4');
		expect(source).toContain('import { Colors } from "@acepe/ui/colors"');
		expect(source).not.toContain('NEW_AGENT_BUTTON_VARIANTS');
		expect(source).not.toContain('type ButtonVariant');
		expect(violetRobotIconMarkup).toBeDefined();
		expect(violetRobotIconMatches).not.toBeNull();
		expect(violetRobotIconMatches).toHaveLength(1);
		expect(source).toContain('<span class="truncate text-foreground">New Agent</span>');
		expect(source).not.toContain('What do you want to build?');
		expect(source).not.toContain('font-sans text-[1.9rem] font-semibold tracking-tight text-foreground');
		expect(source).not.toContain('IconSparkles');
		expect(source).not.toContain('<span>New Agent</span>');
		expect(source).not.toContain('<span>New session</span>');
		expect(source).toContain("EmbeddedPanelHeader");
		expect(source).toContain("HeaderActionCell");
		expect(source).toContain("CloseAction");
		expect(source).toContain('handleNewSessionOpenChange(false)');
		expect(source).toContain("<AgentInput");
		expect(source).toContain("<AgentSelector");
		expect(source).toContain("<ProjectSelector");
		expect(source).toContain("<WorktreeToggleControl");
		expect(source).toContain('<KanbanBoard {groups} emptyHint="No sessions">');
		expect(source).not.toContain("<DialogHeader");
		expect(source).not.toContain("<DialogTitle");
		expect(source).not.toContain("KanbanNewSessionDialog");
	});

	it("deletes the dedicated kanban dialog wrapper file after inlining the shared dialog", () => {
		expect(existsSync(dialogPath)).toBe(false);
	});

	it("keeps the board visible after creating a kanban session", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");
		const willSendHandler = source
			.split("function handleNewSessionWillSend(): string | null {")[1]
			?.split("function handleNewSessionCreated(")[0];
		const createdHandler = source
			.split("function handleNewSessionCreated(sessionId: string, panelId?: string | null): void {")[1]
			?.split("function resolveQuestionId(question: QuestionRequest): string {")[0];

		expect(willSendHandler).toBeDefined();
		expect(source).toContain('import { SoundEffect } from "$lib/acp/types/sounds.js"');
		expect(source).toContain('import { playSound } from "$lib/acp/utils/sound.js"');
		expect(willSendHandler).toContain("playSound(SoundEffect.Paste);");
		expect(willSendHandler).toContain("newSessionOpen = false;");
		expect(willSendHandler).toContain("const optimisticPanel = panelStore.spawnPanel({");
		expect(willSendHandler).toContain("return optimisticPanel.id;");
		expect(createdHandler).toBeDefined();
		expect(createdHandler).toContain("panelStore.updatePanelSession(panelId, sessionId);");
		expect(createdHandler).toContain("panelStore.focusPanel(panelId);");
		expect(createdHandler).toContain("panelStore.openSession(sessionId, 450);");
		expect(createdHandler).not.toContain('panelStore.setViewMode("single")');
		expect(createdHandler).not.toContain("panelStore.focusAndSwitchToPanel");
	});

	it("renders optimistic working cards for session-less panels that are still creating", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("function buildOptimisticKanbanCards(): readonly OptimisticKanbanCard[] {");
		expect(source).toContain("const hotState = panelStore.getHotState(panel.id);");
		expect(source).toContain("hotState.pendingUserEntry");
		expect(source).toContain("hotState.pendingWorktreeSetup");
		expect(source).toContain("const optimisticKanbanCards = buildOptimisticKanbanCards();");
		expect(source).toContain('sectionId === "working"');
		expect(source).toContain("optimisticKanbanCards.map((item) => item.card).concat(sectionCards)");
		expect(source).toContain("{@const item = itemLookup.get(card.id)}");
		expect(source).toContain("item && item.state.pendingInput.kind === \"plan_approval\"");
	});
});
