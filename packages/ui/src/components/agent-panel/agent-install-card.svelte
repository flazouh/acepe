<script lang="ts">
	import type { Snippet } from "svelte";

	import { LoadingIcon, HugeiconsIcon } from "../icons/index.js";

	// The card carries no progress of its own. Installing an agent runs over a
	// request/response call that reports nothing between start and finish, so
	// the caller passes the indicator it wants to show for that wait. This
	// used to own a 20-segment bar driven by a `progressPercent` prop; the
	// only caller never had a percentage to give it, and the bar sat at 0 for
	// the whole install.
	interface Props {
		title: string;
		summary: string;
		details?: string | null;
		leading?: Snippet;
		progressIndicator: Snippet;
	}

	let { title, summary, details = null, leading, progressIndicator }: Props = $props();

	let isExpanded = $state(false);

	const detailsText = $derived(details && details.length > 0 ? details : summary);

	function toggleExpanded(): void {
		isExpanded = !isExpanded;
	}
</script>

<div class="w-full">
	<div
		role="button"
		tabindex="0"
		onclick={toggleExpanded}
		onkeydown={(event: KeyboardEvent) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				toggleExpanded();
			}
		}}
		class="w-full flex items-center justify-between px-3 py-1.5 rounded bg-accent hover:bg-accent/80 transition-colors cursor-pointer"
		aria-expanded={isExpanded}
	>
		<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
			{#if leading}
				{@render leading()}
			{:else}
				<LoadingIcon class="shrink-0 text-muted-foreground" size={13} aria-label="Loading" />
			{/if}

			<span class="font-medium text-foreground shrink-0">{title}</span>

			<span class="truncate text-muted-foreground">
				{summary}
			</span>
		</div>

		<div class="flex items-center gap-2 shrink-0">
			{@render progressIndicator()}
			<HugeiconsIcon name="chevron-down" class="size-3 shrink-0 text-muted-foreground transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}"
			/>
		</div>
	</div>

	{#if isExpanded}
		<div class="rounded-b-lg bg-accent/50 overflow-hidden">
			<div class="px-3 py-2">
				<pre class="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words text-foreground/80">{detailsText}</pre>
			</div>
		</div>
	{/if}
</div>
