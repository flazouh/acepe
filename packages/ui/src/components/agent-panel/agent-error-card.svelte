<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { WarningCircle } from "phosphor-svelte";

	interface Props {
		title: string;
		summary: string;
		details: string;
		detailsLabel?: string;
		dismissLabel?: string;
		createIssueLabel?: string;
		retryLabel?: string;
		onRetry?: (() => void) | undefined;
		onDismiss?: (() => void) | undefined;
		onCreateIssue?: (() => void) | undefined;
	}

	let {
		title,
		summary,
		details,
		detailsLabel = "Details",
		dismissLabel = "Dismiss",
		createIssueLabel = "Create issue",
		retryLabel = "Retry",
		onRetry,
		onDismiss,
		onCreateIssue,
	}: Props = $props();

	let isExpanded = $state(false);

	const hasDetails = $derived(details.trim().length > 0);

	function toggleExpanded(): void {
		if (!hasDetails) {
			return;
		}

		isExpanded = !isExpanded;
	}
</script>

<div class="w-full">
	{#if isExpanded && hasDetails}
		<div class="rounded-t-lg bg-accent/50 overflow-hidden">
			<div class="max-h-[220px] overflow-y-auto px-3 py-2">
				<pre class="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words text-foreground/80">{details}</pre>
			</div>
		</div>
	{/if}

	<div
		class="w-full rounded-lg bg-accent hover:bg-accent/80 transition-colors {isExpanded &&
		hasDetails
			? 'rounded-t-none'
			: ''}"
	>
		<button
			type="button"
			class="w-full flex items-center justify-between px-3 py-1"
			onclick={toggleExpanded}
			aria-expanded={hasDetails ? isExpanded : undefined}
		>
			<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
				<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
				<span class="font-medium text-foreground shrink-0">{title}</span>
				<span class="truncate text-muted-foreground">{summary}</span>
				{#if hasDetails}
					<span class="shrink-0 text-muted-foreground/60 ml-0.5">{detailsLabel}</span>
				{/if}
			</div>
			<ChevronDown
				class="size-3.5 text-muted-foreground shrink-0 transition-transform duration-200 {isExpanded
					? 'rotate-180'
					: ''}"
			/>
		</button>
		{#if onDismiss || onCreateIssue || onRetry}
			<div class="flex items-center justify-end gap-1 px-2 pb-2">
				{#if onDismiss}
					<button
						type="button"
						class="h-6 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent/60 rounded transition-colors cursor-pointer"
						onclick={onDismiss}
					>
						{dismissLabel}
					</button>
				{/if}
				{#if onCreateIssue}
					<button
						type="button"
						class="h-6 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent/60 rounded transition-colors cursor-pointer"
						onclick={onCreateIssue}
					>
						{createIssueLabel}
					</button>
				{/if}
				{#if onRetry}
					<button
						type="button"
						class="h-6 px-2 text-[10px] font-mono font-medium text-foreground bg-accent/60 hover:bg-accent/80 rounded transition-colors cursor-pointer"
						onclick={onRetry}
					>
						{retryLabel}
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
