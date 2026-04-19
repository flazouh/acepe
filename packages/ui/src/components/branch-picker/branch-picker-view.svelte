<script lang="ts">
	import { Check, GitBranch, MagnifyingGlass } from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import { Colors } from "../../lib/colors.js";
	import { DiffPill } from "../diff-pill/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Input } from "../input/index.js";
	import { Selector } from "../selector/index.js";
	import { cn } from "../../lib/utils.js";
	import type { BranchPickerDiffStats, BranchPickerVariant } from "./types.js";

	interface Props {
		/** Current branch name to show in the trigger. null = no branch known. */
		currentBranch: string | null;
		/** Diff stats pill shown in the trigger, optional. */
		diffStats: BranchPickerDiffStats | null;
		/** List of available branches for the dropdown. */
		branches: readonly string[];
		/** Filter query (controlled by the shell, reported via onQueryChange). */
		query?: string;
		/** Dropdown open state (bindable). */
		open?: boolean;
		/** Disable all interaction (e.g. no project selected). */
		disabled?: boolean;
		/** True while branches are loading. */
		loadingBranches?: boolean;
		/** True when the branch list failed to load. */
		branchLoadFailed?: boolean;
		/** True if this is a worktree (locks branch + hides "New branch"). */
		isWorktree?: boolean;
		/** True if the current directory is not a git repo. */
		isNotGitRepo?: boolean;
		/** True when "Initialize git" is possible. */
		canInitGitRepo?: boolean;
		/** Visual density for the trigger. */
		variant?: BranchPickerVariant;
		/** Input ref used by the controller to focus on open. */
		searchInputRef?: HTMLInputElement | null;
		/** Labels. */
		branchesLabel?: string;
		newBranchLabel?: string;
		initGitLabel?: string;
		filterPlaceholder?: string;
		loadingLabel?: string;
		loadFailedLabel?: string;
		noBranchesLabel?: string;
		branchFallbackLabel?: string;
		/** Callbacks. */
		onQueryChange?: (query: string) => void;
		onSelectBranch?: (branch: string) => void;
		onCreateNewBranch?: () => void;
		onInitGitRepo?: () => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		currentBranch,
		diffStats,
		branches,
		query = $bindable(""),
		open = $bindable(false),
		disabled = false,
		loadingBranches = false,
		branchLoadFailed = false,
		isWorktree = false,
		isNotGitRepo = false,
		canInitGitRepo = false,
		variant = "default",
		searchInputRef = $bindable(null),
		branchesLabel = "Branches",
		newBranchLabel = "New branch...",
		initGitLabel = "Initialize Git",
		filterPlaceholder = "Filter...",
		loadingLabel = "Loading...",
		loadFailedLabel = "Could not load branches",
		noBranchesLabel = "No branches found",
		branchFallbackLabel = "branch",
		onQueryChange,
		onSelectBranch,
		onCreateNewBranch,
		onInitGitRepo,
		onOpenChange,
	}: Props = $props();

	const minimalTriggerClass =
		"!border-0 !h-[26px] rounded-md hover:rounded-full transition-[border-radius]";

	const normalizedQuery = $derived(query.trim().toLowerCase());

	const filteredBranches = $derived.by(() => {
		if (!normalizedQuery) return branches;
		return branches.filter((branch) => branch.toLowerCase().includes(normalizedQuery));
	});

	function handleQueryChange(value: string): void {
		query = value;
		onQueryChange?.(value);
	}
</script>

{#if isNotGitRepo}
	<Button
		variant="ghost"
		size="sm"
		class={cn(
			"gap-1.5 w-full px-2 text-[11px]",
			variant === "minimal" ? minimalTriggerClass : "h-7"
		)}
		disabled={!canInitGitRepo}
		onclick={() => onInitGitRepo?.()}
	>
		<GitBranch class="h-3 w-3 shrink-0" weight="fill" />
		<span class="text-[11px] leading-none">{initGitLabel}</span>
	</Button>
{:else}
	<Selector
		bind:open
		{disabled}
		align="end"
		contentClass="z-[var(--app-blocking-z)] isolate w-[272px]"
		variant="ghost"
		class="w-full h-full"
		buttonClass={cn(variant === "minimal" && minimalTriggerClass)}
		{onOpenChange}
	>
		{#snippet renderButton()}
			<GitBranch
				class="size-3 shrink-0"
				weight="fill"
				style="color: {Colors.purple}"
			/>
			<span
				class="text-xs font-mono max-w-[9rem] truncate"
				title={currentBranch || branchFallbackLabel}
			>
				{currentBranch || branchFallbackLabel}
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
					bind:ref={searchInputRef}
					value={query}
					oninput={(event: Event) => {
						const target = event.currentTarget as HTMLInputElement;
						handleQueryChange(target.value);
					}}
					placeholder={filterPlaceholder}
					class="h-7 border-0 bg-muted/50 pl-7 text-xs font-mono placeholder:font-sans placeholder:text-muted-foreground/50"
				/>
			</div>
		</div>

		<!-- Branches -->
		<DropdownMenu.Label
			class="text-[10px] uppercase tracking-wider font-medium !border-b-0"
		>
			{branchesLabel}
		</DropdownMenu.Label>
		<div
			class="max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
		>
			{#if loadingBranches}
				<div class="px-2 py-1 text-[11px] text-muted-foreground/60 font-mono">
					{loadingLabel}
				</div>
			{:else if branchLoadFailed}
				<div class="px-2 py-1 text-[11px] text-muted-foreground/60">
					{loadFailedLabel}
				</div>
			{:else if filteredBranches.length === 0}
				<div
					class="px-2 py-1 text-[11px] text-muted-foreground/60"
					data-testid="branch-picker-empty"
				>
					{noBranchesLabel}
				</div>
			{:else}
				{#each filteredBranches as branch (branch)}
					<DropdownMenu.Item
						onSelect={() => onSelectBranch?.(branch)}
						class={cn(branch === currentBranch && "bg-accent")}
					>
						<div class="flex w-full items-center gap-2">
							<GitBranch
								class="size-3.5 shrink-0"
								weight="fill"
								style="color: {Colors.purple}"
							/>
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
		{#if !isWorktree && onCreateNewBranch}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => onCreateNewBranch?.()}>
				<GitBranch
					class="size-3.5 shrink-0"
					weight="fill"
					style="color: {Colors.purple}"
				/>
				<span>{newBranchLabel}</span>
			</DropdownMenu.Item>
		{/if}
	</Selector>
{/if}
