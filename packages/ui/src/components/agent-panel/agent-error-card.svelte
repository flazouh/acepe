<script lang="ts">
	import { WarningCircle } from "phosphor-svelte";
	import { Button } from "../button/index.js";
	import { LoadingIcon } from "../icons/index.js";

	interface Props {
		title: string;
		summary: string;
		details: string;
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
		dismissLabel = "Dismiss",
		issueActionLabel = "Create issue",
		retryLabel = "Retry",
		retryingLabel = "Retrying…",
		isRetrying = false,
		onRetry,
		onDismiss,
		onIssueAction,
	}: Props = $props();

	const hasDetails = $derived(details.trim().length > 0);
	const hasSummary = $derived(summary.trim().length > 0);
</script>

<div class="w-full rounded-lg border border-border bg-input/30">
	{#if hasDetails}
		<div class="max-h-[220px] overflow-y-auto border-b border-border px-3 py-2">
			<pre
				class="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words text-foreground/80"
			>{details}</pre>
		</div>
	{/if}

	<div class="flex w-full min-w-0 items-center gap-3 pl-1 pr-3 py-1">
		<div class="flex min-w-0 flex-1 items-center gap-1.5 text-[0.6875rem]">
			<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
			<span class="shrink-0 font-medium text-foreground">{title}</span>
			{#if hasSummary}
				<span class="truncate text-muted-foreground">{summary}</span>
			{/if}
		</div>

		{#if onDismiss || onRetry || onIssueAction}
			<div
				class="ml-auto flex shrink-0 items-center gap-1"
				role="none"
				onclick={(event: MouseEvent) => event.stopPropagation()}
			>
				{#if onDismiss}
					<Button variant="headerAction" size="headerAction" onclick={onDismiss}>
						{dismissLabel}
					</Button>
				{/if}
				{#if onIssueAction}
					<Button variant="headerAction" size="headerAction" onclick={onIssueAction}>
						{issueActionLabel}
					</Button>
				{/if}
				{#if onRetry}
					<Button
						variant="headerAction"
						size="headerAction"
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
		{/if}
	</div>
</div>
