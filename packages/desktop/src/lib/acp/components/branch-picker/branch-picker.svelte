<script lang="ts">
import { DiffPill, Selector } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import {
	BookOpen,
	Bug,
	Check,
	GitBranch,
	MagnifyingGlass,
	Recycle,
	Sparkle,
	TestTube,
	Wrench,
} from "phosphor-svelte";
import type { Component } from "svelte";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button/index.js";
import * as Dialog from "@acepe/ui/dialog";
import { Input } from "$lib/components/ui/input/index.js";
import { cn } from "$lib/utils.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import {
	canCreateBranch as getCanCreateBranch,
	filterBranchesByQuery,
	getBranchListDisplayState,
	getFullBranchName,
	getNewBranchNameError,
	getNormalizedBranchName,
	getWorktreeBranches,
	shouldLoadBranchList,
} from "./branch-picker-state.js";

interface Props {
	projectPath: string | null;
	currentBranch: string | null;
	diffStats: { insertions: number; deletions: number } | null;
	isGitRepo: boolean | null;
	isWorktree?: boolean;
	onBranchSelected?: (branch: string) => void;
	onInitGitRepo?: () => void;
	/** "minimal" = pill triggers, no border; "default" = standard. */
	variant?: "default" | "minimal";
}

let {
	projectPath,
	currentBranch,
	diffStats,
	isGitRepo,
	isWorktree = false,
	onBranchSelected,
	onInitGitRepo,
	variant = "default",
}: Props = $props();

// Branch prefix options
interface BranchPrefix {
	label: string;
	value: string;
	icon: Component;
	color: string;
}

const BRANCH_PREFIXES: BranchPrefix[] = [
	{ label: "None", value: "", icon: GitBranch, color: Colors.purple },
	{ label: "feat", value: "feat/", icon: Sparkle, color: "var(--success)" },
	{ label: "fix", value: "fix/", icon: Bug, color: Colors.red },
	{ label: "chore", value: "chore/", icon: Wrench, color: Colors.orange },
	{ label: "refactor", value: "refactor/", icon: Recycle, color: Colors.cyan },
	{ label: "docs", value: "docs/", icon: BookOpen, color: Colors.yellow },
	{ label: "test", value: "test/", icon: TestTube, color: Colors.pink },
];

let branchPopoverOpen = $state(false);
let branchQuery = $state("");
let branches = $state<string[]>([]);
let loadingBranches = $state(false);
let switchingBranch = $state(false);
let branchInputRef = $state<HTMLInputElement | null>(null);
let branchLoadFailed = $state(false);

// Create branch dialog
let createBranchDialogOpen = $state(false);
let newBranchName = $state("");
let selectedPrefix = $state(BRANCH_PREFIXES[0]);
let prefixDropdownOpen = $state(false);
let newBranchInputRef = $state<HTMLInputElement | null>(null);

const minimalTriggerClass =
	"!border-0 !h-[26px] rounded-md hover:rounded-full transition-[border-radius]";

const filteredBranches = $derived(filterBranchesByQuery(branches, branchQuery));
const branchListDisplay = $derived(
	getBranchListDisplayState({
		loadingBranches,
		branchLoadFailed,
		filteredBranches,
	})
);
const normalizedNewBranchName = $derived(getNormalizedBranchName(newBranchName));
const fullBranchName = $derived(getFullBranchName({ prefix: selectedPrefix, branchName: newBranchName }));
const newBranchNameError = $derived(
	getNewBranchNameError({
		normalizedBranchName: normalizedNewBranchName,
		fullBranchName,
		branches,
	})
);
const canCreateBranch = $derived(
	getCanCreateBranch({
		normalizedBranchName: normalizedNewBranchName,
		error: newBranchNameError,
		switchingBranch,
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

function handleCreateBranch(): void {
	if (!canCreateBranch) return;
	handleSwitchBranch(fullBranchName, true);
}

function openCreateBranchDialog(): void {
	branchPopoverOpen = false;
	newBranchName = "";
	selectedPrefix = BRANCH_PREFIXES[0];
	createBranchDialogOpen = true;
	queueMicrotask(() => newBranchInputRef?.focus());
}
</script>

{#if isGitRepo === false}
	<Button
		variant="ghost"
		size="sm"
		class={cn(
			"gap-1.5 w-full px-2 text-[11px]",
			variant === "minimal" ? minimalTriggerClass : "h-7"
		)}
		disabled={!projectPath || !onInitGitRepo}
		onclick={() => onInitGitRepo?.()}
	>
		<GitBranch class="h-3 w-3 shrink-0" weight="fill" />
		<span class="text-[11px] leading-none">Initialize Git</span>
	</Button>
{:else}
	<Selector
		bind:open={branchPopoverOpen}
		disabled={!projectPath}
		align="end"
		blockingOverlay
		variant="ghost"
		class="w-full h-full"
		triggerSize={variant === "minimal" ? "minimal" : "default"}
	>
		{#snippet renderButton()}
			<GitBranch class="size-3 shrink-0" weight="fill" style="color: {Colors.purple}" />
			<span class="text-xs font-mono max-w-[9rem] truncate" title={currentBranch || "branch"}>
				{currentBranch || "branch"}
			</span>
			{#if diffStats}
				<DiffPill
					insertions={diffStats.insertions}
					deletions={diffStats.deletions}
					variant="plain"
				/>
			{/if}
		{/snippet}

		<!-- Search -->
		<div class="sticky top-0 z-10 bg-popover px-2 py-1.5">
			<div class="relative">
				<MagnifyingGlass
					class="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
					weight="fill"
				/>
				<Input
					bind:ref={branchInputRef}
					bind:value={branchQuery}
					placeholder="Filter..."
					class="h-7 border-0 bg-muted/50 pl-7 text-xs font-mono placeholder:font-sans placeholder:text-muted-foreground/50"
				/>
			</div>
		</div>

		<!-- Branches -->
		<DropdownMenu.Label class="text-[10px] uppercase tracking-wider font-medium !border-b-0">
			Branches
		</DropdownMenu.Label>
		<div
			class="max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
		>
			{#if branchListDisplay.kind === "loading"}
				<div class="px-2 py-1 text-[11px] text-muted-foreground/60 font-mono">
					{branchListDisplay.message}
				</div>
			{:else if branchListDisplay.kind === "failed" || branchListDisplay.kind === "empty"}
				<div class="px-2 py-1 text-[11px] text-muted-foreground/60">
					{branchListDisplay.message}
				</div>
			{:else}
				{#each branchListDisplay.branches as branch (branch)}
					<DropdownMenu.Item
						onSelect={() => handleSwitchBranch(branch, false)}
						class={cn(branch === currentBranch && "bg-accent")}
					>
						<div class="flex w-full items-center gap-2">
							<GitBranch class="size-3.5 shrink-0" weight="fill" style="color: {Colors.purple}" />
							<span class="flex-1 truncate font-mono">{branch}</span>
							{#if branch === currentBranch}
								<Check class="size-4 shrink-0 text-foreground" />
							{/if}
						</div>
					</DropdownMenu.Item>
				{/each}
			{/if}
		</div>

		<!-- Actions -->
		{#if !isWorktree}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={openCreateBranchDialog}>
				<GitBranch class="size-3.5 shrink-0" weight="fill" style="color: {Colors.purple}" />
				<span>New branch...</span>
			</DropdownMenu.Item>
		{/if}
	</Selector>
{/if}

<!-- Create branch dialog -->
<Dialog.Root bind:open={createBranchDialogOpen}>
	<Dialog.Content class="max-w-md rounded-2xl">
		<Dialog.Header>
			<Dialog.Title>Create and checkout branch</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-3 py-2">
			<label for="new-branch-name" class="text-sm font-medium">Branch name</label>
			<div class="flex items-stretch">
				<Selector
					bind:open={prefixDropdownOpen}
					align="start"
					sideOffset={4}
					blockingOverlay
					variant="outline"
					triggerSize="minimal"
					class="shrink-0 rounded-l-md border-r-0"
				>
					{#snippet renderButton()}
						<selectedPrefix.icon
							class="h-3.5 w-3.5 shrink-0"
							weight="fill"
							style="color: {selectedPrefix.color}"
						/>
						<span class="font-mono">{selectedPrefix.value || "\u2014"}</span>
					{/snippet}

					{#each BRANCH_PREFIXES as prefix (prefix.label)}
						<DropdownMenu.Item
							onSelect={() => {
								selectedPrefix = prefix;
								prefixDropdownOpen = false;
								queueMicrotask(() => newBranchInputRef?.focus());
							}}
						>
							<prefix.icon
								class="h-3.5 w-3.5 shrink-0"
								weight="fill"
								style="color: {prefix.color}"
							/>
							<span class="flex-1">{prefix.label}</span>
							{#if selectedPrefix === prefix}
								<Check class="size-4 shrink-0 text-foreground" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</Selector>

				<Input
					id="new-branch-name"
					bind:ref={newBranchInputRef}
					bind:value={newBranchName}
					placeholder="my-feature"
					class="rounded-l-none font-mono"
					onkeydown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							handleCreateBranch();
						}
					}}
				/>
			</div>
			{#if newBranchNameError}
				<p class="text-[12px] text-destructive">{newBranchNameError}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" class="rounded-lg" onclick={() => (createBranchDialogOpen = false)}>
				Close
			</Button>
			<Button class="rounded-lg" disabled={!canCreateBranch} onclick={handleCreateBranch}>
				Create and checkout
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
