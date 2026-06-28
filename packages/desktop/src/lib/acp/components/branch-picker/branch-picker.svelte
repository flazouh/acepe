<script lang="ts">
import { DiffPill, Selector } from "@acepe/ui";
import {
	ComposerFilterDropdownBody,
	composerFilterDropdownContentClass,
	composerFilterDropdownEmptyStateClass,
	composerFilterDropdownItemClass,
	composerFilterDropdownListClass,
} from "@acepe/ui";
import { FUSED_CONTROL_SETUP_CHIP_BUTTON_CLASS, FUSED_CONTROL_SETUP_GROUPED_CHIP_LABEL_BUTTON_CLASS, FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS, FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX, FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS } from "@acepe/ui/panel-header";
import { Colors } from "@acepe/ui/colors";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { CheckCircle, GitBranch } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button/index.js";
import { cn } from "$lib/utils.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import {
	filterBranchesByQuery,
	getBranchListDisplayState,
	getWorktreeBranches,
	shouldLoadBranchList,
} from "./branch-picker-state.js";
import CreateBranchDialog from "./create-branch-dialog.svelte";

interface Props {
	projectPath: string | null;
	currentBranch: string | null;
	diffStats: { insertions: number; deletions: number } | null;
	isGitRepo: boolean | null;
	isWorktree?: boolean;
	onBranchSelected?: (branch: string) => void;
	onInitGitRepo?: () => void;
	initGitLoading?: boolean;
	/** "minimal" = pill triggers, no border; "setupChip" = new-thread setup bar chip; "setupChipGrouped" = first segment in setup git button group. */
	variant?: "default" | "minimal" | "setupChip" | "setupChipGrouped";
	class?: string;
}

let {
	projectPath,
	currentBranch,
	diffStats,
	isGitRepo,
	isWorktree = false,
	onBranchSelected,
	onInitGitRepo,
	initGitLoading = false,
	variant = "default",
	class: className = "",
}: Props = $props();

let branchPopoverOpen = $state(false);
let branchQuery = $state("");
let branches = $state<string[]>([]);
let loadingBranches = $state(false);
let switchingBranch = $state(false);
let branchInputRef = $state<HTMLInputElement | null>(null);
let branchLoadFailed = $state(false);

let createBranchDialogOpen = $state(false);

const minimalTriggerClass =
	"!border-0 !h-[26px] rounded-md hover:rounded-full transition-[border-radius]";
const setupBarLayoutClass = "w-auto flex-none";
const branchTriggerClass = $derived(
	variant === "setupChip" || variant === "setupChipGrouped"
		? setupBarLayoutClass
		: variant === "minimal"
			? minimalTriggerClass
			: undefined
);
const triggerSize = $derived(
	variant === "setupChipGrouped"
		? "setupBarChipGrouped"
		: variant === "setupChip"
			? "setupBarChip"
			: variant === "minimal"
				? "minimal"
				: "default"
);
const initGitButtonClass = $derived(
	variant === "setupChipGrouped"
		? cn(FUSED_CONTROL_SETUP_GROUPED_CHIP_LABEL_BUTTON_CLASS, setupBarLayoutClass)
		: variant === "setupChip"
			? cn(FUSED_CONTROL_SETUP_CHIP_BUTTON_CLASS, setupBarLayoutClass)
			: variant === "minimal"
				? minimalTriggerClass
				: "h-7"
);

const filteredBranches = $derived(filterBranchesByQuery(branches, branchQuery));
const branchListDisplay = $derived(
	getBranchListDisplayState({
		loadingBranches,
		branchLoadFailed,
		filteredBranches,
	})
);
$effect(() => {
	if (!branchPopoverOpen) {
		branchQuery = "";
		return;
	}
	queueMicrotask(() => {
		branchInputRef?.focus();
	});
	if (!projectPath) {
		branches = [];
		return;
	}
	// Worktrees are tied to a specific branch — skip the Tauri call
	if (isWorktree) {
		branches = getWorktreeBranches(currentBranch);
		loadingBranches = false;
		return;
	}
	if (!shouldLoadBranchList({ branchPopoverOpen, projectPath, isWorktree })) {
		return;
	}
	loadingBranches = true;
	branchLoadFailed = false;
	let cancelled = false;
	void tauriClient.git.listBranches(projectPath).match(
		(availableBranches) => {
			if (cancelled) return;
			branches = availableBranches;
			loadingBranches = false;
		},
		(error) => {
			if (cancelled) return;
			loadingBranches = false;
			branchLoadFailed = true;
			const message = error.cause?.message || error.message || "Failed to list branches";
			toast.error(message);
		}
	);
	return () => {
		cancelled = true;
	};
});

function handleSwitchBranch(branch: string, create: boolean): void {
	if (!projectPath || switchingBranch) return;

	switchingBranch = true;
	void tauriClient.git.checkoutBranch(projectPath, branch, create).match(
		(selectedBranch) => {
			switchingBranch = false;
			onBranchSelected?.(selectedBranch);
			branchPopoverOpen = false;
			createBranchDialogOpen = false;
		},
		(error) => {
			switchingBranch = false;
			const message = error.cause?.message || error.message || "Failed to switch branch";
			toast.error(message);
		}
	);
}

function handleCreateBranchFromDialog(fullBranchName: string): void {
	handleSwitchBranch(fullBranchName, true);
}

function openCreateBranchDialog(): void {
	branchPopoverOpen = false;
	createBranchDialogOpen = true;
}
</script>

{#if isGitRepo === false}
	<Button
		variant="ghost"
		size={variant === "setupChip" || variant === "setupChipGrouped" ? "setupChip" : "sm"}
		class={cn(
			"gap-1.5",
			variant === "setupChip" ? "w-auto shrink-0 px-1.5 py-1" : "w-full px-2",
			initGitButtonClass
		)}
		disabled={!projectPath || !onInitGitRepo || initGitLoading}
		onclick={() => onInitGitRepo?.()}
	>
		<GitBranch class={FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS} size={FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX} weight="fill" />
		<span class={FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS}>
			{initGitLoading ? "Initializing..." : "Initialize Git"}
		</span>
	</Button>
{:else}
	<Selector
		bind:open={branchPopoverOpen}
		disabled={!projectPath}
		align="end"
		blockingOverlay
		variant="ghost"
		showChevron={variant !== "setupChip" && variant !== "setupChipGrouped"}
		class={cn(
			variant === "setupChip" || variant === "setupChipGrouped" ? "w-auto flex-none" : "w-full h-full",
			className
		)}
		contentClass={composerFilterDropdownContentClass}
		triggerSize={triggerSize}
		triggerClass={branchTriggerClass}
	>
		{#snippet renderButton()}
			<GitBranch
				class={cn(
					variant === "setupChip" || variant === "setupChipGrouped"
						? FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS
						: "size-3 shrink-0",
					variant === "setupChip" || variant === "setupChipGrouped" ? "text-foreground" : ""
				)}
				size={variant === "setupChip" || variant === "setupChipGrouped"
					? FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX
					: undefined}
				weight="fill"
				style={variant === "setupChip" || variant === "setupChipGrouped"
					? undefined
					: `color: ${Colors.purple}`}
			/>
			<span class={cn("max-w-[9rem] truncate", FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS)} title={currentBranch || "branch"}>
				{currentBranch || "branch"}
			</span>
			{#if diffStats && variant !== "setupChip" && variant !== "setupChipGrouped"}
				<DiffPill
					insertions={diffStats.insertions}
					deletions={diffStats.deletions}
					variant="plain"
				/>
			{/if}
		{/snippet}

		<ComposerFilterDropdownBody
			bind:searchQuery={branchQuery}
			searchPlaceholder="Filter branches…"
			searchAriaLabel="Filter branches"
			bind:inputRef={branchInputRef}
		>
			<div class={composerFilterDropdownListClass}>
				{#if branchListDisplay.kind === "loading"}
					<div class={composerFilterDropdownEmptyStateClass}>
						{branchListDisplay.message}
					</div>
				{:else if branchListDisplay.kind === "failed" || branchListDisplay.kind === "empty"}
					<div class={composerFilterDropdownEmptyStateClass}>
						{branchListDisplay.message}
					</div>
				{:else}
					{#each branchListDisplay.branches as branch (branch)}
						<DropdownMenu.Item
							onSelect={() => handleSwitchBranch(branch, false)}
							class={composerFilterDropdownItemClass}
						>
							<GitBranch class="size-3.5 shrink-0" weight="fill" style="color: {Colors.purple}" />
							<span class="min-w-0 flex-1 truncate font-mono text-xs">{branch}</span>
							<CheckCircle
								class={branch === currentBranch
									? "size-3.5 shrink-0 text-foreground"
									: "size-3.5 shrink-0 text-transparent"}
								weight="fill"
							/>
						</DropdownMenu.Item>
					{/each}
				{/if}
			</div>

			{#if !isWorktree}
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={openCreateBranchDialog} class={composerFilterDropdownItemClass}>
					<GitBranch class="size-3.5 shrink-0" weight="fill" style="color: {Colors.purple}" />
					<span class="text-xs">New branch…</span>
				</DropdownMenu.Item>
			{/if}
		</ComposerFilterDropdownBody>
	</Selector>
{/if}

<CreateBranchDialog
	bind:open={createBranchDialogOpen}
	{branches}
	{switchingBranch}
	inputId="new-branch-name"
	onCreate={handleCreateBranchFromDialog}
/>
