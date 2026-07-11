<script lang="ts">
	import { Button } from "../button/index.js";
	import { LoadingIcon, RoundedIcon } from "../icons/index.js";

	interface Props {
		title: string;
		summary: string;
		details: string;
		detailsHtml?: string | null;
		dismissLabel?: string;
		issueActionLabel?: string;
		retryLabel?: string;
		retryingLabel?: string;
		isRetrying?: boolean;
		onRetry?: (() => void) | undefined;
		onDismiss?: (() => void) | undefined;
		onIssueAction?: (() => void) | undefined;
	}

	let {
		title,
		summary,
		details,
		detailsHtml = null,
		dismissLabel = "Dismiss",
		issueActionLabel = "Create issue",
		retryLabel = "Retry",
		retryingLabel = "Retrying…",
		isRetrying = false,
		onRetry,
		onDismiss,
		onIssueAction,
	}: Props = $props();

	const hasDetailsHtml = $derived(detailsHtml !== null && detailsHtml.trim().length > 0);
	const hasDetails = $derived(!hasDetailsHtml && details.trim().length > 0);
	const hasSummary = $derived(summary.trim().length > 0);
</script>

<div
	class="w-full overflow-hidden rounded-lg border border-border bg-input/30"
	role="alert"
	aria-label={hasSummary ? summary : title}
	data-qa="agent-error-card"
>
	<div class="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
		<RoundedIcon name="warning" class="mt-0.5 size-[15px] shrink-0 text-destructive" />
		<div class="min-w-0 flex-1">
			<p
				class="break-words text-sm font-medium leading-snug text-foreground"
				data-qa="agent-error-primary-message"
			>
				{hasSummary ? summary : title}
			</p>
			{#if hasSummary && title.trim() !== summary.trim()}
				<p class="mt-0.5 text-[0.6875rem] text-muted-foreground">{title}</p>
			{/if}
		</div>
	</div>

	{#if onDismiss || onRetry || onIssueAction}
		<div
			class="flex items-center gap-1 border-t border-border/70 px-3 py-1.5"
			role="none"
			data-qa="agent-error-actions"
			onclick={(event: MouseEvent) => event.stopPropagation()}
		>
			<div class="ml-auto flex items-center gap-1">
				{#if onDismiss}
					<Button variant="secondary" size="xs" onclick={onDismiss}>
						{dismissLabel}
					</Button>
				{/if}
				{#if onIssueAction}
					<Button variant="secondary" size="xs" onclick={onIssueAction}>
						{issueActionLabel}
					</Button>
				{/if}
				{#if onRetry}
					<Button
						variant="default"
						size="xs"
						disabled={isRetrying}
						aria-busy={isRetrying ? "true" : undefined}
						onclick={onRetry}
					>
						{#if isRetrying}
							<LoadingIcon class="shrink-0" size={10} />
							{retryingLabel}
						{:else}
							{retryLabel}
						{/if}
					</Button>
				{/if}
			</div>
		</div>
	{/if}

	{#if hasDetailsHtml || hasDetails}
		<details class="group border-t border-border/70" data-qa="agent-error-technical-details">
			<summary
				class="cursor-pointer select-none px-3 py-1.5 text-[0.6875rem] font-medium text-muted-foreground hover:text-foreground"
			>
				Technical details
			</summary>
			{#if hasDetailsHtml}
				<div
					class="error-details-shiki max-h-[min(40vh,320px)] overflow-y-auto border-t border-border/70 px-3 py-2 [overflow-wrap:anywhere]"
				>
					{@html detailsHtml}
				</div>
			{:else if hasDetails}
				<div class="max-h-[min(40vh,320px)] overflow-y-auto border-t border-border/70 px-3 py-2">
					<pre
						class="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-foreground/75 [overflow-wrap:anywhere]"
					>{details}</pre>
				</div>
			{/if}
		</details>
	{/if}
</div>

<style>
	.error-details-shiki {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
		font-size: 0.75rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.error-details-shiki :global(pre),
	.error-details-shiki :global(code) {
		margin: 0;
		padding: 0;
		background: transparent !important;
		font-family: inherit;
	}

	.error-details-shiki :global(.line) {
		display: block;
		min-height: 1.5em;
	}

	.error-details-shiki :global(span) {
		color: var(--shiki-light);
	}

	:global(.dark) .error-details-shiki :global(span) {
		color: var(--shiki-dark);
	}
</style>
