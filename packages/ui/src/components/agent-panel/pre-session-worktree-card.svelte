<script lang="ts">
	import type { Snippet } from "svelte";
	import {
		ArrowCounterClockwise,
		CheckCircle,
		Terminal,
		Tree,
		WarningCircle,
		X,
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

	function toggleExpanded() {
		isExpanded = !isExpanded;
	}

	const treeIconClass = $derived(
		alwaysEnabled ? "text-purple-400" : worktreeOn ? "text-success" : "text-destructive"
	);
	const hasExpandable = $derived(expandedContent !== undefined);
	const showExpanded = $derived(isExpanded && hasExpandable);
</script>

{#if failureMessage}
	<div class="w-full">
		<div
			class="flex w-full items-center gap-1.5 rounded-lg bg-input/30 px-3 py-1"
			class:rounded-b-none={showExpanded}
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
								<Terminal size={12} />
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

		{#if showExpanded && expandedContent}
			<div class="rounded-b-lg border-t border-border/30 bg-input/30 px-3 pb-3 pt-2">
				{@render expandedContent()}
			</div>
		{/if}
	</div>
{:else}
	<div class={showExpanded ? "w-full" : ""}>
		<div
			class="flex items-center gap-1.5 rounded-lg bg-input/30 px-3 py-1"
			class:w-full={showExpanded}
			class:w-fit={!showExpanded}
			class:mx-auto={!showExpanded}
			class:rounded-b-none={showExpanded}
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
							<Terminal size={12} />
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

			<button
				type="button"
				class="ml-auto flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
				onclick={onDismiss}
				aria-label="Dismiss"
			>
				<X size={12} />
			</button>
		</div>

		{#if showExpanded && expandedContent}
			<div class="rounded-b-lg border-t border-border/30 bg-input/30 px-3 pb-3 pt-2">
				{@render expandedContent()}
			</div>
		{/if}
	</div>
{/if}
