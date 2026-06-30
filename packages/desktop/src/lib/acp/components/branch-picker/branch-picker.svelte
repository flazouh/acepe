<script lang="ts">
import { AgentInputBranchSelector } from "@acepe/ui";
import {
	SETUP_CHIP_ICON_CLASS,
	SETUP_CHIP_ICON_SIZE_PX,
	SETUP_CHIP_LABEL_TEXT_CLASS,
} from "@acepe/ui/panel-header";
import { Colors } from "@acepe/ui/colors";
import { GitBranch } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button/index.js";
import { cn } from "$lib/utils.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import {
	getBranchListDisplayState,
	getWorktreeBranches,
	shouldCheckoutSelectedBranch,
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
	/** "minimal" = pill triggers, no border; "setupBarChip" = new-thread setup bar chip; "setupBarChipGrouped" = first segment in setup git button group. */
	variant?: "default" | "minimal" | "setupBarChip" | "setupBarChipGrouped";
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
let branches = $state<string[]>([]);
let loadingBranches = $state(false);
let switchingBranch = $state(false);
let branchLoadFailed = $state(false);

let createBranchDialogOpen = $state(false);

const setupBarLayoutClass = "w-auto flex-none";
const isSetupBarVariant = $derived(
	variant === "setupBarChip" || variant === "setupBarChipGrouped"
);
const initGitButtonClass = $derived(
	cn(
		"gap-1.5",
		isSetupBarVariant ? cn("w-auto shrink-0", setupBarLayoutClass) : "w-full px-2",
		variant === "minimal"
			? "!border-0 !h-[26px] rounded-md hover:rounded-full transition-[border-radius]"
			: !isSetupBarVariant
				? "h-7"
				: ""
	)
);

const branchListDisplay = $derived(
	getBranchListDisplayState({
		loadingBranches,
		branchLoadFailed,
		filteredBranches: branches,
	})
);

$effect(() => {
	if (!branchPopoverOpen) {
		return;
	}
	if (!projectPath) {
		branches = [];
		return;
	}
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
	if (!shouldCheckoutSelectedBranch({ currentBranch, selectedBranch: branch, create })) {
		return;
	}

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
			if (!create) {
				branchPopoverOpen = true;
			}
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
		variant={isSetupBarVariant ? "secondary" : "ghost"}
		size="sm"
		class={initGitButtonClass}
		disabled={!projectPath || !onInitGitRepo || initGitLoading}
		onclick={() => onInitGitRepo?.()}
	>
		<GitBranch class={SETUP_CHIP_ICON_CLASS} size={SETUP_CHIP_ICON_SIZE_PX} weight="fill" />
		<span class={SETUP_CHIP_LABEL_TEXT_CLASS}>
			{initGitLoading ? "Initializing..." : "Initialize Git"}
		</span>
	</Button>
{:else}
	<AgentInputBranchSelector
		bind:open={branchPopoverOpen}
		disabled={!projectPath}
		{currentBranch}
		{diffStats}
		{branchListDisplay}
		branchIconColor={Colors.purple}
		onBranchSelect={(branch) => handleSwitchBranch(branch, false)}
		showCreateButton={!isWorktree}
		onCreateClick={openCreateBranchDialog}
		createDisabled={!projectPath || switchingBranch}
		createAriaLabel="Create branch"
		{variant}
		class={className}
	/>
{/if}

<CreateBranchDialog
	bind:open={createBranchDialogOpen}
	{branches}
	{switchingBranch}
	inputId="new-branch-name"
	onCreate={handleCreateBranchFromDialog}
/>
