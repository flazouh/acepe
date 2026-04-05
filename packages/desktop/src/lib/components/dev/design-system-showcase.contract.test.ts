import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./design-system-showcase.svelte"), "utf8");

describe("design system showcase contract", () => {
	it("adds a dedicated buttons section to the design system overlay", () => {
		expect(source).toContain('id: "button"');
		expect(source).toContain('label: "Buttons"');
		expect(source).toContain('{#if activeSection === "button"}');
		expect(source).toContain('>Buttons</div>');
		expect(source).toContain('<Button variant="header" size="header">');
		expect(source).toContain('<Button variant="toolbar" size="toolbar">');
	});

	it("rebuilds the kanban card showcase from anatomy to full states", () => {
		expect(source).toContain("Header Anatomy");
		expect(source).toContain("Footer Building Blocks");
		expect(source).toContain("Full Card States");
		expect(source).toContain("Review / Unread Completion");
		expect(source).toContain("Question Required");
		expect(source).not.toContain("With Todo Progress + Diff");
		expect(source).not.toContain("With Multiple Current Subagents");
	});

	it("shows desktop-style kanban card wiring in the showcase", () => {
		expect(source).toContain("const demoCardNeedsReview: KanbanCardData = {");
		expect(source).toContain("const demoCardQuestion: KanbanCardData = {");
		expect(source).toContain("const demoCardPermission: KanbanCardData = {");
		expect(source).toContain("function handleShowcaseCardAction(): void {}");
		expect(source).toContain('import * as DropdownMenu from "@acepe/ui/dropdown-menu";');
		expect(source).toContain('import IconDotsVertical from "@tabler/icons-svelte/icons/dots-vertical";');
		expect(source).toContain('const kanbanMenuTriggerClass =');
		expect(source).toContain('class={kanbanMenuTriggerClass}');
		expect(source).toContain('<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />');
		expect(source).toContain("<DropdownMenu.Trigger");
		expect(source).toContain("<KanbanCard card={demoCardBase} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction}>");
		expect(source).toContain("<KanbanCard card={demoCardPermission} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction} showFooter={true}>");
		expect(source).toContain('import PermissionBar from "$lib/acp/components/tool-calls/permission-bar.svelte";');
		expect(source).toContain("<PermissionBar");
		expect(source).toContain("sessionId={demoPermissionFileReq.sessionId}");
		expect(source).toContain("permission={demoPermissionFileReq}");
		expect(source).toContain('projectPath="/Users/alex/Documents/acepe"');
		expect(source).toContain("<AttentionQueueQuestionCard");
		expect(source).toContain("{#snippet menu()}");
		expect(source).toContain("{#snippet footer()}");
		expect(source).not.toContain("<KanbanQuestionFooter");
		expect(source).not.toContain("<PendingPermissionCard");
	});
});
