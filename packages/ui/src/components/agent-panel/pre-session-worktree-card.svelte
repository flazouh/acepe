<script lang="ts">
	import type { Snippet } from "svelte";
	import {
		ArrowCounterClockwise,
		CaretRight,
		CheckCircle,
		Tree,
		WarningCircle,
		XCircle,
	} from "phosphor-svelte";
	import { Button } from "../button/index.js";
	import { SegmentedToggleGroup } from "../panel-header/index.js";
	import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip/index.js";

	interface Props {
		label: string;
		yesLabel: string;
		noLabel: string;
		alwaysLabel: string;
		pendingWorktreeEnabled: boolean;
		alwaysEnabled?: boolean;
		failureMessage?: string | null;
		retryLabel?: string;
		dismissLabel?: string;
		setupScriptsLabel?: string | null;
		expandedContent?: Snippet;
		onYes: () => void;
		onNo: () => void;
		onAlways: () => void;
		onDismiss: () => void;
		onRetry?: () => void;
	}

	let {
		label,
		yesLabel,
		noLabel,
		alwaysLabel,
		pendingWorktreeEnabled,
		alwaysEnabled = false,
		failureMessage = null,
		retryLabel = "Retry",
		dismissLabel = "Dismiss",
		setupScriptsLabel = null,
		expandedContent,
		onYes,
		onNo,
		onAlways,
		onDismiss,
		onRetry,
	}: Props = $props();

	let isExpanded = $state(false);
	let headerElement = $state<HTMLDivElement | null>(null);
	let expandedWidth = $state<number | null>(null);

	const worktreeOn = $derived(pendingWorktreeEnabled || alwaysEnabled);
	const toggleValue = $derived(worktreeOn ? "yes" : "no");
	const toggleItems = $derived([
		{ id: "yes", label: yesLabel },
		{ id: "no", label: noLabel },
	] as const);

	function handleToggleChange(id: string) {
		if (id === "yes") {
			onYes();
		} else {
			onNo();
		}
	}

	function measureHeaderWidth() {
		if (!headerElement) return;
		const nextWidth = Math.ceil(headerElement.getBoundingClientRect().width);
		if (nextWidth > 0) {
			expandedWidth = nextWidth;
		}
	}

	function toggleExpanded() {
		if (!isExpanded) {
			measureHeaderWidth();
		}
		isExpanded = !isExpanded;
	}

	const treeIconClass = $derived(
		alwaysEnabled ? "text-purple-400" : worktreeOn ? "text-success" : "text-destructive"
	);
	const hasExpandable = $derived(expandedContent !== undefined);
	const showExpanded = $derived(isExpanded && hasExpandable);
	const lockedWidth = $derived(showExpanded && expandedWidth !== null ? `${expandedWidth}px` : null);

	$effect(() => {
		const header = headerElement;
		if (!header) return;
		if (!isExpanded) {
			measureHeaderWidth();
		}
		if (typeof ResizeObserver !== "function") return;
		const observer = new ResizeObserver(() => {
			if (!isExpanded) {
				measureHeaderWidth();
			}
		});
		observer.observe(header);
		return () => observer.disconnect();
	});
</script>

{#if failureMessage}
	<div
		class="mx-auto w-fit worktree-card-root"
		class:expanded={showExpanded}
		style:width={lockedWidth}
		style:max-width={showExpanded ? "100%" : null}
	>
		<div
			bind:this={headerElement}
			class="flex items-center gap-1.5 rounded-lg bg-input/30 px-3 py-1"
			class:rounded-b-none={showExpanded}
			class:w-fit={!showExpanded}
			class:w-full={showExpanded}
		>
			<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
			<span class="shrink-0 text-[0.6875rem] font-medium text-foreground">Worktree failed</span>
			<span class="min-w-0 truncate text-[0.6875rem] text-muted-foreground">{failureMessage}</span>
			<div class="ml-auto flex shrink-0 items-center gap-1.5" onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
				{#if hasExpandable}
					<Tooltip>
						<TooltipTrigger>
							<button
								type="button"
								class="flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
								onclick={toggleExpanded}
								aria-expanded={isExpanded}
							>
								<CaretRight size={12} weight="bold" class="transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}" />
							</button>
						</TooltipTrigger>
						<TooltipContent>{setupScriptsLabel ?? "Setup scripts"}</TooltipContent>
					</Tooltip>
				{/if}
				{#if onRetry}
					<Button variant="headerAction" size="headerAction" onclick={onRetry}>
						<ArrowCounterClockwise size={12} class="shrink-0" />
						{retryLabel}
					</Button>
				{/if}
				<Button variant="headerAction" size="headerAction" onclick={onDismiss}>
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
{:else}
	<div
		class="mx-auto w-fit worktree-card-root"
		class:expanded={showExpanded}
		style:width={lockedWidth}
		style:max-width={showExpanded ? "100%" : null}
	>
		<div
			bind:this={headerElement}
			class="flex items-center gap-1.5 rounded-lg bg-input/30 px-3 py-1"
			class:rounded-b-none={showExpanded}
			class:w-fit={!showExpanded}
			class:w-full={showExpanded}
		>
			{#if hasExpandable}
				<Tooltip>
					<TooltipTrigger>
						<button
							type="button"
							class="flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
							onclick={toggleExpanded}
							aria-expanded={isExpanded}
						>
							<CaretRight size={12} weight="bold" class="transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}" />
						</button>
					</TooltipTrigger>
					<TooltipContent>{setupScriptsLabel ?? "Setup scripts"}</TooltipContent>
				</Tooltip>
			{/if}

			<Tree size={12} weight="fill" class="shrink-0 {treeIconClass}" />
			<span class="text-[0.6875rem] font-medium text-foreground">{label}</span>

			<div class="flex shrink-0 items-center gap-1.5" onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
				<SegmentedToggleGroup
					items={toggleItems}
					value={toggleValue}
					onChange={handleToggleChange}
				>
					{#snippet itemContent(item)}
						{#if item.id === "yes"}
							<CheckCircle size={12} weight={worktreeOn ? "fill" : "regular"} class={worktreeOn ? "text-success" : ""} />
						{:else}
							<XCircle size={12} weight={!worktreeOn ? "fill" : "regular"} class={!worktreeOn ? "text-destructive" : ""} />
						{/if}
						{item.label}
					{/snippet}
				</SegmentedToggleGroup>

				<label class="flex cursor-pointer select-none items-center gap-1">
					<input
						type="checkbox"
						checked={alwaysEnabled}
						onchange={onAlways}
						class="accent-current h-3 w-3"
					/>
					<span class="text-[0.625rem] text-muted-foreground">{alwaysLabel}</span>
				</label>
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
	/* Opening locks the root to the measured collapsed header width,
	   so the top pill and bottom panel keep identical edges. */

	/* grid-template-rows 0fr → 1fr animates to live content height,
	   so async-loaded content (spinner → editor) does not jank mid-transition. */
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
