<script lang="ts">
	import type { Snippet } from "svelte";
	import { Button } from "../button/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import { Selector } from "../selector/index.js";
	import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip/index.js";
	import { watchPreSessionWorktreeHeaderWidth } from "./pre-session-worktree-card-effects.js";
	import {
		getPreSessionWorktreeIconClass,
		getPreSessionWorktreeLockedWidth,
		getPreSessionWorktreeMode,
		getPreSessionWorktreeModeOptions,
		getSelectedPreSessionWorktreeModeOption,
		shouldShowPreSessionWorktreeExpanded,
		type WorktreeLaunchMode,
	} from "./pre-session-worktree-card-state.js";

	interface Props {
		variant?: "card" | "trigger";
		promptLabel?: string;
		localLabel?: string;
		worktreeLabel?: string;
		pendingWorktreeEnabled: boolean;
		failureMessage?: string | null;
		retryLabel?: string;
		dismissLabel?: string;
		setupScriptsLabel?: string | null;
		menuSide?: "top" | "bottom";
		expandedContent?: Snippet;
		onYes: () => void;
		onNo: () => void;
		onDismiss: () => void;
		onRetry?: () => void;
	}

	let {
		variant = "card",
		promptLabel = "Start in",
		localLabel = "Work locally",
		worktreeLabel = "New worktree",
		pendingWorktreeEnabled,
		failureMessage = null,
		retryLabel = "Retry",
		dismissLabel = "Dismiss",
		setupScriptsLabel = null,
		menuSide = "bottom",
		expandedContent,
		onYes,
		onNo,
		onDismiss,
		onRetry,
	}: Props = $props();

	let isExpanded = $state(false);
	let menuOpen = $state(false);
	let headerElement = $state<HTMLDivElement | null>(null);
	let expandedWidth = $state<number | null>(null);

	const launchMode = $derived(getPreSessionWorktreeMode({ pendingWorktreeEnabled }));
	const modeOptions = $derived(getPreSessionWorktreeModeOptions({ localLabel, worktreeLabel }));
	const selectedOption = $derived(
		getSelectedPreSessionWorktreeModeOption({ mode: launchMode, modeOptions })
	);
	const treeIconClass = $derived(getPreSessionWorktreeIconClass({ mode: launchMode }));
	const hasExpandable = $derived(expandedContent !== undefined && variant === "card");
	const showExpanded = $derived(shouldShowPreSessionWorktreeExpanded({ isExpanded, hasExpandable }));
	const lockedWidth = $derived(getPreSessionWorktreeLockedWidth({ showExpanded, expandedWidth }));
	const isTriggerOnly = $derived(variant === "trigger");
	const triggerClass = $derived(
		isTriggerOnly
			? menuOpen
				? "bg-accent text-foreground"
				: ""
			: "!h-6 gap-1.5 rounded-md border border-border/40 bg-background/70 px-2 text-[0.6875rem] font-medium text-foreground hover:bg-background"
	);
	const triggerIconSize = $derived(isTriggerOnly ? 12 : 14);

	function handleModeChange(nextMode: WorktreeLaunchMode) {
		if (nextMode === "worktree") {
			onYes();
		} else {
			onNo();
		}
		menuOpen = false;
	}

	function toggleExpanded() {
		isExpanded = !isExpanded;
	}

	$effect(() => {
		if (isTriggerOnly) {
			return;
		}
		return watchPreSessionWorktreeHeaderWidth({
			header: headerElement,
			isExpanded,
			onWidth: (width) => {
				expandedWidth = width;
			},
		});
	});
</script>

{#snippet modeIcon(mode: WorktreeLaunchMode, className = "", size = triggerIconSize)}
	{#if mode === "worktree"}
		<RoundedIcon
			name="worktree"
			class="shrink-0 {className}"
			style="width: {size}px; height: {size}px;"
			data-testid="pre-session-worktree-mode-icon"
		/>
	{:else}
		<RoundedIcon
			name="laptop"
			class="shrink-0 {className}"
			style="width: {size}px; height: {size}px;"
			data-testid="pre-session-worktree-mode-icon"
		/>
	{/if}
{/snippet}

{#snippet launchModeSelector()}
	<Selector
		bind:open={menuOpen}
		align="start"
		side={menuSide}
		sideOffset={4}
		variant="ghost"
		showChevron={true}
		triggerAriaLabel={selectedOption.label}
		contentClass="p-0.5"
		triggerSize={isTriggerOnly ? "footer" : "default"}
		{triggerClass}
	>
		{#snippet renderButton()}
			{@render modeIcon(
				selectedOption.id,
				selectedOption.id === "worktree" ? treeIconClass : "text-muted-foreground"
			)}
			<span class="max-w-[9rem] truncate text-foreground">{selectedOption.label}</span>
		{/snippet}

		<DropdownMenu.Label
			class="border-b-0 px-1.5 py-0.5 text-[0.625rem] leading-none font-normal text-muted-foreground"
		>
			{promptLabel}
		</DropdownMenu.Label>

		{#each modeOptions as option (option.id)}
			{@const selected = option.id === launchMode}
			<DropdownMenu.Item
				onSelect={() => handleModeChange(option.id)}
				class="cursor-pointer gap-1.5 rounded-sm !px-1.5 !py-0.5 text-[0.6875rem]"
			>
				<div class="flex w-full min-w-[8.5rem] items-center gap-1.5">
					{@render modeIcon(
						option.id,
						option.id === "worktree" && selected ? "text-success" : "text-muted-foreground",
						11
					)}
					<span class="min-w-0 flex-1 truncate text-foreground">{option.label}</span>
					<RoundedIcon
						name="check"
						class={selected ? "size-2.5 shrink-0 text-foreground" : "size-2.5 shrink-0 text-transparent"}
					/>
				</div>
			</DropdownMenu.Item>
		{/each}
	</Selector>
{/snippet}

{#if failureMessage}
	<div
		class="mx-auto w-fit worktree-card-root"
		class:expanded={showExpanded}
		style:width={lockedWidth}
		style:max-width={showExpanded ? "100%" : null}
	>
		<div
			bind:this={headerElement}
			class="flex items-center gap-1.5 rounded-lg bg-input/30 px-2.5 py-1"
			class:rounded-b-none={showExpanded}
			class:w-fit={!showExpanded}
			class:w-full={showExpanded}
		>
			<RoundedIcon name="warning" class="size-[13px] shrink-0 text-destructive" />
			<span class="shrink-0 text-[0.6875rem] font-medium text-foreground">Worktree failed</span>
			<span class="min-w-0 truncate text-[0.6875rem] text-muted-foreground">{failureMessage}</span>
			<div class="ml-auto flex shrink-0 items-center gap-1.5" onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
				{#if hasExpandable}
					<Tooltip>
						<TooltipTrigger>
							<button
								type="button"
								class="flex items-center justify-center rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
								onclick={toggleExpanded}
								aria-expanded={isExpanded}
							>
								<RoundedIcon name="chevron-right" class="size-3 shrink-0 transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}" />
							</button>
						</TooltipTrigger>
						<TooltipContent>{setupScriptsLabel ?? "Setup scripts"}</TooltipContent>
					</Tooltip>
				{/if}
				{#if onRetry}
					<Button variant="secondary" size="xs" onclick={onRetry}>
						<RoundedIcon
							name="arrow-counter-clockwise"
							class="size-3 shrink-0"
							data-testid="pre-session-worktree-retry-icon"
						/>
						{retryLabel}
					</Button>
				{/if}
				<Button variant="secondary" size="xs" onclick={onDismiss}>
					{dismissLabel}
				</Button>
			</div>
		</div>

		{#if hasExpandable && expandedContent}
			<div class="worktree-card-expand" aria-hidden={!showExpanded}>
				<div class="worktree-card-expand-inner">
					<div class="w-full rounded-b-lg border-t border-border/30 bg-input/30 px-3 pb-3 pt-2">
						{@render expandedContent()}
					</div>
				</div>
			</div>
		{/if}
	</div>
{:else if isTriggerOnly}
	<div class="flex min-w-0 items-center" onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
		{@render launchModeSelector()}
	</div>
{:else}
	<div
		class="mx-auto w-fit worktree-card-root"
		class:expanded={showExpanded}
		style:width={lockedWidth}
		style:max-width={showExpanded ? "100%" : null}
	>
		<div
			bind:this={headerElement}
			class="flex items-center gap-2 rounded-lg bg-input/30 px-2.5 py-1"
			class:rounded-b-none={showExpanded}
			class:w-fit={!showExpanded}
			class:w-full={showExpanded}
		>
			{#if hasExpandable}
				<Tooltip>
					<TooltipTrigger>
						<button
							type="button"
							class="flex items-center justify-center rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
							onclick={toggleExpanded}
							aria-expanded={isExpanded}
						>
							<RoundedIcon name="chevron-right" class="size-3 shrink-0 transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}" />
						</button>
					</TooltipTrigger>
					<TooltipContent>{setupScriptsLabel ?? "Setup scripts"}</TooltipContent>
				</Tooltip>
			{/if}

			<span class="shrink-0 text-[0.6875rem] text-muted-foreground">{promptLabel}</span>

			<div class="flex shrink-0 items-center" onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
				{@render launchModeSelector()}
			</div>
		</div>

		{#if hasExpandable && expandedContent}
			<div class="worktree-card-expand" aria-hidden={!showExpanded}>
				<div class="worktree-card-expand-inner">
					<div class="w-full rounded-b-lg border-t border-border/30 bg-input/30 px-3 pb-3 pt-2">
						{@render expandedContent()}
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.worktree-card-expand {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 220ms cubic-bezier(0.33, 1, 0.68, 1);
	}

	.worktree-card-root.expanded .worktree-card-expand {
		grid-template-rows: 1fr;
	}

	.worktree-card-expand-inner {
		min-height: 0;
		overflow: hidden;
	}
</style>
