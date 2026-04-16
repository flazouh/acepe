<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { WarningCircle } from "phosphor-svelte";

	interface Props {
		title: string;
		summary: string;
		details: string;
		detailsLabel?: string;
		dismissLabel?: string;
		referenceId?: string;
		referenceSearchable?: boolean;
		referenceLabel?: string;
		searchableReferenceLabel?: string;
		localOnlyReferenceLabel?: string;
		copyReferenceIdLabel?: string;
		issueActionLabel?: string;
		retryLabel?: string;
		onRetry?: (() => void) | undefined;
		onDismiss?: (() => void) | undefined;
		onCopyReferenceId?: (() => void) | undefined;
		onIssueAction?: (() => void) | undefined;
	}

	let {
		title,
		summary,
		details,
		detailsLabel = "Details",
		dismissLabel = "Dismiss",
		referenceId = undefined,
		referenceSearchable = false,
		referenceLabel = "Reference ID",
		searchableReferenceLabel = "Searchable",
		localOnlyReferenceLabel = "Local only",
		copyReferenceIdLabel = "Copy ID",
		issueActionLabel = "Create issue",
		retryLabel = "Retry",
		onRetry,
		onDismiss,
		onCopyReferenceId,
		onIssueAction,
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
			{#if referenceId}
				<div class="flex items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
					<div class="flex min-w-0 items-center gap-2 text-[0.625rem]">
						<span class="shrink-0 uppercase tracking-[0.12em] text-muted-foreground/80">
							{referenceLabel}
						</span>
						<code class="truncate rounded bg-background/60 px-1.5 py-0.5 font-mono text-foreground">
							{referenceId}
						</code>
						<span class="shrink-0 text-muted-foreground/70">
							{referenceSearchable ? searchableReferenceLabel : localOnlyReferenceLabel}
						</span>
					</div>
					{#if onCopyReferenceId}
						<button
							type="button"
							class="h-6 shrink-0 rounded px-2 text-[10px] font-mono text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
							onclick={(event) => {
								event.stopPropagation();
								onCopyReferenceId();
							}}
						>
							{copyReferenceIdLabel}
						</button>
					{/if}
				</div>
			{/if}
		{#if onDismiss || onRetry || onIssueAction}
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
				{#if onIssueAction}
					<button
						type="button"
						class="h-6 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent/60 rounded transition-colors cursor-pointer"
						onclick={onIssueAction}
					>
						{issueActionLabel}
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
