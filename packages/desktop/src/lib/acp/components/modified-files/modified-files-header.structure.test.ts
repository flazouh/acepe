import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "./modified-files-header.svelte"), "utf8");
const trailingControlsSource = readFileSync(
	resolve(
		__dirname,
		"../../../../../../ui/src/components/agent-panel/agent-panel-modified-files-trailing-controls.svelte"
	),
	"utf8"
);
const prSettingsPopoverStart = source.indexOf(
	'<DropdownMenu.Content align="start" class="w-[420px] overflow-hidden p-0" sideOffset={6}>'
);
const prSettingsPopoverEnd = source.indexOf(
	"<!-- Merge split button: shown after PR is created -->",
	prSettingsPopoverStart
);
const prSettingsPopoverSource =
	prSettingsPopoverStart >= 0 && prSettingsPopoverEnd >= 0
		? source.slice(prSettingsPopoverStart, prSettingsPopoverEnd)
		: "";

describe("modified-files-header structure", () => {
	it("removes the duplicate modified-files count and embeds diff stats in the PR action", () => {
		expect(source).not.toContain("m.modified_files_count({ count: modifiedFilesState.fileCount })");
		expect(source).toContain(
			'<DiffPill insertions={totalAdded} deletions={totalRemoved} variant="plain" />'
		);
		expect(source).toContain(
			'class="flex items-center rounded border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0"'
		);
		expect(source).toContain("group-hover/open-pr:text-success");
	});

	it("adds a keep-all action wired to the review-state handler", () => {
		expect(source).toContain("function handleKeepAllClick(): void {");
		expect(source).toContain("sessionReviewStateStore.upsertFileProgress(");
		expect(source).toContain("m.review_keep()");
	});

	it("renders an applied keep-all state as a neutral disabled button once every file is accepted", () => {
		expect(source).toContain("const isKeepAllApplied = $derived.by(() => {");
		expect(source).not.toContain('from "$lib/paraglide/messages/review_applied.js"');
		expect(source).toContain('appliedLabel: m.review_applied()');
		expect(trailingControlsSource).toContain("<CheckCircle");
		expect(trailingControlsSource).toContain(
			'<Button variant="headerAction" size="headerAction" disabled class="disabled:opacity-100">'
		);
		expect(trailingControlsSource).toContain(
			'<CheckCircle size={11} weight="fill" class="shrink-0 text-success" />'
		);
		expect(trailingControlsSource).not.toContain("border-success/30 bg-success/10");
	});

	it("renders review before keep in the right-side action cluster", () => {
		const reviewButtonIndex = trailingControlsSource.indexOf("{model.reviewLabel}");
		const keepButtonIndex = trailingControlsSource.indexOf("{model.keepLabel}");

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
		expect(source).toContain("const promptPreviewHelperText = $derived.by(() => {");
		expect(prSettingsPopoverSource).toContain("{promptPreviewHelperText}");
		expect(prSettingsPopoverSource).not.toContain("<DropdownMenu.SubTrigger");
		expect(prSettingsPopoverSource).not.toContain("Session default");
		expect(prSettingsPopoverSource).not.toContain("Agent default");
		expect(prSettingsPopoverSource).not.toContain("Current prompt used");
		expect(prSettingsPopoverSource).not.toContain("handleCreatePrClick");
		expect(prSettingsPopoverSource).not.toContain("m.agent_panel_open_pr()");
	});

	it("renders the PR model picker label without the CPU icon", () => {
		expect(prSettingsPopoverSource).not.toContain("<Cpu");
		expect(prSettingsPopoverSource).toContain("Model");
	});

	it("renders a merge split button with strategy picker when onMerge is provided", () => {
		// The merge button group lives in modified-files-header, not in the PR status card.
		expect(source).toContain("onMerge");
		expect(source).toContain("mergeStrategyStore.strategy");
		expect(source).toContain("m.pr_card_merge()");
		expect(source).toContain("m.pr_card_squash_merge()");
		expect(source).toContain("m.pr_card_merge_commit()");
		expect(source).toContain("m.pr_card_rebase_merge()");
	});

	it("shows the merged badge when prState is MERGED", () => {
		expect(source).toContain('prState === "MERGED"');
		expect(source).toContain("m.pr_card_merged()");
	});
});
