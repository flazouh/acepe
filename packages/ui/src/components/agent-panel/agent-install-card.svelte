<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import type { Snippet } from "svelte";

	const SEGMENT_COUNT = 20;
	const segmentIndexes = Array.from({ length: SEGMENT_COUNT }, (_, index) => index);

	interface Props {
		title: string;
		summary: string;
		details?: string | null;
		progressPercent: number;
		ariaLabel?: string;
		leading?: Snippet;
		progressIndicator?: Snippet;
	}

	let {
		title,
		summary,
		details = null,
		progressPercent,
		ariaLabel,
		leading,
		progressIndicator,
	}: Props = $props();

	let isExpanded = $state(false);

	const clampedProgress = $derived(
		progressPercent < 0 ? 0 : progressPercent > 100 ? 100 : progressPercent
	);
	const filledSegmentCount = $derived(Math.round((clampedProgress / 100) * SEGMENT_COUNT));
	const detailsText = $derived(details && details.length > 0 ? details : summary);
	const progressAriaLabel = $derived(ariaLabel ?? `${title} ${summary}`);

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
		class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-accent hover:bg-accent/80 transition-colors cursor-pointer"
		aria-expanded={isExpanded}
	>
		<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
			{#if leading}
				{@render leading()}
			{:else}
				<div
					class="size-[13px] rounded-full border-2 border-muted-foreground/30 border-t-foreground/70 animate-spin shrink-0"
				></div>
			{/if}

			<span class="font-medium text-foreground shrink-0">{title}</span>

			<span class="truncate text-muted-foreground">
				{summary}
			</span>
		</div>

		<div class="flex items-center gap-2 shrink-0">
			{#if progressIndicator}
				{@render progressIndicator()}
			{:else}
				<div
					class="voice-download-segments"
					role="progressbar"
					aria-label={progressAriaLabel}
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={clampedProgress}
				>
					{#each segmentIndexes as segmentIndex}
						<span
							class="voice-download-segment {segmentIndex < filledSegmentCount
								? 'filled'
								: ''}"
						></span>
					{/each}
				</div>
			{/if}
			<ChevronDown
				class="size-3.5 text-muted-foreground transition-transform duration-200 {isExpanded
					? 'rotate-180'
					: ''}"
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

<style>
	.voice-download-segments {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.voice-download-segment {
		width: 4px;
		height: 10px;
		border-radius: 9999px;
		background: color-mix(in oklab, var(--muted-foreground) 18%, transparent);
	}

	.voice-download-segment.filled {
		background: color-mix(in oklab, var(--foreground) 68%, transparent);
	}
</style>
