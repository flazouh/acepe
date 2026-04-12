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
		expect(source).toContain('"answer_needed"');
		expect(source).toContain('"planning"');
		expect(source).toContain('"working"');
		expect(source).toContain('"needs_review"');
		expect(source).toContain('"idle"');
		expect(source).toContain("return SECTION_ORDER.map((sectionId) => {");
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
		expect(source).toContain('class="min-h-0 min-w-0 flex-1 overflow-hidden"');
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

		expect(source).toContain("projectActivityEntry");
		expect(source).toContain("taskCard: KanbanTaskCardData | null");
		expect(source).toContain("projectPath={item.projectPath}");
		expect(source).toContain(
			'import PermissionBar from "$lib/acp/components/tool-calls/permission-bar.svelte"'
		);
		expect(source).toContain("buildQueueItemQuestionUiState");
		expect(source).toContain("questionIndexBySession = $state(");
		expect(source).toContain("function getCurrentQuestionIndex(item: ThreadBoardItem): number");
		expect(source).toContain(
			"function handlePrevQuestion(sessionId: string, currentQuestionIndex: number): void"
		);
		expect(source).toContain("function handleNextQuestion(");
		expect(source).toContain("<PermissionBar");
		expect(source).toContain("sessionId={item.sessionId}");
		expect(source).toContain("projectPath={item.projectPath}");
		expect(source).toContain("onQuestionPrev={handlePrevQuestion}");
		expect(source).toContain("onQuestionNext={handleNextQuestion}");
		expect(source).not.toContain("<PendingPermissionCard permission={permission} />");
	});

	it("omits the kanban footer wrapper when there is no footer content", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).not.toContain("const kanbanFooterBySessionId = $derived.by(() => {");
		expect(source).toContain("<KanbanSceneBoard");
		expect(source).toContain("{#snippet permissionFooterRenderer(card: KanbanSceneCardData, _permissionFooterData)}");
		expect(source).toContain("{#snippet todoSectionRenderer(card: KanbanSceneCardData)}");
		expect(source).toContain(
			"{@const hotState = item ? sessionStore.getHotState(item.sessionId) : null}"
		);
		expect(source).toContain("onMenuAction={(cardId: string, actionId: string) => {");
		expect(source).not.toContain("flushFooter={showComposer}");
	});

	it("delegates bare card rendering to KanbanSceneBoard instead of inline branches", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("<KanbanSceneBoard");
		expect(source).not.toContain("<KanbanCard {card} onclick={() => handleCardClick(card.id)}");
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

	it("builds scene-level menu actions for kanban cards", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("copySessionToClipboard");
		expect(source).toContain("copyTextToClipboard");
		expect(source).toContain(
			'from "$lib/acp/components/agent-panel/logic/clipboard-manager.js"'
		);
		expect(source).not.toContain(
			'import { getOpenInFinderTarget } from "$lib/acp/components/agent-panel/logic/open-in-finder-target.js"'
		);
		expect(source).toContain('import { openFileInEditor, tauriClient } from "$lib/utils/tauri-client.js"');
		expect(source).toContain("function handleCloseSession(item: ThreadBoardItem)");
		expect(source).toContain("function buildSceneMenuActions(): readonly KanbanSceneMenuAction[] {");
		expect(source).toContain('let activeDialogMode = $state<KanbanThreadDialogMode>("inspect");');
		expect(source).toContain('activeDialogMode = "inspect";');
		expect(source).toContain('activeDialogMode = "close-panel";');
		expect(source).toContain("function handleDialogClosePanel(panelId: string): void {");
		expect(source).toContain("panelStore.closePanel(panelId);");
		expect(source).toContain('{ id: "copy-id", label: m.session_menu_copy_id() }');
		expect(source).toContain('{ id: "export-markdown", label: m.session_menu_export_markdown() }');
		expect(source).toContain('{ id: "export-json", label: m.session_menu_export_json() }');
		expect(source).toContain("onMenuAction={(cardId: string, actionId: string) => {");
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
		expect(source).toContain('item.state.activity.kind === "streaming"');
		expect(source).toContain('item.state.activity.kind === "thinking"');
		expect(source).toContain("const activityProjection = projectActivityEntry({");
		expect(source).toContain("lastToolCall: isWorking ? null : item.lastToolCall,");
		expect(source).toContain("lastToolKind: isWorking ? null : item.lastToolKind,");
		expect(source).toContain('activityProjection.toolKind !== "think"');
		expect(source).toContain("const toolDisplay =");
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

	it("shows the latest completed tool history once active work stops", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("currentStreamingToolCall: item.currentStreamingToolCall,");
		expect(source).toContain("currentToolKind: item.currentToolKind,");
		expect(source).toContain("lastToolCall: isWorking ? null : item.lastToolCall,");
		expect(source).toContain("lastToolKind: isWorking ? null : item.lastToolKind,");
		expect(source).not.toContain("showHistoricalActivity");
	});

	it("hides the unseen-completion dot for needs-review cards", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("const hasUnseenCompletion =");
		expect(source).toContain('item.status === "needs_review" ? false : item.state.attention.hasUnseenCompletion;');
		expect(source).toContain("hasUnseenCompletion,");
	});

	it("maps live kanban tool rows to a simple verb plus optional file chip", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("projectActivityEntry");
		expect(source).toContain(
			'from "$lib/acp/components/activity-entry/activity-entry-projection.js"'
		);
		expect(source).not.toContain("getToolCompactDisplayText");
		expect(source).toContain("return activityProjection.latestTool;");
	});

	it("prefers the compact subtitle for execute tools when there is no file path", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("activityProjection.latestTool");
		expect(source).not.toContain("getToolKindSubtitle(toolDisplay.toolKind, tc)");
	});
});
