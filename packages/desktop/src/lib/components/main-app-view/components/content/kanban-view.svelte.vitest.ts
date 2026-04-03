import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const kanbanViewPath = resolve(
	process.cwd(),
	"src/lib/components/main-app-view/components/content/kanban-view.svelte"
);

describe("kanban empty-column contract", () => {
	it("builds groups from a fixed board order with idle", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("const SECTION_ORDER: readonly ThreadBoardStatus[] = [");
		expect(source).toContain(
			'const SECTION_ORDER: readonly ThreadBoardStatus[] = [\n\t\t"answer_needed",\n\t\t"planning",\n\t\t"working",\n\t\t"finished",\n\t\t"idle",\n\t];'
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

	it("renders task subagent cards and compact permission details in kanban cards", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("getQueueItemTaskDisplay");
		expect(source).toContain("taskCard: KanbanTaskCardData | null");
		expect(source).toContain("projectPath={item.projectPath}");
		expect(source).toContain("<PermissionActionBar permission={permission} compact projectPath={item.projectPath} />");
		expect(source).not.toContain("extractCompactPermissionDisplay");
	});

	it("omits the kanban footer wrapper when there is no footer content", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).not.toContain("const kanbanFooterBySessionId = $derived.by(() => {");
		expect(source).toContain("{@const permission = item ? getPermissionRequest(item) : null}");
		expect(source).toContain("{@const question = item ? getQuestionData(item) : null}");
		expect(source).toContain(
			"{@const usageTelemetry = item ? (sessionStore.getHotState(item.sessionId).usageTelemetry ?? null) : null}"
		);
		expect(source).toContain("{@const isClaudeCode = item ? item.agentId === AGENT_IDS.CLAUDE_CODE : false}");
		expect(source).toContain("{@const showUsage = hasVisibleModelSelectorMetrics(usageTelemetry, isClaudeCode)}");
		expect(source).toContain("{@const showComposer = item ? isComposerVisible(item) : false}");
		expect(source).toContain("{@const showFooter = permission !== null || question !== null || showUsage || showComposer}");
		expect(source).toContain('{#if item}');
		expect(source).toContain('<KanbanCard {card} onclick={() => handleCardClick(card.id)} showFooter={showFooter}>');
		expect(source).not.toContain('{#snippet footer()}\n\t\t\t\t\t\t{#if item}');
	});

	it("falls back to a bare kanban card when there is no context or action footer content", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain('{:else}\n\t\t\t\t\t<KanbanCard {card} onclick={() => handleCardClick(card.id)} />');
	});

	it("renders the compact context window widget in kanban footers", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain(
			'import ModelSelectorMetricsChip from "$lib/acp/components/model-selector.metrics-chip.svelte"'
		);
		expect(source).toContain(
			'import { hasVisibleModelSelectorMetrics } from "$lib/acp/components/model-selector.metrics-chip.logic.js"'
		);
		expect(source).toContain('import { AGENT_IDS } from "$lib/acp/types/agent-id.js"');
		expect(source).toContain("<ModelSelectorMetricsChip");
		expect(source).toContain("sessionId={card.id}");
		expect(source).toContain("agentId={item.agentId}");
		expect(source).toContain("compact={true}");
		expect(source).toContain("{#if showUsage}");
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
		expect(source).toContain("panelStore.closePanel(item.panelId);");
		expect(source).toContain("{#snippet menu()}");
		expect(source).not.toContain('import { OverflowMenuTriggerAction } from "@acepe/ui/panel-header"');
		expect(source).toContain('<DropdownMenu.Trigger');
		expect(source).toContain('aria-label="More actions"');
		expect(source).toContain(
			'class="shrink-0 inline-flex h-3 w-2.5 items-center justify-center text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"'
		);
		expect(source).toContain('<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />');
		expect(source).not.toContain('hover:bg-accent');
		expect(source).toContain('label={m.session_menu_copy_id()}');
		expect(source).toContain("{m.thread_open_in_finder()}");
		expect(source).toContain("{m.session_menu_export()}");
		expect(source).toContain("{m.common_close()}");
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

	it("builds full conversation markdown for kanban card previews", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("function getKanbanPreviewMarkdown(");
		expect(source).toContain('entry.type === "user"');
		expect(source).toContain('entry.type === "assistant"');
		expect(source).not.toContain("KANBAN_PREVIEW_MAX_LINES");
		expect(source).not.toContain("KANBAN_PREVIEW_MAX_CHARS");
		expect(source).not.toContain("truncateKanbanPreview");
		expect(source).toContain("const previewMarkdown = getKanbanPreviewMarkdown(");
		expect(source).toContain("previewMarkdown,");
	});

	it("preserves todo labels for kanban card tally context", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("label: item.todoProgress.label");
	});

	it("suppresses stale historical task and tool summaries for idle cards", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain('const showHistoricalActivity = item.status !== "idle";');
		expect(source).toContain("if (!showHistoricalActivity) return null;");
	});
});