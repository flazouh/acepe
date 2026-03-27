<script lang="ts">
interface Props {
	current: number;
	total: number;
	segmentClass?: string;
	filledClass?: string;
	emptyClass?: string;
}

let {
	current,
	total,
	segmentClass = "segmented-progress-segment",
	filledClass = "segmented-progress-segment-filled",
	emptyClass = "segmented-progress-segment-empty",
}: Props = $props();

const segments = $derived.by(() => {
	const safeTotal = total > 0 ? total : 0;
	const safeCurrent = current > 0 ? Math.min(current, safeTotal) : 0;

	return Array.from({ length: safeTotal }, (_, index) => index < safeCurrent);
});
</script>

<div class="flex items-center gap-0.5 shrink-0" aria-hidden="true">
	{#each segments as isFilled, index (index)}
		<div
			data-testid="todo-progress-segment"
			data-filled={isFilled ? "true" : "false"}
			class="{segmentClass} {isFilled ? filledClass : emptyClass}"
		></div>
	{/each}
</div>

<style>
	.segmented-progress-segment {
		width: 3px;
		height: 10px;
		border-radius: 999px;
		transition: background-color 160ms ease-out, opacity 160ms ease-out, transform 160ms ease-out;
		opacity: 0.55;
	}

	.segmented-progress-segment-filled {
		background: #f9c396;
		opacity: 1;
	}

	.segmented-progress-segment-empty {
		background: color-mix(in srgb, var(--border) 55%, transparent);
		height: 5px;
	}
</style>
