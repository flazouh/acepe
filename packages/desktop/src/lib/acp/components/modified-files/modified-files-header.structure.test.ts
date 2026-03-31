import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "./modified-files-header.svelte"), "utf8");
const prSettingsPopoverStart = source.indexOf(
	'<DropdownMenu.Content align="start" class="w-[420px] overflow-hidden p-0" sideOffset={6}>'
);
const prSettingsPopoverEnd = source.indexOf("<!-- Review split button -->", prSettingsPopoverStart);
const prSettingsPopoverSource =
	prSettingsPopoverStart >= 0 && prSettingsPopoverEnd >= 0
		? source.slice(prSettingsPopoverStart, prSettingsPopoverEnd)
		: "";

describe("modified-files-header structure", () => {
	it("removes the duplicate modified-files count and embeds diff stats in the PR action", () => {
		expect(source).not.toContain("m.modified_files_count({ count: modifiedFilesState.fileCount })");
		expect(source).toContain("<DiffPill insertions={totalAdded} deletions={totalRemoved} variant=\"plain\" />");
		expect(source).toContain("class=\"w-full flex items-center justify-between pl-1 pr-3 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors cursor-pointer");
		expect(source).toContain("group-hover/open-pr:text-success");
	});

	it("adds a keep-all action wired to the review-state handler", () => {
		expect(source).toContain("function handleKeepAllClick(): void {");
		expect(source).toContain("sessionReviewStateStore.upsertFileProgress(");
		expect(source).toContain("m.review_keep()");
	});

	it("renders review before keep in the right-side action cluster", () => {
		const reviewButtonIndex = source.indexOf("{m.modified_files_review_button()}");
		const keepButtonIndex = source.indexOf("{m.review_keep()}");

		expect(reviewButtonIndex).toBeGreaterThan(-1);
		expect(keepButtonIndex).toBeGreaterThan(-1);
		expect(reviewButtonIndex).toBeLessThan(keepButtonIndex);
	});

	it("uses side-by-side dropdown pickers and smart PR instructions in the settings popover", () => {
		expect(source).toContain("function resolveCustomPrompt(): string | undefined {");
		expect(source).toContain("function handleAgentPickerChange(value: string): void {");
		expect(source).toContain("function handleModelPickerChange(value: string): void {");
		expect(source).toContain("function handlePromptSaveClick(): void {");
		expect(prSettingsPopoverSource).toContain('class="grid gap-1.5 sm:grid-cols-2"');
		expect(prSettingsPopoverSource).toContain("<DropdownMenu.Trigger");
		expect(prSettingsPopoverSource).toContain("PR instructions");
		expect(prSettingsPopoverSource).toContain("Save prompt");
		expect(prSettingsPopoverSource).toContain("Reset");
		expect(prSettingsPopoverSource).toContain("Acepe appends the response format and git context automatically.");
		expect(prSettingsPopoverSource).not.toContain("<DropdownMenu.SubTrigger");
		expect(prSettingsPopoverSource).not.toContain("Session default");
		expect(prSettingsPopoverSource).not.toContain("Agent default");
		expect(prSettingsPopoverSource).not.toContain("Current prompt used");
		expect(prSettingsPopoverSource).not.toContain("handleCreatePrClick");
		expect(prSettingsPopoverSource).not.toContain("m.agent_panel_open_pr()");
	});

	it("renders the PR model picker label without the CPU icon", () => {
		expect(source).not.toContain('from "phosphor-svelte/lib/Cpu"');
		expect(prSettingsPopoverSource).not.toContain("<Cpu");
		expect(prSettingsPopoverSource).toContain("Model");
	});
});