import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const kanbanViewPath = resolve(
	process.cwd(),
	"src/lib/components/main-app-view/components/content/kanban-view.svelte"
);
const kanbanCompactComposerPath = resolve(
	process.cwd(),
	"../ui/src/components/kanban/kanban-compact-composer.svelte"
);

describe("kanban empty-column contract", () => {
	it("builds groups from a fixed board order with idle", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("const SECTION_ORDER: readonly ThreadBoardStatus[] = [");
		expect(source).toContain(
			'const SECTION_ORDER: readonly ThreadBoardStatus[] = [\n\t\t"answer_needed",\n\t\t"planning",\n\t\t"working",\n\t\t"needs_review",\n\t\t"idle",\n\t];'
		);
		expect(source).toContain("SECTION_ORDER.map((sectionId) => {");
		expect(source).toContain("buildThreadBoard(");
		expect(source).not.toContain(
			"const section = queueStore.sections.find((section) => section.id === sectionId);"
		);
	});

	it("fills the available content width instead of sizing to its intrinsic content", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain('class="flex h-full min-h-0 min-w-0 flex-1 flex-col"');
		expect(source).toContain('class="min-h-0 min-w-0 flex-1"');
	});

	it("opens the full thread UI in a dialog without leaving kanban", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain('import KanbanThreadDialog from "./kanban-thread-dialog.svelte"');
		expect(source).toContain("let activeDialogPanelId = $state<string | null>(null);");
		expect(source).toContain("activeDialogPanelId = item.panelId;");
		expect(source).not.toContain('panelStore.setViewMode("single")');
		expect(source).toContain("<KanbanThreadDialog");
	});

	it("renders task subagent cards plus the same permission bar used above the composer", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("getQueueItemTaskDisplay");
		expect(source).toContain("taskCard: KanbanTaskCardData | null");
		expect(source).toContain("projectPath={item.projectPath}");
		expect(source).toContain('import PermissionActionBar from "$lib/acp/components/tool-calls/permission-action-bar.svelte"');
		expect(source).toContain("buildQueueItemQuestionUiState");
		expect(source).toContain("questionIndexBySession = $state(new SvelteMap");
		expect(source).toContain("function getCurrentQuestionIndex(item: ThreadBoardItem): number");
		expect(source).toContain("function handlePrevQuestion(sessionId: string, currentQuestionIndex: number): void");
		expect(source).toContain("function handleNextQuestion(");
		expect(source).toContain("<PermissionActionBar");
		expect(source).toContain("permission={permission}");
		expect(source).toContain("projectPath={item.projectPath}");
		expect(source).toContain("<AttentionQueueQuestionCard");
		expect(source).toContain("{currentQuestionIndex}");
		expect(source).toContain("onPrevQuestion={() => handlePrevQuestion(card.id, currentQuestionIndex)}");
		expect(source).toContain(
			"onNextQuestion={() => handleNextQuestion(card.id, currentQuestionIndex, questionUiState.totalQuestions)}"
		);
		expect(source).not.toContain("<PendingPermissionCard permission={permission} />");
	});

	it("omits the kanban footer wrapper when there is no footer content", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).not.toContain("const kanbanFooterBySessionId = $derived.by(() => {");
		expect(source).toContain("{@const permission = item ? getPermissionRequest(item) : null}");
		expect(source).toContain("{@const questionUiState = item ? getQuestionUiState(item) : null}");
		expect(source).toContain(
			"{@const hotState = item ? sessionStore.getHotState(item.sessionId) : null}"
		);
		expect(source).toContain("{@const showFooter = permission !== null || questionUiState !== null}");
		expect(source).toContain('{#if item}');
		expect(source).toContain('<KanbanCard {card} onclick={() => handleCardClick(card.id)}');
		expect(source).toContain('showFooter={showFooter}');
		expect(source).not.toContain('flushFooter={showComposer}');
		expect(source).not.toContain('{#snippet footer()}\n\t\t\t\t\t\t{#if item}');
	});

	it("falls back to a bare kanban card when there is no context or action footer content", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain('{:else}\n\t\t\t\t\t<KanbanCard {card} onclick={() => handleCardClick(card.id)} />');
	});

	it("renders the compact composer in an embedded voice layout with a smaller submit button", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		expect(existsSync(kanbanCompactComposerPath)).toBe(true);
		if (!existsSync(kanbanViewPath) || !existsSync(kanbanCompactComposerPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");
		const composerSource = readFileSync(kanbanCompactComposerPath, "utf8");

		expect(composerSource).toContain("onModeToggle?: () => void;");
		expect(composerSource).toContain("bg-background/90");
		expect(composerSource).toContain("px-2");
		expect(composerSource).toContain("py-0.5");
	});

	it("renders a compact header session actions menu for kanban cards", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain('import CopyButton from "$lib/acp/components/messages/copy-button.svelte"');
		expect(source).toContain(
			'import { copySessionToClipboard, copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js"'
		);
		expect(source).toContain(
			'import { getOpenInFinderTarget } from "$lib/acp/components/agent-panel/logic/open-in-finder-target.js"'
		);
		expect(source).toContain('import { openFileInEditor, revealInFinder, tauriClient } from "$lib/utils/tauri-client.js"');
		expect(source).toContain('import IconDotsVertical from "@tabler/icons-svelte/icons/dots-vertical"');
		expect(source).toContain("function handleCloseSession(item: ThreadBoardItem)");
		expect(source).toContain('let activeDialogMode = $state<KanbanThreadDialogMode>("inspect");');
		expect(source).toContain('activeDialogMode = "inspect";');
		expect(source).toContain('activeDialogMode = "close-panel";');
		expect(source).toContain("function handleDialogClosePanel(panelId: string): void {");
		expect(source).toContain("panelStore.closePanel(panelId);");
		expect(source).toContain("{#snippet menu()}");
		expect(source).not.toContain('import { OverflowMenuTriggerAction } from "@acepe/ui/panel-header"');
		expect(source).toContain('<DropdownMenu.Trigger');
		expect(source).toContain('aria-label="More actions"');
		expect(source).toContain(
			'class="shrink-0 inline-flex h-5 w-5 items-center justify-center p-1 text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"'
		);
		expect(source).toContain('<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />');
		expect(source).not.toContain('hover:bg-accent');
		expect(source).toContain('label={m.session_menu_copy_id()}');
		expect(source).toContain("{m.thread_open_in_finder()}");
		expect(source).toContain("{m.session_menu_export()}");
		expect(source).not.toContain("{m.common_close()}");
		expect(source).toContain("mode={activeDialogMode}");
		expect(source).toContain("onClosePanel={handleDialogClosePanel}");
	});

	it("avoids dead desktop-only imports that break Vite resolution", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).not.toContain('import { tauriClient } from "$lib/clients/index.js"');
		expect(source).not.toContain(
			'import { copySessionToClipboard, openFileInEditor } from "$lib/acp/logic/index.js"'
		);
		expect(source).not.toContain('import { toast } from "$lib/components/ui/sonner/index.js"');
	});

	it("renders only active tool or subagent context and falls back to Thinking during live work", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).not.toContain("function getKanbanPreviewMarkdown(");
		expect(source).not.toContain("previewMarkdown");
		expect(source).toContain(
			'const isWorking = item.state.activity.kind === "streaming" || item.state.activity.kind === "thinking";'
		);
		expect(source).toContain("lastToolCall: null,");
		expect(source).toContain("lastToolKind: null,");
		expect(source).toContain('currentToolDisplay.toolKind === "think"');
		expect(source).toContain("if (!isWorking) return null;");
		expect(source).toContain("if (toolDisplay) return null;");
		expect(source).toContain('return "Thinking…";');
	});

	it("preserves todo labels for kanban card tally context", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("label: item.todoProgress.label");
	});

	it("ignores stale completed tool history when mapping kanban card activity", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("currentStreamingToolCall: item.currentStreamingToolCall,");
		expect(source).toContain("currentToolKind: item.currentToolKind,");
		expect(source).toContain("lastToolCall: null,");
		expect(source).toContain("lastToolKind: null,");
		expect(source).not.toContain("showHistoricalActivity");
	});
});
